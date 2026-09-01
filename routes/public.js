const express = require('express');
const { db, slugify, RESERVED_SLUGS, isOwnerUsername } = require('../db');

const router = express.Router();

// Everything a visitor's page actually renders — and nothing else. The
// profile row also carries stripe_customer_id / stripe_subscription_id,
// which `SELECT *` was handing to anyone who asked for the page.
const PUBLIC_PROFILE_FIELDS = [
  'slug',
  'name',
  'tagline',
  'avatar_path',
  'background_path',
  'age_gate_enabled',
  'age_gate_title',
  'age_gate_subtitle',
  'age_gate_confirm',
  'footer_text',
  'accent_from',
  'accent_to',
  'particles_enabled',
  'particles_color',
  'particles_density',
  'vip_tier',
];

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
  const row = db
    .prepare('SELECT p.*, u.username FROM profile p JOIN users u ON u.id = p.user_id WHERE p.slug = ?')
    .get(req.params.slug);
  if (!row) return res.status(404).json({ error: 'Página no encontrada' });

  const profile = {};
  for (const field of PUBLIC_PROFILE_FIELDS) profile[field] = row[field];
  // Lets the badge say OWNER instead of "Cliente VIP" on the pages belonging
  // to whoever runs the platform.
  profile.is_owner = isOwnerUsername(row.username) ? 1 : 0;
  res.json(profile);
});

router.get('/:slug/links', (req, res) => {
  const profile = db.prepare('SELECT user_id FROM profile WHERE slug = ?').get(req.params.slug);
  if (!profile) return res.status(404).json({ error: 'Página no encontrada' });

  const links = db.prepare('SELECT * FROM links WHERE user_id = ? AND enabled = 1 ORDER BY order_index ASC').all(profile.user_id);
  res.json(links);
});

module.exports = router;
