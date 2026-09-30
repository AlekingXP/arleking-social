'use strict';

// Adaptador de Claude (Anthropic), con el SDK oficial.
//
// Hace UN turno: traduce la conversación neutra al formato de la API,
// reenvía el texto según llega y devuelve qué quiere hacer el modelo
// después. El bucle de herramientas vive en el agente y no aquí —por eso
// no se usa el Tool Runner del SDK—: ese bucle tiene que ser idéntico para
// todos los proveedores, y dentro de un adaptador dejaría de serlo.
//
// Lo que sí es de Anthropic y vive aquí:
//
//  · Pensamiento adaptativo con esfuerzo bajo: un chat de soporte no gana
//    nada pensando mucho y la latencia se nota, pero decidir si lo
//    encontrado responde de verdad a la pregunta sí merece una pausa.
//  · `fallbacks: "default"`: si el modelo declina una petición por una
//    política, la API la reintenta en el modelo recomendado dentro de la
//    misma llamada. Si la API rechazara el parámetro, se desactiva solo
//    (ver `usarFallbacks`) en vez de dejar el soporte caído.
//  · `eager_input_streaming`: las entradas de herramientas llegan sin que
//    el servidor las valide, así que herramientas.js las valida todas.
//  · El turno del asistente se reenvía íntegro —con sus bloques de
//    pensamiento— como exige la API para continuar tras una herramienta.

let Anthropic = null;
function sdk() {
  if (!Anthropic) {
    const modulo = require('@anthropic-ai/sdk');
    Anthropic = modulo.default || modulo;
  }
  return Anthropic;
}

const BETA_FALLBACKS = 'server-side-fallback-2026-07-01';
const MAX_REINTENTOS_JSON = 2;

// Tipos de bloque que no se reenvían si quedaron ANTES de un cambio de
// modelo por fallback: pertenecen al intento que se declinó.
const DEL_INTENTO_DECLINADO = new Set(['thinking', 'redacted_thinking', 'tool_use', 'server_tool_use']);

class JsonIlegible extends Error {}

