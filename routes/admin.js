const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { db, slugify, RESERVED_SLUGS, VIP_TIERS, createUserWithProfile, touchUserActivity, isOwnerUsername } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { uploadsDir } = require('../paths');
const { analyzeUrl } = require('../security/rules/urls');
const { hashPassword, verifyPassword, checkPasswordPolicy } = require('../security/auth/password');
const { createLockout } = require('../security/auth/lockout');
const totp = require('../security/auth/totp');
const { issueToken } = require('../security/auth/csrf');
const { createTrustedDevices } = require('../security/auth/trusted-device');
const { createWebAuthn } = require('../security/auth/webauthn');

const trustedDevices = createTrustedDevices(db);
const webauthn = createWebAuthn(db);
const cookieSecure = process.env.NODE_ENV === 'production';

const lockout = createLockout(db);

// El envio de prueba sale hacia un tercero, asi que se limita aparte del
// resto del panel para que no se pueda usar como amplificador.
const paymentLimiterlessGuard = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas pruebas. Espera unos minutos.' },
});

// app.locals is populated in server.js; reached through req so this module
// never has to import the app back.
const NO_AUDIT = { record() {}, isKnownOrigin: () => true, recentFailures: () => 0, accountsTargetedFrom: () => 0 };
const auditOf = (req) => (req.app && req.app.locals && req.app.locals.audit) || NO_AUDIT;
const storeOf = (req) => (req.app && req.app.locals && req.app.locals.sessionStore) || null;

const router = express.Router();

// Link enforcement. Only `critical` blocks: an executable scheme or control
// characters hidden in a URL have no honest use on a bio page. Everything
// milder (phishing-shaped hostnames, homographs, shorteners) is logged for
// review rather than rejected, because a false positive there would lock a
// legitimate user out of their own page.
//
// Fails open by design. This is defence in depth, not the only control -- a
// bug in the scanner must never take link editing down for everybody, so an
// unexpected throw is logged and the save proceeds.
function blockingUrlFinding(url) {
  try {
    const findings = analyzeUrl(url);
    for (const f of findings) {
      if (f.severity !== 'critical') {
        console.warn(`[seguridad] enlace permitido con aviso ${f.severity}/${f.code}: ${f.message}`);
      }
    }
    return findings.find((f) => f.severity === 'critical') || null;
  } catch (err) {
    console.error('[seguridad] el analisis de URL fallo, se permite el enlace:', err.message);
    return null;
  }
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.' },
});

if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, crypto.randomUUID() + ext);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowed.includes(ext)) return cb(new Error('Formato de imagen no soportado'));
    cb(null, true);
  },
});

// ---- Auth ----

router.post('/auth/register', authLimiter, async (req, res) => {
  const { username, password, slug: rawSlug, name } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Faltan datos' });

  const cleanUsername = username.trim();
  if (cleanUsername.length < 3) return res.status(400).json({ error: 'El usuario debe tener al menos 3 caracteres' });
  if (cleanUsername.length > 40) return res.status(400).json({ error: 'El usuario no puede superar los 40 caracteres' });

  const policyError = checkPasswordPolicy(password, { username: cleanUsername });
  if (policyError) return res.status(400).json({ error: policyError });

  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(cleanUsername)) {
    return res.status(409).json({ error: 'Ese nombre de usuario ya está en uso' });
  }

  const slug = slugify(rawSlug || cleanUsername);
  if (RESERVED_SLUGS.includes(slug)) return res.status(400).json({ error: 'Esa URL está reservada, elige otra' });
  if (db.prepare('SELECT 1 FROM profile WHERE slug = ?').get(slug)) {
    return res.status(409).json({ error: 'Esa URL ya está en uso' });
  }

  const hash = await hashPassword(password);
  const displayName = (name || cleanUsername).trim();
  const userId = createUserWithProfile({ username: cleanUsername, passwordHash: hash, name: displayName, slug });
  db.prepare("UPDATE users SET password_changed_at = datetime('now') WHERE id = ?").run(userId);

  auditOf(req).record('register', req, { userId, username: cleanUsername });

  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Error de sesión' });
    req.session.userId = userId;
    req.session.username = cleanUsername;
    issueToken(req, res); // see completeLogin
    res.status(201).json({ ok: true, username: cleanUsername, slug });
  });
});

