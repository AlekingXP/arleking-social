'use strict';

// Adaptador de OpenAI, con el SDK oficial.
//
// Cumple el mismo contrato que el de Claude (ver index.js): hace UN turno,
// traduce la conversación neutra al formato de la API, reenvía el texto
// según llega y devuelve qué quiere hacer el modelo después. El bucle de
// herramientas sigue viviendo en el agente.
//
// Habla la API de Chat Completions a propósito, no la de Respuestas: es la
// superficie más estable y, además, la que hablan otros proveedores
// (Groq, Together, Mistral, OpenRouter, DeepSeek, Ollama...). Con
// OPENAI_BASE_URL apuntando a cualquiera de ellos, este mismo archivo sirve
// sin tocar una línea.
//
// Dos diferencias con Anthropic que están resueltas aquí dentro:
//
//  · Los resultados de herramientas van en UN mensaje por resultado
//    (role: 'tool'), no todos juntos en uno de usuario.
//  · Los argumentos llegan troceados y sin validar; se acumulan por índice
//    y se analizan al cerrar. Si el JSON no se puede leer, se pasa tal cual
//    a herramientas.js, que lo rechaza con INVALID_INPUT y deja que el
//    modelo lo corrija en el turno siguiente.

let OpenAI = null;
function sdk() {
  if (!OpenAI) {
    const modulo = require('openai');
    OpenAI = modulo.default || modulo;
  }
  return OpenAI;
}

