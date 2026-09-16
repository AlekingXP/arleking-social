'use strict';

// Avisos de soporte, en las dos direcciones.
//
// Hacia el dueño: por el webhook de alertas que ya existe, porque un ticket
// que espera en una tabla que nadie mira es un ticket sin responder. Va sin
// el contenido de la consulta: ese canal acaba en un chat de equipo y el
// texto de un visitante puede traer datos suyos que no tienen por qué
// aparecer ahí. Lleva la referencia; el detalle se lee en el panel.
//
// Hacia el visitante: por correo, y sólo cuando una persona responde de
// verdad. Nunca avisa de lo que contesta el asistente —eso ya lo está
// leyendo en pantalla— ni de que su ticket se abrió: sería convertir el
// soporte en una fuente de correo no pedido.

const { escapeHtml } = require('../security/auth/emails');

function plantillaRespuesta({ subject, body, url }) {
  const cuerpoHtml = escapeHtml(body).split('\n').filter(Boolean).map(
    (linea) => `<p style="margin:0 0 14px;font:400 15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:rgba(241,236,243,0.82);">${linea}</p>`
  ).join('');

  const html = `<!DOCTYPE html>
<html lang="es"><body style="margin:0;padding:0;background:#0e0a10;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0e0a10;padding:32px 16px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#17111a;border:1px solid rgba(255,255,255,0.08);border-radius:16px;">
      <tr><td style="padding:28px 28px 0;">
        <p style="margin:0 0 18px;font:600 15px/1.4 Georgia,serif;color:#ff9a5a;">ArleKing Social</p>
        <h1 style="margin:0 0 6px;font:600 21px/1.3 -apple-system,Segoe UI,Roboto,sans-serif;color:#f1ecf3;">Respuesta a tu consulta</h1>
        <p style="margin:0 0 22px;font:400 13px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:rgba(241,236,243,0.5);">${escapeHtml(subject)}</p>
      </td></tr>
      <tr><td style="padding:0 28px 8px;">${cuerpoHtml}</td></tr>
      <tr><td style="padding:6px 28px 26px;">
        <a href="${escapeHtml(url)}" style="display:inline-block;padding:13px 26px;border-radius:999px;background:#2a1f30;border:1px solid rgba(255,255,255,0.22);color:#f1ecf3;font:600 15px/1 -apple-system,Segoe UI,Roboto,sans-serif;text-decoration:none;">Ir a ArleKing Social</a>
      </td></tr>
      <tr><td style="padding:0 28px 28px;border-top:1px solid rgba(255,255,255,0.08);">
        <p style="margin:18px 0 0;font:400 12px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:rgba(241,236,243,0.4);">Recibes este correo porque pediste ayuda en ArleKing Social. Puedes responder a este mensaje para continuar la conversación.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

  const text = [
    'ArleKing Social — Respuesta a tu consulta',
    subject,
    '',
    body,
    '',
    url,
    '',
    'Recibes este correo porque pediste ayuda en ArleKing Social.',
  ].join('\n');

  return { html, text };
}

function createNotifier({ alerts, mailer }) {
  /** Avisa al dueño de que hay un ticket nuevo. Sin el texto del visitante. */
  function ticketOpened(ticket) {
    try {
      if (!alerts || !alerts.enabled()) return false;
      return alerts.consider('support_ticket', {
        // Cada ticket merece su propio aviso: el enfriamiento por defecto
        // agruparía varios distintos en uno solo y se perderían.
        alertKey: ticket.public_id,
        username: ticket.username || null,
        detail: `Ticket ${ticket.public_id}: ${String(ticket.subject || '').slice(0, 120)}`,
      });
    } catch (err) {
      console.warn('[soporte] no se pudo avisar del ticket:', err.message);
      return false;
    }
  }

  /**
   * Manda al visitante la respuesta de una persona. Devuelve por qué no se
   * mandó cuando no se manda, para que el panel pueda decirlo en vez de
   * fingir que salió.
   */
  async function replySent({ ticket, body, baseUrl }) {
    if (!ticket.email) return { sent: false, reason: 'sin-correo' };
    if (!mailer || !mailer.enabled()) return { sent: false, reason: 'sin-proveedor' };

    const { html, text } = plantillaRespuesta({
      subject: ticket.subject,
      body,
      url: baseUrl,
    });

    try {
      await mailer.send({
        to: ticket.email,
        subject: `Re: ${ticket.subject}`,
        html,
        text,
      });
      return { sent: true };
    } catch (err) {
      console.error('[soporte] no se pudo enviar la respuesta:', err.message);
      return { sent: false, reason: 'error', error: err.message };
    }
  }

  return { ticketOpened, replySent };
}

module.exports = { createNotifier };
