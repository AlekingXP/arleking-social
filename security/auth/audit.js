'use strict';

// Security event log.
//
// Records who did what and from where, WITHOUT recording anything that
// would turn the log itself into a breach: no passwords, no TOTP codes, no
// session ids, no tokens, no raw IP addresses. The IP is stored as a keyed
// hash, which still lets you group events by origin and spot one address
// hammering many accounts, but cannot be reversed into a location or
// matched against another dataset.

const crypto = require('crypto');

// Events worth keeping. A closed set, so a typo can't silently create a new
// event type nobody ever queries.
const EVENTS = new Set([
  'login_ok', 'login_fail', 'login_locked',
  'register', 'logout',
  'password_change', 'password_reset_request', 'password_reset_ok',
  'mfa_enrolled', 'mfa_ok', 'mfa_fail', 'mfa_disabled', 'mfa_devices_forgotten',
  'oauth_link', 'oauth_unlink', 'oauth_login',
  'account_delete', 'session_revoked_all',
  'suspicious_new_ip', 'suspicious_burst',
]);

let ipSalt = null;

function setIpSalt(salt) {
  ipSalt = salt;
}

/**
 * One-way, salted digest of an IP. The salt lives with the session secret
 * on the persistent disk, so digests are stable across restarts (you can
 * still correlate) but meaningless to anyone who only has the database.
 */
function hashIp(ip) {
  if (!ip) return null;
  return crypto.createHmac('sha256', ipSalt || 'sin-salt').update(String(ip)).digest('hex').slice(0, 32);
}

// Keeps a user agent useful for spotting a new device without storing the
// full fingerprinting surface.
function shortUserAgent(ua) {
  if (!ua) return null;
  return String(ua).slice(0, 120);
}

function createAuditLog(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      event TEXT NOT NULL,
      user_id INTEGER,
      username TEXT,
      ip_hash TEXT,
      user_agent TEXT,
      detail TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_auth_events_user ON auth_events(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_auth_events_event ON auth_events(event, created_at);
    CREATE INDEX IF NOT EXISTS idx_auth_events_ip ON auth_events(ip_hash, created_at);
  `);

  const insert = db.prepare(`
    INSERT INTO auth_events (event, user_id, username, ip_hash, user_agent, detail)
    VALUES (@event, @user_id, @username, @ip_hash, @user_agent, @detail)
  `);

  /**
   * Never throws. An audit write failing must not take down the login it is
   * describing -- losing one log line is strictly better than locking every
   * user out because the disk filled up.
   */
  function record(event, req, { userId = null, username = null, detail = null } = {}) {
    try {
      if (!EVENTS.has(event)) {
        console.warn(`[auditoria] evento desconocido "${event}" ignorado`);
        return;
      }
      insert.run({
        event,
        user_id: userId,
        username: username ? String(username).slice(0, 80) : null,
        ip_hash: hashIp(req && req.ip),
        user_agent: shortUserAgent(req && req.get && req.get('user-agent')),
        detail: detail ? String(detail).slice(0, 300) : null,
      });
    } catch (err) {
      console.error('[auditoria] no se pudo registrar el evento:', err.message);
    }
  }

  /** Has this account been seen from this origin before? */
  function isKnownOrigin(userId, req) {
    try {
      const digest = hashIp(req && req.ip);
      if (!digest) return true; // can't tell -- don't cry wolf
      const row = db.prepare(`
        SELECT 1 FROM auth_events
        WHERE user_id = ? AND ip_hash = ? AND event IN ('login_ok','oauth_login','register')
        LIMIT 1
      `).get(userId, digest);
      return !!row;
    } catch {
      return true;
    }
  }

  /** Recent failures for one account, across every origin. */
  function recentFailures(username, minutes) {
    try {
      return db.prepare(`
        SELECT COUNT(*) AS n FROM auth_events
        WHERE event = 'login_fail' AND username = ?
          AND created_at > datetime('now', ?)
      `).get(username, `-${minutes} minutes`).n;
    } catch {
      return 0;
    }
  }

  /** Distinct accounts one origin has failed against -- credential stuffing. */
  function accountsTargetedFrom(req, minutes) {
    try {
      const digest = hashIp(req && req.ip);
      if (!digest) return 0;
      return db.prepare(`
        SELECT COUNT(DISTINCT username) AS n FROM auth_events
        WHERE event = 'login_fail' AND ip_hash = ?
          AND created_at > datetime('now', ?)
      `).get(digest, `-${minutes} minutes`).n;
    } catch {
      return 0;
    }
  }

  return { record, isKnownOrigin, recentFailures, accountsTargetedFrom, hashIp };
}

module.exports = { createAuditLog, setIpSalt, EVENTS };
