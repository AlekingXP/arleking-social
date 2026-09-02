'use strict';

// Password hashing and policy.
//
// Argon2id with the OWASP minimum configuration (m=19 MiB, t=2, p=1).
// Existing bcrypt hashes keep working and are transparently upgraded the
// next time their owner logs in, so nobody is locked out by the change.

const crypto = require('crypto');
const argon2 = require('@node-rs/argon2');
const bcrypt = require('bcryptjs');
const { COMMON_PASSWORDS } = require('./common-passwords');

const ARGON2_OPTIONS = {
  algorithm: argon2.Algorithm.Argon2id,
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
};

// A pre-computed hash of a value nobody can supply, verified against when
// the account does not exist. Without it, a missing account returns in
// microseconds while a real one costs a full Argon2 verification -- which
// tells an attacker which usernames are registered just by timing the
// response. See the comment in verifyPassword.
const DUMMY_HASH = argon2.hashSync(crypto.randomBytes(32).toString('hex'), ARGON2_OPTIONS);

const MIN_LENGTH = 8;   // NIST SP 800-63B floor
const MAX_LENGTH = 128; // bcrypt truncates at 72 bytes; argon2 has no limit, but cap the work

function isBcryptHash(hash) {
  return typeof hash === 'string' && /^\$2[aby]?\$/.test(hash);
}

async function hashPassword(plain) {
  return argon2.hash(plain, ARGON2_OPTIONS);
}

/**
 * Verifies a password against a stored hash of either algorithm.
 *
 * `storedHash` may be null (account has no password, e.g. OAuth-only). The
 * dummy verification still runs in that case so the response takes the same
 * time as a real failure.
 *
 * Returns { ok, needsUpgrade }.
 */
async function verifyPassword(plain, storedHash) {
  if (!storedHash) {
    await argon2.verify(DUMMY_HASH, plain).catch(() => false);
    return { ok: false, needsUpgrade: false };
  }

  if (isBcryptHash(storedHash)) {
    const ok = bcrypt.compareSync(plain, storedHash);
    return { ok, needsUpgrade: ok };
  }

  let ok = false;
  try {
    ok = await argon2.verify(storedHash, plain);
  } catch {
    ok = false; // malformed hash -- treat as a failed login, never as a pass
  }
  return { ok, needsUpgrade: false };
}

/**
 * Policy check. Follows NIST SP 800-63B: length and blocklist matter,
 * composition rules (forced symbols, mixed case) do not -- they push people
 * toward predictable patterns without adding real entropy.
 *
 * Returns null when acceptable, or a message explaining the rejection.
 */
function checkPasswordPolicy(plain, { username } = {}) {
  const value = String(plain == null ? '' : plain);

  if (value.length < MIN_LENGTH) {
    return `La contraseña debe tener al menos ${MIN_LENGTH} caracteres.`;
  }
  if (value.length > MAX_LENGTH) {
    return `La contraseña no puede superar los ${MAX_LENGTH} caracteres.`;
  }

  const normalised = value.toLowerCase().trim();

  if (COMMON_PASSWORDS.has(normalised)) {
    return 'Esa contraseña aparece en las listas de contraseñas filtradas. Elige otra.';
  }

  if (username && normalised.includes(String(username).toLowerCase()) && String(username).length >= 3) {
    return 'La contraseña no puede contener tu nombre de usuario.';
  }

  // A single repeated character, or a straight run of the keyboard.
  if (/^(.)\1+$/.test(value)) {
    return 'La contraseña no puede ser un mismo carácter repetido.';
  }
  if (/^(0123456789|1234567890|abcdefghij|qwertyuiop)/i.test(value)) {
    return 'La contraseña es una secuencia predecible. Elige otra.';
  }

  return null;
}

module.exports = {
  hashPassword,
  verifyPassword,
  checkPasswordPolicy,
  isBcryptHash,
  MIN_LENGTH,
  MAX_LENGTH,
};
