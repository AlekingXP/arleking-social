const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { dataDir } = require('./paths');

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'app.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT,
    google_id TEXT UNIQUE,
    google_email TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_active_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS profile (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    tagline TEXT NOT NULL,
    avatar_path TEXT,
    background_path TEXT,
    age_gate_enabled INTEGER NOT NULL DEFAULT 0,
    age_gate_title TEXT NOT NULL,
    age_gate_subtitle TEXT NOT NULL,
    age_gate_confirm TEXT NOT NULL,
    footer_text TEXT NOT NULL,
    accent_from TEXT NOT NULL DEFAULT '#ff5f8f',
    accent_to TEXT NOT NULL DEFAULT '#ff9a5a',
    particles_enabled INTEGER NOT NULL DEFAULT 1,
    particles_color TEXT NOT NULL DEFAULT '#ffffff',
    particles_density INTEGER NOT NULL DEFAULT 60,
    vip_tier TEXT,
    vip_activated_at TEXT,
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT
  );

  -- Linked social accounts. One row per (provider, account), so a user can
  -- sign in with Google, GitHub, Discord... The older users.google_id
  -- column is migrated into here below and kept in sync for Google only,
  -- since existing sessions and queries still read it.
  CREATE TABLE IF NOT EXISTS oauth_accounts (
    provider TEXT NOT NULL,
    provider_user_id TEXT NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (provider, provider_user_id)
  );

  CREATE INDEX IF NOT EXISTS idx_oauth_accounts_user ON oauth_accounts(user_id);

  -- Webhook replay/idempotency guard. Stripe retries deliveries and can
  -- deliver the same event more than once; without this, replaying an old
  -- checkout.session.completed would re-activate an already-cancelled
  -- subscription.
  CREATE TABLE IF NOT EXISTS stripe_events (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    received_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    order_index INTEGER NOT NULL,
    type TEXT NOT NULL DEFAULT 'simple',
    platform TEXT NOT NULL DEFAULT 'custom',
    label TEXT NOT NULL,
    subtitle TEXT,
    badge_left TEXT,
    badge_right TEXT,
    url TEXT NOT NULL,
    image_path TEXT,
    icon TEXT,
    enabled INTEGER NOT NULL DEFAULT 1
  );
