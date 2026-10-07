// Los fondos generativos.
//
// Un fondo se juzga mirándolo, y eso ya está hecho en el navegador. Lo que
// se comprueba aquí es lo que NO se ve mirando:
//
//   1. Que las dos listas de fondos no se hayan separado. El catálogo real
//      vive en el navegador y el servidor sólo guarda nombres, así que son
//      dos listas; la primera vez ya se me olvidó una en el servidor y el
//      fondo se habría podido elegir en el panel para guardarse como
//      "ninguno" sin decir nada.
//
//   2. Que no vuelva el fallo del factor de escala. Las miniaturas del
//      selector dibujan lo mismo diez veces más pequeño, y para eso se
//      engordan los grosores. Multiplicar por ese factor una OPACIDAD la
//      sube por encima de uno, y multiplicar una amplitud saca las ondas de
//      la pantalla. Eso pasó, y no se nota leyendo el código: se nota
//      cuando un fondo sale fosforescente.
//
//   3. Que lo que llegue del formulario no entre crudo en la base, porque
//      de ahí sale a un atributo de la página pública.
//
// Se ejecuta con `npm test`. Base de datos en el directorio temporal.
const path = require('path');
const os = require('os');
const fs = require('fs');

const DATOS = path.join(os.tmpdir(), 'arleking-prueba-fondos');
if (fs.existsSync(DATOS)) fs.rmSync(DATOS, { recursive: true, force: true });

const RAIZ = path.join(__dirname, '..');
const leer = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8');

