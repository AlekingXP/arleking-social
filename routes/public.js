const express = require('express');
const { db } = require('../db');

const router = express.Router();

router.get('/profile', (req, res) => {
  const profile = db.prepare('SELECT * FROM profile WHERE id = 1').get();
  res.json(profile);
});

router.get('/links', (req, res) => {
  const links = db.prepare('SELECT * FROM links WHERE enabled = 1 ORDER BY order_index ASC').all();
  res.json(links);
});

module.exports = router;
