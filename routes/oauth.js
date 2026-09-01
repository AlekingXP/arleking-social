const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { db, slugify, RESERVED_SLUGS, createUserWithProfile, touchUserActivity } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Every provider is the same OAuth2 authorization-code dance; only the
// endpoints, scopes and the shape of the profile response differ. Adding
// another one means adding an entry here plus its two env vars — nothing
// else in this file changes.
const PROVIDERS = {
  google: {
    label: 'Google',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userUrl: 'https://www.googleapis.com/oauth2/v3/userinfo',
    scope: 'openid email profile',
    authParams: { prompt: 'select_account' },
    envPrefix: 'GOOGLE',
    parseUser: (p) => ({
      id: p.sub,
      email: p.email || null,
      name: p.name || null,
      handle: p.email ? p.email.split('@')[0] : null,
    }),
  },

  github: {
    label: 'GitHub',
    authUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userUrl: 'https://api.github.com/user',
    // user:email so a private primary address can still be resolved below.
    scope: 'read:user user:email',
    envPrefix: 'GITHUB',
    parseUser: (p) => ({
      id: String(p.id),
      email: p.email || null,
      name: p.name || p.login || null,
      handle: p.login || null,
    }),
    // GitHub hides the address unless it's public, so fall back to the
    // verified primary from /user/emails.
    async resolveEmail(accessToken, profile, authedFetch) {
      if (profile.email) return profile.email;
      try {
        const res = await authedFetch('https://api.github.com/user/emails', accessToken);
        if (!res.ok) return null;
        const emails = await res.json();
        const primary = emails.find((e) => e.primary && e.verified) || emails.find((e) => e.verified);
        return primary ? primary.email : null;
      } catch {
        return null;
      }
    },
  },

  discord: {
    label: 'Discord',
    authUrl: 'https://discord.com/api/oauth2/authorize',
    tokenUrl: 'https://discord.com/api/oauth2/token',
    userUrl: 'https://discord.com/api/users/@me',
    scope: 'identify email',
    envPrefix: 'DISCORD',
    parseUser: (p) => ({
      id: p.id,
      email: p.email || null,
      name: p.global_name || p.username || null,
      handle: p.username || null,
    }),
  },
};

// The key comes straight off the URL, so go through hasOwnProperty —
// PROVIDERS['constructor'] would otherwise return a truthy object and
// hijack the route instead of falling through to a 404.
function getProvider(key) {
  return Object.prototype.hasOwnProperty.call(PROVIDERS, key) ? PROVIDERS[key] : null;
}

function credsFor(key) {
  const { envPrefix } = PROVIDERS[key];
  return {
    clientId: process.env[`${envPrefix}_CLIENT_ID`],
    clientSecret: process.env[`${envPrefix}_CLIENT_SECRET`],
  };
}

function isConfigured(key) {
  const { clientId, clientSecret } = credsFor(key);
  return Boolean(clientId && clientSecret);
}

function redirectUri(req, key) {
  return `${req.protocol}://${req.get('host')}/api/auth/${key}/callback`;
}

function authedFetch(url, accessToken) {
  return fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      // GitHub rejects API requests without one.
      'User-Agent': 'ArleKing-Social',
    },
  });
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

