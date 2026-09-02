'use strict';

// Salida de alertas.
//
// El registro de auditoría ya detectaba actividad sospechosa, pero nadie se
// enteraba: quedaba en una tabla que hay que ir a mirar. Esto la empuja
// fuera.
//
// Por webhook y no por correo a propósito: no hay proveedor de envío
// configurado (el mismo bloqueo que impide la verificación de correo), y un
// webhook funciona con Discord, Slack o cualquier endpoint que acepte un
// POST sin añadir ni una dependencia ni una cuenta más.
//
// Tres reglas que rigen todo lo de abajo:
//
//  1. No se manda nada sensible. Misma regla que la auditoría: ni
//     contraseñas, ni códigos, ni identificadores de sesión, ni IP en claro.
//     Un webhook acaba en un chat de equipo; tratarlo como un canal seguro
//     sería un error.
//  2. Nunca rompe la petición que lo dispara. Se envía sin esperar
//     respuesta y cualquier fallo se traga: quedarse sin avisar es malo,
//     tumbar un inicio de sesión por ello es peor.
//  3. Se limita sola. Un ataque de fuerza bruta genera cientos de eventos;
//     mandar cientos de mensajes convierte la alerta en ruido que se
//     silencia, que es exactamente perder la alerta.

const DEFAULT_COOLDOWN_MS = 10 * 60 * 1000; // por tipo+sujeto
const GLOBAL_MAX_PER_HOUR = 20;

// Qué merece interrumpir a alguien. El resto queda en la auditoría, que es
// donde se mira cuando ya sabes que pasó algo.
const ALERTABLE = {
  suspicious_burst: { severity: 'alta', title: 'Posible ataque de credenciales' },
  login_locked: { severity: 'media', title: 'Cuenta bloqueada por intentos fallidos' },
  suspicious_new_ip: { severity: 'baja', title: 'Acceso desde un origen nuevo' },
  mfa_disabled: { severity: 'alta', title: 'Verificación en dos pasos desactivada' },
  mfa_devices_forgotten: { severity: 'baja', title: 'Dispositivos de confianza olvidados' },
  password_change: { severity: 'media', title: 'Contraseña cambiada' },
  passkey_added: { severity: 'media', title: 'Llave de acceso añadida' },
  passkey_removed: { severity: 'media', title: 'Llave de acceso eliminada' },
  account_delete: { severity: 'alta', title: 'Cuenta eliminada' },
  oauth_link: { severity: 'baja', title: 'Cuenta externa vinculada' },
};

function createAlerts(options = {}) {
  const webhookUrl = options.webhookUrl || process.env.ALERT_WEBHOOK_URL || null;
  const cooldownMs = options.cooldownMs || DEFAULT_COOLDOWN_MS;
  const maxPerHour = options.maxPerHour || GLOBAL_MAX_PER_HOUR;
  const send = options.send || globalThis.fetch;

  const lastSent = new Map(); // "evento:sujeto" -> timestamp
  const recentSends = [];     // timestamps de la última hora

  function enabled() {
    return Boolean(webhookUrl);
  }

  function withinGlobalCap(now) {
    while (recentSends.length && now - recentSends[0] > 60 * 60 * 1000) recentSends.shift();
    return recentSends.length < maxPerHour;
  }

  /**
   * Da forma al cuerpo según a dónde va. Discord espera `content`, Slack
   * `text`; cualquier otro endpoint recibe el objeto completo, que es más
   * útil para automatizar.
   */
  function buildBody(url, text, payload) {
    if (/discord(app)?\.com\/api\/webhooks/i.test(url)) return { content: text };
    if (/hooks\.slack\.com/i.test(url)) return { text };
    return { text, ...payload };
  }

  function format(event, meta, context) {
    const parts = [`[${meta.severity.toUpperCase()}] ArleKing Social — ${meta.title}`];
    if (context.username) parts.push(`Cuenta: ${context.username}`);
    if (context.detail) parts.push(context.detail);
    // Sólo el prefijo del digest: suficiente para saber si dos avisos vienen
    // del mismo sitio, inútil para localizar a nadie.
    if (context.originTag) parts.push(`Origen: ${context.originTag}`);
    parts.push(new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC');
    return parts.join(' · ');
  }

  /**
   * Considera un evento de auditoría. No lanza y no devuelve promesa: el
   * envío ocurre por detrás para no añadir latencia al login que lo generó.
   */
  function consider(event, context = {}) {
    try {
      if (!enabled()) return false;
      const meta = Object.prototype.hasOwnProperty.call(ALERTABLE, event) ? ALERTABLE[event] : null;
      if (!meta) return false;

      const now = Date.now();
      const key = `${event}:${context.username || context.originTag || '-'}`;
      const previous = lastSent.get(key);
      if (previous && now - previous < cooldownMs) return false;
      if (!withinGlobalCap(now)) return false;

      lastSent.set(key, now);
      recentSends.push(now);

      const text = format(event, meta, context);
      const body = buildBody(webhookUrl, text, {
        event,
        severity: meta.severity,
        username: context.username || null,
        detail: context.detail || null,
        at: new Date().toISOString(),
      });

      // Deliberadamente sin await.
      Promise.resolve()
        .then(() => send(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(5000),
        }))
        .then((res) => {
          if (res && !res.ok) console.warn(`[alertas] el webhook respondió ${res.status}`);
        })
        .catch((err) => console.warn('[alertas] no se pudo enviar:', err.message));

      return true;
    } catch (err) {
      console.warn('[alertas] fallo al considerar el evento:', err.message);
      return false;
    }
  }

  /** Envío de prueba, para comprobar la URL sin esperar a un incidente. */
  async function test() {
    if (!enabled()) return { ok: false, error: 'No hay ALERT_WEBHOOK_URL configurada.' };
    try {
      const body = buildBody(webhookUrl, '[PRUEBA] ArleKing Social — el canal de alertas funciona.', { event: 'test' });
      const res = await send(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return { ok: false, error: `El webhook respondió ${res.status}` };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  return { consider, test, enabled, ALERTABLE };
}

module.exports = { createAlerts, ALERTABLE };
