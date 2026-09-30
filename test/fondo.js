// El fondo de la página pública: ahora admite vídeo además de imagen.
//
// Levanta la aplicación de verdad y sube archivos por HTTP, porque lo que
// hay que comprobar es justo la cadena entera: filtro de extensión, tope de
// peso, comprobación del contenido y borrado del anterior.
//
// Se ejecuta con `npm test`. Base de datos en el directorio temporal.
const path = require('path');
const os = require('os');
const fs = require('fs');

const DATOS = path.join(os.tmpdir(), 'arleking-prueba-fondo');
if (fs.existsSync(DATOS)) fs.rmSync(DATOS, { recursive: true, force: true });

let pasadas = 0;
let fallos = 0;
function ok(nombre, cond, extra) {
  if (cond) { pasadas++; console.log('  ok    ' + nombre); }
  else { fallos++; console.log('  FALLO ' + nombre + (extra !== undefined ? '  -> ' + JSON.stringify(extra).slice(0, 300) : '')); }
}

// ---- Archivos de prueba, por sus primeros bytes ----
//
// No hacen falta archivos reales: lo que mira el servidor es la cabecera.
// Se rellenan hasta pasar de los 12 bytes que lee.
const relleno = (cabecera, total = 64) => {
  const b = Buffer.alloc(total);
  Buffer.from(cabecera).copy(b, 0);
  return b;
};
const PNG = relleno([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPG = relleno([0xff, 0xd8, 0xff, 0xe0]);
const WEBP = (() => { const b = Buffer.alloc(64); b.write('RIFF', 0, 'latin1'); b.write('WEBP', 8, 'latin1'); return b; })();
const MP4 = (() => { const b = Buffer.alloc(64); b.writeUInt32BE(32, 0); b.write('ftypisom', 4, 'latin1'); return b; })();
const WEBM = relleno([0x1a, 0x45, 0xdf, 0xa3]);
const NO_ES_NADA = Buffer.from('<html>esto no es un video, solo se llama asi</html>');

async function subirFondo(SRV, sesion, nombre, bytes) {
  const fd = new FormData();
  fd.append('background', new Blob([bytes]), nombre);
  const r = await fetch(SRV + '/api/profile/background', {
    method: 'POST',
    headers: { Cookie: sesion.cookie, 'X-CSRF-Token': sesion.csrf },
    body: fd,
  });
  return { status: r.status, json: await r.json().catch(() => null) };
}

async function subirAvatar(SRV, sesion, nombre, bytes) {
  const fd = new FormData();
  fd.append('avatar', new Blob([bytes]), nombre);
  const r = await fetch(SRV + '/api/profile/avatar', {
    method: 'POST',
    headers: { Cookie: sesion.cookie, 'X-CSRF-Token': sesion.csrf },
    body: fd,
  });
  return { status: r.status, json: await r.json().catch(() => null) };
}

function tarro(res, t = {}) {
  (res.headers.getSetCookie ? res.headers.getSetCookie() : []).forEach((c) => {
    const par = c.split(';')[0];
    const i = par.indexOf('=');
    t[par.slice(0, i)] = par.slice(i + 1);
  });
  return t;
}

async function registrar(SRV, usuario) {
  const r = await fetch(SRV + '/api/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: usuario, password: 'Clave-Larga-De-Prueba-2026!' }),
  });
  const t = tarro(r);
  const g = await fetch(SRV + '/api/auth/me', { headers: { Cookie: Object.entries(t).map(([k, v]) => `${k}=${v}`).join('; ') } });
  tarro(g, t);
  return {
    cookie: Object.entries(t).map(([k, v]) => `${k}=${v}`).join('; '),
    csrf: decodeURIComponent(t.csrf_token || ''),
  };
}

(async () => {
  process.env.PORT = '3997';
  process.env.DATA_DIR = DATOS;
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;

  require('../server.js');
  const SRV = 'http://localhost:3997';
  await new Promise((r) => setTimeout(r, 1800));
  const subidas = path.join(DATOS, 'uploads');
  const ana = await registrar(SRV, 'ana-fondo');

  console.log('== 1. Lo que ya funcionaba sigue funcionando ==');
  for (const [nombre, bytes] of [['f.png', PNG], ['f.jpg', JPG], ['f.webp', WEBP]]) {
    const r = await subirFondo(SRV, ana, nombre, bytes);
    ok(`acepta ${nombre}`, r.status === 200 && r.json.background_path.endsWith(path.extname(nombre)), r);
  }

  console.log('\n== 2. Vídeo ==');
  const rMp4 = await subirFondo(SRV, ana, 'clip.mp4', MP4);
  ok('acepta MP4', rMp4.status === 200 && /\.mp4$/.test(rMp4.json.background_path), rMp4);
  const rWebm = await subirFondo(SRV, ana, 'clip.webm', WEBM);
  ok('acepta WEBM', rWebm.status === 200 && /\.webm$/.test(rWebm.json.background_path), rWebm);
  ok('el anterior se borra del disco', !fs.existsSync(path.join(subidas, path.basename(rMp4.json.background_path))));

  console.log('\n== 3. Formatos que no reproduce todo el mundo ==');
  const rMov = await subirFondo(SRV, ana, 'iphone.mov', MP4);
  ok('rechaza .mov con 400', rMov.status === 400, rMov.status);
  ok('y explica a qué convertirlo', /MP4 o WEBM/.test(rMov.json.error), rMov.json);
  const rRaro = await subirFondo(SRV, ana, 'cosa.exe', MP4);
  ok('rechaza cualquier otra extensión', rRaro.status === 400, rRaro);

  console.log('\n== 4. La extensión no prueba nada: se mira el contenido ==');
  const antes = fs.readdirSync(subidas).length;
  const rFalso = await subirFondo(SRV, ana, 'mentira.mp4', NO_ES_NADA);
  ok('rechaza un archivo que sólo se llama .mp4', rFalso.status === 400, rFalso);
  ok('y no lo deja en el disco', fs.readdirSync(subidas).length === antes, {
    antes, despues: fs.readdirSync(subidas).length,
  });
  const perfil = await fetch(SRV + '/api/profile', { headers: { Cookie: ana.cookie } }).then((r) => r.json());
  ok('el fondo bueno sigue puesto', perfil.background_path === rWebm.json.background_path, perfil.background_path);

  console.log('\n== 5. Peso ==');
  const gordo = Buffer.alloc(21 * 1024 * 1024);
  WEBM.copy(gordo, 0);
  const rGordo = await subirFondo(SRV, ana, 'enorme.webm', gordo);
  ok('un vídeo de 21 MB no entra', rGordo.status === 413, rGordo.status);
  ok('y dice cuál es el máximo', /20 MB/.test(rGordo.json.error), rGordo.json);
  // El mismo archivo que pasa como fondo no pasa como avatar: cada subida
  // tiene su propio tope.
  const medio = Buffer.alloc(6 * 1024 * 1024);
  PNG.copy(medio, 0);
  const rAvatarGordo = await subirAvatar(SRV, ana, 'grande.png', medio);
  ok('el avatar mantiene su tope de 5 MB', rAvatarGordo.status === 413 && /5 MB/.test(rAvatarGordo.json.error), rAvatarGordo);

  console.log('\n== 6. El vídeo es sólo para el fondo ==');
  const rAvatarVideo = await subirAvatar(SRV, ana, 'clip.mp4', MP4);
  ok('el avatar sigue rechazando vídeo', rAvatarVideo.status === 400, rAvatarVideo.status);
  const rAvatarOk = await subirAvatar(SRV, ana, 'yo.png', PNG);
  ok('y sigue aceptando imágenes', rAvatarOk.status === 200 && /\.png$/.test(rAvatarOk.json.avatar_path), rAvatarOk);

  console.log('\n== 7. Quitar el fondo ==');
  const archivo = path.basename(rWebm.json.background_path);
  const rBorrar = await fetch(SRV + '/api/profile/background', {
    method: 'DELETE', headers: { Cookie: ana.cookie, 'X-CSRF-Token': ana.csrf },
  });
  const trasBorrar = await rBorrar.json();
  ok('vuelve al predeterminado', rBorrar.status === 200 && trasBorrar.background_path === null, trasBorrar.background_path);
  ok('y el vídeo no se queda ocupando disco', !fs.existsSync(path.join(subidas, archivo)));

  console.log('\n== 8. Sin sesión no se sube nada ==');
  const fd = new FormData();
  fd.append('background', new Blob([WEBM]), 'ajeno.webm');
  const rAnon = await fetch(SRV + '/api/profile/background', { method: 'POST', body: fd });
  ok('pide sesión', rAnon.status === 401 || rAnon.status === 403, rAnon.status);

  console.log(`\n=== ${pasadas} pasadas, ${fallos} fallos ===`);
  process.exit(fallos ? 1 : 0);
})().catch((err) => { console.error('ERROR EN LA PRUEBA:', err); process.exit(2); });
