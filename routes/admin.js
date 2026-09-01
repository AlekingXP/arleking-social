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

const router = express.Router();

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

router.post('/auth/register', authLimiter, (req, res) => {
  const { username, password, slug: rawSlug, name } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Faltan datos' });

  const cleanUsername = username.trim();
  if (cleanUsername.length < 3) return res.status(400).json({ error: 'El usuario debe tener al menos 3 caracteres' });
  if (password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });

  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(cleanUsername)) {
    return res.status(409).json({ error: 'Ese nombre de usuario ya está en uso' });
  }

  const slug = slugify(rawSlug || cleanUsername);
  if (RESERVED_SLUGS.includes(slug)) return res.status(400).json({ error: 'Esa URL está reservada, elige otra' });
  if (db.prepare('SELECT 1 FROM profile WHERE slug = ?').get(slug)) {
    return res.status(409).json({ error: 'Esa URL ya está en uso' });
  }

  const hash = bcrypt.hashSync(password, 10);
  const displayName = (name || cleanUsername).trim();
  const userId = createUserWithProfile({ username: cleanUsername, passwordHash: hash, name: displayName, slug });

  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Error de sesión' });
    req.session.userId = userId;
    req.session.username = cleanUsername;
    res.status(201).json({ ok: true, username: cleanUsername, slug });
  });
});

router.post('/auth/login', authLimiter, (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Faltan credenciales' });

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !user.password_hash || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  }

  touchUserActivity(user.id);
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Error de sesión' });
    req.session.userId = user.id;
    req.session.username = user.username;
    res.json({ ok: true, username: user.username });
  });
});

router.post('/auth/logout', (req, res) => {
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

router.put('/auth/password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!newPassword) return res.status(400).json({ error: 'Faltan datos' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);

  if (user.password_hash) {
    if (!currentPassword || !bcrypt.compareSync(currentPassword, user.password_hash)) {
      return res.status(401).json({ error: 'La contraseña actual no es correcta' });
    }
  }

  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
  res.json({ ok: true });
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