// Establishes the authenticated session. Split out because both the
// password path and the MFA path finish the same way.
function completeLogin(req, res, user, extra = {}) {
  touchUserActivity(user.id);
  lockout.recordSuccess(user.username);

  const audit = auditOf(req);
  const knownOrigin = audit.isKnownOrigin(user.id, req);
  audit.record('login_ok', req, { userId: user.id, username: user.username });
  if (!knownOrigin) {
    audit.record('suspicious_new_ip', req, {
      userId: user.id,
      username: user.username,
      detail: 'primer acceso correcto desde este origen',
    });
  }

  // Regenerated on every privilege change, so a session id captured before
  // login cannot be reused afterwards (session fixation).
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Error de sesión' });
    req.session.userId = user.id;
    req.session.username = user.username;
    // regenerate() discarded the previous session, and with it the CSRF
    // token the client is holding. Mint one for the new session and send it
    // in this same response, otherwise the first write after signing in
    // fails against a token the server no longer knows.
    issueToken(req, res);
    res.json({ ok: true, username: user.username, newOrigin: !knownOrigin, ...extra });
  });
}

/**
 * Accepts either a live TOTP code or an unused recovery code. Recovery
 * codes are single use: the row is marked the moment it succeeds.
 */
function verifyMfa(user, submitted) {
  if (totp.verifyCode(user.mfa_secret, submitted)) return true;

  const digest = totp.hashRecoveryCode(submitted);
  const row = db.prepare(
    'SELECT id FROM mfa_recovery_codes WHERE user_id = ? AND code_hash = ? AND used_at IS NULL'
  ).get(user.id, digest);
  if (!row) return false;

  db.prepare("UPDATE mfa_recovery_codes SET used_at = datetime('now') WHERE id = ?").run(row.id);
  return true;
}

