'use strict';

// Envío de correo.
//
// Agnóstico del proveedor a propósito: quien despliega elige, y el resto de
// la aplicación no se entera. Se detecta por las variables de entorno que
// haya, en este orden:
//
//   RESEND_API_KEY      -> Resend        (HTTP, sin dependencia)
//   POSTMARK_API_TOKEN  -> Postmark      (HTTP, sin dependencia)
//   BREVO_API_KEY       -> Brevo         (HTTP, sin dependencia)
//   SMTP_HOST + SMTP_USER + SMTP_PASS    (nodemailer)
//
// Los tres primeros no necesitan ninguna librería: son un POST con fetch.
// SMTP sí, porque hablar el protocolo a mano sería absurdo, y además es la
// opción que ya tiene cualquiera con un dominio propio.
//
// Si no hay ninguna configurada, `enabled()` devuelve false y las funciones
// que dependen del correo se desactivan solas en vez de fallar a mitad de
// un registro.

let nodemailer = null; // cargado en diferido: sin SMTP no hace falta ni requerirlo

const FROM = process.env.MAIL_FROM || 'ArleKing Social <no-reply@arleking-social.net>';
const REPLY_TO = process.env.MAIL_REPLY_TO || null;

function detectProvider() {
  if (process.env.RESEND_API_KEY) return 'resend';
  if (process.env.POSTMARK_API_TOKEN) return 'postmark';
  if (process.env.BREVO_API_KEY) return 'brevo';
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) return 'smtp';
  return null;
}

/** Separa "Nombre <correo@dominio>" en sus dos partes. */
function parseAddress(value) {
  const match = String(value).match(/^\s*(.*?)\s*<\s*([^>]+)\s*>\s*$/);
  if (match) return { name: match[1] || undefined, email: match[2] };
  return { name: undefined, email: String(value).trim() };
}

// Anulable para poder apuntar a un proxy propio o a un receptor local en
// pruebas. Sin la variable, la URL real del proveedor.
const RESEND_URL = process.env.RESEND_API_URL || 'https://api.resend.com/emails';

async function sendViaResend({ to, subject, html, text }) {
  const res = await fetch(RESEND_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM,
      to: [to],
      subject,
      html,
      text,
      ...(REPLY_TO ? { reply_to: REPLY_TO } : {}),
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Resend respondió ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

async function sendViaPostmark({ to, subject, html, text }) {
  const res = await fetch('https://api.postmarkapp.com/email', {
    method: 'POST',
    headers: {
      'X-Postmark-Server-Token': process.env.POSTMARK_API_TOKEN,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      From: FROM,
      To: to,
      Subject: subject,
      HtmlBody: html,
      TextBody: text,
      MessageStream: process.env.POSTMARK_STREAM || 'outbound',
      ...(REPLY_TO ? { ReplyTo: REPLY_TO } : {}),
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Postmark respondió ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

async function sendViaBrevo({ to, subject, html, text }) {
  const from = parseAddress(FROM);
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': process.env.BREVO_API_KEY,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      sender: { email: from.email, name: from.name },
      to: [{ email: to }],
      subject,
      htmlContent: html,
      textContent: text,
      ...(REPLY_TO ? { replyTo: { email: parseAddress(REPLY_TO).email } } : {}),
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Brevo respondió ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

let smtpTransport = null;

async function sendViaSmtp({ to, subject, html, text }) {
  if (!nodemailer) nodemailer = require('nodemailer');
  if (!smtpTransport) {
    const port = Number(process.env.SMTP_PORT || 587);
    smtpTransport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      // 465 es TLS implícito; 587 y 25 empiezan en claro y suben con
      // STARTTLS. Deducirlo del puerto evita una variable más que casi
      // siempre se configura mal.
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  await smtpTransport.sendMail({
    from: FROM,
    to,
    subject,
    html,
    text,
    ...(REPLY_TO ? { replyTo: REPLY_TO } : {}),
  });
}

const SENDERS = {
  resend: sendViaResend,
  postmark: sendViaPostmark,
  brevo: sendViaBrevo,
  smtp: sendViaSmtp,
};

function createMailer(options = {}) {
  const provider = options.provider || detectProvider();
  const senders = options.senders || SENDERS;

  function enabled() {
    return Boolean(provider && senders[provider]);
  }

  /**
   * Envía un correo. Lanza si falla — al revés que las alertas: aquí quien
   * llama SÍ necesita saberlo, porque decirle a alguien "te mandamos un
   * enlace" cuando no se mandó lo deja esperando algo que no va a llegar.
   */
  async function send({ to, subject, html, text }) {
    if (!enabled()) throw new Error('No hay proveedor de correo configurado.');
    if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(to))) {
      throw new Error('Dirección de correo inválida.');
    }
    await senders[provider]({ to: String(to).trim(), subject, html, text });
  }

  return { send, enabled, provider: () => provider };
}

module.exports = { createMailer, detectProvider, parseAddress };