function crearProveedorOpenAI(opciones = {}) {
  const apiKey = opciones.apiKey !== undefined ? opciones.apiKey : process.env.OPENAI_API_KEY;
  const baseURL = opciones.baseURL !== undefined ? opciones.baseURL : process.env.OPENAI_BASE_URL;
  const modelo = opciones.modelo || process.env.OPENAI_MODEL || process.env.SUPPORT_MODEL || 'gpt-4o-mini';
  // Sólo se manda si se pide: los modelos que no razonan rechazan el campo.
  const esfuerzo = opciones.esfuerzo || process.env.OPENAI_REASONING_EFFORT || null;
  const maxTokens = opciones.maxTokens || 4096;

  // El nombre del tope de salida cambió: los modelos nuevos de OpenAI piden
  // `max_completion_tokens` y los compatibles de terceros suelen conocer
  // sólo `max_tokens`. Se empieza por el que corresponde y, si la API lo
  // rechaza, se prueba el otro y se recuerda: así no hay que configurarlo.
  let campoTope = baseURL ? 'max_tokens' : 'max_completion_tokens';

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

  // ---- Traducción neutra -> OpenAI ----

  function aHerramientas(definiciones) {
    return definiciones.map((d) => ({
      type: 'function',
      function: { name: d.nombre, description: d.descripcion, parameters: d.esquema },
    }));
  }

  function aMensajes({ sistema, contexto, mensajes }) {
    // Las instrucciones fijas van primero y aparte del contexto, para que los
    // proveedores que cachean prefijos puedan reutilizarlas.
    const salida = [{ role: 'system', content: sistema }, { role: 'system', content: contexto }];

    for (const m of mensajes) {
      if (m.rol === 'usuario') {
        salida.push({ role: 'user', content: m.texto });
      } else if (m.rol === 'asistente') {
        if (m.crudo && m.crudo.proveedor === 'openai' && m.crudo.mensaje) {
          salida.push(m.crudo.mensaje);
        } else {
          const bloque = { role: 'assistant', content: m.texto || null };
          if (m.llamadas && m.llamadas.length) {
            bloque.tool_calls = m.llamadas.map((l) => ({
              id: l.id,
              type: 'function',
              function: { name: l.nombre, arguments: JSON.stringify(l.entrada || {}) },
            }));
          }
          // Un turno sin texto ni herramientas no aporta nada y algunos
          // proveedores lo rechazan.
          if (bloque.content || bloque.tool_calls) salida.push(bloque);
        }
      } else if (m.rol === 'resultados') {
        // Uno por resultado: aquí no existe el mensaje con varios dentro.
        m.resultados.forEach((r) => {
          salida.push({ role: 'tool', tool_call_id: r.id, content: r.contenido });
        });
      }
    }
    return salida;
  }

  function cuerpo({ sistema, contexto, mensajes, herramientas }) {
    const peticion = {
      model: modelo,
      messages: aMensajes({ sistema, contexto, mensajes }),
      tools: aHerramientas(herramientas),
      stream: true,
      // Sin esto el streaming no informa del gasto, y el presupuesto diario
      // se quedaría a ciegas.
      stream_options: { include_usage: true },
    };
    peticion[campoTope] = maxTokens;
    if (esfuerzo) peticion.reasoning_effort = esfuerzo;
    return peticion;
  }

  /** Consume el flujo y devuelve el turno ya montado. */
  async function* unIntento({ peticion, senal }) {
    const c = obtenerCliente();
    const flujo = await c.chat.completions.create(peticion, { signal: senal });

    let texto = '';
    let rechazo = '';
    let motivo = null;
    let uso = null;
    const enCurso = []; // llamadas a herramientas, por índice

    for await (const trozo of flujo) {
      if (trozo.usage) uso = trozo.usage;
      const opcion = trozo.choices && trozo.choices[0];
      if (!opcion) continue;
      const d = opcion.delta || {};

      if (d.content) {
        texto += d.content;
        yield { tipo: 'texto', delta: d.content };
      }
      // El modelo puede declinar: llega por su propio campo, no como texto.
      if (d.refusal) rechazo += d.refusal;

      if (d.tool_calls) {
        for (const tc of d.tool_calls) {
          const i = tc.index || 0;
          if (!enCurso[i]) enCurso[i] = { id: '', nombre: '', argumentos: '' };
          if (tc.id) enCurso[i].id = tc.id;
          if (tc.function && tc.function.name) enCurso[i].nombre += tc.function.name;
          if (tc.function && tc.function.arguments) enCurso[i].argumentos += tc.function.arguments;
        }
      }
      if (opcion.finish_reason) motivo = opcion.finish_reason;
    }

    return { texto, rechazo, motivo, uso, enCurso };
  }

  async function* turno({ sistema, contexto, mensajes, herramientas, senal }) {
    const Cliente = sdk();
    if (!obtenerCliente()) throw new Error('Falta OPENAI_API_KEY.');

    const peticion = cuerpo({ sistema, contexto, mensajes, herramientas });

    let resultado = null;
    let campoAnterior = null; // a qué volver si el cambio no era la causa
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
        resultado = paso.value;
        if (campoAnterior) console.warn(`[soporte] la API rechazó ${campoAnterior}; se usa ${campoTope}`);
        campoAnterior = null; // funcionó: el campo nuevo se queda
        break;
      } catch (err) {
        // Un 400 sin haber dicho nada puede ser el nombre del tope de salida:
        // se prueba el otro una vez. Si el segundo intento también falla, el
        // problema era otro y se deja el campo como estaba.
        if (err instanceof Cliente.BadRequestError && !emitido && intento === 0) {
          campoAnterior = campoTope;
          campoTope = campoAnterior === 'max_tokens' ? 'max_completion_tokens' : 'max_tokens';
          delete peticion[campoAnterior];
          peticion[campoTope] = maxTokens;
          continue;
        }
        if (campoAnterior) {
          campoTope = campoAnterior;
          campoAnterior = null;
        }
        if (err instanceof Cliente.NotFoundError || err instanceof Cliente.BadRequestError) {
          console.error(`[soporte] OpenAI rechazó la petición con el modelo "${modelo}". `
            + 'Comprueba OPENAI_MODEL: tiene que ser uno que exista en tu cuenta.');
        }
        throw err;
      }
    }

    const llamadas = resultado.enCurso
      .filter(Boolean)
      .filter((l) => l.nombre)
      .map((l) => {
        let entrada;
        try {
          entrada = JSON.parse(l.argumentos || '{}');
        } catch {
          // Se pasa el texto crudo: herramientas.js lo rechaza con
          // INVALID_INPUT y el modelo lo corrige en el turno siguiente.
          entrada = l.argumentos;
        }
        return { id: l.id, nombre: l.nombre, entrada };
      });

    // Se decide por el motivo de parada antes de mirar el contenido.
    let parada;
    if (resultado.rechazo) parada = 'rechazo';
    else if (resultado.motivo === 'content_filter') parada = 'rechazo';
    else if (resultado.motivo === 'tool_calls') parada = llamadas.length ? 'herramientas' : 'fin';
    // Cortado por el tope: una entrada a medias parece válida, así que no se
    // ejecuta nada de este turno.
    else if (resultado.motivo === 'length') parada = llamadas.length ? 'limite' : 'fin';
    else parada = llamadas.length ? 'herramientas' : 'fin';

    const mensajeCrudo = { role: 'assistant', content: resultado.texto || null };
    if (parada === 'herramientas') {
      mensajeCrudo.tool_calls = llamadas.map((l) => ({
        id: l.id,
        type: 'function',
        function: { name: l.nombre, arguments: typeof l.entrada === 'string' ? l.entrada : JSON.stringify(l.entrada) },
      }));
    }

    const u = resultado.uso || {};
    yield {
      tipo: 'turno',
      parada,
      texto: resultado.texto,
      llamadas: parada === 'herramientas' ? llamadas : [],
      crudo: { proveedor: 'openai', mensaje: mensajeCrudo },
      uso: { entrada: u.prompt_tokens || 0, salida: u.completion_tokens || 0, cache: 0 },
      modelo,
    };
  }

  function esAbandono(err) {
    return Boolean(OpenAI) && err instanceof OpenAI.APIUserAbortError;
  }

  return {
    id: 'openai',
    disponible,
    describir: () => ({ proveedor: 'openai', modelo, esfuerzo }),
    turno,
    esAbandono,
    // Expuestos para las pruebas.
    _aMensajes: aMensajes,
    _aHerramientas: aHerramientas,
  };
}

module.exports = { crearProveedorOpenAI };
