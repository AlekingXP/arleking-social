'use strict';

// Encuestas del panel.
//
// Dos públicos y dos permisos distintos, y conviene tenerlo claro al leer:
//
//   Quien lleva la plataforma   crea, lee los resultados, cierra y borra.
//   Cualquiera con cuenta       ve la que tenga pendiente y la responde.
//
// Lo que ve cada uno NO es lo mismo: a quien responde se le manda la
// pregunta y nada más —ni recuentos, ni quién ha contestado qué—, porque
// saber que van 40 a favor y 2 en contra cambia lo que la gente vota. Los
// dos recortes viven en support/encuestas.js (`aParticipante` y `aDueno`),
// no aquí, para que no se pueda filtrar algo por olvidar un campo.
//
// Nada de esto existe fuera del panel: la página pública no tiene encuestas,
// así que todos los endpoints piden sesión.

const express = require('express');
const rateLimit = require('express-rate-limit');

const { db } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requireOwner, nombreDe, esDueno } = require('../middleware/owner');
const { crearEncuestas, MAX_PREGUNTA, MAX_DETALLE, MAX_COMENTARIO } = require('../support/encuestas');

const router = express.Router();
const encuestas = crearEncuestas(db);

// Responder es barato, pero el comentario es texto libre que acaba en el
// panel de otra persona: sin tope, una cuenta puede llenarlo.
const responderLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Has enviado muchas respuestas seguidas. Espera un momento.' },
});

const crearLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Has creado muchas encuestas seguidas.' },
});

// ---- Quien responde ----

/**
 * La encuesta que esta persona tiene pendiente, si la hay.
 *
 * A quien lleva la plataforma no le salta ninguna: ya sabe lo que preguntó,
 * y verse el propio aviso al entrar sería ruido. Puede responderla si quiere
 * —el endpoint de responder no lo impide—, pero no se le empuja.
 */
router.get('/encuestas/pendiente', requireAuth, (req, res) => {
  if (esDueno(req)) return res.json({ encuesta: null });
  res.json({ encuesta: encuestas.pendientePara(req.session.userId) });
});

router.post('/encuestas/:id/responder', responderLimiter, requireAuth, (req, res) => {
  const { respuesta, comentario } = req.body || {};
  const r = encuestas.responder({
    publicId: req.params.id,
    userId: req.session.userId,
    username: nombreDe(req),
    respuesta: String(respuesta || ''),
    comentario: comentario,
  });
  if (r.error) return res.status(400).json({ error: r.error });
  // Encadenadas: si tenía dos pendientes, la siguiente sale sola.
  res.json({ ok: true, siguiente: encuestas.pendientePara(req.session.userId) });
});

// ---- Quien la hace ----

router.get('/encuestas', requireAuth, requireOwner, (req, res) => {
  res.json({ encuestas: encuestas.listar(), limites: { pregunta: MAX_PREGUNTA, detalle: MAX_DETALLE, comentario: MAX_COMENTARIO } });
});

router.get('/encuestas/:id', requireAuth, requireOwner, (req, res) => {
  const detalle = encuestas.detalle(req.params.id);
  if (!detalle) return res.status(404).json({ error: 'Esa encuesta no existe.' });
  res.json(detalle);
});

router.post('/encuestas', crearLimiter, requireAuth, requireOwner, (req, res) => {
  const { pregunta, detalle } = req.body || {};
  const r = encuestas.crear({ pregunta, detalle, autor: nombreDe(req) });
  if (r.error) return res.status(400).json({ error: r.error });
  res.status(201).json(r.encuesta);
});

router.post('/encuestas/:id/cerrar', requireAuth, requireOwner, (req, res) => {
  const e = encuestas.cerrar(req.params.id);
  if (!e) return res.status(404).json({ error: 'Esa encuesta no existe.' });
  res.json(e);
});

router.post('/encuestas/:id/reabrir', requireAuth, requireOwner, (req, res) => {
  const e = encuestas.reabrir(req.params.id);
  if (!e) return res.status(404).json({ error: 'Esa encuesta no existe.' });
  res.json(e);
});

router.delete('/encuestas/:id', requireAuth, requireOwner, (req, res) => {
  if (!encuestas.borrar(req.params.id)) return res.status(404).json({ error: 'Esa encuesta no existe.' });
  res.json({ ok: true });
});

module.exports = router;
