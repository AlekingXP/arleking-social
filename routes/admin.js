const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { db } = require('../db');
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

router.get('/auth/setup-status', (req, res) => {
  const count = db.prepare('SELECT COUNT(*) AS c FROM admin').get().c;
  res.json({ needsSetup: count === 0 });
});

router.post('/auth/register', authLimiter, (req, res) => {
  const count = db.prepare('SELECT COUNT(*) AS c FROM admin').get().c;
  if (count > 0) return res.status(403).json({ error: 'Ya existe una cuenta de administrador' });

  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Faltan datos' });
  if (username.trim().length < 3) return res.status(400).json({ error: 'El usuario debe tener al menos 3 caracteres' });
  if (password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });

  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare('INSERT INTO admin (username, password_hash) VALUES (?, ?)').run(username.trim(), hash);

  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Error de sesión' });
    req.session.userId = info.lastInsertRowid;
    req.session.username = username.trim();
    res.status(201).json({ ok: true, username: username.trim() });
  });
});

router.post('/auth/login', authLimiter, (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Faltan credenciales' });

  const admin = db.prepare('SELECT * FROM admin WHERE username = ?').get(username);
  if (!admin || !admin.password_hash || !bcrypt.compareSync(password, admin.password_hash)) {
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  }

  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Error de sesión' });
    req.session.userId = admin.id;
    req.session.username = admin.username;
    res.json({ ok: true, username: admin.username });
  });
});

router.post('/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/auth/me', (req, res) => {
  if (req.session && req.session.userId) {
    const admin = db.prepare('SELECT username, password_hash, google_email FROM admin WHERE id = ?').get(req.session.userId);
    return res.json({
      authenticated: true,
      username: req.session.username,
      hasPassword: !!(admin && admin.password_hash),
      googleEmail: admin ? admin.google_email : null,
    });
  }
  res.json({ authenticated: false });
});

router.put('/auth/password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!newPassword) return res.status(400).json({ error: 'Faltan datos' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' });

  const admin = db.prepare('SELECT * FROM admin WHERE id = ?').get(req.session.userId);

  if (admin.password_hash) {
    if (!currentPassword || !bcrypt.compareSync(currentPassword, admin.password_hash)) {
      return res.status(401).json({ error: 'La contraseña actual no es correcta' });
    }
  }

  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE admin SET password_hash = ? WHERE id = ?').run(hash, admin.id);
  res.json({ ok: true });
});

// ---- Profile ----

router.get('/profile', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM profile WHERE id = 1').get());
});

router.put('/profile', requireAuth, (req, res) => {
  const {
    name, tagline, age_gate_enabled, age_gate_title, age_gate_subtitle,
    age_gate_confirm, footer_text, accent_from, accent_to,
    particles_enabled, particles_color, particles_density,
  } = req.body || {};

  if (!name || !tagline) return res.status(400).json({ error: 'Nombre y tagline son obligatorios' });

  const density = Math.min(150, Math.max(0, parseInt(particles_density, 10) || 60));

  db.prepare(`
    UPDATE profile SET
      name = ?, tagline = ?, age_gate_enabled = ?, age_gate_title = ?,
      age_gate_subtitle = ?, age_gate_confirm = ?, footer_text = ?,
      accent_from = ?, accent_to = ?,
      particles_enabled = ?, particles_color = ?, particles_density = ?
    WHERE id = 1
  `).run(
    name, tagline, age_gate_enabled ? 1 : 0, age_gate_title || name,
    age_gate_subtitle || tagline, age_gate_confirm || 'Al continuar confirmas que eres mayor de edad',
    footer_text || name, accent_from || '#ff5f8f', accent_to || '#ff9a5a',
    particles_enabled ? 1 : 0, particles_color || '#ffffff', density
  );

  res.json(db.prepare('SELECT * FROM profile WHERE id = 1').get());
});

router.post('/profile/avatar', requireAuth, upload.single('avatar'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió ninguna imagen' });

  const prev = db.prepare('SELECT avatar_path FROM profile WHERE id = 1').get();
  db.prepare('UPDATE profile SET avatar_path = ? WHERE id = 1').run('/uploads/' + req.file.filename);
  if (prev && prev.avatar_path) {
    fs.unlink(path.join(uploadsDir, path.basename(prev.avatar_path)), () => {});
  }

  res.json(db.prepare('SELECT * FROM profile WHERE id = 1').get());
});

