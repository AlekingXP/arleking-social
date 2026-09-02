'use strict';

// CSRF protection: synchroniser token, tied to the session.
//
// The app was leaning on two accidental defences. SameSite=Lax stops a
// cross-site form POST from carrying the cookie, and express.json() only
// parses application/json, which a plain <form> cannot produce. Both hold
// today, but both are properties of other decisions -- change the parser to
// accept urlencoded, or relax SameSite for an embed, and the protection
// silently disappears. A token makes the defence explicit.
//
// Lax also still sends cookies on top-level GET navigation, which is why
// the OAuth link flow (GET /api/auth/:provider?intent=link) is covered too:
// without it an attacker can walk a logged-in victim through linking the
// ATTACKER's identity provider account to the victim's profile, leaving
// themselves a permanent way in.

const crypto = require('crypto');

const HEADER = 'x-csrf-token';
const COOKIE = 'csrf_token';

// Methods that cannot change state, so they need no token.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Routes exempt by necessity, each for a stated reason.
const EXEMPT = [
  // Stripe signs its own requests; it has no way to carry our token, and
  // the signature check in the handler is the stronger control.
  '/api/webhooks/stripe',
  // The entry points a user reaches before any session exists.
  '/api/auth/login',
  '/api/auth/register',
];

function issueToken(req, res) {
  if (!req.session) return null;
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('base64url');
  }
  // Readable by the page's own JavaScript on purpose -- this is the
  // "double submit" half. It is NOT the secret; the copy in the session is,
  // and an attacker on another origin cannot read this one anyway.
  res.cookie(COOKIE, req.session.csrfToken, {
    httpOnly: false,
    sameSite: 'lax',
    secure: !!req.secure || process.env.NODE_ENV === 'production',
    path: '/',
  });
  return req.session.csrfToken;
}

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a || ''));
  const bufB = Buffer.from(String(b || ''));
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function csrfProtection(options = {}) {
  const exempt = new Set([...EXEMPT, ...(options.exempt || [])]);

  return function csrf(req, res, next) {
    // Always make a token available to the page.
    if (req.session) issueToken(req, res);

    if (SAFE_METHODS.has(req.method)) return next();
    if (exempt.has(req.path)) return next();

    // No session means nothing to protect -- the request is anonymous and
    // any endpoint it reaches enforces its own auth.
    if (!req.session || !req.session.userId) return next();

    const presented = req.get(HEADER) || (req.body && req.body._csrf);
    if (!timingSafeEqual(presented, req.session.csrfToken)) {
      return res.status(403).json({ error: 'Token CSRF inválido o ausente. Recarga la página e inténtalo de nuevo.' });
    }
    return next();
  };
}

/**
 * Guards a state-changing GET that cannot carry a header, by checking the
 * token in the query string. Used by the OAuth link flow.
 */
function verifyQueryToken(req) {
  if (!req.session || !req.session.csrfToken) return false;
  return timingSafeEqual(req.query && req.query.csrf, req.session.csrfToken);
}

module.exports = { csrfProtection, issueToken, verifyQueryToken, HEADER, COOKIE };
