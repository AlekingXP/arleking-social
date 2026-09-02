'use strict';

// Passkeys (WebAuthn) — what a user experiences as "entrar con Face ID".
//
// There is no Face ID API for the web. Face ID, Touch ID, Windows Hello and
// Android's fingerprint are all reached through the same WebAuthn platform
// authenticator, so implementing this once covers every one of them.
//
// Unlike totp.js, this leans on a library on purpose. TOTP is forty lines of
// HMAC-SHA1 and hand-writing it removes a supply-chain dependency from a
// component whose whole job is to be trustworthy. WebAuthn is the opposite:
// CBOR decoding, COSE key parsing, attestation statement verification across
// several formats, and signature checking. Hand-rolling that is precisely
// where a subtle, silent authentication bypass gets introduced.
//
// A passkey is a FULL credential here, not a second factor. Registration and
// login both demand user verification, so possession of the device and a
// biometric or PIN are already two factors — which is why Google, Apple and
// GitHub all treat a passkey as sufficient on its own. Asking for a password
// as well would make it strictly worse than the password alone: more
// friction for no added assurance.

const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');

const RP_NAME = 'ArleKing Social';

/**
 * The Relying Party ID must be the site's domain, and the origin must match
 * exactly — that binding is what makes passkeys phishing-resistant, since a
 * credential minted for one domain cannot be replayed against another.
 * Derived from the request rather than hardcoded so localhost development
 * and production both work without a config switch.
 */
function rpIdFor(req) {
  if (process.env.WEBAUTHN_RP_ID) return process.env.WEBAUTHN_RP_ID;
  return req.hostname; // strips any :port, which rpID must not contain
}

function originFor(req) {
  if (process.env.WEBAUTHN_ORIGIN) return process.env.WEBAUTHN_ORIGIN;
  return `${req.protocol}://${req.get('host')}`;
}

function createWebAuthn(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS webauthn_credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      credential_id TEXT NOT NULL UNIQUE,
      public_key TEXT NOT NULL,
      counter INTEGER NOT NULL DEFAULT 0,
      transports TEXT,
      device_type TEXT,
      backed_up INTEGER NOT NULL DEFAULT 0,
      label TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_webauthn_user ON webauthn_credentials(user_id);
  `);

  const stmts = {
    forUser: db.prepare('SELECT * FROM webauthn_credentials WHERE user_id = ? ORDER BY created_at'),
    byCredentialId: db.prepare('SELECT * FROM webauthn_credentials WHERE credential_id = ?'),
    insert: db.prepare(`
      INSERT INTO webauthn_credentials
        (user_id, credential_id, public_key, counter, transports, device_type, backed_up, label)
      VALUES (@user_id, @credential_id, @public_key, @counter, @transports, @device_type, @backed_up, @label)
    `),
    touch: db.prepare("UPDATE webauthn_credentials SET counter = ?, last_used_at = datetime('now') WHERE id = ?"),
    remove: db.prepare('DELETE FROM webauthn_credentials WHERE id = ? AND user_id = ?'),
    countForUser: db.prepare('SELECT COUNT(*) AS n FROM webauthn_credentials WHERE user_id = ?'),
  };

  function listFor(userId) {
    return stmts.forUser.all(userId).map((row) => ({
      id: row.id,
      label: row.label,
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at,
      // A "multiDevice" credential is one iCloud or Google syncs between the
      // user's devices; "singleDevice" lives on one piece of hardware and is
      // gone with it. Worth surfacing, because it changes what losing the
      // phone means.
      synced: row.device_type === 'multiDevice',
      backedUp: !!row.backed_up,
    }));
  }

  async function registrationOptions(req, user) {
    const existing = stmts.forUser.all(user.id);
    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: rpIdFor(req),
      userName: user.username,
      userDisplayName: user.username,
      attestationType: 'none', // no attestation: we do not vet hardware vendors, and asking for it only adds a privacy prompt
      // Stops the same authenticator being enrolled twice, which would leave
      // the user with a duplicate they cannot tell apart in the list.
      excludeCredentials: existing.map((row) => ({
        id: row.credential_id,
        transports: row.transports ? JSON.parse(row.transports) : undefined,
      })),
      authenticatorSelection: {
        // Discoverable, so signing in needs no username typed first.
        residentKey: 'preferred',
        // Required, not preferred: this is what forces Face ID / PIN rather
        // than a bare tap, and it is the reason a passkey can stand alone
        // as a full credential.
        userVerification: 'required',
      },
    });
    return options;
  }

  async function verifyRegistration(req, user, response, expectedChallenge, label) {
    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: originFor(req),
      expectedRPID: rpIdFor(req),
      requireUserVerification: true,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return { verified: false };
    }

    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

    stmts.insert.run({
      user_id: user.id,
      credential_id: credential.id,
      public_key: Buffer.from(credential.publicKey).toString('base64url'),
      counter: credential.counter || 0,
      transports: credential.transports ? JSON.stringify(credential.transports) : null,
      device_type: credentialDeviceType,
      backed_up: credentialBackedUp ? 1 : 0,
      label: (label && String(label).slice(0, 60)) || 'Dispositivo',
    });

    return { verified: true };
  }

  async function authenticationOptions(req) {
    // No allowCredentials: the browser offers whichever passkey it holds for
    // this site, so the user never has to say who they are first. The
    // credential itself carries the identity.
    return generateAuthenticationOptions({
      rpID: rpIdFor(req),
      userVerification: 'required',
    });
  }

  async function verifyAuthentication(req, response, expectedChallenge) {
    const stored = stmts.byCredentialId.get(response.id);
    if (!stored) return { verified: false, reason: 'unknown_credential' };

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge,
        expectedOrigin: originFor(req),
        expectedRPID: rpIdFor(req),
        requireUserVerification: true,
        credential: {
          id: stored.credential_id,
          publicKey: Buffer.from(stored.public_key, 'base64url'),
          counter: stored.counter,
          transports: stored.transports ? JSON.parse(stored.transports) : undefined,
        },
      });
    } catch (err) {
      return { verified: false, reason: err.message };
    }

    if (!verification.verified) return { verified: false, reason: 'not_verified' };

    // The signature counter only ever moves forward on a genuine
    // authenticator. Going backwards means the credential was cloned — the
    // one thing a stolen public key cannot fake. Synced passkeys legitimately
    // report 0 forever, so the check only applies once a counter is in use.
    const newCounter = verification.authenticationInfo.newCounter;
    if (stored.counter > 0 && newCounter <= stored.counter) {
      return { verified: false, reason: 'cloned_authenticator' };
    }

    stmts.touch.run(newCounter, stored.id);
    return { verified: true, userId: stored.user_id, credentialRowId: stored.id };
  }

  function remove(userId, rowId) {
    return stmts.remove.run(rowId, userId).changes;
  }

  function countFor(userId) {
    return stmts.countForUser.get(userId).n;
  }

  return {
    listFor,
    registrationOptions,
    verifyRegistration,
    authenticationOptions,
    verifyAuthentication,
    remove,
    countFor,
    rpIdFor,
    originFor,
  };
}

module.exports = { createWebAuthn };
