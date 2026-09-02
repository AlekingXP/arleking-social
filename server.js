require('dotenv').config();

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');

const { db, cleanupInactiveUsers, reconcileVipGrants } = require('./db');
const { dataDir, uploadsDir } = require('./paths');
const publicRoutes = require('./routes/public');
const adminRoutes = require('./routes/admin');
const oauthRoutes = require('./routes/oauth');
const { router: stripeRoutes, webhookHandler } = require('./routes/stripe');

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';

if (isProduction) app.set('trust proxy', 1);

const { SqliteSessionStore } = require('./security/auth/session-store');
const { csrfProtection } = require('./security/auth/csrf');
const { createAuditLog, setIpSalt } = require('./security/auth/audit');
const { buildPolicy } = require('./security/auth/csp');

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const secretPath = path.join(dataDir, '.session-secret');
let sessionSecret;
if (fs.existsSync(secretPath)) {
  sessionSecret = fs.readFileSync(secretPath, 'utf8');
} else {
  sessionSecret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(secretPath, sessionSecret);
}

// Derived rather than reused, so the audit log's IP digests are stable
// across restarts without the session secret itself being recoverable from
// the database if it ever leaks.
setIpSalt(crypto.createHmac('sha256', sessionSecret).update('audit-ip-salt').digest('hex'));

// Don't advertise the framework: it tells a scanner which CVE list to try.
app.disable('x-powered-by');

// Built once at boot from the actual HTML on disk -- see security/auth/csp.js
// for why hashes rather than a nonce or 'unsafe-inline'.
const contentSecurityPolicy = buildPolicy({
  publicDir: path.join(__dirname, 'public'),
  isProduction,
});

app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', contentSecurityPolicy);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Kept alongside frame-ancestors for browsers that predate CSP level 2.
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=(), usb=(), interest-cohort=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  if (isProduction) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }
  next();
});

// Signature verification needs the exact raw bytes, so this is mounted
// before the global JSON body parser below (Express applies middleware in
// registration order; other routes fall through to express.json() as usual).
app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), webhookHandler);

// Cap the body size: the default 100kb is already sane, but stating it
// makes the limit a decision rather than an accident.
app.use(express.json({ limit: '100kb' }));

// Persisted to SQLite instead of the default MemoryStore, which leaks
// memory and drops every session on restart -- each deploy was silently
// logging everyone out. Persistence is also what makes revoking another
// session possible at all.
const sessionStore = new SqliteSessionStore(db);

app.use(session({
  name: 'aks.sid', // not the default connect.sid, which names the stack
  secret: sessionSecret,
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  // Slides the 8-hour window forward while someone is active, so working
  // sessions aren't cut off mid-edit and idle ones still expire.
  rolling: true,
  cookie: {
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 8,
    sameSite: 'lax',
    secure: isProduction,
    path: '/',
  },
}));

// Must come after the session, which it reads the token from.
app.use(csrfProtection());

// Shared with the routes through app.locals so nothing has to reach back
// into server.js.
const audit = createAuditLog(db);
app.locals.audit = audit;
app.locals.sessionStore = sessionStore;

app.use('/uploads', express.static(uploadsDir));
app.use('/api/public', publicRoutes);
app.use('/api', adminRoutes);
app.use('/api', oauthRoutes);
app.use('/api', stripeRoutes);

// `Cache-Control: no-cache` forces a revalidation round-trip (If-None-Match)
// on every load instead of the browser silently reusing a stale copy after
// a deploy — the ETag Express already sends means an unchanged file still
// comes back as a cheap 304, so this doesn't disable caching, just makes it
// honest about when to trust it.
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
}));

// `root` (rather than a bare absolute path) keeps sendFile's dotfile check
// scoped to the relative filename — without it, checking out this repo under
// a dot-prefixed directory (e.g. a `.claude/worktrees/...` git worktree)
// makes every sendFile() 404, since the check otherwise scans the *whole*
// absolute path for a dot-prefixed segment.
const adminViewsDir = path.join(__dirname, 'public', 'admin');
const legalViewsDir = path.join(__dirname, 'public', 'legal');

// Registered before the `/:slug` catch-all below, which would otherwise
// swallow these and try to render them as a user profile page.
const LEGAL_PAGES = { terminos: 'terminos.html', privacidad: 'privacidad.html', reembolsos: 'reembolsos.html' };
Object.entries(LEGAL_PAGES).forEach(([route, file]) => {
  app.get(`/${route}`, (req, res) => res.sendFile(file, { root: legalViewsDir }));
});

app.get('/admin/login', (req, res) => {
  res.sendFile('login.html', { root: adminViewsDir });
});

app.get('/admin/dashboard', (req, res) => {
  res.sendFile('dashboard.html', { root: adminViewsDir });
});

app.get('/:slug', (req, res, next) => {
  if (req.params.slug.includes('.')) return next();
  res.sendFile('profile.html', { root: path.join(__dirname, 'public') });
});

app.use((err, req, res, next) => {
  console.error(err);

  // A body express.json() can't parse is the caller's mistake, not ours:
  // answering 500 tells them to retry a request that will never work, and
  // echoing err.message hands back the parser's internals.
  if (err.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    return res.status(400).json({ error: 'Solicitud mal formada.' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'El contenido enviado es demasiado grande.' });
  }

  res.status(500).json({ error: err.message || 'Error interno' });
});

function runInactivityCleanup() {
  try {
    const removed = cleanupInactiveUsers(uploadsDir);
    if (removed.length) {
      console.log(`Cuentas eliminadas por inactividad (6+ meses): ${removed.map((u) => u.username).join(', ')}`);
    }
  } catch (err) {
    console.error('Error al limpiar cuentas inactivas:', err.message);
  }
}

app.listen(PORT, () => {
  console.log(`\nServidor corriendo en http://localhost:${PORT}`);
  console.log(`Dashboard admin en http://localhost:${PORT}/admin/login`);

  try {
    const { granted, revoked } = reconcileVipGrants();
    if (granted.length) console.log(`VIP de propietario concedido a: ${granted.join(', ')}`);
    if (revoked) console.log(`Badges VIP sin suscripción revocados: ${revoked}`);
  } catch (err) {
    console.error('Error al reconciliar los badges VIP:', err.message);
  }

  runInactivityCleanup();
  setInterval(runInactivityCleanup, 24 * 60 * 60 * 1000);
});
