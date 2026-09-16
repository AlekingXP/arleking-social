'use strict';

// Conversaciones, mensajes y tickets de soporte.
//
// Una conversación es el hilo; un ticket es una marca sobre ese hilo que
// dice "esto necesita a una persona". Se modela así, y no como dos cosas
// separadas, por una razón concreta: cuando el dueño responde, su respuesta
// entra en el MISMO hilo que ya leyó el visitante. Quien vuelve al chat ve
// la conversación completa —lo que preguntó, lo que contestó el asistente y
// lo que contestó la persona— en vez de recibir un correo suelto sin
// contexto.
//
// Sobre la identidad: quien abre un chat casi nunca tiene sesión. Para que
// pueda volver a su propio hilo (y sólo al suyo) se le entrega un testigo
// aleatorio y aquí se guarda únicamente su SHA-256. Una copia de esta tabla
// no permite leer ninguna conversación ajena.

const crypto = require('crypto');

const MAX_MENSAJE = 2000;      // lo que se acepta de un visitante, en caracteres
const MAX_TURNOS = 30;         // tope duro por conversación
const VENTANA_HISTORIAL = 12;  // cuántos mensajes se le pasan al modelo

function nuevoId() {
  return crypto.randomBytes(12).toString('base64url');
}

function digest(valor) {
  return crypto.createHash('sha256').update(String(valor)).digest('hex');
}

