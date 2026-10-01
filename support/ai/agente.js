'use strict';

// El agente: el bucle que es igual para cualquier proveedor.
//
// Pide un turno al proveedor, ejecuta las herramientas que pida, le devuelve
// los resultados y repite hasta que termina. Por el camino reenvía al
// navegador lo que la interfaz necesita en vivo: el texto según se escribe,
// qué herramienta está usando, la guía visual y el ticket.
//
// Elige proveedor en cada petición: el principal si tiene credenciales y
// queda presupuesto, y si no el local. Si el principal falla ANTES de haber
// dicho nada, la misma petición se repite con el local; la persona recibe
// una respuesta peor en vez de un error. Si ya había empezado a hablar, se
// corta con una disculpa: mezclar dos respuestas sería más confuso.

const { definiciones, crearEjecutor } = require('./herramientas');
const { FIJAS, contexto: construirContexto } = require('./instrucciones');

const MAX_VUELTAS = 5;
const VENTANA = 12;

const TOPE_LLAMADAS = Number(process.env.SUPPORT_DAILY_CALLS || 400);
const TOPE_TOKENS = Number(process.env.SUPPORT_DAILY_TOKENS || 600000);

function crearAgente({ db, kb, store, proveedores }) {
  const { ejecutar, consultaCuenta } = crearEjecutor({ db, kb, store });
  const HERRAMIENTAS = definiciones();

  // Por qué dejó de conversar la última vez.
  //
  // Tener clave no es lo mismo que funcionar: con una clave sin saldo, un
  // modelo que no existe en esa cuenta o una organización sin verificar, el
  // asistente degrada al modo sin modelo —que es lo correcto, sigue
  // atendiendo— pero el panel decía "Activo" igualmente y la razón sólo
  // quedaba en el registro del servidor. Quien lleva la plataforma acababa
  // mirando un chat que "no funciona" sin nada que lo explique.
  let ultimoFallo = null;

  // Algunos proveedores devuelven la clave dentro del mensaje de error. El
  // 401 de OpenAI es literalmente «Incorrect API key provided: sk-proj-****».
  // Viene enmascarada, y esto sólo lo ve quien lleva la plataforma —que es
  // quien la puso—, pero un secreto que no hace falta guardar no se guarda.
  // Ceñida a la forma real de las claves de OpenAI y Anthropic (sk-…,
  // sk-proj-…, sk-ant-…). Una más amplia se comería cosas útiles: el nombre
  // de una cabecera beta como "server-side-fallback-2026-07-01" encaja en
  // casi cualquier patrón de "palabras con guiones y números".
  const CLAVE = /\b(?:sk|rk|pk)-[A-Za-z0-9_*-]{6,}/g;

  function anotarFallo(err) {
    ultimoFallo = {
      // El mensaje del SDK ya trae el código y el motivo ("429 You exceeded
      // your current quota...), que es lo que hace falta para arreglarlo.
      mensaje: String((err && err.message) || err).replace(CLAVE, '«clave oculta»').slice(0, 300),
      cuando: new Date().toISOString(),
    };
  }

  function presupuestoAgotado() {
    const uso = store.usageToday();
    return uso.calls >= TOPE_LLAMADAS || (uso.input_tokens + uso.output_tokens) >= TOPE_TOKENS;
  }

  function principalActivo() {
    return Boolean(proveedores.principal && proveedores.principal.disponible());
  }

  function elegir() {
    if (principalActivo() && !presupuestoAgotado()) return proveedores.principal;
    return proveedores.local;
  }

  function estado() {
    const uso = store.usageToday();
    const principal = proveedores.principal ? proveedores.principal.describir() : null;
    return {
      enabled: principalActivo(),
      provider: proveedores.nombre,
      model: principalActivo() && principal ? principal.modelo : null,
      effort: principal ? principal.esfuerzo || null : null,
      // Sólo Claude tiene reintento en otro modelo; el que no lo tenga dice
      // false, no "no sé".
      fallbacks: Boolean(principal && principal.fallbacks === true),
      // null mientras la última petición fuera bien.
      lastError: ultimoFallo,
      today: {
        calls: uso.calls,
        tokens: uso.input_tokens + uso.output_tokens,
        callLimit: TOPE_LLAMADAS,
        tokenLimit: TOPE_TOKENS,
      },
      exhausted: principalActivo() ? presupuestoAgotado() : false,
    };
  }

  /** La conversación guardada, en formato neutro. */
  function historial(conversationId) {
    return store.recentHistory(conversationId, VENTANA).map((m) => {
      if (m.role === 'visitante') return { rol: 'usuario', texto: m.body };
      // Se marca quién escribió para que el modelo no atribuya a una persona
      // lo que dijo él, ni al revés, al retomar un hilo.
      const prefijo = m.role === 'soporte' ? '[Respuesta escrita por una persona del equipo] ' : '';
      return { rol: 'asistente', texto: prefijo + m.body, llamadas: [] };
    });
  }

  function escalar(ctx, asunto, resumen) {
    const { ticket, created } = store.createTicket({
      conversationId: ctx.conversationId,
      userId: ctx.userId,
      username: ctx.cuenta ? ctx.cuenta.username : null,
      email: ctx.cuenta ? ctx.cuenta.email : null,
      subject: asunto,
      summary: resumen,
    });
    ctx.ticket = ticket;
    if (created) ctx.ticketCreado = true;
    return created ? { tipo: 'ticket', referencia: ticket.public_id } : null;
  }

  async function* bucle(proveedor, { mensajes, ctx, textoContexto, senal }) {
    let dicho = '';
    let ofrecerTicket = false;

    for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta++) {
      let turno = null;
      let delTurno = '';
      let separar = dicho.length > 0;

      for await (const ev of proveedor.turno({
        sistema: FIJAS,
        contexto: textoContexto,
        mensajes,
        herramientas: HERRAMIENTAS,
        senal,
      })) {
        if (ev.tipo === 'texto') {
          if (!ev.delta) continue;
          if (separar && ev.delta.trim()) {
            yield { tipo: 'texto', delta: '\n\n' };
            delTurno += '\n\n';
            separar = false;
          }
          delTurno += ev.delta;
          ctx.emitido = true;
          yield ev;
        } else if (ev.tipo === 'reinicio') {
          delTurno = '';
          separar = dicho.length > 0;
          yield { tipo: 'reinicio', texto: dicho };
        } else if (ev.tipo === 'turno') {
          turno = ev;
        }
      }

      if (!turno) break;
      if (proveedor.id !== 'local') {
        store.recordUsage({ input: turno.uso.entrada, output: turno.uso.salida });
      }
      if (turno.ofrecerTicket) ofrecerTicket = true;

      if (turno.parada === 'rechazo') {
        // Lo que se alcanzó a escribir antes de declinar no vale como respuesta.
        yield { tipo: 'reinicio', texto: dicho };
        const evento = escalar(ctx, 'Consulta que el asistente no pudo atender',
          'El asistente declinó responder a este mensaje. Requiere revisión de una persona.');
        if (evento) yield evento;
        const aviso = (dicho ? '\n\n' : '') + 'Esto prefiero que lo vea una persona del equipo. Ya se lo he pasado y te responderán aquí mismo.';
        yield { tipo: 'texto', delta: aviso };
        dicho += aviso;
        break;
      }

      dicho += delTurno;

      if (turno.parada === 'pausa') {
        mensajes.push({ rol: 'asistente', texto: turno.texto, llamadas: [], crudo: turno.crudo });
        continue;
      }
      if (turno.parada !== 'herramientas') break;

      mensajes.push({ rol: 'asistente', texto: turno.texto, llamadas: turno.llamadas, crudo: turno.crudo });

      // Todos los resultados en UN solo mensaje: repartirlos le enseña al
      // modelo a dejar de pedir herramientas en paralelo.
      const resultados = [];
      for (const llamada of turno.llamadas) {
        yield { tipo: 'herramienta', nombre: llamada.nombre };
        const r = ejecutar(llamada.nombre, llamada.entrada, ctx);
        resultados.push({ id: llamada.id, contenido: r.contenido, error: Boolean(r.error) });
        if (r.evento) yield r.evento;
      }
      mensajes.push({ rol: 'resultados', resultados });
    }

    if (!dicho.trim()) {
      if (ctx.guia) {
        const frase = 'Te lo enseño en pantalla.';
        yield { tipo: 'texto', delta: frase };
        dicho = frase;
      } else {
        // Se quedó sin vueltas sin llegar a decir nada.
        const evento = ctx.ticket ? null : escalar(ctx, 'Consulta sin resolver por el asistente',
          'El asistente agotó sus pasos sin llegar a una respuesta. Conversación completa en el hilo.');
        if (evento) yield evento;
        const frase = 'Perdona, me he liado con esta. La paso a una persona del equipo para que la mire bien.';
        yield { tipo: 'texto', delta: frase };
        dicho = frase;
      }
    }

    if (ctx.fuentes.size) kb.markUsed([...ctx.fuentes]);

    yield {
      tipo: 'fin',
      texto: dicho,
      fuentes: [...ctx.fuentes].map((id) => {
        const a = kb.get(id);
        return a ? { id: a.id, title: a.question } : null;
      }).filter(Boolean),
      ticket: ctx.ticketCreado && ctx.ticket ? { reference: ctx.ticket.public_id } : null,
      guia: ctx.guia,
      degradado: proveedor.id === 'local',
      ofrecerTicket: proveedor.id === 'local' ? ofrecerTicket : false,
      proveedor: proveedor.id,
    };
  }

  /**
   * Atiende un mensaje ya guardado en la conversación. Generador de eventos;
   * nunca lanza salvo que la petición se haya cancelado.
   */
  async function* atender({ conversation, userId = null, pestana = null, modoVoz = false, senal = null }) {
    const ctx = {
      conversationId: conversation.id,
      userId,
      cuenta: null,
      fuentes: new Set(),
      guia: null,
      ticket: null,
      ticketCreado: false,
      emitido: false,
    };

    if (userId) {
      const fila = consultaCuenta.get(userId);
      if (fila) ctx.cuenta = { username: fila.username, email: fila.email_verified_at ? fila.email : null };
    }

    const textoContexto = construirContexto({
      username: ctx.cuenta ? ctx.cuenta.username : null,
      pestana,
      modoVoz,
    });

    const proveedor = elegir();
    try {
      yield* bucle(proveedor, { mensajes: historial(conversation.id), ctx, textoContexto, senal });
      if (proveedor.id !== 'local') ultimoFallo = null; // conversó: lo anterior ya no vale
      return;
    } catch (err) {
      if (senal && senal.aborted) return;
      if (proveedor.esAbandono && proveedor.esAbandono(err)) return;
      console.error(`[soporte] falló el proveedor ${proveedor.id}:`, err.message);
      if (proveedor.id === 'local') throw err;
      anotarFallo(err);

      if (ctx.emitido) {
        const frase = '\n\nSe me cortó la conexión a mitad. Pregúntamelo otra vez en un momento.';
        yield { tipo: 'texto', delta: frase };
        yield {
          tipo: 'fin', texto: frase.trim(), fuentes: [], ticket: null, guia: null,
          degradado: true, ofrecerTicket: true, proveedor: proveedor.id, error: true,
        };
        return;
      }
    }

    // El principal falló sin decir nada: se atiende sin modelo.
    ctx.fuentes = new Set();
    ctx.guia = null;
    yield* bucle(proveedores.local, { mensajes: historial(conversation.id), ctx, textoContexto, senal });
  }

  return { atender, estado, presupuestoAgotado, principalActivo };
}

module.exports = { crearAgente, MAX_VUELTAS };
