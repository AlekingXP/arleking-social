'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { db } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { createCollector } = require('../analytics/collect');
const { createQueries } = require('../analytics/query');

const router = express.Router();
const collector = createCollector(db);
const queries = createQueries(db);

// El endpoint de registro es público y sin sesión, así que sin límite sería
// trivial inflarle las cifras a cualquiera. Generoso porque una visita
// normal manda dos o tres eventos, y estrecho frente a un bucle.
const trackLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: false,
  legacyHeaders: false,
  // Silencioso: el rastreador no muestra errores a nadie, y devolver un
  // cuerpo de error solo gastaría ancho de banda del visitante.
  handler: (req, res) => res.status(204).end(),
});

/**
 * Registro de eventos. Siempre responde 204 sin cuerpo, pase lo que pase:
 * el visitante no debe enterarse de que esto existe, y sendBeacon ignora la
 * respuesta de todos modos.
 */
router.post('/track', trackLimiter, (req, res) => {
  try {
    const { slug, type, linkId, dwellMs } = req.body || {};
    if (!slug || !type) return res.status(204).end();

    const profile = db.prepare('SELECT user_id FROM profile WHERE slug = ?').get(String(slug));
    if (!profile) return res.status(204).end();

    // El enlace debe pertenecer a este perfil: sin la comprobación se podrían
    // apuntar clics al enlace de otra persona.
    let link = null;
    if (linkId != null) {
      const row = db.prepare('SELECT id FROM links WHERE id = ? AND user_id = ?')
        .get(Number(linkId), profile.user_id);
      if (row) link = row.id;
    }

    collector.record(req, {
      profileUserId: profile.user_id,
      type: String(type),
      linkId: link,
      dwellMs: Number(dwellMs) || null,
    });
  } catch (err) {
    console.error('[analiticas] fallo al registrar:', err.message);
  }
  return res.status(204).end();
});

/** Panel del dueño. Sólo ve lo suyo: el id sale de la sesión, no del query. */
router.get('/analytics', requireAuth, (req, res) => {
  const range = String((req.query && req.query.range) || '7d');
  try {
    res.json(queries.everything(req.session.userId, range));
  } catch (err) {
    console.error('[analiticas] fallo al consultar:', err.message);
    res.status(500).json({ error: 'No se pudieron cargar las analíticas.' });
  }
});

module.exports = { router, collector };
