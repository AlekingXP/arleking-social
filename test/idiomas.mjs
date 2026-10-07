// Idiomas.
//
// Dos mitades que se prueban distinto:
//
//   El diccionario de la interfaz. Lo que importa no es que las frases
//   suenen bien —eso se lee— sino que NO haya claves rotas: una clave en el
//   HTML sin entrada en el diccionario enseña castellano (aceptable), pero
//   una entrada sobrante es una traducción que nadie ve y que se pudre.
//
//   El idioma del asistente. Se le dice al modelo en qué idioma contestar;
//   lo que se comprueba aquí es que la instrucción salga bien formada y que
//   NO aparezca cuando la persona ya está en castellano, porque decirle "y
//   ahora responde en español" a cada petición es gastar tokens en nada.
//
// Se ejecuta con `npm test`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.join(AQUI, '..');

let pasadas = 0;
let fallos = 0;
function ok(nombre, cond, extra) {
  if (cond) { pasadas++; console.log('  ok    ' + nombre); }
  else { fallos++; console.log('  FALLO ' + nombre + (extra !== undefined ? '  -> ' + JSON.stringify(extra).slice(0, 300) : '')); }
}

const leer = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8');

console.log('== 1. El diccionario cuadra con lo que hay marcado ==');
const en = JSON.parse(leer('public/i18n/en.json'));

// Las claves que de verdad se usan: las del HTML y las del JS.
const clavesEnHtml = new Set();
for (const f of ['public/admin/dashboard.html', 'public/admin/login.html', 'public/profile.html']) {
  for (const m of leer(f).matchAll(/data-i18n(?:-ph|-aria|-title)?="([^"]+)"/g)) clavesEnHtml.add(m[1]);
}
const clavesEnJs = new Set();
const JS_TRADUCIDO = [
  'public/admin/js/login.js',
  'public/admin/js/admin.js',
  'public/admin/js/encuesta.js',
  'public/admin/js/encuestas-admin.js',
  'public/admin/js/wallpaper-picker.js',
  'public/js/support-widget.js',
];
for (const f of JS_TRADUCIDO) {
  for (const m of leer(f).matchAll(/\bT\('([^']+)'/g)) clavesEnJs.add(m[1]);
}
const usadas = new Set([...clavesEnHtml, ...clavesEnJs]);

ok('hay claves marcadas en el HTML', clavesEnHtml.size > 150, clavesEnHtml.size);
ok('y en el JavaScript', clavesEnJs.size > 30, clavesEnJs.size);

const sobran = Object.keys(en).filter((k) => !usadas.has(k));
ok('ninguna traducción sobra', sobran.length === 0, sobran.slice(0, 10));

const vacias = Object.entries(en).filter(([, v]) => typeof v !== 'string' || !v.trim());
ok('ninguna traducción está vacía', vacias.length === 0, vacias.slice(0, 5).map(([k]) => k));

// Que falte alguna es legítimo (marcas, URLs): cae en castellano. Lo que no
// vale es que falten a puñados, que seria un diccionario a medio hacer.
const faltan = [...usadas].filter((k) => !(k in en));
ok('apenas quedan sin traducir', faltan.length <= 15, { cuantas: faltan.length, cuales: faltan });

console.log('\n== 2. El módulo de idiomas elige bien ==');
const i18n = leer('public/js/i18n.js');
ok('el castellano no descarga diccionario', /idioma === BASE\) return Promise\.resolve\(\)/.test(i18n));
ok('un idioma que no tenemos cae en inglés, no en castellano', /SOPORTADOS\.indexOf\('en'\)/.test(i18n));
ok('mira navigator.languages, no sólo el primero', /navigator\.languages/.test(i18n));
// Dentro de detectar(), no en todo el archivo: los comentarios de arriba
// nombran navigator.languages y la primera versión de esta comprobación se
// creyó que ese era el código.
const cuerpoDetectar = i18n.slice(i18n.indexOf('function detectar()'), i18n.indexOf('function t('));
ok('lo elegido a mano manda sobre el del sistema',
  cuerpoDetectar.indexOf('guardado()') < cuerpoDetectar.indexOf('navigator.languages'),
  { guardado: cuerpoDetectar.indexOf('guardado()'), navegador: cuerpoDetectar.indexOf('navigator.languages') });

console.log('\n== 3. Lo que se le dice al asistente ==');
const { contexto, nombreDeIdioma } = require(path.join(RAIZ, 'support/ai/instrucciones.js'));

ok('reconoce etiquetas con región', nombreDeIdioma('en-GB') === nombreDeIdioma('en'), nombreDeIdioma('en-GB'));
ok('y con guion bajo', nombreDeIdioma('pt_BR') === nombreDeIdioma('pt'), nombreDeIdioma('pt_BR'));
ok('una etiqueta vacía no es un idioma', nombreDeIdioma('') === null && nombreDeIdioma(null) === null);
ok('un idioma raro tiene nombre igualmente', typeof nombreDeIdioma('ja') === 'string', nombreDeIdioma('ja'));

const enIngles = contexto({ username: 'ana', idioma: 'en-US' });
ok('le dice que responda en inglés', /respóndele SIEMPRE en ingl/i.test(enIngles), enIngles);
ok('y que traduzca la ayuda en vez de pegarla', /Tradúcelos a ingl/i.test(enIngles));

const enCastellano = contexto({ username: 'ana', idioma: 'es-419' });
ok('a quien ya está en castellano no se le dice nada de idioma',
  !/respóndele SIEMPRE/.test(enCastellano), enCastellano);
const sinIdioma = contexto({ username: 'ana' });
ok('sin idioma, tampoco', !/respóndele SIEMPRE/.test(sinIdioma));

// Un idioma cualquiera funciona: esta mitad no depende de que exista un
// diccionario, que es justo por lo que vale la pena.
const enJapones = contexto({ username: 'ana', idioma: 'ja' });
ok('con un idioma sin diccionario también da instrucción', /respóndele SIEMPRE en/.test(enJapones), enJapones);

console.log('\n== 4. Lo que llega del cliente no entra crudo ==');
const rutas = leer('routes/support.js');
ok('el idioma se valida con una forma cerrada', /\^\[a-zA-Z\]\{2,3\}\(-\[a-zA-Z0-9\]\{2,8\}\)\?\$/.test(rutas));
ok('se queda sólo con la raíz', /split\('-'\)\[0\]/.test(rutas));
ok('y si no, mira la cabecera del navegador', /accept-language/.test(rutas));

console.log(`\n=== ${pasadas} pasadas, ${fallos} fallos ===`);
process.exit(fallos ? 1 : 0);
