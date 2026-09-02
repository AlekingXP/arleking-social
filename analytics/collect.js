'use strict';

// Recogida de analíticas, sin cookies.
//
// La política de privacidad del sitio promete que no hay rastreadores. Eso
// descarta el modelo habitual —una cookie con un identificador permanente—
// y obliga al enfoque que usan Plausible o Fathom: la identidad del
// visitante es un hash con una sal que **rota cada día**.
//
// La consecuencia es la que importa: mañana el mismo visitante produce un
// hash distinto, así que se puede contar "cuántas personas distintas
// entraron hoy" sin poder seguir a nadie a lo largo del tiempo. No hay nada
// que anonimizar después porque nunca se guarda el dato original.
//
// Tampoco hace falta banner de consentimiento, precisamente porque no se
// almacena nada en el dispositivo de quien visita.

const crypto = require('crypto');

const SESSION_WINDOW_MS = 30 * 60 * 1000; // corte estándar de sesión

let baseSalt = null;

function setSalt(salt) {
  baseSalt = salt;
}

/** Sal del día: es lo que hace irreversible el seguimiento entre jornadas. */
function dailySalt(now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  return crypto.createHmac('sha256', baseSalt || 'sin-salt').update(day).digest('hex');
}

/**
 * Identidad del visitante para HOY y para ESTA página. Incluye el perfil en
 * la mezcla a propósito: así el mismo visitante en dos páginas distintas no
 * es correlacionable entre ellas.
 */
function visitorHash(req, profileUserId, now) {
  const parts = [
    req.ip || '',
    req.get('user-agent') || '',
    String(profileUserId),
  ].join('|');
  return crypto.createHmac('sha256', dailySalt(now)).update(parts).digest('hex').slice(0, 32);
}

// Detección de navegador/SO/dispositivo. A mano y deliberadamente burda: no
// se busca identificar un dispositivo, sino saber si conviene probar la
// página en Safari o en Chrome. Una librería de user-agents daría cien
// campos que aquí sólo servirían para hacer huella digital.
function classify(userAgent) {
  const ua = String(userAgent || '');

  let browser = 'Otro';
  if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/OPR\/|Opera/.test(ua)) browser = 'Opera';
  else if (/SamsungBrowser/.test(ua)) browser = 'Samsung Internet';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';
  // Chrome se declara a sí mismo dentro del UA de muchos otros, así que va
  // después de todos ellos.
  else if (/Chrome\//.test(ua)) browser = 'Chrome';
  // Safari aparece en casi todos los UA de WebKit; sólo cuenta si no es
  // ninguno de los anteriores.
  else if (/Safari\//.test(ua)) browser = 'Safari';

  let os = 'Otro';
  if (/Windows NT/.test(ua)) os = 'Windows';
  else if (/iPhone|iPad|iPod/.test(ua)) os = 'iOS';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/Mac OS X/.test(ua)) os = 'macOS';
  else if (/Linux/.test(ua)) os = 'Linux';

  let device = 'Escritorio';
  if (/iPad|Tablet/.test(ua)) device = 'Tablet';
  else if (/Mobi|iPhone|Android.*Mobile/.test(ua)) device = 'Móvil';

  return { browser, os, device };
}

/**
 * Reduce el referente a su dominio. La URL completa puede llevar términos de
 * búsqueda o identificadores del sitio de origen; el dominio es lo único
 * accionable ("me llegan de TikTok") y lo único que se guarda.
 */
function referrerHost(referrer, ownHost) {
  if (!referrer) return null;
  try {
    const host = new URL(referrer).hostname.replace(/^www\./, '');
    if (!host || host === String(ownHost || '').replace(/^www\./, '')) return null; // navegación interna
    return host.slice(0, 80);
  } catch {
    return null;
  }
}

/** Los bots inflan las cifras y no son personas mirando la página. */
const BOT_PATTERN = /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|headless|lighthouse|pingdom|uptime|curl|wget|python-requests|node-fetch|axios|monitor/i;

function looksAutomated(userAgent) {
  return BOT_PATTERN.test(String(userAgent || ''));
}

