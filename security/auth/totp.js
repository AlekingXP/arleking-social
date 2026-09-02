'use strict';

// TOTP (RFC 6238) second factor, implemented on node:crypto.
//
// No dependency: TOTP is HMAC-SHA1 over a time counter, and the whole
// algorithm is the forty lines below. Pulling in a package for it would add
// supply-chain surface to the exact component whose job is to be trusted.

const crypto = require('crypto');

const STEP_SECONDS = 30;
const DIGITS = 6;
// One step either side. RFC 6238 recommends at most one, which tolerates
// ordinary clock drift without meaningfully widening the guess window.
const WINDOW = 1;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(input) {
  const clean = String(input).toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error('Secreto TOTP inválido');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** 160-bit secret, the size RFC 4226 recommends for HMAC-SHA1. */
function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function codeFor(secret, counter) {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac('sha1', key).update(buf).digest();
  // Dynamic truncation, RFC 4226 section 5.3.
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

/**
 * Verifies a submitted code. Compares in constant time and accepts one step
 * either side of now.
 */
function verifyCode(secret, submitted, atMs = Date.now()) {
  const candidate = String(submitted || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(candidate)) return false;

  const counter = Math.floor(atMs / 1000 / STEP_SECONDS);
  let matched = false;
  for (let drift = -WINDOW; drift <= WINDOW; drift++) {
    const expected = codeFor(secret, counter + drift);
    // No early break: every candidate is compared so the time taken does
    // not reveal which step matched.
    const a = Buffer.from(expected);
    const b = Buffer.from(candidate);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) matched = true;
  }
  return matched;
}

/** The otpauth:// URI an authenticator app scans. */
function provisioningUri(secret, { account, issuer = 'ArleKing Social' }) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/**
 * Single-use recovery codes, for when the phone is lost. Returned in plain
 * text once; only their hashes are ever stored.
 */
function generateRecoveryCodes(count = 8) {
  const codes = [];
  for (let i = 0; i < count; i++) {
    const raw = crypto.randomBytes(5).toString('hex').toUpperCase(); // 10 chars
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5)}`);
  }
  return codes;
}

function hashRecoveryCode(code) {
  return crypto.createHash('sha256').update(String(code).toUpperCase().replace(/[\s-]/g, '')).digest('hex');
}

module.exports = {
  generateSecret,
  verifyCode,
  codeFor,
  provisioningUri,
  generateRecoveryCodes,
  hashRecoveryCode,
  STEP_SECONDS,
  DIGITS,
};
