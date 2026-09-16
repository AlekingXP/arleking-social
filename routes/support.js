'use strict';

// Soporte: chat del panel, buzón de tickets y editor de la base de
// conocimiento.
//
// El chat sólo existe dentro del panel, así que todos sus endpoints piden
// sesión. Estuvieron abiertos mientras el widget vivía en las páginas
// públicas, para atender a visitantes anónimos; sin ese motivo, un endpoint
// sin sesión que gasta dinero en la API de Anthropic era superficie de
// ataque pura: cualquiera con curl podía agotar el presupuesto del día y
// dejar sin soporte a los usuarios de verdad.
//
// Aun con sesión, cada mensaje cuesta dinero, así que los límites siguen
// arriba del todo y no dentro del asistente:
//
//   · Límite por IP, para que un bucle no se convierta en una factura.
//   · Tope de turnos por conversación, para el caso contrario: uno que se
//     queda dentro de un mismo hilo dándole a enter.
//   · Longitud máxima del mensaje, porque el coste va por tokens de
//     entrada y nadie necesita cuatro mil caracteres para preguntar cómo
//     cancelar.
//   · El presupuesto diario lo comprueba el asistente, no esto: cuando se
//     agota, el soporte no se apaga, se degrada a buscar en la ayuda.
//
// Y la regla que no se negocia: la identidad sale SIEMPRE de req.session.
// Ni de un campo del cuerpo, ni de lo que diga el modelo.

const express = require('express');
const rateLimit = require('express-rate-limit');

const { db, isOwnerUsername } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { createKb } = require('../support/kb');
const { createStore, correoValido, MAX_MENSAJE, MAX_TURNOS } = require('../support/store');
const { createAssistant } = require('../support/assistant');
const { createNotifier } = require('../support/notify');
const { createMailer } = require('../security/auth/mailer');

const router = express.Router();

const kb = createKb(db);
const store = createStore(db);
const assistant = createAssistant({ db, kb, store });
const mailer = createMailer();

// Las alertas se crean en server.js y se comparten por app.locals; el
// notificador se monta en diferido para no duplicarlas.
let notifier = null;
function notificadorDe(req) {
  if (!notifier) {
    const alerts = (req.app && req.app.locals && req.app.locals.alerts) || null;
    notifier = createNotifier({ alerts, mailer });
  }
  return notifier;
}

// Barrido diario de conversaciones viejas sin ticket. Nadie vuelve a un
// chat de hace un mes, y guardarlo para siempre sólo acumula texto de
// visitantes que ya no lo necesitan.
const barrido = setInterval(() => store.sweep(), 24 * 60 * 60 * 1000);
if (barrido.unref) barrido.unref();

const chatLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Has escrito muchos mensajes seguidos. Espera un par de minutos.' },
});

const ticketLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 4,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Has abierto varias consultas seguidas. Espera un rato antes de abrir otra.' },
});

const lecturaLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas peticiones.' },
});

/** Sólo quien lleva la plataforma ve el buzón: no es soporte por perfil. */
function requireOwner(req, res, next) {
  const fila = db.prepare('SELECT username FROM users WHERE id = ?').get(req.session.userId);
  if (!fila || !isOwnerUsername(fila.username)) {
    return res.status(403).json({ error: 'No tienes acceso al panel de soporte.' });
  }
  return next();
}

function baseUrl(req) {
  return `${req.protocol}://${req.get('host')}`;
}

/**
 * Recupera el hilo sólo si el testigo cuadra Y la conversación es de quien
 * tiene la sesión. Con sesión obligatoria esto es defensa en profundidad:
 * un testigo filtrado ya no basta para leer el hilo de otra cuenta. Los
 * hilos sin dueño (abiertos cuando el chat era público) se dejan reclamar
 * con su testigo, que es lo que ya hacía el chat al iniciar sesión.
 */
function hiloDe(req, conversationId, secret) {
  const conversacion = store.authConversation(conversationId, secret);
  if (!conversacion) return null;
  if (conversacion.user_id && conversacion.user_id !== req.session.userId) return null;
  return conversacion;
}

/** Sólo los campos que el visitante debe ver de su propio hilo. */
function hiloPublico(conversationId) {
  return store.history(conversationId).map((m) => ({
    role: m.role,
    body: m.body,
    at: m.created_at,
  }));
}

// ---- Chat del panel ----

router.get('/support/status', lecturaLimiter, requireAuth, (req, res) => {
  const estado = assistant.status();
  res.json({
    // El widget sólo necesita saber si conversar o mostrar la ayuda
    // buscable. Ni el modelo ni el presupuesto salen de aquí: son detalles
    // de operación y no le importan a quien pregunta.
    assistant: estado.enabled && !estado.exhausted,
    email: mailer.enabled(),
  });
});