function createCollector(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS analytics_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      visitor_hash TEXT NOT NULL,
      session_id TEXT NOT NULL,
      link_id INTEGER,
      referrer_host TEXT,
      browser TEXT,
      os TEXT,
      device TEXT,
      country TEXT,
      dwell_ms INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_analytics_profile_time ON analytics_events(profile_user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_analytics_session ON analytics_events(session_id);
    CREATE INDEX IF NOT EXISTS idx_analytics_type ON analytics_events(profile_user_id, type, created_at);
  `);

  const stmts = {
    insert: db.prepare(`
      INSERT INTO analytics_events
        (profile_user_id, type, visitor_hash, session_id, link_id, referrer_host, browser, os, device, country, dwell_ms)
      VALUES (@profile_user_id, @type, @visitor_hash, @session_id, @link_id, @referrer_host, @browser, @os, @device, @country, @dwell_ms)
    `),
    lastForVisitor: db.prepare(`
      SELECT session_id, created_at FROM analytics_events
      WHERE visitor_hash = ? ORDER BY id DESC LIMIT 1
    `),
    // Un evento de salida no crea sesión: actualiza la que ya existe.
    setDwell: db.prepare(`
      UPDATE analytics_events SET dwell_ms = ?
      WHERE session_id = ? AND type = 'view' AND dwell_ms IS NULL
    `),
    prune: db.prepare("DELETE FROM analytics_events WHERE created_at < datetime('now', ?)"),
  };

  /**
   * Sesión del visitante: la anterior si sigue viva, una nueva si no. Media
   * hora es el corte convencional, y evita tener que guardar nada en el
   * navegador para saber si esto es "la misma visita".
   */
  function sessionFor(visitor, now) {
    const previous = stmts.lastForVisitor.get(visitor);
    if (previous) {
      const age = now.getTime() - new Date(previous.created_at + 'Z').getTime();
      if (age >= 0 && age < SESSION_WINDOW_MS) return previous.session_id;
    }
    return crypto.randomBytes(12).toString('hex');
  }

  /**
   * Registra un evento. Nunca lanza: perder una métrica es aceptable,
   * romper la página de alguien por contarla no lo es.
   */
  function record(req, { profileUserId, type, linkId = null, dwellMs = null }) {
    try {
      const userAgent = req.get('user-agent');
      if (looksAutomated(userAgent)) return { ok: false, reason: 'bot' };
      if (!['view', 'click', 'leave'].includes(type)) return { ok: false, reason: 'tipo' };

      const now = new Date();
      const visitor = visitorHash(req, profileUserId, now);
      const session = sessionFor(visitor, now);

      // "leave" sólo aporta el tiempo de permanencia a la vista que ya
      // existe; contarlo como evento propio duplicaría las visitas.
      if (type === 'leave') {
        if (dwellMs > 0) stmts.setDwell.run(Math.min(dwellMs, 30 * 60 * 1000), session);
        return { ok: true, session };
      }

      const { browser, os, device } = classify(userAgent);
      stmts.insert.run({
        profile_user_id: profileUserId,
        type,
        visitor_hash: visitor,
        session_id: session,
        link_id: linkId,
        referrer_host: referrerHost(req.get('referer'), req.hostname),
        browser,
        os,
        device,
        // Cloudflare la deduce por IP y la manda en esta cabecera, así que
        // el país sale gratis y sin guardar la dirección.
        country: (req.get('cf-ipcountry') || '').slice(0, 2).toUpperCase() || null,
        dwell_ms: null,
      });
      return { ok: true, session };
    } catch (err) {
      console.error('[analiticas] no se pudo registrar:', err.message);
      return { ok: false, reason: 'error' };
    }
  }

  /** Retención: los datos viejos no se consultan y sí son responsabilidad. */
  function prune(days = 365) {
    try {
      return stmts.prune.run(`-${days} days`).changes;
    } catch {
      return 0;
    }
  }

  return { record, prune, SESSION_WINDOW_MS };
}

module.exports = { createCollector, setSalt, classify, referrerHost, looksAutomated, dailySalt };