function crearProveedorAnthropic(opciones = {}) {
  const apiKey = opciones.apiKey !== undefined ? opciones.apiKey : process.env.ANTHROPIC_API_KEY;
  const baseURL = opciones.baseURL !== undefined ? opciones.baseURL : process.env.ANTHROPIC_BASE_URL;
  const modelo = opciones.modelo || process.env.SUPPORT_MODEL || 'claude-opus-5';
  const esfuerzo = opciones.esfuerzo || process.env.SUPPORT_EFFORT || 'low';
  // Respuestas deliberadamente cortas y un endpoint con tope de gasto: 4096
  // deja sitio al pensamiento sin permitir un monólogo.
  const maxTokens = opciones.maxTokens || 4096;

  let usarFallbacks = (opciones.fallbacks || process.env.SUPPORT_FALLBACKS || 'on') !== 'off';
  // Con un servidor intermedio propio (ANTHROPIC_BASE_URL) no se sabe si
  // acepta el campo; la documentación aconseja no mandarlo en ese caso.
  const entradaEnVivo = !baseURL;

  let cliente = null;

  function obtenerCliente() {
    if (!apiKey) return null;
    if (!cliente) {
      const Cliente = sdk();
      cliente = new Cliente({
        apiKey,
        ...(baseURL ? { baseURL } : {}),
        maxRetries: 1, // una respuesta lenta es peor que una degradada
        timeout: 60 * 1000,
      });
    }
    return cliente;
  }

  function disponible() {
    return Boolean(apiKey);
  }

  // ---- Traducción neutra -> Anthropic ----

  function aHerramientas(definiciones) {
    return definiciones.map((d) => ({
      name: d.nombre,
      description: d.descripcion,
      input_schema: d.esquema,
      ...(entradaEnVivo ? { eager_input_streaming: true } : {}),
    }));
  }

  function aMensajes(mensajes) {
    const salida = [];
    for (const m of mensajes) {
      if (m.rol === 'usuario') {
        salida.push({ role: 'user', content: m.texto });
      } else if (m.rol === 'asistente') {
        if (m.crudo && m.crudo.proveedor === 'anthropic' && Array.isArray(m.crudo.contenido)) {
          salida.push({ role: 'assistant', content: m.crudo.contenido });
        } else {
          // Viene de otro proveedor o del historial guardado: se reconstruye.
          const bloques = [];
          if (m.texto) bloques.push({ type: 'text', text: m.texto });
          (m.llamadas || []).forEach((l) => bloques.push({ type: 'tool_use', id: l.id, name: l.nombre, input: l.entrada || {} }));
          if (bloques.length) salida.push({ role: 'assistant', content: bloques });
        }
      } else if (m.rol === 'resultados') {
        salida.push({
          role: 'user',
          content: m.resultados.map((r) => ({
            type: 'tool_result',
            tool_use_id: r.id,
            content: r.contenido,
            ...(r.error ? { is_error: true } : {}),
          })),
        });
      }
    }
    // La API exige que empiece el usuario; el historial recortado puede no hacerlo.
    while (salida.length && salida[0].role !== 'user') salida.shift();
    return salida;
  }

  /**
   * Tras un cambio de modelo a mitad de respuesta, lo anterior al último
   * bloque `fallback` es del intento declinado: su texto se conserva, sus
   * herramientas y su pensamiento no. El propio bloque es sólo un marcador.
   */
  function limpiarContenido(contenido) {
    let frontera = -1;
    contenido.forEach((b, i) => { if (b.type === 'fallback') frontera = i; });
    if (frontera === -1) return { reenviable: contenido, vigentes: contenido };
    const reenviable = contenido.filter((b, i) => {
      if (b.type === 'fallback') return false;
      if (i < frontera && DEL_INTENTO_DECLINADO.has(b.type)) return false;
      return true;
    });
    return { reenviable, vigentes: contenido.slice(frontera + 1) };
  }

  async function* unIntento({ peticion, senal }) {
    const c = obtenerCliente();
    const params = usarFallbacks
      ? { ...peticion, betas: [BETA_FALLBACKS], fallbacks: 'default' }
      : peticion;
    const flujo = usarFallbacks
      ? c.beta.messages.stream(params, { signal: senal })
      : c.messages.stream(params, { signal: senal });

    const Cliente = sdk();
    let mensaje;
    try {
      // Con entradas en vivo, un JSON que no se puede leer revienta aquí,
      // al cerrarse el bloque; por eso se envuelve el consumo entero.
      for await (const evento of flujo) {
        if (evento.type === 'content_block_delta' && evento.delta.type === 'text_delta') {
          yield { tipo: 'texto', delta: evento.delta.text };
        }
      }
      mensaje = await flujo.finalMessage();
    } catch (err) {
      // El SDK señala un JSON que no puede leer con un AnthropicError que NO
      // es APIError. Sólo ese se reintenta; los errores de la API (límite de
      // uso, autenticación...) y cualquier otro fallo siguen su camino.
      if (err instanceof Cliente.AnthropicError && !(err instanceof Cliente.APIError)) {
        throw new JsonIlegible(err.message);
      }
      throw err;
    }
    return mensaje;
  }

  /**
   * Un turno completo. Emite { tipo: 'texto' } mientras llega y termina con
   * { tipo: 'turno', ... }. Si hay que repetir el turno tras haber emitido
   * texto, emite antes { tipo: 'reinicio' } para que se descarte.
   */
  async function* turno({ sistema, contexto, mensajes, herramientas, senal }) {
    const Cliente = sdk();
    if (!obtenerCliente()) throw new Error('Falta ANTHROPIC_API_KEY.');

    const peticion = {
      model: modelo,
      max_tokens: maxTokens,
      system: [
        { type: 'text', text: sistema, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: contexto },
      ],
      thinking: { type: 'adaptive' },
      output_config: { effort: esfuerzo },
      tools: aHerramientas(herramientas),
      messages: aMensajes(mensajes),
    };

    let mensaje = null;
    for (let intento = 0; ; intento++) {
      let emitido = false;
      try {
        const it = unIntento({ peticion, senal });
        let paso = await it.next();
        while (!paso.done) {
          emitido = true;
          yield paso.value;
          paso = await it.next();
        }
        mensaje = paso.value;
        break;
      } catch (err) {
        if (err instanceof JsonIlegible && intento < MAX_REINTENTOS_JSON) {
          console.warn('[soporte] entrada de herramienta ilegible, se repite el turno');
          if (emitido) yield { tipo: 'reinicio' };
          continue;
        }
        if (err instanceof Cliente.BadRequestError && usarFallbacks && !emitido) {
          // Puede ser el parámetro de fallbacks. Se prueba sin él: si así
          // funciona, era eso y se apaga para el resto del proceso; si no,
          // el error era otro y se propaga tal cual.
          usarFallbacks = false;
          try {
            const it = unIntento({ peticion, senal });
            let paso = await it.next();
            while (!paso.done) { yield paso.value; paso = await it.next(); }
            mensaje = paso.value;
            console.warn('[soporte] la API rechazó fallbacks: desactivados para este proceso');
            break;
          } catch (err2) {
            usarFallbacks = true;
            throw err2;
          }
        }
        throw err;
      }
    }

    const { reenviable, vigentes } = limpiarContenido(mensaje.content);
    const texto = vigentes.filter((b) => b.type === 'text').map((b) => b.text).join('');
    const llamadas = vigentes
      .filter((b) => b.type === 'tool_use')
      .map((b) => ({ id: b.id, nombre: b.name, entrada: b.input }));

    const sirvioFallback = (mensaje.usage && Array.isArray(mensaje.usage.iterations) ? mensaje.usage.iterations : [])
      .some((it) => it.type === 'fallback_message');
    if (sirvioFallback && mensaje.stop_reason !== 'refusal') {
      console.warn(`[soporte] respondió el modelo de respaldo ${mensaje.model}`);
    }

    // Se decide por stop_reason antes de mirar el contenido.
    let parada;
    switch (mensaje.stop_reason) {
      case 'refusal': parada = 'rechazo'; break;
      case 'pause_turn': parada = 'pausa'; break;
      case 'tool_use': parada = llamadas.length ? 'herramientas' : 'fin'; break;
      // Una entrada cortada por el límite suele parecer un objeto válido:
      // no se ejecuta nada de ese turno.
      case 'max_tokens': parada = llamadas.length ? 'limite' : 'fin'; break;
      default: parada = 'fin';
    }

    const u = mensaje.usage || {};
    yield {
      tipo: 'turno',
      parada,
      texto,
      llamadas: parada === 'herramientas' ? llamadas : [],
      crudo: { proveedor: 'anthropic', contenido: reenviable },
      uso: {
        entrada: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0),
        salida: u.output_tokens || 0,
        cache: u.cache_read_input_tokens || 0,
      },
      modelo: mensaje.model,
    };
  }

  function esAbandono(err) {
    return Boolean(Anthropic) && err instanceof Anthropic.APIUserAbortError;
  }

  return {
    id: 'anthropic',
    disponible,
    describir: () => ({ proveedor: 'anthropic', modelo, esfuerzo, fallbacks: usarFallbacks }),
    turno,
    esAbandono,
    // Expuestos para las pruebas.
    _aMensajes: aMensajes,
    _aHerramientas: aHerramientas,
    _limpiarContenido: limpiarContenido,
  };
}

module.exports = { crearProveedorAnthropic };