router.post('/support/chat', chatLimiter, requireAuth, async (req, res) => {
  try {
    const cuerpo = req.body || {};
    const mensaje = String(cuerpo.message == null ? '' : cuerpo.message).trim();

    if (!mensaje) return res.status(400).json({ error: 'Escribe tu consulta.' });
    if (mensaje.length > MAX_MENSAJE) {
      return res.status(400).json({ error: `El mensaje es muy largo (máximo ${MAX_MENSAJE} caracteres).` });
    }

    const userId = (req.session && req.session.userId) || null;
    const slug = cuerpo.slug ? String(cuerpo.slug).slice(0, 60) : null;

    // Un testigo que no cuadra abre un hilo nuevo en vez de dar un error:
    // así no se puede distinguir "no existe" de "no es tuyo".
    let conversacion = hiloDe(req, cuerpo.conversationId, cuerpo.secret);
    let credenciales = null;

    if (!conversacion) {
      const abierta = store.openConversation({ userId, slug });
      conversacion = { id: abierta.id, public_id: abierta.publicId, turns: 0, user_id: userId };
      credenciales = { conversationId: abierta.publicId, secret: abierta.secret };
    } else if (conversacion.turns >= MAX_TURNOS) {
      return res.status(429).json({
        error: 'Esta conversación ya es muy larga. Recárgala para empezar de nuevo, o pide que te atienda una persona.',
        maxed: true,
      });
    } else if (userId && !conversacion.user_id) {
      // Inició sin sesión y luego entró: a partir de aquí el asistente
      // puede consultar su cuenta.
      store.linkUser(conversacion.id, userId);
      conversacion.user_id = userId;
    }

    store.addMessage(conversacion.id, 'visitante', mensaje);
    store.touchConversation(conversacion.id);

    const respuesta = await assistant.reply({
      conversation: conversacion,
      message: mensaje,
      userId,
      slug,
    });

    store.addMessage(conversacion.id, 'asistente', respuesta.text);

    if (respuesta.ticket) notificadorDe(req).ticketOpened(respuesta.ticket);

    res.json({
      ...(credenciales || {}),
      reply: respuesta.text,
      sources: respuesta.sources || [],
      ticket: respuesta.ticket ? { reference: respuesta.ticket.public_id } : null,
      degraded: Boolean(respuesta.degraded),
      offerTicket: Boolean(respuesta.offerTicket),
    });
  } catch (err) {
    console.error('[soporte] fallo en el chat:', err.message);
    res.status(500).json({ error: 'No pude responder ahora mismo. Inténtalo de nuevo en un momento.' });
  }
});

/** El hilo completo, para quien vuelve y quiere ver si ya le respondieron. */
router.get('/support/thread', lecturaLimiter, requireAuth, (req, res) => {
  const conversacion = hiloDe(req, req.query.conversationId, req.query.secret);
  if (!conversacion) return res.status(404).json({ error: 'Conversación no encontrada.' });

  const ticket = db
    .prepare("SELECT public_id, subject, status FROM support_tickets WHERE conversation_id = ? ORDER BY id DESC LIMIT 1")
    .get(conversacion.id);

  res.json({
    messages: hiloPublico(conversacion.id),
    ticket: ticket ? { reference: ticket.public_id, subject: ticket.subject, status: ticket.status } : null,
    maxed: conversacion.turns >= MAX_TURNOS,
  });
});

/** Ticket directo, sin pasar por el asistente. Siempre disponible. */
router.post('/support/ticket', ticketLimiter, requireAuth, (req, res) => {
  const cuerpo = req.body || {};
  const asunto = String(cuerpo.subject || '').trim();
  const detalle = String(cuerpo.body || '').trim();
  const correo = String(cuerpo.email || '').trim();

  if (detalle.length < 10) return res.status(400).json({ error: 'Cuéntanos un poco más para poder ayudarte.' });
  if (detalle.length > MAX_MENSAJE * 2) return res.status(400).json({ error: 'El mensaje es demasiado largo.' });
  if (correo && !correoValido(correo)) return res.status(400).json({ error: 'Ese correo no parece válido.' });

  const userId = (req.session && req.session.userId) || null;
  const cuenta = userId
    ? db.prepare('SELECT username, email, email_verified_at FROM users WHERE id = ?').get(userId)
    : null;

  const conversacion = hiloDe(req, cuerpo.conversationId, cuerpo.secret);
  let conversationId = conversacion ? conversacion.id : null;
  let credenciales = null;

  if (!conversationId) {
    const abierta = store.openConversation({ userId, slug: null });
    conversationId = abierta.id;
    credenciales = { conversationId: abierta.publicId, secret: abierta.secret };
  }

  store.addMessage(conversationId, 'visitante', detalle);

  const { ticket } = store.createTicket({
    conversationId,
    userId,
    username: cuenta ? cuenta.username : null,
    // El correo verificado de la sesión manda sobre el que se escriba en el
    // formulario: es el único que sabemos que pertenece a quien pregunta.
    email: cuenta && cuenta.email_verified_at ? cuenta.email : (correo || null),
    subject: asunto || detalle.slice(0, 70),
    summary: null,
  });

  notificadorDe(req).ticketOpened(ticket);

  res.json({
    ...(credenciales || {}),
    ticket: { reference: ticket.public_id },
    emailNotice: ticket.email ? mailer.enabled() : false,
  });
});