`);

const RESERVED_SLUGS = [
  'admin', 'api', 'login', 'signup', 'register', 'logout',
  'images', 'uploads', 'css', 'js', 'u', 'static', 'app',
  'favicon.ico', 'robots.txt', 'sitemap.xml', 'ale-king-xp',
  // Legal pages and asset dirs — a profile here would shadow the real page.
  'terminos', 'privacidad', 'reembolsos', 'legal', 'models',
];

function slugify(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'usuario';
}

// ---- One-time migration: single-tenant (admin/profile id=1) -> multi-tenant ----
const tableNames = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name);
const profileColumnsNow = db.prepare('PRAGMA table_info(profile)').all().map((c) => c.name);
const needsTenantMigration = tableNames.includes('admin') && !profileColumnsNow.includes('user_id');

if (needsTenantMigration) {
  console.log('Migrando base de datos a modo multiusuario...');

  const migrate = db.transaction(() => {
    const oldAdmins = db.prepare('SELECT * FROM admin').all();
    const insertUser = db.prepare(`
      INSERT INTO users (id, username, password_hash, google_id, google_email)
      VALUES (@id, @username, @password_hash, @google_id, @google_email)
    `);
    oldAdmins.forEach((a) => insertUser.run(a));

    const oldProfile = db.prepare('SELECT * FROM profile_legacy WHERE id = 1').get();
    if (oldProfile && oldAdmins[0]) {
      let slug = 'ale-king';
      if (RESERVED_SLUGS.includes(slug)) slug = 'ale-king-social';
      db.prepare(`
        INSERT INTO profile (
          user_id, slug, name, tagline, avatar_path, background_path,
          age_gate_enabled, age_gate_title, age_gate_subtitle, age_gate_confirm,
          footer_text, accent_from, accent_to, particles_enabled, particles_color, particles_density
        ) VALUES (
          @user_id, @slug, @name, @tagline, @avatar_path, @background_path,
          @age_gate_enabled, @age_gate_title, @age_gate_subtitle, @age_gate_confirm,
          @footer_text, @accent_from, @accent_to, @particles_enabled, @particles_color, @particles_density
        )
      `).run({ ...oldProfile, user_id: oldAdmins[0].id, slug });

      const oldLinks = db.prepare('SELECT * FROM links_legacy').all();
      const insertLink = db.prepare(`
        INSERT INTO links (
          id, user_id, order_index, type, platform, label, subtitle,
          badge_left, badge_right, url, image_path, icon, enabled
        ) VALUES (
          @id, @user_id, @order_index, @type, @platform, @label, @subtitle,
          @badge_left, @badge_right, @url, @image_path, @icon, @enabled
        )
      `);
      oldLinks.forEach((l) => insertLink.run({ ...l, user_id: oldAdmins[0].id }));
    }

    db.exec('DROP TABLE admin');
    db.exec('DROP TABLE profile_legacy');
    db.exec('DROP TABLE links_legacy');
  });

  db.exec('ALTER TABLE profile RENAME TO profile_legacy');
  db.exec('ALTER TABLE links RENAME TO links_legacy');
  db.exec(`
    CREATE TABLE profile (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      tagline TEXT NOT NULL,
      avatar_path TEXT,
      background_path TEXT,
      age_gate_enabled INTEGER NOT NULL DEFAULT 0,
      age_gate_title TEXT NOT NULL,
      age_gate_subtitle TEXT NOT NULL,
      age_gate_confirm TEXT NOT NULL,
      footer_text TEXT NOT NULL,
      accent_from TEXT NOT NULL DEFAULT '#ff5f8f',
      accent_to TEXT NOT NULL DEFAULT '#ff9a5a',
      particles_enabled INTEGER NOT NULL DEFAULT 1,
      particles_color TEXT NOT NULL DEFAULT '#ffffff',
      particles_density INTEGER NOT NULL DEFAULT 60
    );
    CREATE TABLE links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      order_index INTEGER NOT NULL,
      type TEXT NOT NULL DEFAULT 'simple',
      platform TEXT NOT NULL DEFAULT 'custom',
      label TEXT NOT NULL,
      subtitle TEXT,
      badge_left TEXT,
      badge_right TEXT,
      url TEXT NOT NULL,
      image_path TEXT,
      icon TEXT,
      enabled INTEGER NOT NULL DEFAULT 1
    );
  `);

  migrate();
  console.log('Migración completa.');
}

const userColumnsNow = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
if (!userColumnsNow.includes('last_active_at')) {
  db.exec('ALTER TABLE users ADD COLUMN last_active_at TEXT');
  db.exec("UPDATE users SET last_active_at = datetime('now') WHERE last_active_at IS NULL");
}

const profileColumnsForVip = db.prepare('PRAGMA table_info(profile)').all().map((c) => c.name);
if (!profileColumnsForVip.includes('vip_tier')) db.exec('ALTER TABLE profile ADD COLUMN vip_tier TEXT');
if (!profileColumnsForVip.includes('vip_activated_at')) db.exec('ALTER TABLE profile ADD COLUMN vip_activated_at TEXT');
if (!profileColumnsForVip.includes('stripe_customer_id')) db.exec('ALTER TABLE profile ADD COLUMN stripe_customer_id TEXT');
if (!profileColumnsForVip.includes('stripe_subscription_id')) db.exec('ALTER TABLE profile ADD COLUMN stripe_subscription_id TEXT');

// MFA. Nullable and off by default, so every existing account keeps working
// exactly as before until its owner chooses to enrol.
if (!userColumnsNow.includes('mfa_secret')) db.exec('ALTER TABLE users ADD COLUMN mfa_secret TEXT');
if (!userColumnsNow.includes('mfa_enabled')) db.exec('ALTER TABLE users ADD COLUMN mfa_enabled INTEGER NOT NULL DEFAULT 0');
if (!userColumnsNow.includes('mfa_enrolled_at')) db.exec('ALTER TABLE users ADD COLUMN mfa_enrolled_at TEXT');
if (!userColumnsNow.includes('password_changed_at')) db.exec('ALTER TABLE users ADD COLUMN password_changed_at TEXT');

// Correo. Nullable: las cuentas existentes no lo tienen y no se les puede
// exigir de golpe. `email_verified_at` separa "la escribio" de "demostro que
// es suya" -- solo lo segundo sirve para recuperar el acceso.
if (!userColumnsNow.includes('email')) db.exec('ALTER TABLE users ADD COLUMN email TEXT');
if (!userColumnsNow.includes('email_verified_at')) db.exec('ALTER TABLE users ADD COLUMN email_verified_at TEXT');
db.exec('CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)');

// Recovery codes are stored only as SHA-256 digests: the plaintext is shown
// to the user once at enrolment and never again, so a copy of this table is
// not a set of working second factors.
db.exec(`
  CREATE TABLE IF NOT EXISTS mfa_recovery_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    used_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_mfa_recovery_user ON mfa_recovery_codes(user_id);
