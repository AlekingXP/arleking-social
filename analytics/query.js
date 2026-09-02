'use strict';

// Consultas del panel de analíticas.
//
// Todo se deriva de la tabla de eventos; no hay contadores acumulados que
// puedan desincronizarse. Con el volumen de una página de enlaces esto es
// barato, y a cambio cualquier métrica nueva es una consulta más y no una
// migración.

const RANGES = {
  today: { sql: "datetime('now','start of day')", label: 'Hoy', buckets: 'hour', days: 1 },
  '7d': { sql: "datetime('now','-7 days')", label: '7 días', buckets: 'day', days: 7 },
  '30d': { sql: "datetime('now','-30 days')", label: '30 días', buckets: 'day', days: 30 },
  '90d': { sql: "datetime('now','-90 days')", label: '90 días', buckets: 'day', days: 90 },
};

function createQueries(db) {
  function rangeOf(key) {
    return Object.prototype.hasOwnProperty.call(RANGES, key) ? RANGES[key] : RANGES['7d'];
  }

  /**
   * Cifras principales, con la variación frente al periodo inmediatamente
   * anterior de la misma duración. Un número solo no dice nada: 9 visitas
   * puede ser estupendo o terrible según la semana pasada.
   */
  function summary(userId, rangeKey) {
    const range = rangeOf(rangeKey);
    const desde = range.sql;
    const desdeAnterior = `datetime(${desde}, '-${range.days} days')`;

    const bloque = (from, to) => db.prepare(`
      SELECT
        COUNT(*) FILTER (WHERE type = 'view') AS pageviews,
        COUNT(DISTINCT visitor_hash) AS visitors,
        COUNT(DISTINCT session_id) AS sessions,
        COUNT(*) FILTER (WHERE type = 'click') AS clicks
      FROM analytics_events
      WHERE profile_user_id = ? AND created_at >= ${from} ${to ? `AND created_at < ${to}` : ''}
    `).get(userId);

    const actual = bloque(desde, null);
    const anterior = bloque(desdeAnterior, desde);

    // Rebote: sesiones que vieron la página y no pulsaron ningún enlace. En
    // una página de enlaces esa es la definición útil — no "una sola
    // pageview", que aquí serían casi todas.
    const rebote = db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN clicks = 0 THEN 1 ELSE 0 END) AS sin_clic
      FROM (
        SELECT session_id, COUNT(*) FILTER (WHERE type = 'click') AS clicks
        FROM analytics_events
        WHERE profile_user_id = ? AND created_at >= ${desde}
        GROUP BY session_id
      )
    `).get(userId);

    const permanencia = db.prepare(`
      SELECT AVG(dwell_ms) AS media FROM analytics_events
      WHERE profile_user_id = ? AND type = 'view' AND dwell_ms IS NOT NULL AND created_at >= ${desde}
    `).get(userId);

    const cambio = (ahora, antes) => {
      if (!antes) return ahora ? 100 : 0;
      return Math.round(((ahora - antes) / antes) * 1000) / 10;
    };

    const bounceRate = rebote.total ? Math.round((rebote.sin_clic / rebote.total) * 1000) / 10 : 0;
    // La métrica que a una página de enlaces le importa de verdad: de cada
    // cien que entran, cuántas pulsan algo. Es el equivalente honesto a la
    // "tasa de conversión" de una tienda.
    const ctr = actual.sessions ? Math.round(((rebote.total - rebote.sin_clic) / actual.sessions) * 1000) / 10 : 0;

    return {
      range: rangeKey,
      pageviews: actual.pageviews,
      visitors: actual.visitors,
      sessions: actual.sessions,
      clicks: actual.clicks,
      bounceRate,
      ctr,
      avgDwellMs: Math.round(permanencia.media || 0),
      change: {
        pageviews: cambio(actual.pageviews, anterior.pageviews),
        visitors: cambio(actual.visitors, anterior.visitors),
        sessions: cambio(actual.sessions, anterior.sessions),
        clicks: cambio(actual.clicks, anterior.clicks),
      },
    };
  }

  /**
   * Serie temporal. Se rellenan los huecos con ceros en JavaScript en vez de
   * en SQL: un día sin visitas debe dibujarse como un valle, no desaparecer
   * y deformar el eje.
   */
  function series(userId, rangeKey) {
    const range = rangeOf(rangeKey);
    const porHora = range.buckets === 'hour';
    const formato = porHora ? '%Y-%m-%dT%H:00' : '%Y-%m-%d';

    const filas = db.prepare(`
      SELECT strftime('${formato}', created_at) AS bucket,
             COUNT(*) FILTER (WHERE type = 'view') AS pageviews,
             COUNT(DISTINCT session_id) AS sessions,
             COUNT(*) FILTER (WHERE type = 'click') AS clicks
      FROM analytics_events
      WHERE profile_user_id = ? AND created_at >= ${range.sql}
      GROUP BY bucket ORDER BY bucket
    `).all(userId);

    const porClave = new Map(filas.map((f) => [f.bucket, f]));
    const salida = [];
    const ahora = new Date();
    const pasos = porHora ? ahora.getHours() + 1 : range.days;

    for (let i = pasos - 1; i >= 0; i--) {
      const d = new Date(ahora);
      if (porHora) d.setHours(ahora.getHours() - i, 0, 0, 0);
      else d.setDate(ahora.getDate() - i);
      const clave = porHora
        ? d.toISOString().slice(0, 13) + ':00'
        : d.toISOString().slice(0, 10);
      const hit = porClave.get(clave);
      salida.push({
        bucket: clave,
        pageviews: hit ? hit.pageviews : 0,
        sessions: hit ? hit.sessions : 0,
        clicks: hit ? hit.clicks : 0,
      });
    }
    return salida;
  }

  /** Desglose genérico por columna, ya ordenado y con porcentaje. */
  function breakdown(userId, rangeKey, column, { type = 'view', limit = 8 } = {}) {
    const range = rangeOf(rangeKey);
    const permitidas = ['referrer_host', 'browser', 'os', 'device', 'country'];
    if (!permitidas.includes(column)) return [];

    const filas = db.prepare(`
      SELECT COALESCE(${column}, 'Desconocido') AS name, COUNT(*) AS value
      FROM analytics_events
      WHERE profile_user_id = ? AND type = ? AND created_at >= ${range.sql}
      GROUP BY name ORDER BY value DESC LIMIT ?
    `).all(userId, type, limit);

    const total = filas.reduce((sum, f) => sum + f.value, 0);
    return filas.map((f) => ({
      name: f.name,
      value: f.value,
      percent: total ? Math.round((f.value / total) * 1000) / 10 : 0,
    }));
  }

  /**
   * Rendimiento por enlace. Esto es lo que un panel de tienda no puede dar y
   * una página de enlaces necesita: no sólo cuántos entran, sino a dónde van.
   */
  function linkPerformance(userId, rangeKey) {
    const range = rangeOf(rangeKey);
    const sesiones = db.prepare(`
      SELECT COUNT(DISTINCT session_id) AS n FROM analytics_events
      WHERE profile_user_id = ? AND created_at >= ${range.sql}
    `).get(userId).n;

    const filas = db.prepare(`
      SELECT l.id, l.label, l.platform, l.url,
             COUNT(e.id) AS clicks,
             COUNT(DISTINCT e.session_id) AS sessions
      FROM links l
      LEFT JOIN analytics_events e
        ON e.link_id = l.id AND e.type = 'click' AND e.created_at >= ${range.sql}
      WHERE l.user_id = ?
      GROUP BY l.id ORDER BY clicks DESC, l.order_index ASC
    `).all(userId);

    return filas.map((f) => ({
      id: f.id,
      label: f.label,
      platform: f.platform,
      clicks: f.clicks,
      // Porcentaje de visitas que acabaron pulsando ESTE enlace. Es la cifra
      // que dice si un enlace merece seguir arriba del todo.
      ctr: sesiones ? Math.round((f.sessions / sesiones) * 1000) / 10 : 0,
    }));
  }

  /** Visitantes de los últimos cinco minutos, para el indicador "ahora". */
  function liveVisitors(userId) {
    return db.prepare(`
      SELECT COUNT(DISTINCT session_id) AS n FROM analytics_events
      WHERE profile_user_id = ? AND created_at >= datetime('now','-5 minutes')
    `).get(userId).n;
  }

  function everything(userId, rangeKey) {
    return {
      summary: summary(userId, rangeKey),
      series: series(userId, rangeKey),
      links: linkPerformance(userId, rangeKey),
      referrers: breakdown(userId, rangeKey, 'referrer_host'),
      browsers: breakdown(userId, rangeKey, 'browser'),
      systems: breakdown(userId, rangeKey, 'os'),
      devices: breakdown(userId, rangeKey, 'device'),
      countries: breakdown(userId, rangeKey, 'country'),
      live: liveVisitors(userId),
      ranges: Object.entries(RANGES).map(([key, r]) => ({ key, label: r.label })),
    };
  }

  return { everything, summary, series, breakdown, linkPerformance, liveVisitors, RANGES };
}

module.exports = { createQueries, RANGES };
