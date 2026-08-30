const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const { dataDir } = require('./paths');

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'app.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS profile (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    name TEXT NOT NULL,
    tagline TEXT NOT NULL,
    avatar_path TEXT,
    age_gate_enabled INTEGER NOT NULL DEFAULT 1,
    age_gate_title TEXT NOT NULL,
    age_gate_subtitle TEXT NOT NULL,
    age_gate_confirm TEXT NOT NULL,
    footer_text TEXT NOT NULL,
    accent_from TEXT NOT NULL DEFAULT '#ff5f8f',
    accent_to TEXT NOT NULL DEFAULT '#ff9a5a'
  );

  CREATE TABLE IF NOT EXISTS admin (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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

const profileExists = db.prepare('SELECT COUNT(*) AS c FROM profile').get().c;
if (!profileExists) {
  db.prepare(`
    INSERT INTO profile (id, name, tagline, avatar_path, age_gate_enabled, age_gate_title, age_gate_subtitle, age_gate_confirm, footer_text, accent_from, accent_to)
    VALUES (1, ?, ?, NULL, 0, ?, ?, ?, ?, ?, ?)
  `).run(
    'Ale King',
    '✨ mis redes sociales',
    'Ale King',
    '✨ mis redes sociales',
    'Al continuar confirmas que eres mayor de edad',
    '✨ Ale King',
    '#ff5f8f',
    '#ff9a5a'
  );
}

const linkCount = db.prepare('SELECT COUNT(*) AS c FROM links').get().c;
if (!linkCount) {
  const insert = db.prepare(`
    INSERT INTO links (order_index, type, platform, label, subtitle, badge_left, badge_right, url, image_path, icon, enabled)
    VALUES (@order_index, @type, @platform, @label, @subtitle, @badge_left, @badge_right, @url, @image_path, @icon, @enabled)
  `);
  const seedLinks = [
    { order_index: 0, type: 'featured', platform: 'custom', label: 'Ale King', subtitle: 'todo mi contenido y redes ✨', badge_left: 'DESTACADO', badge_right: 'Ale King XP', url: 'https://example.com/ale-king-xp', image_path: null, icon: null, enabled: 1 },
    { order_index: 1, type: 'simple', platform: 'twitch', label: 'Twitch', subtitle: 'en vivo', badge_left: null, badge_right: null, url: 'https://twitch.tv/tu_usuario', image_path: null, icon: '🎮', enabled: 1 },
    { order_index: 2, type: 'simple', platform: 'telegram', label: 'Telegram', subtitle: 'canal de avisos', badge_left: null, badge_right: null, url: 'https://t.me/tu_usuario', image_path: null, icon: '✈️', enabled: 1 },
    { order_index: 3, type: 'simple', platform: 'discord', label: 'Discord', subtitle: 'únete al server', badge_left: null, badge_right: null, url: 'https://discord.com/invite/tu-invite', image_path: null, icon: '💬', enabled: 1 },
    { order_index: 4, type: 'simple', platform: 'twitter', label: 'Twitter', subtitle: '@tu_usuario', badge_left: null, badge_right: null, url: 'https://x.com/tu_usuario', image_path: null, icon: '🐦', enabled: 1 },
    { order_index: 5, type: 'simple', platform: 'wishlist', label: 'Wishlist', subtitle: 'apóyame con un regalo 🎁', badge_left: null, badge_right: null, url: 'https://example.com/tu-wishlist', image_path: null, icon: '🎁', enabled: 1 },
  ];
  const insertMany = db.transaction((rows) => rows.forEach((r) => insert.run(r)));
  insertMany(seedLinks);
}

const adminExists = db.prepare('SELECT COUNT(*) AS c FROM admin').get().c;
let generatedPassword = null;
if (!adminExists) {
  generatedPassword = 'changeme123';
  const hash = bcrypt.hashSync(generatedPassword, 10);
  db.prepare('INSERT INTO admin (username, password_hash) VALUES (?, ?)').run('admin', hash);
}

module.exports = { db, generatedPassword };
