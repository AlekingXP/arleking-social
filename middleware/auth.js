const { touchUserActivity } = require('../db');

function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    touchUserActivity(req.session.userId);
    return next();
  }
  return res.status(401).json({ error: 'No autenticado' });
}

module.exports = { requireAuth };
