'use strict';

// SQLite-backed session store.
//
// express-session defaults to MemoryStore, which its own documentation
// marks as unfit for production: it leaks memory and every restart destroys
// every session. On this app that meant each deploy silently logged
// everybody out.
//
// Persisting sessions also buys something MemoryStore cannot give at all:
// the ability to enumerate and revoke a user's other sessions, which is
// what makes "changing your password kicks out whoever stole it" work.

const { Store } = require('express-session');

class SqliteSessionStore extends Store {
  constructor(db) {
    super();
    this.db = db;

    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid TEXT PRIMARY KEY,
        user_id INTEGER,
        data TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
    `);

    this.stmts = {
      get: db.prepare('SELECT data, expires_at FROM sessions WHERE sid = ?'),
      set: db.prepare(`
        INSERT INTO sessions (sid, user_id, data, expires_at) VALUES (@sid, @user_id, @data, @expires_at)
        ON CONFLICT(sid) DO UPDATE SET user_id = excluded.user_id, data = excluded.data, expires_at = excluded.expires_at
      `),
      destroy: db.prepare('DELETE FROM sessions WHERE sid = ?'),
      touch: db.prepare('UPDATE sessions SET expires_at = ? WHERE sid = ?'),
      clear: db.prepare('DELETE FROM sessions'),
      length: db.prepare('SELECT COUNT(*) AS n FROM sessions'),
      sweep: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
      byUser: db.prepare('SELECT sid FROM sessions WHERE user_id = ?'),
      destroyUser: db.prepare('DELETE FROM sessions WHERE user_id = ? AND sid != ?'),
      destroyUserAll: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
    };

    this.sweepExpired();
    // Hourly, and unref'd so a pending sweep never holds the process open.
    this.sweepTimer = setInterval(() => this.sweepExpired(), 60 * 60 * 1000);
    if (this.sweepTimer.unref) this.sweepTimer.unref();
  }

  expiryOf(session) {
    const cookie = session && session.cookie;
    if (cookie && cookie.expires) return new Date(cookie.expires).getTime();
    const maxAge = (cookie && cookie.originalMaxAge) || 8 * 60 * 60 * 1000;
    return Date.now() + maxAge;
  }

  get(sid, callback) {
    try {
      const row = this.stmts.get.get(sid);
      if (!row) return callback(null, null);
      // An expired row is treated as absent and cleaned up in passing.
      if (row.expires_at <= Date.now()) {
        this.stmts.destroy.run(sid);
        return callback(null, null);
      }
      return callback(null, JSON.parse(row.data));
    } catch (err) {
      return callback(err);
    }
  }

  set(sid, session, callback) {
    try {
      this.stmts.set.run({
        sid,
        // Denormalised so sessions can be revoked per user without parsing
        // every row's JSON.
        user_id: session && session.userId ? session.userId : null,
        data: JSON.stringify(session),
        expires_at: this.expiryOf(session),
      });
      return callback ? callback(null) : undefined;
    } catch (err) {
      return callback ? callback(err) : undefined;
    }
  }

  destroy(sid, callback) {
    try {
      this.stmts.destroy.run(sid);
      return callback ? callback(null) : undefined;
    } catch (err) {
      return callback ? callback(err) : undefined;
    }
  }

  touch(sid, session, callback) {
    try {
      this.stmts.touch.run(this.expiryOf(session), sid);
      return callback ? callback(null) : undefined;
    } catch (err) {
      return callback ? callback(err) : undefined;
    }
  }

  clear(callback) {
    try {
      this.stmts.clear.run();
      return callback ? callback(null) : undefined;
    } catch (err) {
      return callback ? callback(err) : undefined;
    }
  }

  length(callback) {
    try {
      return callback(null, this.stmts.length.get().n);
    } catch (err) {
      return callback(err);
    }
  }

  sweepExpired() {
    try {
      return this.stmts.sweep.run(Date.now()).changes;
    } catch (err) {
      console.error('[sesiones] no se pudieron limpiar las expiradas:', err.message);
      return 0;
    }
  }

  /** Revokes every session of a user except the one given. */
  revokeOthers(userId, keepSid) {
    try {
      return this.stmts.destroyUser.run(userId, keepSid || '').changes;
    } catch (err) {
      console.error('[sesiones] no se pudieron revocar:', err.message);
      return 0;
    }
  }

  revokeAll(userId) {
    try {
      return this.stmts.destroyUserAll.run(userId).changes;
    } catch (err) {
      console.error('[sesiones] no se pudieron revocar:', err.message);
      return 0;
    }
  }

  countFor(userId) {
    try {
      return this.stmts.byUser.all(userId).length;
    } catch {
      return 0;
    }
  }
}

module.exports = { SqliteSessionStore };
