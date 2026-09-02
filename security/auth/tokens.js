'use strict';

// Tokens de un solo uso para verificar correo y restablecer contraseña.
//
// Se guarda **solo el hash SHA-256**, igual que los códigos de recuperación:
// una copia de la base de datos no es un juego de enlaces funcionando. Y el
// token viaja por correo, que es un canal que no controlamos — asumir que
// alguien más lo lee es lo prudente, y por eso caducan pronto y se queman al
// primer uso.

const crypto = require('crypto');

const PURPOSES = {
  // Restablecer contraseña: ventana corta. Es la operación más peligrosa que
  // se puede iniciar sin estar dentro de la cuenta.
  reset: { ttlMs: 60 * 60 * 1000 },
  // Verificar correo: más larga, porque no concede nada por sí sola.
  verify: { ttlMs: 24 * 60 * 60 * 1000 },
};

function createTokens(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_tokens (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      purpose TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON auth_tokens(user_id, purpose);
    CREATE INDEX IF NOT EXISTS idx_auth_tokens_expires ON auth_tokens(expires_at);
  `);

  const stmts = {
    insert: db.prepare('INSERT INTO auth_tokens (token_hash, user_id, purpose, expires_at) VALUES (?, ?, ?, ?)'),
    find: db.prepare('SELECT * FROM auth_tokens WHERE token_hash = ?'),
    // Condiciones dentro del UPDATE: es lo que hace atomico el "gastarlo".
    claim: db.prepare(`
      UPDATE auth_tokens SET used_at = datetime('now')
      WHERE token_hash = ? AND purpose = ? AND used_at IS NULL AND expires_at > ?
    `),
    dropForUser: db.prepare('DELETE FROM auth_tokens WHERE user_id = ? AND purpose = ?'),
    sweep: db.prepare('DELETE FROM auth_tokens WHERE expires_at <= ?'),
    recentForUser: db.prepare(`
      SELECT COUNT(*) AS n FROM auth_tokens
      WHERE user_id = ? AND purpose = ? AND created_at > datetime('now', '-1 hour')
    `),
  };

  function hash(token) {
    return crypto.createHash('sha256').update(String(token)).digest('hex');
  }

  /**
   * Crea un token y devuelve el valor en claro, que sólo existe aquí y en el
   * correo. Los anteriores del mismo propósito se borran: pedir un enlace
   * nuevo debe invalidar el viejo, o quien interceptó el primero sigue
   * teniendo una llave válida.
   */
  function issue(userId, purpose) {
    const meta = Object.prototype.hasOwnProperty.call(PURPOSES, purpose) ? PURPOSES[purpose] : null;
    if (!meta) throw new Error(`Propósito de token desconocido: ${purpose}`);

    stmts.dropForUser.run(userId, purpose);
    const token = crypto.randomBytes(32).toString('base64url');
    stmts.insert.run(hash(token), userId, purpose, Date.now() + meta.ttlMs);
    return token;
  }

  /**
   * Mira si el token vale, SIN gastarlo. Sirve para saber de quién es antes
   * de validar nada más: si se consumiera primero, una contraseña rechazada
   * por la política se llevaría el enlace por delante y habría que pedir
   * otro por escribirla mal una vez.
   */
  function peek(token, purpose) {
    if (!token) return null;
    const row = stmts.find.get(hash(token));
    if (!row) return null;
    if (row.purpose !== purpose) return null;
    if (row.used_at) return null;
    if (row.expires_at <= Date.now()) return null;
    return { userId: row.user_id };
  }

  /**
   * Gasta el token. El UPDATE lleva las condiciones dentro en vez de
   * comprobarlas antes: así la comprobación y la marca son una sola
   * operación y dos peticiones simultáneas no pueden gastarlo las dos —
   * sólo una consigue `changes === 1`.
   */
  function consume(token, purpose) {
    if (!token) return null;
    const digest = hash(token);
    const result = stmts.claim.run(digest, purpose, Date.now());
    if (result.changes !== 1) return null;
    const row = stmts.find.get(digest);
    return row ? { userId: row.user_id } : null;
  }

  /** Cuántos se pidieron en la última hora, para frenar el envío en bucle. */
  function recentCount(userId, purpose) {
    try {
      return stmts.recentForUser.get(userId, purpose).n;
    } catch {
      return 0;
    }
  }

  function sweepExpired() {
    try {
      return stmts.sweep.run(Date.now()).changes;
    } catch {
      return 0;
    }
  }

  sweepExpired();

  return { issue, peek, consume, recentCount, sweepExpired, PURPOSES };
}

module.exports = { createTokens, PURPOSES };
