const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { db, slugify, RESERVED_SLUGS, createUserWithProfile } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

function isConfigured() {
  return Boolean(CLIENT_ID && CLIENT_SECRET);
}

function getRedirectUri(req) {
  return `${req.protocol}://${req.get('host')}/api/auth/google/callback`;
}

function uniqueSlugFrom(base) {
  let slug = slugify(base);
  if (RESERVED_SLUGS.includes(slug)) slug = `${slug}-user`;
  let candidate = slug;
  let n = 2;
  while (db.prepare('SELECT 1 FROM profile WHERE slug = ?').get(candidate)) {
    candidate = `${slug}-${n}`;
    n += 1;
  }
  return candidate;
}

const oauthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

router.get('/auth/google/status', (req, res) => {
  res.json({ configured: isConfigured() });
});

router.get('/auth/google', oauthLimiter, (req, res) => {
  if (!isConfigured()) return res.status(503).send('Google Sign-In no está configurado en este servidor.');

  const intent = req.query.intent === 'link' ? 'link' : 'login';

  if (intent === 'link' && !(req.session && req.session.userId)) {
    return res.redirect('/admin/login?error=must_login');
  }

  const state = crypto.randomBytes(24).toString('hex');
  req.session.oauthState = state;
  req.session.oauthIntent = intent;
  req.session.oauthAdminId = intent === 'link' ? req.session.userId : null;

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: getRedirectUri(req),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });

  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

router.get('/auth/google/callback', oauthLimiter, async (req, res) => {
  if (!isConfigured()) return res.redirect('/admin/login?error=google_not_configured');

  const { code, state } = req.query;
  if (!code || !state || state !== req.session.oauthState) {
    return res.redirect('/admin/login?error=google_state');
  }

  const intent = req.session.oauthIntent || 'login';
  const linkAdminId = req.session.oauthAdminId;
  delete req.session.oauthState;
  delete req.session.oauthIntent;
  delete req.session.oauthAdminId;

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: getRedirectUri(req),
        grant_type: 'authorization_code',
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) throw new Error(tokenData.error_description || 'No se pudo obtener el token');

    const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const profile = await userRes.json();
    if (!userRes.ok || !profile.sub) throw new Error('No se pudo obtener el perfil de Google');

    if (intent === 'link') {
      if (!linkAdminId) return res.redirect('/admin/login?error=must_login');

      const taken = db.prepare('SELECT id FROM users WHERE google_id = ? AND id != ?').get(profile.sub, linkAdminId);
      if (taken) return res.redirect('/admin/dashboard?error=google_taken');

      db.prepare('UPDATE users SET google_id = ?, google_email = ? WHERE id = ?')
        .run(profile.sub, profile.email || null, linkAdminId);
      return res.redirect('/admin/dashboard?linked=1');
    }

    // intent === 'login' — find existing, or create a brand new account (open signup)
    let user = db.prepare('SELECT * FROM users WHERE google_id = ?').get(profile.sub);
    let isNew = false;

    if (!user) {
      const baseUsername = (profile.email ? profile.email.split('@')[0] : `user${profile.sub}`).replace(/[^a-zA-Z0-9_.-]/g, '');
      let username = baseUsername || `user${profile.sub}`;
      let suffix = 2;
      while (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
        username = `${baseUsername}${suffix}`;
        suffix += 1;
      }
      const slug = uniqueSlugFrom(profile.name || baseUsername);
      const displayName = profile.name || baseUsername;

      const userId = createUserWithProfile({
        username,
        googleId: profile.sub,
        googleEmail: profile.email || null,
        name: displayName,
        slug,
      });
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
      isNew = true;
    }

    req.session.regenerate((err) => {
      if (err) return res.redirect('/admin/login?error=session');
      req.session.userId = user.id;
      req.session.username = user.username;
      res.redirect(isNew ? '/admin/dashboard?welcome=1' : '/admin/dashboard');
    });
  } catch (err) {
    console.error('Google OAuth error:', err.message);
    res.redirect('/admin/login?error=google_failed');
  }
});

router.delete('/auth/google-link', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!user.password_hash) {
    return res.status(400).json({ error: 'Configura una contraseña antes de desvincular Google, o perderás el acceso' });
  }
  db.prepare('UPDATE users SET google_id = NULL, google_email = NULL WHERE id = ?').run(user.id);
  res.json({ ok: true });
});

module.exports = router;