router.post('/auth/login', authLimiter, async (req, res) => {
  const { username, password, totp: totpCode } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Faltan credenciales' });

  const cleanUsername = String(username).trim();
  const audit = auditOf(req);

  // Account-scoped lockout, checked before any work is done. The IP limiter
  // above does nothing against a botnet spreading attempts for one account
  // across thousands of addresses.
  const lock = lockout.check(cleanUsername);
  if (lock.locked) {
    audit.record('login_locked', req, { username: cleanUsername, detail: `faltan ${lock.retryAfter}s` });
    res.setHeader('Retry-After', String(lock.retryAfter));
    return res.status(429).json({
      error: `Demasiados intentos fallidos. Vuelve a intentarlo en ${lock.retryAfter} segundos.`,
    });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(cleanUsername);
  // verifyPassword runs a dummy Argon2 verification when the account or the
  // hash is missing, so a nonexistent user costs the same time as a wrong
  // password. Without it the response time alone enumerates accounts.
  const { ok, needsUpgrade } = await verifyPassword(password, user ? user.password_hash : null);

  if (!user || !ok) {
    const result = lockout.recordFailure(cleanUsername);
    audit.record('login_fail', req, { userId: user ? user.id : null, username: cleanUsername });

    // One origin failing against many different accounts is credential
    // stuffing, not a forgotten password.
    const targeted = audit.accountsTargetedFrom(req, 15);
    if (targeted >= 5) {
      audit.record('suspicious_burst', req, { detail: `${targeted} cuentas distintas en 15 min` });
    }

    if (result.lockedFor) {
      res.setHeader('Retry-After', String(result.lockedFor));
      return res.status(429).json({
        error: `Demasiados intentos fallidos. Vuelve a intentarlo en ${result.lockedFor} segundos.`,
      });
    }
    // Deliberately identical whether or not the account exists.
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  }

  // Rehash a surviving bcrypt password now that we hold the plaintext. This
  // is the only moment it is available, so the migration happens here or
  // never.
  if (needsUpgrade) {
    try {
      const upgraded = await hashPassword(password);
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(upgraded, user.id);
    } catch (err) {
      console.error('[seguridad] no se pudo migrar el hash a Argon2id:', err.message);
    }
  }

  if (user.mfa_enabled && user.mfa_secret) {
    // A browser that passed the second factor within the last 24h skips the
    // prompt. It never skips the password -- see security/auth/trusted-device.js
    // for why that boundary is what makes this safe to offer at all.
    const trusted = trustedDevices.isTrusted(req, user.id);

    if (!trusted) {
      if (!totpCode) {
        // The password was right; say only that a second factor is needed.
        return res.status(401).json({ error: 'Introduce tu código de verificación.', mfaRequired: true });
      }
      if (!verifyMfa(user, totpCode)) {
        lockout.recordFailure(cleanUsername);
        audit.record('mfa_fail', req, { userId: user.id, username: user.username });
        return res.status(401).json({ error: 'Código de verificación incorrecto.', mfaRequired: true });
      }
      audit.record('mfa_ok', req, { userId: user.id, username: user.username });
      // Renewed only after a real code, so trust never extends itself: a
      // device that has not shown a code in 24h has to show one again.
      trustedDevices.remember(req, res, user.id, { secure: cookieSecure });
    } else {
      audit.record('mfa_ok', req, { userId: user.id, username: user.username, detail: 'dispositivo recordado' });
    }
  }

  return completeLogin(req, res, user);
});

router.post('/auth/logout', (req, res) => {
  const userId = req.session && req.session.userId;
  const username = req.session && req.session.username;
  if (userId) auditOf(req).record('logout', req, { userId, username });
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/auth/me', (req, res) => {
  if (req.session && req.session.userId) {
    const user = db.prepare('SELECT username, password_hash, google_email FROM users WHERE id = ?').get(req.session.userId);
    const profile = db.prepare('SELECT slug FROM profile WHERE user_id = ?').get(req.session.userId);
    return res.json({
      authenticated: true,
      username: req.session.username,
      hasPassword: !!(user && user.password_hash),
      googleEmail: user ? user.google_email : null,
      slug: profile ? profile.slug : null,
      isOwner: isOwnerUsername(req.session.username),
    });
  }
  res.json({ authenticated: false });
});

router.put('/auth/password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!newPassword) return res.status(400).json({ error: 'Faltan datos' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);

  const policyError = checkPasswordPolicy(newPassword, { username: user.username });
  if (policyError) return res.status(400).json({ error: policyError });

  if (user.password_hash) {
    const { ok } = await verifyPassword(currentPassword, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'La contraseña actual no es correcta' });
  }

  const hash = await hashPassword(newPassword);
  db.prepare("UPDATE users SET password_hash = ?, password_changed_at = datetime('now') WHERE id = ?")
    .run(hash, user.id);

  // Changing a password is what someone does when they suspect the old one
  // is compromised. Leaving the attacker's session alive would make the
  // whole gesture pointless, so every OTHER session is dropped -- this one
  // survives, because logging the user out of the page they are standing on
  // teaches them not to bother changing it next time.
  const store = storeOf(req);
  let revoked = 0;
  if (store) revoked = store.revokeOthers(user.id, req.sessionID);

  // Same reasoning as the sessions: someone changing their password wants
  // every previously-granted shortcut gone, including a remembered device
  // sitting on a machine they no longer trust.
  trustedDevices.forgetAll(user.id);
  trustedDevices.clearCookie(res, { secure: cookieSecure });

  const audit = auditOf(req);
  audit.record('password_change', req, { userId: user.id, username: user.username });
  if (revoked) {
    audit.record('session_revoked_all', req, {
      userId: user.id, username: user.username, detail: `${revoked} sesion(es)`,
    });
  }

  res.json({ ok: true, revokedSessions: revoked });
});

// ---- MFA (TOTP) ----

// Enrolment is two steps on purpose: the secret is only committed once the
// user has proved their authenticator produces a matching code. Storing it
// on step one would lock out anyone whose scan silently failed.