// ---- Panel del dueño ----

router.get('/support/assistant', requireAuth, requireOwner, (req, res) => {
  res.json({ ...assistant.status(), mail: mailer.enabled(), alerts: Boolean(notificadorDe(req)) });
});

router.get('/support/tickets', requireAuth, requireOwner, (req, res) => {
  const estado = String(req.query.status || 'abierto');
  const permitidos = ['abierto', 'respondido', 'cerrado', 'todos'];
  res.json({
    tickets: store.listTickets({ status: permitidos.includes(estado) ? estado : 'abierto' }),
    counts: store.ticketCounts(),
  });
});

router.get('/support/tickets/:id', requireAuth, requireOwner, (req, res) => {
  const ticket = store.getTicket(Number(req.params.id));
  if (!ticket) return res.status(404).json({ error: 'Ticket no encontrado.' });
  res.json({
    ticket,
    messages: ticket.conversation_id ? hiloPublico(ticket.conversation_id) : [],
  });
});

router.post('/support/tickets/:id/reply', requireAuth, requireOwner, async (req, res) => {
  const ticket = store.getTicket(Number(req.params.id));
  if (!ticket) return res.status(404).json({ error: 'Ticket no encontrado.' });

  const cuerpo = String((req.body && req.body.body) || '').trim();
  if (!cuerpo) return res.status(400).json({ error: 'Escribe una respuesta.' });
  if (cuerpo.length > 4000) return res.status(400).json({ error: 'La respuesta es demasiado larga.' });

  // Entra en el mismo hilo que ve el visitante: si vuelve al chat, la
  // encuentra ahí en vez de tener que buscar un correo.
  if (ticket.conversation_id) store.addMessage(ticket.conversation_id, 'soporte', cuerpo);
  store.setStatus(ticket.id, 'respondido');

  const envio = await notificadorDe(req).replySent({ ticket, body: cuerpo, baseUrl: baseUrl(req) });

  res.json({ ok: true, email: envio });
});

router.post('/support/tickets/:id/status', requireAuth, requireOwner, (req, res) => {
  const estado = String((req.body && req.body.status) || '');
  if (!store.setStatus(Number(req.params.id), estado)) {
    return res.status(400).json({ error: 'Estado no válido.' });
  }
  res.json({ ok: true, counts: store.ticketCounts() });
});

// ---- Base de conocimiento ----
//
// Editable desde el panel a propósito: es lo que separa un asistente que
// repite lo de siempre de uno que aprende. Cuando el dueño responde algo
// tres veces a mano, lo convierte en artículo y deja de responderlo.

router.get('/support/kb', requireAuth, requireOwner, (req, res) => {
  res.json({ articles: kb.list() });
});

router.post('/support/kb', requireAuth, requireOwner, (req, res) => {
  const { question, answer, tags } = req.body || {};
  if (!String(question || '').trim()) return res.status(400).json({ error: 'Falta la pregunta.' });
  if (!String(answer || '').trim()) return res.status(400).json({ error: 'Falta la respuesta.' });
  res.json({
    article: kb.create({
      question: String(question).trim().slice(0, 200),
      answer: String(answer).trim().slice(0, 4000),
      tags: String(tags || '').trim().slice(0, 300),
    }),
  });
});

router.put('/support/kb/:id', requireAuth, requireOwner, (req, res) => {
  const { question, answer, tags, enabled } = req.body || {};
  const articulo = kb.update(Number(req.params.id), {
    question: question != null ? String(question).trim().slice(0, 200) : null,
    answer: answer != null ? String(answer).trim().slice(0, 4000) : null,
    tags: tags != null ? String(tags).trim().slice(0, 300) : null,
    enabled: enabled != null ? Boolean(enabled) : null,
  });
  if (!articulo) return res.status(404).json({ error: 'Artículo no encontrado.' });
  res.json({ article: articulo });
});

router.delete('/support/kb/:id', requireAuth, requireOwner, (req, res) => {
  if (!kb.remove(Number(req.params.id))) return res.status(404).json({ error: 'Artículo no encontrado.' });
  res.json({ ok: true });
});

module.exports = { router, kb, store, assistant };