function uniqueUsernameFrom(base) {
  const clean = String(base || '').replace(/[^a-zA-Z0-9_.-]/g, '') || 'usuario';
  let candidate = clean;
  let n = 2;
  while (db.prepare('SELECT 1 FROM users WHERE username = ?').get(candidate)) {
    candidate = `${clean}${n}`;
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

// ---- Discovery ----

router.get('/auth/providers', (req, res) => {
  res.json(
    Object.entries(PROVIDERS).map(([key, p]) => ({
      key,
      label: p.label,
      configured: isConfigured(key),
    }))
  );
});

// Kept so older cached copies of the login page don't break.
router.get('/auth/google/status', (req, res) => {
  res.json({ configured: isConfigured('google') });
});

// ---- Start the flow ----

router.get('/auth/:provider', oauthLimiter, (req, res, next) => {
  const key = req.params.provider;
  const provider = getProvider(key);
  if (!provider) return next(); // not ours — let another route try

  if (!isConfigured(key)) {
    return res.redirect(`/admin/login?error=oauth_not_configured&provider=${key}`);
  }

  const intent = req.query.intent === 'link' ? 'link' : 'login';
  if (intent === 'link' && !(req.session && req.session.userId)) {
    return res.redirect('/admin/login?error=must_login');
  }

  const state = crypto.randomBytes(24).toString('hex');
  req.session.oauthState = state;
  req.session.oauthIntent = intent;
  req.session.oauthProvider = key;
  req.session.oauthUserId = intent === 'link' ? req.session.userId : null;

  const params = new URLSearchParams({
    client_id: credsFor(key).clientId,
    redirect_uri: redirectUri(req, key),
    response_type: 'code',
    scope: provider.scope,
    state,
    ...(provider.authParams || {}),
  });

  res.redirect(`${provider.authUrl}?${params.toString()}`);
});

// ---- Handle the return trip ----

router.get('/auth/:provider/callback', oauthLimiter, async (req, res, next) => {
  const key = req.params.provider;
  const provider = getProvider(key);
  if (!provider) return next();

  if (!isConfigured(key)) return res.redirect(`/admin/login?error=oauth_not_configured&provider=${key}`);

  const { code, state } = req.query;
  // The state must match AND belong to the provider we started with —
  // otherwise a callback for one provider could consume another's state.
  if (!code || !state || state !== req.session.oauthState || req.session.oauthProvider !== key) {
    return res.redirect(`/admin/login?error=oauth_state&provider=${key}`);
  }

  const intent = req.session.oauthIntent || 'login';
  const linkUserId = req.session.oauthUserId;
  delete req.session.oauthState;
  delete req.session.oauthIntent;
  delete req.session.oauthProvider;
  delete req.session.oauthUserId;

  try {
    const { clientId, clientSecret } = credsFor(key);
    const tokenRes = await fetch(provider.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        // GitHub returns form-encoded unless JSON is requested explicitly.
        Accept: 'application/json',
        'User-Agent': 'ArleKing-Social',
      },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri(req, key),
        grant_type: 'authorization_code',
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.access_token) {
      throw new Error(tokenData.error_description || tokenData.error || 'No se pudo obtener el token');
    }

    const userRes = await authedFetch(provider.userUrl, tokenData.access_token);
    const raw = await userRes.json();
    if (!userRes.ok) throw new Error(`No se pudo obtener el perfil de ${provider.label}`);

    const parsed = provider.parseUser(raw);
    if (!parsed.id) throw new Error(`${provider.label} no devolvió un identificador`);
    if (provider.resolveEmail) {
      parsed.email = await provider.resolveEmail(tokenData.access_token, parsed, authedFetch);
    }

    const existing = db
      .prepare('SELECT * FROM oauth_accounts WHERE provider = ? AND provider_user_id = ?')
      .get(key, parsed.id);

    if (intent === 'link') {
      if (!linkUserId) return res.redirect('/admin/login?error=must_login');
      if (existing && existing.user_id !== linkUserId) {
        return res.redirect(`/admin/dashboard?error=oauth_taken&provider=${key}`);
      }

      db.prepare(`
        INSERT INTO oauth_accounts (provider, provider_user_id, user_id, email)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(provider, provider_user_id) DO UPDATE SET user_id = excluded.user_id, email = excluded.email
      `).run(key, parsed.id, linkUserId, parsed.email);

      if (key === 'google') {
        db.prepare('UPDATE users SET google_id = ?, google_email = ? WHERE id = ?')
          .run(parsed.id, parsed.email, linkUserId);
      }
      return res.redirect(`/admin/dashboard?linked=${key}`);
    }

    // intent === 'login' — sign in, or create the account on first use.
    let user = existing ? db.prepare('SELECT * FROM users WHERE id = ?').get(existing.user_id) : null;
    let isNew = false;

    if (!user) {
      const username = uniqueUsernameFrom(parsed.handle || parsed.email || `user${parsed.id}`);
      const displayName = parsed.name || username;
      const userId = createUserWithProfile({
        username,
        googleId: key === 'google' ? parsed.id : null,
        googleEmail: key === 'google' ? parsed.email : null,
        name: displayName,
        slug: uniqueSlugFrom(displayName),
      });
      db.prepare('INSERT INTO oauth_accounts (provider, provider_user_id, user_id, email) VALUES (?, ?, ?, ?)')
        .run(key, parsed.id, userId, parsed.email);
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
      isNew = true;
    }

    touchUserActivity(user.id);
    req.session.regenerate((err) => {
      if (err) return res.redirect('/admin/login?error=session');
      req.session.userId = user.id;
      req.session.username = user.username;
      res.redirect(isNew ? '/admin/dashboard?welcome=1' : '/admin/dashboard');
    });
  } catch (err) {
    console.error(`OAuth (${key}) error:`, err.message);
    res.redirect(`/admin/login?error=oauth_failed&provider=${key}`);
  }
});

// ---- Linked accounts management ----

router.get('/auth/linked', requireAuth, (req, res) => {
  const rows = db
    .prepare('SELECT provider, provider_user_id, email FROM oauth_accounts WHERE user_id = ? ORDER BY created_at')
    .all(req.session.userId);
  res.json(
    Object.entries(PROVIDERS).map(([key, p]) => {
      // One entry per linked account, not per provider: nothing stops the
      // same person from attaching two Google addresses, and collapsing
      // them to the first hid the rest from the dashboard entirely.
      const accounts = rows
        .filter((r) => r.provider === key)
        .map((r) => ({ id: r.provider_user_id, email: r.email }));
      return {
        key,
        label: p.label,
        configured: isConfigured(key),
        accounts,
        linked: accounts.length > 0,
        email: accounts.length ? accounts[0].email : null, // back-compat
      };
    })
  );
});

router.delete('/auth/:provider/link', requireAuth, (req, res, next) => {
  const key = req.params.provider;
  if (!getProvider(key)) return next();

  const accountId = req.query.account;
  const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.session.userId);
  const totalLinks = db.prepare('SELECT COUNT(*) AS n FROM oauth_accounts WHERE user_id = ?').get(req.session.userId).n;

  const targets = accountId
    ? db
        .prepare('SELECT COUNT(*) AS n FROM oauth_accounts WHERE user_id = ? AND provider = ? AND provider_user_id = ?')
        .get(req.session.userId, key, accountId).n
    : db.prepare('SELECT COUNT(*) AS n FROM oauth_accounts WHERE user_id = ? AND provider = ?').get(req.session.userId, key).n;

  if (!targets) return res.status(404).json({ error: 'Esa cuenta no está vinculada.' });

  // Refuse to remove the last way in — measured against what would actually
  // be left afterwards, so unlinking one of two accounts is still allowed.
  if (!user.password_hash && totalLinks - targets < 1) {
    return res.status(400).json({
      error: 'Configura una contraseña antes de desvincular tu única cuenta, o perderás el acceso.',
    });
  }

  if (accountId) {
    db.prepare('DELETE FROM oauth_accounts WHERE user_id = ? AND provider = ? AND provider_user_id = ?')
      .run(req.session.userId, key, accountId);
  } else {
    db.prepare('DELETE FROM oauth_accounts WHERE user_id = ? AND provider = ?').run(req.session.userId, key);
  }

  // The legacy users.google_id mirror only makes sense while a Google row
  // survives; point it at whichever one is left, or clear it.
  if (key === 'google') {
    const remaining = db
      .prepare("SELECT provider_user_id, email FROM oauth_accounts WHERE user_id = ? AND provider = 'google' ORDER BY created_at")
      .get(req.session.userId);
    db.prepare('UPDATE users SET google_id = ?, google_email = ? WHERE id = ?')
      .run(remaining ? remaining.provider_user_id : null, remaining ? remaining.email : null, req.session.userId);
  }
  res.json({ ok: true });
});

module.exports = router;