router.post('/auth/mfa/setup', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (user.mfa_enabled) return res.status(409).json({ error: 'La verificación en dos pasos ya está activa.' });

  const secret = totp.generateSecret();
  // Parked on the session, not the users table, until it is confirmed.
  req.session.pendingMfaSecret = secret;

  res.json({
    secret,
    uri: totp.provisioningUri(secret, { account: user.username }),
  });
});

router.post('/auth/mfa/enable', requireAuth, (req, res) => {
  const { code } = req.body || {};
  const secret = req.session.pendingMfaSecret;
  if (!secret) return res.status(400).json({ error: 'Empieza la configuración de nuevo.' });

  if (!totp.verifyCode(secret, code)) {
    return res.status(400).json({ error: 'Ese código no coincide. Comprueba la hora de tu teléfono e inténtalo otra vez.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  const codes = totp.generateRecoveryCodes(8);

  const enable = db.transaction(() => {
    db.prepare("UPDATE users SET mfa_secret = ?, mfa_enabled = 1, mfa_enrolled_at = datetime('now') WHERE id = ?")
      .run(secret, user.id);
    db.prepare('DELETE FROM mfa_recovery_codes WHERE user_id = ?').run(user.id);
    const insert = db.prepare('INSERT INTO mfa_recovery_codes (user_id, code_hash) VALUES (?, ?)');
    for (const c of codes) insert.run(user.id, totp.hashRecoveryCode(c));
  });
  enable();

  delete req.session.pendingMfaSecret;
  auditOf(req).record('mfa_enrolled', req, { userId: user.id, username: user.username });

  // The only time the plaintext codes exist. They are stored as digests, so
  // this response cannot be reproduced later.
  res.json({ ok: true, recoveryCodes: codes });
});

router.post('/auth/mfa/disable', requireAuth, async (req, res) => {
  const { password, code } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!user.mfa_enabled) return res.status(400).json({ error: 'La verificación en dos pasos no está activa.' });

  // Turning a factor OFF is a privileged act: require proof of both, so a
  // stolen session alone cannot strip the protection it is meant to defeat.
  if (user.password_hash) {
    const { ok } = await verifyPassword(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'La contraseña no es correcta.' });
  }
  if (!verifyMfa(user, code)) {
    return res.status(401).json({ error: 'Código de verificación incorrecto.' });
  }

  const disable = db.transaction(() => {
    db.prepare('UPDATE users SET mfa_secret = NULL, mfa_enabled = 0, mfa_enrolled_at = NULL WHERE id = ?').run(user.id);
    db.prepare('DELETE FROM mfa_recovery_codes WHERE user_id = ?').run(user.id);
  });
  disable();

  // Otherwise the trust records would outlive the factor they belong to and
  // silently wave through the next enrolment.
  trustedDevices.forgetAll(user.id);
  trustedDevices.clearCookie(res, { secure: cookieSecure });

  auditOf(req).record('mfa_disabled', req, { userId: user.id, username: user.username });
  res.json({ ok: true });
});

router.get('/auth/mfa/status', requireAuth, (req, res) => {
  const user = db.prepare('SELECT mfa_enabled, mfa_enrolled_at FROM users WHERE id = ?').get(req.session.userId);
  const unused = db.prepare(
    'SELECT COUNT(*) AS n FROM mfa_recovery_codes WHERE user_id = ? AND used_at IS NULL'
  ).get(req.session.userId).n;
  res.json({
    enabled: !!(user && user.mfa_enabled),
    enrolledAt: user ? user.mfa_enrolled_at : null,
    recoveryCodesLeft: unused,
    trustedDevices: trustedDevices.countFor(req.session.userId),
    trustHours: trustedDevices.TRUST_HOURS,
  });
});

router.post('/auth/mfa/forget-devices', requireAuth, (req, res) => {
  const forgotten = trustedDevices.forgetAll(req.session.userId);
  trustedDevices.clearCookie(res, { secure: cookieSecure });
  auditOf(req).record('mfa_devices_forgotten', req, {
    userId: req.session.userId,
    username: req.session.username,
    detail: `${forgotten} dispositivo(s)`,
  });
  res.json({ ok: true, forgotten });
});

// ---- Passkeys (WebAuthn) ----
//
// A passkey signs in on its own: no password, no TOTP. Both the registration
// and the login demand user verification, so the device plus a biometric or
// PIN are already two factors, and it is phishing-resistant in a way a
// password never is. See security/auth/webauthn.js.

router.post('/auth/passkey/register/options', requireAuth, async (req, res) => {
  try {
    const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(req.session.userId);
    const options = await webauthn.registrationOptions(req, user);
    // Parked on the session: the challenge must come back from the server
    // that issued it, or a replayed one would pass.
    req.session.passkeyChallenge = options.challenge;
    res.json(options);
  } catch (err) {
    console.error('[passkey] no se pudieron generar las opciones de registro:', err.message);
    res.status(500).json({ error: 'No se pudo iniciar el registro de la llave.' });
  }
});

router.post('/auth/passkey/register/verify', requireAuth, async (req, res) => {
  const expected = req.session.passkeyChallenge;
  if (!expected) return res.status(400).json({ error: 'Empieza el registro de nuevo.' });
  // Single use, cleared before verifying so a failure cannot be retried
  // against the same challenge.
  delete req.session.passkeyChallenge;

  try {
    const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(req.session.userId);
    const { verified } = await webauthn.verifyRegistration(
      req, user, req.body && req.body.response, expected, req.body && req.body.label
    );
    if (!verified) return res.status(400).json({ error: 'No se pudo verificar la llave.' });

    auditOf(req).record('passkey_added', req, { userId: user.id, username: user.username });
    res.json({ ok: true, passkeys: webauthn.listFor(user.id) });
  } catch (err) {
    console.error('[passkey] registro fallido:', err.message);
    res.status(400).json({ error: 'No se pudo registrar la llave: ' + err.message });
  }
});

router.post('/auth/passkey/login/options', authLimiter, async (req, res) => {
  try {
    const options = await webauthn.authenticationOptions(req);
    req.session.passkeyLoginChallenge = options.challenge;
    res.json(options);
  } catch (err) {
    console.error('[passkey] no se pudieron generar las opciones de acceso:', err.message);
    res.status(500).json({ error: 'No se pudo iniciar el acceso con llave.' });
  }
});

router.post('/auth/passkey/login/verify', authLimiter, async (req, res) => {
  const expected = req.session.passkeyLoginChallenge;
  if (!expected) return res.status(400).json({ error: 'La sesión expiró, inténtalo de nuevo.' });
  delete req.session.passkeyLoginChallenge;

  const audit = auditOf(req);
  try {
    const result = await webauthn.verifyAuthentication(req, req.body && req.body.response, expected);
    if (!result.verified) {
      audit.record('passkey_fail', req, { detail: result.reason });
      // A counter that went backwards means a cloned authenticator, which is
      // worth shouting about rather than filing as a normal failure.
      if (result.reason === 'cloned_authenticator') {
        audit.record('suspicious_burst', req, { detail: 'contador de passkey retrocedido' });
      }
      return res.status(401).json({ error: 'No se pudo verificar la llave.' });
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.userId);
    if (!user) return res.status(401).json({ error: 'No se pudo verificar la llave.' });

    audit.record('passkey_login', req, { userId: user.id, username: user.username });
    return completeLogin(req, res, user);
  } catch (err) {
    console.error('[passkey] acceso fallido:', err.message);
    audit.record('passkey_fail', req, { detail: err.message });
    return res.status(401).json({ error: 'No se pudo verificar la llave.' });
  }
});

router.get('/auth/passkeys', requireAuth, (req, res) => {
  res.json(webauthn.listFor(req.session.userId));
});

router.delete('/auth/passkeys/:id', requireAuth, async (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  const remaining = webauthn.countFor(user.id) - 1;
  const oauthLinks = db.prepare('SELECT COUNT(*) AS n FROM oauth_accounts WHERE user_id = ?').get(user.id).n;

  // Refuse to remove the last way in, same rule the OAuth unlink follows.
  if (!user.password_hash && remaining < 1 && oauthLinks < 1) {
    return res.status(400).json({
      error: 'Es tu única forma de entrar. Configura una contraseña antes de eliminarla.',
    });
  }

  const removed = webauthn.remove(user.id, Number(req.params.id));
  if (!removed) return res.status(404).json({ error: 'Esa llave no existe.' });

  auditOf(req).record('passkey_removed', req, { userId: user.id, username: user.username });
  res.json({ ok: true, passkeys: webauthn.listFor(user.id) });
});

// ---- Alertas ----

// Solo para el propietario: el canal es de la plataforma, no de cada
// cuenta, y un envio de prueba desde cualquier usuario seria un modo facil
// de inundar el webhook.
router.get('/alerts/status', requireAuth, (req, res) => {
  if (!isOwnerUsername(req.session.username)) return res.status(403).json({ error: 'No autorizado' });
  const alerts = req.app.locals.alerts;
  res.json({ enabled: !!(alerts && alerts.enabled()) });
});

router.post('/alerts/test', paymentLimiterlessGuard, requireAuth, async (req, res) => {
  if (!isOwnerUsername(req.session.username)) return res.status(403).json({ error: 'No autorizado' });
  const alerts = req.app.locals.alerts;
  if (!alerts || !alerts.enabled()) {
    return res.status(503).json({ error: 'No hay ALERT_WEBHOOK_URL configurada en el servidor.' });
  }
  const result = await alerts.test();
  if (!result.ok) return res.status(502).json({ error: result.error });
  res.json({ ok: true });
});

// ---- Sessions and activity ----

router.get('/auth/sessions', requireAuth, (req, res) => {
  const store = storeOf(req);
  res.json({ active: store ? store.countFor(req.session.userId) : 1 });
});

router.post('/auth/sessions/revoke-others', requireAuth, (req, res) => {
  const store = storeOf(req);
  const revoked = store ? store.revokeOthers(req.session.userId, req.sessionID) : 0;
  auditOf(req).record('session_revoked_all', req, {
    userId: req.session.userId, username: req.session.username, detail: `${revoked} sesion(es)`,
  });
  res.json({ ok: true, revoked });
});

// Recent security activity for the signed-in account. Deliberately never
// returns ip_hash or user_agent in full: this is a "was that you?" view, not
// a forensics console, and rendering a raw fingerprint would only teach
// people to ignore it.
router.get('/auth/activity', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT created_at, event, detail FROM auth_events
    WHERE user_id = ? ORDER BY created_at DESC LIMIT 25
  `).all(req.session.userId);
  res.json(rows);
});

// ---- Profile ----

router.get('/profile', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM profile WHERE user_id = ?').get(req.session.userId));
});

router.put('/profile', requireAuth, (req, res) => {
  const {
    name, tagline, age_gate_enabled, age_gate_title, age_gate_subtitle,
    age_gate_confirm, footer_text, accent_from, accent_to,
    particles_enabled, particles_color, particles_density, slug: rawSlug,
  } = req.body || {};

  if (!name || !tagline) return res.status(400).json({ error: 'Nombre y tagline son obligatorios' });

  const current = db.prepare('SELECT slug FROM profile WHERE user_id = ?').get(req.session.userId);
  let slug = current.slug;
  if (rawSlug && slugify(rawSlug) !== current.slug) {
    slug = slugify(rawSlug);
    if (RESERVED_SLUGS.includes(slug)) return res.status(400).json({ error: 'Esa URL está reservada, elige otra' });
    const taken = db.prepare('SELECT 1 FROM profile WHERE slug = ? AND user_id != ?').get(slug, req.session.userId);
    if (taken) return res.status(409).json({ error: 'Esa URL ya está en uso' });
  }

  const density = Math.min(150, Math.max(0, parseInt(particles_density, 10) || 60));

  db.prepare(`
    UPDATE profile SET
      slug = ?, name = ?, tagline = ?, age_gate_enabled = ?, age_gate_title = ?,
      age_gate_subtitle = ?, age_gate_confirm = ?, footer_text = ?,
      accent_from = ?, accent_to = ?,
      particles_enabled = ?, particles_color = ?, particles_density = ?
    WHERE user_id = ?
  `).run(
    slug, name, tagline, age_gate_enabled ? 1 : 0, age_gate_title || name,
    age_gate_subtitle || tagline, age_gate_confirm || 'Al continuar confirmas que eres mayor de edad',
    footer_text || name, accent_from || '#ff5f8f', accent_to || '#ff9a5a',
    particles_enabled ? 1 : 0, particles_color || '#ffffff', density,
    req.session.userId
  );

  res.json(db.prepare('SELECT * FROM profile WHERE user_id = ?').get(req.session.userId));
});

// Manual VIP switch for platform owners (OWNER_USERNAMES) — the site is
// theirs, so they don't pay for their own badge.
//
// This used to be an unauthenticated-by-role "/profile/vip-test" route
// guarded only by requireAuth, which meant ANY registered user could grant
// themselves any paid tier for free. The path is renamed so old clients
// hitting the open endpoint get a 404 rather than silently succeeding.
router.put('/profile/vip-owner', requireAuth, (req, res) => {
  if (!isOwnerUsername(req.session.username)) {
    return res.status(403).json({ error: 'Solo los propietarios pueden cambiar el tier manualmente.' });
  }

  const { vip_tier } = req.body || {};
  if (vip_tier !== null && !VIP_TIERS.includes(vip_tier)) {
    return res.status(400).json({ error: 'Tier VIP inválido' });
  }

  db.prepare(`
    UPDATE profile SET vip_tier = ?, vip_activated_at = CASE WHEN ? IS NULL THEN NULL ELSE datetime('now') END
    WHERE user_id = ?
  `).run(vip_tier, vip_tier, req.session.userId);

  res.json(db.prepare('SELECT * FROM profile WHERE user_id = ?').get(req.session.userId));
});

router.post('/profile/avatar', requireAuth, upload.single('avatar'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió ninguna imagen' });

  const prev = db.prepare('SELECT avatar_path FROM profile WHERE user_id = ?').get(req.session.userId);
  db.prepare('UPDATE profile SET avatar_path = ? WHERE user_id = ?').run('/uploads/' + req.file.filename, req.session.userId);
  if (prev && prev.avatar_path) {
    fs.unlink(path.join(uploadsDir, path.basename(prev.avatar_path)), () => {});
  }

  res.json(db.prepare('SELECT * FROM profile WHERE user_id = ?').get(req.session.userId));
});

router.post('/profile/background', requireAuth, upload.single('background'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió ninguna imagen' });

  const prev = db.prepare('SELECT background_path FROM profile WHERE user_id = ?').get(req.session.userId);
  db.prepare('UPDATE profile SET background_path = ? WHERE user_id = ?').run('/uploads/' + req.file.filename, req.session.userId);
  if (prev && prev.background_path) {
    fs.unlink(path.join(uploadsDir, path.basename(prev.background_path)), () => {});
  }

  res.json(db.prepare('SELECT * FROM profile WHERE user_id = ?').get(req.session.userId));
});

router.delete('/profile/background', requireAuth, (req, res) => {
  const prev = db.prepare('SELECT background_path FROM profile WHERE user_id = ?').get(req.session.userId);
  db.prepare('UPDATE profile SET background_path = NULL WHERE user_id = ?').run(req.session.userId);
  if (prev && prev.background_path) {
    fs.unlink(path.join(uploadsDir, path.basename(prev.background_path)), () => {});
  }

  res.json(db.prepare('SELECT * FROM profile WHERE user_id = ?').get(req.session.userId));
});

// ---- Links (all scoped to req.session.userId) ----

router.get('/links', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM links WHERE user_id = ? ORDER BY order_index ASC').all(req.session.userId));
});

// `platform` is free text now (the "Personalizado" option lets people name
// their own), so it's capped here — the input's maxlength only constrains
// the browser, not the API.
function cleanPlatform(platform) {
  const value = typeof platform === 'string' ? platform.trim().slice(0, 40) : '';
  return value || 'custom';
}

router.post('/links', requireAuth, (req, res) => {
  const { type, platform, label, subtitle, badge_left, badge_right, url, icon, enabled } = req.body || {};
  if (!label || !url) return res.status(400).json({ error: 'Label y URL son obligatorios' });

  const blocked = blockingUrlFinding(url);
  if (blocked) return res.status(400).json({ error: blocked.message });

  const maxOrder = db.prepare('SELECT COALESCE(MAX(order_index), -1) AS m FROM links WHERE user_id = ?').get(req.session.userId).m;
  const info = db.prepare(`
    INSERT INTO links (user_id, order_index, type, platform, label, subtitle, badge_left, badge_right, url, image_path, icon, enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
  `).run(req.session.userId, maxOrder + 1, type || 'simple', cleanPlatform(platform), label, subtitle || '', badge_left || null, badge_right || null, url, icon || '🔗', enabled ? 1 : 0);

  res.status(201).json(db.prepare('SELECT * FROM links WHERE id = ? AND user_id = ?').get(info.lastInsertRowid, req.session.userId));
});

router.put('/links/reorder', requireAuth, (req, res) => {
  const { order } = req.body || {};
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order debe ser un arreglo de IDs' });

  const update = db.prepare('UPDATE links SET order_index = ? WHERE id = ? AND user_id = ?');
  const tx = db.transaction((ids) => ids.forEach((id, idx) => update.run(idx, id, req.session.userId)));
  tx(order);

  res.json(db.prepare('SELECT * FROM links WHERE user_id = ? ORDER BY order_index ASC').all(req.session.userId));
});

router.put('/links/:id', requireAuth, (req, res) => {
  const existing = db.prepare('SELECT * FROM links WHERE id = ? AND user_id = ?').get(req.params.id, req.session.userId);
  if (!existing) return res.status(404).json({ error: 'Link no encontrado' });

  const { type, platform, label, subtitle, badge_left, badge_right, url, icon, enabled } = req.body || {};
  if (!label || !url) return res.status(400).json({ error: 'Label y URL son obligatorios' });

  const blocked = blockingUrlFinding(url);
  if (blocked) return res.status(400).json({ error: blocked.message });

  db.prepare(`
    UPDATE links SET type = ?, platform = ?, label = ?, subtitle = ?, badge_left = ?, badge_right = ?, url = ?, icon = ?, enabled = ?
    WHERE id = ? AND user_id = ?
  `).run(type || 'simple', cleanPlatform(platform), label, subtitle || '', badge_left || null, badge_right || null, url, icon || '🔗', enabled ? 1 : 0, req.params.id, req.session.userId);

  res.json(db.prepare('SELECT * FROM links WHERE id = ? AND user_id = ?').get(req.params.id, req.session.userId));
});

router.delete('/links/:id', requireAuth, (req, res) => {
  const existing = db.prepare('SELECT * FROM links WHERE id = ? AND user_id = ?').get(req.params.id, req.session.userId);
  if (!existing) return res.status(404).json({ error: 'Link no encontrado' });

  if (existing.image_path) {
    fs.unlink(path.join(uploadsDir, path.basename(existing.image_path)), () => {});
  }
  db.prepare('DELETE FROM links WHERE id = ? AND user_id = ?').run(req.params.id, req.session.userId);
  res.json({ ok: true });
});

router.post('/links/:id/image', requireAuth, upload.single('image'), (req, res) => {
  const existing = db.prepare('SELECT * FROM links WHERE id = ? AND user_id = ?').get(req.params.id, req.session.userId);
  if (!existing) return res.status(404).json({ error: 'Link no encontrado' });
  if (!req.file) return res.status(400).json({ error: 'No se recibió ninguna imagen' });

  db.prepare('UPDATE links SET image_path = ? WHERE id = ? AND user_id = ?').run('/uploads/' + req.file.filename, req.params.id, req.session.userId);
  if (existing.image_path) {
    fs.unlink(path.join(uploadsDir, path.basename(existing.image_path)), () => {});
  }

  res.json(db.prepare('SELECT * FROM links WHERE id = ? AND user_id = ?').get(req.params.id, req.session.userId));
});

module.exports = router;
