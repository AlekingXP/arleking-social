'use strict';

// "Remember this device" for the second factor.
//
// Asking for a TOTP code on every single sign-in is the main reason people
// turn MFA off, which trades a small convenience for the whole protection.
// Letting a device skip the code for a day keeps the factor switched on.
//
// The important boundary: this cookie ONLY waives the second factor. The
// password is still required every time. So a stolen cookie on its own is
// worth nothing -- an attacker who has it is exactly as far from the
// account as an attacker who has no MFA at all, which is the situation
// this feature is compared against.
//
// What is stored is a SHA-256 digest, never the token itself, so a copy of
// the database cannot be turned back into a working cookie.

const crypto = require('crypto');

const COOKIE = 'aks.tdid';
const TRUST_HOURS = 24;

function createTrustedDevices(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS trusted_devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      user_agent TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_trusted_devices_user ON trusted_devices(user_id);
    CREATE INDEX IF NOT EXISTS idx_trusted_devices_expires ON trusted_devices(expires_at);
  `);

  const stmts = {
    find: db.prepare('SELECT * FROM trusted_devices WHERE token_hash = ?'),
    insert: db.prepare(`
      INSERT INTO trusted_devices (user_id, token_hash, user_agent, expires_at)
      VALUES (?, ?, ?, ?)
    `),
    deleteByHash: db.prepare('DELETE FROM trusted_devices WHERE token_hash = ?'),
    deleteForUser: db.prepare('DELETE FROM trusted_devices WHERE user_id = ?'),
    countForUser: db.prepare('SELECT COUNT(*) AS n FROM trusted_devices WHERE user_id = ? AND expires_at > ?'),
    sweep: db.prepare('DELETE FROM trusted_devices WHERE expires_at <= ?'),
  };

  function hash(token) {
    return crypto.createHash('sha256').update(String(token)).digest('hex');
  }

  function readCookie(req) {
    const raw = req.headers && req.headers.cookie;
    if (!raw) return null;
    for (const part of raw.split(';')) {
      const [name, ...rest] = part.trim().split('=');
      if (name === COOKIE) return decodeURIComponent(rest.join('='));
    }
    return null;
  }

  /**
   * True when this browser passed the second factor for THIS user recently.
   * A token belonging to another account is not merely rejected but deleted
   * -- it can only mean a stale or tampered cookie.
   */
  function isTrusted(req, userId) {
    try {
      const token = readCookie(req);
      if (!token) return false;

      const row = stmts.find.get(hash(token));
      if (!row) return false;

      if (row.expires_at <= Date.now()) {
        stmts.deleteByHash.run(row.token_hash);
        return false;
      }
      if (row.user_id !== userId) {
        stmts.deleteByHash.run(row.token_hash);
        return false;
      }
      return true;
    } catch (err) {
      // Fail closed: if the check itself breaks, ask for the code. The cost
      // is one extra prompt; the cost of failing open is a skipped factor.
      console.error('[dispositivo] no se pudo comprobar la confianza:', err.message);
      return false;
    }
  }

  /** Issues a fresh 24h trust for this browser and drops any previous one. */
  function remember(req, res, userId, { secure }) {
    try {
      const previous = readCookie(req);
      if (previous) stmts.deleteByHash.run(hash(previous));

      const token = crypto.randomBytes(32).toString('base64url');
      const expiresAt = Date.now() + TRUST_HOURS * 60 * 60 * 1000;
      const ua = req.get && req.get('user-agent') ? String(req.get('user-agent')).slice(0, 120) : null;

      stmts.insert.run(userId, hash(token), ua, expiresAt);

      res.cookie(COOKIE, token, {
        httpOnly: true,   // never readable by page script
        sameSite: 'lax',
        secure: !!secure,
        maxAge: TRUST_HOURS * 60 * 60 * 1000,
        path: '/',
      });
      return true;
    } catch (err) {
      console.error('[dispositivo] no se pudo recordar:', err.message);
      return false;
    }
  }

  /** Revokes every remembered device for a user. */
  function forgetAll(userId) {
    try {
      return stmts.deleteForUser.run(userId).changes;
    } catch (err) {
      console.error('[dispositivo] no se pudieron olvidar:', err.message);
      return 0;
    }
  }

  function countFor(userId) {
    try {
      return stmts.countForUser.get(userId, Date.now()).n;
    } catch {
      return 0;
    }
  }

  function clearCookie(res, { secure }) {
    res.clearCookie(COOKIE, { httpOnly: true, sameSite: 'lax', secure: !!secure, path: '/' });
  }

  function sweepExpired() {
    try {
      return stmts.sweep.run(Date.now()).changes;
    } catch {
      return 0;
    }
  }

  sweepExpired();

  return { isTrusted, remember, forgetAll, countFor, clearCookie, sweepExpired, TRUST_HOURS, COOKIE };
}

module.exports = { createTrustedDevices, TRUST_HOURS };
