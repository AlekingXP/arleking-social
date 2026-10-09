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
//   4. Que la tercera lista no se separe de las otras dos. Desde que cada
//      fondo trae además su tipografía y su forma de entrar, hay un tercer
//      sitio donde están los nombres: la tabla de estilos. Un fondo sin
//      estilo se vería con la letra de otro y nadie lo notaría leyendo.
//
//   5. Que las familias tipográficas estén nombradas en UN solo sitio. Si
//      una hoja de estilos vuelve a escribir 'Cinzel' a mano, ya hay dos
//      listas de fuentes y se separan el día que cambie una.
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

  console.log('\n== 5. Cada fondo trae su estilo ==');

  const estilos = leer('public/js/estilos.js');
  const css = leer('public/css/style.css');

  // Las claves de la tabla de estilos, sacadas del propio archivo.
  const tabla = estilos.slice(estilos.indexOf('var ESTILOS = {'), estilos.indexOf('var pedidas'));
  const conEstilo = [...tabla.matchAll(/^    ([a-z]+): \{/gm)].map((m) => m[1]);

  ok('la tabla de estilos tiene una entrada por fondo',
    JSON.stringify(conEstilo) === JSON.stringify(CLAVES),
    { estilos: conEstilo, fondos: CLAVES });

  // 'malla' es el de casa y no cambia nada, así que no necesita bloque.
  const sinBloque = CLAVES.filter((c) => c !== 'malla' && !css.includes('[data-estilo="' + c + '"]'));
  ok('y cada uno tiene sus reglas en el CSS', sinBloque.length === 0, sinBloque);

  const sobran = [...css.matchAll(/\[data-estilo="([a-z]+)"\]/g)]
    .map((m) => m[1]).filter((c, i, a) => a.indexOf(c) === i && CLAVES.indexOf(c) === -1);
  ok('y el CSS no estiliza fondos que no existen', sobran.length === 0, sobran);

  // El punto de todo esto: que elegir fondo cambie de verdad la letra y la
  // entrada. Un bloque que solo repite lo de por defecto no cambia nada.
  const cambian = CLAVES.filter((c) => c !== 'malla').filter((c) => {
    const i = css.indexOf('[data-estilo="' + c + '"]');
    const fin = css.indexOf('/* --', i + 10);
    const bloque = css.slice(i, fin === -1 ? css.length : fin);
    return /--entrada:/.test(bloque) && /(font-weight|letter-spacing|text-transform)/.test(bloque);
  });
  ok('cada estilo cambia la letra Y la entrada, no solo una',
    cambian.length === CLAVES.length - 1,
    { cambian: cambian.length, esperados: CLAVES.length - 1 });

  // Una sola lista de fuentes. Si una hoja de estilos nombra una familia,
  // ya son dos listas.
  const familias = [...estilos.matchAll(/familias: \['([^']+)'\]/g)]
    .map((m) => m[1].split(':')[0].split('+').join(' '));
  ok('se encontraron las familias', familias.length >= 8, familias);
  const hojas = ['public/css/style.css', 'public/css/glass.css', 'public/admin/css/admin.css'];
  const filtradas = [];
  hojas.forEach((hoja) => {
    const texto = leer(hoja);
    familias.forEach((fam) => { if (texto.includes(fam)) filtradas.push(hoja + ': ' + fam); });
  });
  ok('ninguna hoja de estilos nombra una fuente de la tabla', filtradas.length === 0, filtradas);
  ok('el CSS las recibe por variable', /--font-titulo/.test(css) && /--font-cuerpo/.test(css));

  // Quien pide menos movimiento tiene diez formas nuevas de quedarse con
  // una página en blanco: diez entradas, y algunas recortan o desenfocan.
  const quieto = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
  ok('con movimiento reducido no queda nada invisible',
    /\[data-estilo\]/.test(quieto) && /opacity: 1/.test(quieto)
    && /clip-path: none/.test(quieto) && /filter: none/.test(quieto), quieto.slice(0, 300));

  console.log('\n== 6. «Viva»: la imagen de cada cual ==');

  ok('se declara que necesita una imagen', /necesitaImagen: true/.test(fuente));
  ok('y que quiere el puntero', /quierePuntero: true/.test(fuente));
  // Un escuchador en la ventana, no uno por lienzo: en el panel hay diez
  // miniaturas y serían diez funciones por cada píxel que se mueve el ratón.
  ok('un solo escuchador de puntero para todos', (fuente.match(/addEventListener\('pointermove'/g) || []).length === 1);
  ok('y en pasivo', /addEventListener\('pointermove', alMoverPuntero, \{ passive: true \}\)/.test(fuente));
  ok('se suelta al parar', /removeEventListener\('pointermove'/.test(fuente) && /soltarPuntero\(\)/.test(fuente));

  // El fallo que este motor evita en todas partes: forzar al navegador a
  // recalcular la página en cada fotograma. La caja se cachea al medir y
  // al hacer scroll, nunca dentro del bucle de dibujo.
  const motor = fuente.slice(fuente.indexOf('function montar(lienzo'));
  const enElBucle = motor.slice(motor.indexOf('function unFotograma'), motor.indexOf('function arrancar'));
  ok('la caja no se pide en cada fotograma', !/getBoundingClientRect/.test(enElBucle), enElBucle);
  ok('se refresca al hacer scroll, y en pasivo',
    /addEventListener\('scroll', alScroll, \{ passive: true \}\)/.test(motor));

  // Sin imagen no hay nada que animar, y un rectángulo vacío miente.
  const viva = fuente.slice(fuente.indexOf("clave: 'viva'"), fuente.indexOf('// ---- El motor ----'));
  ok('sin imagen, «Viva» dibuja un hueco y lo dice', /if \(!img\) \{/.test(viva));
  ok('y la página pública no lo monta siquiera',
    /profile\.wallpaper !== 'viva' \|\| esFoto/.test(leer('public/js/main.js')));
  ok('la baldosa del panel también lo avisa',
    /necesitaImagen && !imagen/.test(leer('public/admin/js/wallpaper-picker.js')));

  console.log('\n== 7. De punta a punta ==');

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

  console.log('\n== 8. Se porta bien con quien no quiere movimiento ==');

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
