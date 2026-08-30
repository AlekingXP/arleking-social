const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');

const { generatedPassword } = require('./db');
const { dataDir, uploadsDir } = require('./paths');
const publicRoutes = require('./routes/public');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';

if (isProduction) app.set('trust proxy', 1);

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const secretPath = path.join(dataDir, '.session-secret');
let sessionSecret;
if (fs.existsSync(secretPath)) {
  sessionSecret = fs.readFileSync(secretPath, 'utf8');
} else {
  sessionSecret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(secretPath, sessionSecret);
}

app.use(express.json());
app.use(session({
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 8,
    sameSite: 'lax',
    secure: isProduction,
  },
}));

app.use('/uploads', express.static(uploadsDir));
app.use('/api/public', publicRoutes);
app.use('/api', adminRoutes);

app.use(express.static(path.join(__dirname, 'public')));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Error interno' });
});

app.listen(PORT, () => {
  console.log(`\nServidor corriendo en http://localhost:${PORT}`);
  console.log(`Dashboard admin en http://localhost:${PORT}/admin/login.html`);
  if (generatedPassword) {
    console.log(`\nUsuario admin creado -> usuario: admin | contraseña: ${generatedPassword}`);
    console.log('Cámbiala desde el dashboard después de iniciar sesión.\n');
  }
});