router.post('/profile/background', requireAuth, upload.single('background'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió ninguna imagen' });

  const prev = db.prepare('SELECT background_path FROM profile WHERE id = 1').get();
  db.prepare('UPDATE profile SET background_path = ? WHERE id = 1').run('/uploads/' + req.file.filename);
  if (prev && prev.background_path) {
    fs.unlink(path.join(uploadsDir, path.basename(prev.background_path)), () => {});
  }

  res.json(db.prepare('SELECT * FROM profile WHERE id = 1').get());
});

router.delete('/profile/background', requireAuth, (req, res) => {
  const prev = db.prepare('SELECT background_path FROM profile WHERE id = 1').get();
  db.prepare('UPDATE profile SET background_path = NULL WHERE id = 1').run();
  if (prev && prev.background_path) {
    fs.unlink(path.join(uploadsDir, path.basename(prev.background_path)), () => {});
  }

  res.json(db.prepare('SELECT * FROM profile WHERE id = 1').get());
});

// ---- Links ----

router.get('/links', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM links ORDER BY order_index ASC').all());
});

router.post('/links', requireAuth, (req, res) => {
  const { type, platform, label, subtitle, badge_left, badge_right, url, icon, enabled } = req.body || {};
  if (!label || !url) return res.status(400).json({ error: 'Label y URL son obligatorios' });

  const maxOrder = db.prepare('SELECT COALESCE(MAX(order_index), -1) AS m FROM links').get().m;
  const info = db.prepare(`
    INSERT INTO links (order_index, type, platform, label, subtitle, badge_left, badge_right, url, image_path, icon, enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
  `).run(maxOrder + 1, type || 'simple', platform || 'custom', label, subtitle || '', badge_left || null, badge_right || null, url, icon || '🔗', enabled ? 1 : 0);

  res.status(201).json(db.prepare('SELECT * FROM links WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/links/reorder', requireAuth, (req, res) => {
  const { order } = req.body || {};
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order debe ser un arreglo de IDs' });

  const update = db.prepare('UPDATE links SET order_index = ? WHERE id = ?');
  const tx = db.transaction((ids) => ids.forEach((id, idx) => update.run(idx, id)));
  tx(order);

  res.json(db.prepare('SELECT * FROM links ORDER BY order_index ASC').all());
});

router.put('/links/:id', requireAuth, (req, res) => {
  const existing = db.prepare('SELECT * FROM links WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Link no encontrado' });

  const { type, platform, label, subtitle, badge_left, badge_right, url, icon, enabled } = req.body || {};
  if (!label || !url) return res.status(400).json({ error: 'Label y URL son obligatorios' });

  db.prepare(`
    UPDATE links SET type = ?, platform = ?, label = ?, subtitle = ?, badge_left = ?, badge_right = ?, url = ?, icon = ?, enabled = ?
    WHERE id = ?
  `).run(type || 'simple', platform || 'custom', label, subtitle || '', badge_left || null, badge_right || null, url, icon || '🔗', enabled ? 1 : 0, req.params.id);

  res.json(db.prepare('SELECT * FROM links WHERE id = ?').get(req.params.id));
});

router.delete('/links/:id', requireAuth, (req, res) => {
  const existing = db.prepare('SELECT * FROM links WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Link no encontrado' });

  if (existing.image_path) {
    fs.unlink(path.join(uploadsDir, path.basename(existing.image_path)), () => {});
  }
  db.prepare('DELETE FROM links WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.post('/links/:id/image', requireAuth, upload.single('image'), (req, res) => {
  const existing = db.prepare('SELECT * FROM links WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Link no encontrado' });
  if (!req.file) return res.status(400).json({ error: 'No se recibió ninguna imagen' });

  db.prepare('UPDATE links SET image_path = ? WHERE id = ?').run('/uploads/' + req.file.filename, req.params.id);
  if (existing.image_path) {
    fs.unlink(path.join(uploadsDir, path.basename(existing.image_path)), () => {});
  }

  res.json(db.prepare('SELECT * FROM links WHERE id = ?').get(req.params.id));
});

module.exports = router;
