const express = require('express');
const { db, slugify, RESERVED_SLUGS } = require('../db');

const router = express.Router();

router.get('/check-username', (req, res) => {
  const raw = (req.query.username || '').trim();
  if (raw.length < 3) return res.json({ available: false, reason: 'Debe tener al menos 3 caracteres' });

  const exists = db.prepare('SELECT 1 FROM users WHERE username = ?').get(raw);
  res.json({ available: !exists, reason: exists ? 'Ese usuario ya está en uso' : null });
});

router.get('/check-slug', (req, res) => {
  const slug = slugify(req.query.slug || '');
  if (RESERVED_SLUGS.includes(slug)) return res.json({ available: false, slug, reason: 'Ese nombre está reservado' });

  const exists = db.prepare('SELECT 1 FROM profile WHERE slug = ?').get(slug);
  res.json({ available: !exists, slug, reason: exists ? 'Esa URL ya está en uso' : null });
});

router.get('/:slug/profile', (req, res) => {
  const profile = db.prepare('SELECT * FROM profile WHERE slug = ?').get(req.params.slug);
  if (!profile) return res.status(404).json({ error: 'Página no encontrada' });
  res.json(profile);
});

router.get('/:slug/links', (req, res) => {
  const profile = db.prepare('SELECT user_id FROM profile WHERE slug = ?').get(req.params.slug);
  if (!profile) return res.status(404).json({ error: 'Página no encontrada' });

  const links = db.prepare('SELECT * FROM links WHERE user_id = ? AND enabled = 1 ORDER BY order_index ASC').all(profile.user_id);
  res.json(links);
});

module.exports = router;
