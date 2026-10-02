const { db, isOwnerUsername } = require('../db');

/**
 * Sólo para quien lleva la plataforma.
 *
 * Va SIEMPRE después de requireAuth: aquí se da por hecho que hay sesión.
 * Quién es dueño lo decide OWNER_USERNAMES en el entorno, no un campo de la
 * base: así no hay nada que un usuario pueda cambiarse a sí mismo.
 */
function requireOwner(req, res, next) {
  const fila = db.prepare('SELECT username FROM users WHERE id = ?').get(req.session.userId);
  if (!fila || !isOwnerUsername(fila.username)) {
    return res.status(403).json({ error: 'No tienes acceso a esta parte del panel.' });
  }
  return next();
}

/** El nombre de quien pide, para firmar lo que crea. */
function nombreDe(req) {
  const fila = db.prepare('SELECT username FROM users WHERE id = ?').get(req.session.userId);
  return fila ? fila.username : null;
}

/** Lo mismo que requireOwner pero como pregunta, sin cortar la petición. */
function esDueno(req) {
  if (!req.session || !req.session.userId) return false;
  const fila = db.prepare('SELECT username FROM users WHERE id = ?').get(req.session.userId);
  return Boolean(fila && isOwnerUsername(fila.username));
}

module.exports = { requireOwner, nombreDe, esDueno };