`);

// Backfill: accounts linked before oauth_accounts existed only have
// users.google_id. Idempotent, so it's safe on every boot.
db.exec(`
  INSERT OR IGNORE INTO oauth_accounts (provider, provider_user_id, user_id, email)
  SELECT 'google', google_id, id, google_email FROM users WHERE google_id IS NOT NULL
`);

// Subscription tiers, each backed by a real recurring Stripe Price (see
// routes/stripe.js). 'diamante' ($10) and 'sello' ($15) from the original
// spec are reserved for later — only these two are sellable today.
const VIP_TIERS = ['billete', 'king'];

// ---- Platform owners ----
// Accounts that get the VIP badge without paying, because the platform is
// theirs. Set OWNER_USERNAMES to a comma-separated list of usernames.
// Everyone else must go through Stripe.
const OWNER_USERNAMES = (process.env.OWNER_USERNAMES || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const OWNER_VIP_TIER = process.env.OWNER_VIP_TIER || 'king';

function isOwnerUsername(username) {
  const name = String(username || '').toLowerCase();
  return OWNER_USERNAMES.some((u) => u.toLowerCase() === name);
}

const findUserByName = () => db.prepare('SELECT id, username FROM users WHERE username = ? COLLATE NOCASE');

/**
 * Grants owner accounts their tier, and revokes any badge that isn't paid
 * for. Runs at startup so an owner never has to click anything, and so a
 * badge obtained through the old unrestricted toggle doesn't linger.
 * Accounts with a real Stripe subscription are never touched — Stripe
 * stays the source of truth for those.
 */
function reconcileVipGrants() {
  const result = { granted: [], revoked: 0 };

  if (OWNER_USERNAMES.length && !VIP_TIERS.includes(OWNER_VIP_TIER)) {
    console.warn(`OWNER_VIP_TIER "${OWNER_VIP_TIER}" no es un tier válido; se omite la concesión.`);
  } else {
    const stmt = findUserByName();
    OWNER_USERNAMES.forEach((username) => {
      const user = stmt.get(username);
      if (!user) return;
      const profile = db.prepare('SELECT vip_tier, stripe_subscription_id FROM profile WHERE user_id = ?').get(user.id);
      if (!profile || profile.stripe_subscription_id) return;
      if (profile.vip_tier === OWNER_VIP_TIER) return;
      db.prepare("UPDATE profile SET vip_tier = ?, vip_activated_at = datetime('now') WHERE user_id = ?")
        .run(OWNER_VIP_TIER, user.id);
      result.granted.push(user.username);
    });
  }

  // Anything still holding a badge with no subscription behind it and no
  // owner status got it from the old open endpoint.
  const ownerIds = OWNER_USERNAMES
    .map((u) => findUserByName().get(u))
    .filter(Boolean)
    .map((u) => u.id);
  const placeholders = ownerIds.map(() => '?').join(',');
  const revoke = db.prepare(`
    UPDATE profile SET vip_tier = NULL, vip_activated_at = NULL
    WHERE vip_tier IS NOT NULL
      AND stripe_subscription_id IS NULL
      ${ownerIds.length ? `AND user_id NOT IN (${placeholders})` : ''}
  `);
  result.revoked = revoke.run(...ownerIds).changes;

  return result;
}

const INACTIVITY_MONTHS = 6;

function touchUserActivity(userId) {
  db.prepare("UPDATE users SET last_active_at = datetime('now') WHERE id = ?").run(userId);
}

function deleteUserFiles(userId, uploadsDir) {
  const profile = db.prepare('SELECT avatar_path, background_path FROM profile WHERE user_id = ?').get(userId);
  const links = db.prepare('SELECT image_path FROM links WHERE user_id = ?').all(userId);
  const paths = [
    profile && profile.avatar_path,
    profile && profile.background_path,
    ...links.map((l) => l.image_path),
  ].filter(Boolean);

  paths.forEach((p) => {
    try {
      fs.unlinkSync(path.join(uploadsDir, path.basename(p)));
    } catch (err) {
      // file already gone or inaccessible — nothing to do
    }
  });
}

function cleanupInactiveUsers(uploadsDir) {
  const cutoff = db.prepare(`SELECT datetime('now', '-${INACTIVITY_MONTHS} months') AS cutoff`).get().cutoff;
  const inactive = db.prepare('SELECT id, username FROM users WHERE last_active_at < ?').all(cutoff);

  if (!inactive.length) return inactive;

  const remove = db.transaction((ids) => {
    ids.forEach((id) => {
      deleteUserFiles(id, uploadsDir);
      db.prepare('DELETE FROM users WHERE id = ?').run(id);
    });
  });
  remove(inactive.map((u) => u.id));

  return inactive;
}

function createUserWithProfile({ username, passwordHash, googleId, googleEmail, name, slug }) {
  const insertUser = db.prepare(`
    INSERT INTO users (username, password_hash, google_id, google_email)
    VALUES (?, ?, ?, ?)
  `);
  const info = insertUser.run(username, passwordHash || null, googleId || null, googleEmail || null);
  const userId = info.lastInsertRowid;

  db.prepare(`
    INSERT INTO profile (
      user_id, slug, name, tagline, age_gate_enabled, age_gate_title,
      age_gate_subtitle, age_gate_confirm, footer_text, accent_from, accent_to
    ) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
  `).run(
    userId, slug, name, '✨ mis redes sociales', name, '✨ mis redes sociales',
    'Al continuar confirmas que eres mayor de edad', name, '#ff5f8f', '#ff9a5a'
  );

  const insertLink = db.prepare(`
    INSERT INTO links (user_id, order_index, type, platform, label, subtitle, badge_left, badge_right, url, image_path, icon, enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
  `);
  const seedLinks = [
    { type: 'simple', platform: 'instagram', label: 'Instagram', subtitle: '@tu_usuario', icon: '📸', url: 'https://instagram.com/tu_usuario' },
    { type: 'simple', platform: 'twitter', label: 'Twitter', subtitle: '@tu_usuario', icon: '🐦', url: 'https://x.com/tu_usuario' },
    { type: 'simple', platform: 'tiktok', label: 'TikTok', subtitle: '@tu_usuario', icon: '🎵', url: 'https://tiktok.com/@tu_usuario' },
  ];
  seedLinks.forEach((l, idx) => insertLink.run(userId, idx, l.type, l.platform, l.label, l.subtitle, null, null, l.url, l.icon, 1));

  return userId;
}

module.exports = {
  db, slugify, RESERVED_SLUGS, VIP_TIERS,
  createUserWithProfile, touchUserActivity, cleanupInactiveUsers,
  isOwnerUsername, reconcileVipGrants, OWNER_VIP_TIER,
};