function igualSeguro(a, b) {
  const bufA = Buffer.from(String(a || ''));
  const bufB = Buffer.from(String(b || ''));
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** Validación de correo deliberadamente laxa: rechazar uno válido es peor. */
function correoValido(valor) {
  const v = String(valor || '').trim();
  return v.length >= 5 && v.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
}

function createStore(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS support_conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      public_id TEXT NOT NULL UNIQUE,
      secret_hash TEXT NOT NULL,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      slug TEXT,
      turns INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS support_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL REFERENCES support_conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_support_messages_conv
      ON support_messages(conversation_id, id);

    CREATE TABLE IF NOT EXISTS support_tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      public_id TEXT NOT NULL UNIQUE,
      conversation_id INTEGER REFERENCES support_conversations(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      username TEXT,
      email TEXT,
      subject TEXT NOT NULL,
      summary TEXT,
      status TEXT NOT NULL DEFAULT 'abierto',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_support_tickets_status
      ON support_tickets(status, updated_at DESC);

    -- Contador de gasto del asistente. Una fila por día: es todo lo que
    -- hace falta para cortar en seco cuando se agota el presupuesto, y no
    -- guarda nada de nadie.
    CREATE TABLE IF NOT EXISTS support_usage (
      day TEXT PRIMARY KEY,
      calls INTEGER NOT NULL DEFAULT 0,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0
    );
  `);

  const q = {
    crearConversacion: db.prepare(`
      INSERT INTO support_conversations (public_id, secret_hash, user_id, slug)
      VALUES (?, ?, ?, ?)
    `),
    conversacionPorPublicId: db.prepare('SELECT * FROM support_conversations WHERE public_id = ?'),
    conversacionPorId: db.prepare('SELECT * FROM support_conversations WHERE id = ?'),
    tocarConversacion: db.prepare(`
      UPDATE support_conversations
      SET turns = turns + 1, last_at = datetime('now')
      WHERE id = ?
    `),
    vincularUsuario: db.prepare('UPDATE support_conversations SET user_id = ? WHERE id = ?'),

    anadirMensaje: db.prepare(`
      INSERT INTO support_messages (conversation_id, role, body) VALUES (?, ?, ?)
    `),
    mensajes: db.prepare(`
      SELECT role, body, created_at FROM support_messages
      WHERE conversation_id = ? ORDER BY id ASC
    `),
    ultimosMensajes: db.prepare(`
      SELECT role, body FROM support_messages
      WHERE conversation_id = ? ORDER BY id DESC LIMIT ?
    `),

    crearTicket: db.prepare(`
      INSERT INTO support_tickets
        (public_id, conversation_id, user_id, username, email, subject, summary)
      VALUES (@public_id, @conversation_id, @user_id, @username, @email, @subject, @summary)
    `),
    ticketPorId: db.prepare('SELECT * FROM support_tickets WHERE id = ?'),
    ticketDeConversacion: db.prepare(`
      SELECT * FROM support_tickets
      WHERE conversation_id = ? AND status != 'cerrado'
      ORDER BY id DESC LIMIT 1
    `),
    listarTickets: db.prepare(`
      SELECT t.*, (
        SELECT COUNT(*) FROM support_messages m WHERE m.conversation_id = t.conversation_id
      ) AS message_count
      FROM support_tickets t
      WHERE (@status = 'todos' OR t.status = @status)
      ORDER BY
        CASE t.status WHEN 'abierto' THEN 0 WHEN 'respondido' THEN 1 ELSE 2 END,
        t.updated_at DESC
      LIMIT @limit
    `),
    contarPorEstado: db.prepare(`
      SELECT status, COUNT(*) AS n FROM support_tickets GROUP BY status
    `),
    cambiarEstado: db.prepare(`
      UPDATE support_tickets SET status = ?, updated_at = datetime('now') WHERE id = ?
    `),
    tocarTicket: db.prepare(`
      UPDATE support_tickets SET updated_at = datetime('now') WHERE id = ?
    `),

    usoDeHoy: db.prepare('SELECT * FROM support_usage WHERE day = ?'),
    registrarUso: db.prepare(`
      INSERT INTO support_usage (day, calls, input_tokens, output_tokens)
      VALUES (@day, 1, @input, @output)
      ON CONFLICT(day) DO UPDATE SET
        calls = calls + 1,
        input_tokens = input_tokens + @input,
        output_tokens = output_tokens + @output
    `),
    limpiarConversaciones: db.prepare(`
      DELETE FROM support_conversations
      WHERE last_at < datetime('now', '-30 days')
        AND id NOT IN (SELECT conversation_id FROM support_tickets WHERE conversation_id IS NOT NULL)
    `),
  };

  // ---- Conversaciones ----

  function openConversation({ userId = null, slug = null } = {}) {
    const publicId = nuevoId();
    const secreto = crypto.randomBytes(24).toString('base64url');
    const info = q.crearConversacion.run(publicId, digest(secreto), userId, slug || null);
    return { id: info.lastInsertRowid, publicId, secret: secreto };
  }

  /**
   * Recupera una conversación comprobando el testigo. Devuelve null ante
   * cualquier duda: un testigo que no cuadra y una conversación que no
   * existe son indistinguibles desde fuera, que es justo lo que se quiere.
   */
  function authConversation(publicId, secreto) {
    if (!publicId || !secreto) return null;
    const fila = q.conversacionPorPublicId.get(String(publicId));
    if (!fila) return null;
    if (!igualSeguro(digest(secreto), fila.secret_hash)) return null;
    return fila;
  }

  function addMessage(conversationId, role, body) {
    const texto = String(body == null ? '' : body).slice(0, MAX_MENSAJE * 4);
    q.anadirMensaje.run(conversationId, role, texto);
  }

  function touchConversation(conversationId) {
    q.tocarConversacion.run(conversationId);
  }

  function linkUser(conversationId, userId) {
    q.vincularUsuario.run(userId, conversationId);
  }

  function history(conversationId) {
    return q.mensajes.all(conversationId);
  }

  /** Los últimos N mensajes, en orden cronológico, para el contexto del modelo. */
  function recentHistory(conversationId, limite = VENTANA_HISTORIAL) {
    return q.ultimosMensajes.all(conversationId, limite).reverse();
  }

  // ---- Tickets ----

  function createTicket({ conversationId, userId, username, email, subject, summary }) {
    // Uno abierto por conversación: sin esto, un visitante insistente
    // genera diez tickets del mismo problema y el buzón deja de servir.
    const existente = conversationId ? q.ticketDeConversacion.get(conversationId) : null;
    if (existente) return { ticket: existente, created: false };

    const publicId = nuevoId();
    const info = q.crearTicket.run({
      public_id: publicId,
      conversation_id: conversationId || null,
      user_id: userId || null,
      username: username || null,
      email: email && correoValido(email) ? String(email).trim() : null,
      subject: String(subject || 'Consulta de soporte').slice(0, 160),
      summary: summary ? String(summary).slice(0, 2000) : null,
    });
    return { ticket: q.ticketPorId.get(info.lastInsertRowid), created: true };
  }

  function listTickets({ status = 'abierto', limit = 50 } = {}) {
    return q.listarTickets.all({ status, limit });
  }

  function ticketCounts() {
    const filas = q.contarPorEstado.all();
    const salida = { abierto: 0, respondido: 0, cerrado: 0 };
    filas.forEach((f) => { salida[f.status] = f.n; });
    return salida;
  }

  function getTicket(id) {
    return q.ticketPorId.get(id);
  }

  function setStatus(id, status) {
    if (!['abierto', 'respondido', 'cerrado'].includes(status)) return false;
    return q.cambiarEstado.run(status, id).changes > 0;
  }

  function touchTicket(id) {
    q.tocarTicket.run(id);
  }

  // ---- Presupuesto ----

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  function usageToday() {
    return q.usoDeHoy.get(today()) || { day: today(), calls: 0, input_tokens: 0, output_tokens: 0 };
  }

  function recordUsage({ input = 0, output = 0 } = {}) {
    try {
      q.registrarUso.run({ day: today(), input: Number(input) || 0, output: Number(output) || 0 });
    } catch {
      // Contabilizar mal es preferible a tirar una respuesta ya generada.
    }
  }

  function sweep() {
    try {
      return q.limpiarConversaciones.run().changes;
    } catch {
      return 0;
    }
  }

  return {
    openConversation, authConversation, addMessage, touchConversation, linkUser,
    history, recentHistory,
    createTicket, listTickets, ticketCounts, getTicket, setStatus, touchTicket,
    usageToday, recordUsage, sweep,
    MAX_MENSAJE, MAX_TURNOS,
  };
}

module.exports = { createStore, correoValido, MAX_MENSAJE, MAX_TURNOS };
