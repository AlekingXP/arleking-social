'use strict';

// Plantillas de correo.
//
// HTML y texto plano en cada mensaje: mucha gente lee en clientes que
// bloquean HTML, y un correo que llega vacío es peor que no mandarlo.
//
// Estilos en línea a propósito. Los clientes de correo descartan las hojas
// de estilo y buena parte de CSS moderno, así que aquí no aplica nada de lo
// que usa el sitio: tabla, colores planos y poco más.

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function layout({ title, intro, buttonLabel, buttonUrl, note, footer }) {
  return `<!DOCTYPE html>
<html lang="es"><body style="margin:0;padding:0;background:#0e0a10;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0e0a10;padding:32px 16px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#17111a;border:1px solid rgba(255,255,255,0.08);border-radius:16px;">
      <tr><td style="padding:28px 28px 0;">
        <p style="margin:0 0 18px;font:600 15px/1.4 Georgia,serif;color:#ff9a5a;">ArleKing Social</p>
        <h1 style="margin:0 0 14px;font:600 21px/1.3 -apple-system,Segoe UI,Roboto,sans-serif;color:#f1ecf3;">${escapeHtml(title)}</h1>
        <p style="margin:0 0 22px;font:400 15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:rgba(241,236,243,0.75);">${intro}</p>
      </td></tr>
      <tr><td style="padding:0 28px 22px;">
        <a href="${escapeHtml(buttonUrl)}" style="display:inline-block;padding:13px 26px;border-radius:999px;background:#2a1f30;border:1px solid rgba(255,255,255,0.22);color:#f1ecf3;font:600 15px/1 -apple-system,Segoe UI,Roboto,sans-serif;text-decoration:none;">${escapeHtml(buttonLabel)}</a>
      </td></tr>
      <tr><td style="padding:0 28px 8px;">
        <p style="margin:0 0 8px;font:400 13px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:rgba(241,236,243,0.5);">${note}</p>
        <p style="margin:0 0 22px;font:400 12px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:rgba(241,236,243,0.4);word-break:break-all;">${escapeHtml(buttonUrl)}</p>
      </td></tr>
      <tr><td style="padding:0 28px 28px;border-top:1px solid rgba(255,255,255,0.08);">
        <p style="margin:18px 0 0;font:400 12px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:rgba(241,236,243,0.4);">${footer}</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

function passwordReset({ username, url }) {
  return {
    subject: 'Restablece tu contraseña — ArleKing Social',
    html: layout({
      title: 'Restablece tu contraseña',
      intro: `Alguien pidió restablecer la contraseña de <strong style="color:#f1ecf3;">${escapeHtml(username)}</strong>. Si fuiste tú, sigue el enlace.`,
      buttonLabel: 'Elegir contraseña nueva',
      buttonUrl: url,
      note: 'El enlace caduca en una hora y sólo sirve una vez.',
      footer: 'Si no pediste esto, puedes ignorar el mensaje: tu contraseña no cambia hasta que alguien abra ese enlace. Si te llega repetidamente, alguien está intentando entrar en tu cuenta.',
    }),
    text: [
      'Restablece tu contraseña — ArleKing Social',
      '',
      `Alguien pidió restablecer la contraseña de ${username}. Si fuiste tú, abre este enlace:`,
      url,
      '',
      'Caduca en una hora y sólo sirve una vez.',
      '',
      'Si no pediste esto, ignora el mensaje: tu contraseña no cambia hasta que alguien abra ese enlace.',
    ].join('\n'),
  };
}

function emailVerification({ username, url }) {
  return {
    subject: 'Confirma tu correo — ArleKing Social',
    html: layout({
      title: 'Confirma tu correo',
      intro: `Confirma esta dirección para la cuenta <strong style="color:#f1ecf3;">${escapeHtml(username)}</strong>. Es lo que te permitirá recuperar el acceso si olvidas tu contraseña.`,
      buttonLabel: 'Confirmar correo',
      buttonUrl: url,
      note: 'El enlace caduca en 24 horas.',
      footer: 'Si no creaste esta cuenta, ignora el mensaje y no se hará nada con tu dirección.',
    }),
    text: [
      'Confirma tu correo — ArleKing Social',
      '',
      `Confirma esta dirección para la cuenta ${username}:`,
      url,
      '',
      'Caduca en 24 horas.',
      '',
      'Si no creaste esta cuenta, ignora el mensaje.',
    ].join('\n'),
  };
}

module.exports = { passwordReset, emailVerification, escapeHtml };
