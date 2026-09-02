'use strict';

// Per-account brute-force protection.
//
// The existing express-rate-limit guard is keyed on IP, which stops one
// machine hammering the login but does nothing about the attack that
// matters: a botnet spreading attempts for a single account across
// thousands of addresses, each staying comfortably under the per-IP limit.
// This counts failures against the ACCOUNT, wherever they come from.
//
// Backoff is exponential and capped, and a lockout is a delay rather than a
// permanent block -- otherwise anyone could lock any user out of their own
// account at will, turning the defence into the denial of service.

const THRESHOLD = 5;          // failures before the first lock
const BASE_SECONDS = 30;      // first lock duration
const MAX_SECONDS = 15 * 60;  // cap, so an attacker cannot lock someone out for a day
const WINDOW_MINUTES = 60;    // failures older than this stop counting

function createLockout(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS login_attempts (
      username TEXT PRIMARY KEY,
      failures INTEGER NOT NULL DEFAULT 0,
      first_failure_at TEXT,
      locked_until TEXT
    );
  `);

  const get = db.prepare('SELECT * FROM login_attempts WHERE username = ?');
  const clear = db.prepare('DELETE FROM login_attempts WHERE username = ?');

  const upsert = db.prepare(`
    INSERT INTO login_attempts (username, failures, first_failure_at, locked_until)
    VALUES (@username, @failures, @first_failure_at, @locked_until)
    ON CONFLICT(username) DO UPDATE SET
      failures = excluded.failures,
      first_failure_at = excluded.first_failure_at,
      locked_until = excluded.locked_until
  `);

  function lockSeconds(failures) {
    const over = failures - THRESHOLD;
    if (over < 0) return 0;
    return Math.min(BASE_SECONDS * Math.pow(2, over), MAX_SECONDS);
  }

  /**
   * Returns { locked, retryAfter } — retryAfter in whole seconds.
   * Safe to call for usernames that do not exist: the answer must not
   * depend on whether the account is real.
   */
  function check(username) {
    try {
      const row = get.get(username);
      if (!row || !row.locked_until) return { locked: false, retryAfter: 0 };
      const until = new Date(row.locked_until + 'Z').getTime();
      const now = Date.now();
      if (Number.isNaN(until) || until <= now) return { locked: false, retryAfter: 0 };
      return { locked: true, retryAfter: Math.ceil((until - now) / 1000) };
    } catch {
      return { locked: false, retryAfter: 0 }; // fail open: never lock everyone out on a bug
    }
  }

  function recordFailure(username) {
    try {
      const row = get.get(username);
      const now = new Date();
      const windowStart = new Date(now.getTime() - WINDOW_MINUTES * 60000);

      let failures = 1;
      let firstAt = now;
      if (row && row.first_failure_at) {
        const previousFirst = new Date(row.first_failure_at + 'Z');
        if (previousFirst > windowStart) {
          failures = row.failures + 1;
          firstAt = previousFirst;
        }
      }

      const seconds = lockSeconds(failures);
      const lockedUntil = seconds
        ? new Date(now.getTime() + seconds * 1000).toISOString().replace('T', ' ').slice(0, 19)
        : null;

      upsert.run({
        username,
        failures,
        first_failure_at: firstAt.toISOString().replace('T', ' ').slice(0, 19),
        locked_until: lockedUntil,
      });

      return { failures, lockedFor: seconds };
    } catch (err) {
      console.error('[bloqueo] no se pudo registrar el fallo:', err.message);
      return { failures: 0, lockedFor: 0 };
    }
  }

  function recordSuccess(username) {
    try {
      clear.run(username);
    } catch (err) {
      console.error('[bloqueo] no se pudo limpiar el contador:', err.message);
    }
  }

  return { check, recordFailure, recordSuccess, THRESHOLD, MAX_SECONDS };
}

module.exports = { createLockout };