let pasadas = 0;
let fallos = 0;
function ok(nombre, cond, extra) {
  if (cond) { pasadas++; console.log('  ok    ' + nombre); }
  else { fallos++; console.log('  FALLO ' + nombre + (extra !== undefined ? '  -> ' + JSON.stringify(extra).slice(0, 300) : '')); }
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
  process.env.PORT = '3990';
  process.env.DATA_DIR = DATOS;
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;

  const { CLAVES, limpiarFondo } = require('../support/fondos');
  const fuente = leer('public/js/wallpapers.js');

  console.log('== 1. Las dos listas no se han separado ==');

  // Las del navegador, sacadas del propio archivo que se envía.
  const enElNavegador = [...fuente.matchAll(/^\s*clave: '([a-z]+)',$/gm)].map((m) => m[1]);

  ok('se encontró el catálogo del navegador', enElNavegador.length >= 8, enElNavegador);
  ok('el servidor conoce los mismos, en el mismo orden',
    JSON.stringify(enElNavegador) === JSON.stringify(CLAVES),
    { navegador: enElNavegador, servidor: CLAVES });

  const repetidas = CLAVES.filter((c, i) => CLAVES.indexOf(c) !== i);
  ok('ninguna clave repetida', repetidas.length === 0, repetidas);

  console.log('\n== 2. El factor de escala sólo engorda, no ilumina ==');

  // El fallo exacto que hubo: rgba(color, 0.55 * p.escala). Con escala 2.2 eso
  // es una opacidad de 1,21 y el fondo sale quemado.
  const enOpacidad = [...fuente.matchAll(/rgba\([^)]*p\.escala[^)]*\)/g)].map((m) => m[0]);
  ok('ninguna opacidad multiplicada por la escala', enOpacidad.length === 0, enOpacidad);

  // Y el otro: una amplitud en píxeles multiplicada por la escala, que en la
  // miniatura sacaba la topografía fuera del lienzo.
  const amplitudes = [...fuente.matchAll(/const (amplitud|v|vx|vy) = [^;]*p\.escala[^;]*;/g)].map((m) => m[0]);
  ok('ninguna amplitud ni velocidad multiplicada por la escala', amplitudes.length === 0, amplitudes);

  // Lo que sí debe llevarla, o las miniaturas se ven grises.
  ok('los grosores y radios sí la llevan',
    /lineWidth = [^;]*p\.escala/.test(fuente) && /rad[^;]*\* p\.escala/.test(fuente));

  // La regla, escrita donde se define: sin esto, el próximo fondo la repite.
  ok('y la regla está escrita al lado', /REGLA: la escala multiplica/.test(fuente));

  console.log('\n== 3. Los recuentos no se derrumban en una miniatura ==');

  // Con (w*h)/2600, una miniatura de 230x144 se quedaba en doce partículas y
  // parecía estropeada. Los recuentos son fijos: la miniatura es una maqueta
  // a escala, con las mismas piezas más pequeñas.
  const porArea = [...fuente.matchAll(/\(w \* h\) \/ \d+/g)].map((m) => m[0]);
  ok('ningún recuento sale del área del lienzo', porArea.length === 0, porArea);

  console.log('\n== 4. Lo que llega del formulario se filtra ==');

  ok('una clave del catálogo pasa', limpiarFondo('malla') === 'malla');
  ok('con espacios alrededor, también', limpiarFondo('  aurora  ') === 'aurora');
  ok('una inventada se convierte en ninguno', limpiarFondo('loquesea') === null);
  ok('vacío, ninguno', limpiarFondo('') === null);
  ok('nulo, ninguno', limpiarFondo(null) === null);
  ok('un número, ninguno', limpiarFondo(42) === null);
  ok('un objeto, ninguno', limpiarFondo({ malla: 1 }) === null);
  // Esto acaba en un atributo de la página pública de alguien.
  ok('una etiqueta, ninguno', limpiarFondo('"><script>alert(1)</script>') === null);
  ok('una ruta, ninguno', limpiarFondo('../../etc/passwd') === null);

  console.log('\n== 5. De punta a punta ==');

  require('../server.js');
  const SRV = 'http://localhost:3990';
  await new Promise((r) => setTimeout(r, 1800));

  const yo = await registrar(SRV, 'quien-elige-fondo');
  const guardar = (cuerpo) => fetch(SRV + '/api/profile', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: yo.cookie, 'X-CSRF-Token': yo.csrf },
    body: JSON.stringify({ name: 'Quien elige', tagline: 'fondos', ...cuerpo }),
  }).then(async (r) => ({ status: r.status, datos: await r.json().catch(() => ({})) }));

  const recien = await fetch(SRV + '/api/profile', { headers: { Cookie: yo.cookie } }).then((r) => r.json());
  ok('una cuenta nueva no trae ningún fondo', recien.wallpaper === null, recien.wallpaper);

  const puesto = await guardar({ wallpaper: 'rejilla' });
  ok('se guarda el elegido', puesto.datos.wallpaper === 'rejilla', puesto.datos.wallpaper);

  const inventado = await guardar({ wallpaper: 'no-existe-este' });
  // No se rechaza la petición entera: el resto del formulario —el nombre, la
  // URL, los colores— sí es válido, y perderlo por un campo que la persona
  // ni siquiera ve escrito sería absurdo.
  ok('uno inventado no rompe el guardado', inventado.status === 200, inventado.status);
  ok('y se queda en ninguno', inventado.datos.wallpaper === null, inventado.datos.wallpaper);

  await guardar({ wallpaper: 'celdas' });
  const publico = await fetch(SRV + '/api/public/quien-elige-fondo/profile').then((r) => r.json());
  ok('la página pública recibe el fondo', publico.wallpaper === 'celdas', publico.wallpaper);
  // Y sigue sin recibir lo que nunca debe salir de casa.
  ok('y sigue sin recibir lo de Stripe',
    !('stripe_customer_id' in publico) && !('stripe_subscription_id' in publico), Object.keys(publico));

  const quitado = await guardar({ wallpaper: null });
  ok('se puede quitar', quitado.datos.wallpaper === null, quitado.datos.wallpaper);

  console.log('\n== 6. Se porta bien con quien no quiere movimiento ==');

  ok('mira si el sistema pide menos movimiento', fuente.includes('prefers-reduced-motion'));
  ok('y aun así pinta un fotograma, no un hueco',
    /unFotograma\(performance\.now\(\)\);/.test(fuente));
  ok('se para cuando la pestaña pasa atrás', fuente.includes("'visibilitychange'"));
  ok('y cuando el lienzo sale de la pantalla', fuente.includes('IntersectionObserver'));
  // Sesenta por segundo para un fondo desenfocado es gastar el doble por
  // nada: lo mira quien está leyendo otra cosa.
  ok('va a treinta por segundo, no a sesenta', /ahora - ultimo < 33/.test(fuente));
  // En un móvil de 3x, un lienzo a pantalla completa serían nueve veces los
  // píxeles de un fondo borroso.
  ok('la densidad de píxeles está limitada', /devicePixelRatio \|\| 1, 2/.test(fuente));

  console.log('\n=== ' + pasadas + ' pasadas, ' + fallos + ' fallos ===');
  process.exit(fallos ? 1 : 0);
})().catch((err) => { console.error('ERROR EN LA PRUEBA:', err); process.exit(2); });
