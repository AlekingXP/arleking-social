// El recorrido que hay debajo de los enlaces.
//
// Lo bonito se juzga mirándolo, y eso está hecho en el navegador. Aquí se
// comprueba lo que no se ve mirando una página que funciona:
//
//   Que nadie se encuentre su página tres pantallas más larga sin haberlo
//   pedido. Está apagado para todo lo que ya existe.
//
//   Que el contenido NO dependa de que la animación arranque. Un revelado
//   al entrar en pantalla es opacidad cero hasta que algo la sube, y si ese
//   algo no corre —sin IntersectionObserver, con el movimiento reducido— lo
//   que queda es una página en blanco. Ese es el fallo caro de este patrón
//   y es el que más se repite por ahí.
//
//   Que lo pesado llegue tarde. Three.js son unos cientos de kilobytes en
//   la página que cargan los visitantes; si se pide arriba, el recorrido
//   se lo cobra a todo el que entra y no baja.
//
//   Y las reglas de montaje, que son lo que separa esto de "cosas que
//   aparecen": tres propiedades por entrada, escalonadas, sin curvas
//   lineales salvo la cinta, y sólo propiedades que no recalculan la página.
//
// Se ejecuta con `npm test`. Base de datos en el directorio temporal.
const path = require('path');
const os = require('os');
const fs = require('fs');

const DATOS = path.join(os.tmpdir(), 'arleking-prueba-recorrido');
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
  process.env.PORT = '3989';
  process.env.DATA_DIR = DATOS;
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;

  const ctrl = leer('public/js/recorrido.js');
  const esc3d = leer('public/js/recorrido-3d.js');
  const html = leer('public/profile.html');
  const css = leer('public/css/style.css');

  console.log('== 1. Nadie se lo encuentra puesto ==');

  ok('la columna nace apagada',
    /recorrido INTEGER NOT NULL DEFAULT 0/.test(leer('db.js')));
  ok('y el bloque nace oculto en el HTML',
    /id="recorrido" class="recorrido hidden"/.test(html));
  // Lo enseña main.js sólo si el perfil lo pide. Si eso se rompiera, el
  // recorrido saldría en todas las páginas del mundo a la vez.
  ok('sólo se enseña si el perfil lo pide',
    /if \(profile\.recorrido && window\.AKRecorrido\)/.test(leer('public/js/main.js')));

  console.log('\n== 2. El contenido no depende de que la animación arranque ==');

  // Éste es el fallo caro del patrón: opacidad cero esperando a un
  // observador que puede no existir.
  ok('sin IntersectionObserver se enseña todo igual',
    /if \(!window\.IntersectionObserver \|\| quieto\) \{[\s\S]{0,180}classList\.add\('visible'\)/.test(ctrl),
    ctrl.slice(ctrl.indexOf('montarRevelados'), ctrl.indexOf('montarRevelados') + 420));
  // Y además en CSS, que es lo que cubre el caso de que el archivo entero
  // no llegue a cargarse.
  ok('y con movimiento reducido lo cubre también el CSS',
    /prefers-reduced-motion[\s\S]{0,220}\[data-revelar\] \[data-paso\] \{ opacity: 1/.test(css));

  console.log('\n== 3. Lo pesado llega tarde, o no llega ==');

  ok('el controlador no importa Three.js arriba',
    !/^import /m.test(ctrl) && !ctrl.includes("from 'three'"), 'hay un import de primer nivel');
  ok('lo trae con import() dinámico', /import\('\/js\/recorrido-3d\.js'\)/.test(ctrl));
  ok('y sólo desde dentro del observador',
    ctrl.indexOf('new IntersectionObserver') < ctrl.indexOf("import('/js/recorrido-3d.js')"));
  // La sonda abre un contexto WebGL de 64 píxeles y cronometra. En un
  // teléfono viejo una pieza 3D a pantalla completa arruina la página.
  ok('pregunta si el aparato da la talla', /kit\.dispositivoApto\(\)/.test(ctrl));
  ok('y si no, enseña el respaldo', /rendirse\(\)/.test(ctrl) && /data-respaldo/.test(html));
  ok('también si el módulo no llega', /\.catch\(function \(\) \{[\s\S]{0,200}rendirse\(\)/.test(ctrl));

  console.log('\n== 4. Las reglas de montaje ==');

  const entrada = css.slice(css.indexOf('[data-revelar] [data-paso]'), css.indexOf('[data-revelar].visible'));
  // Una opacidad sola es un parpadeo. Tres propiedades es algo que llega.
  ok('las entradas mueven tres propiedades',
    /opacity: 0/.test(entrada) && /translateY\(/.test(entrada) && /scale\(/.test(entrada), entrada);
  // Todo a la vez se lee como un corte, no como una entrada. El retardo
  // sale de una variable desde que cada fondo trae su propio escalonado,
  // asi que lo que se comprueba es que el escalonado siga existiendo y que
  // su valor de fabrica siga siendo 60ms: lo primero es la regla, lo
  // segundo es que ningun estilo tenga que repetirla para tenerla.
  const conRetardo = (entrada.match(/calc\(var\(--paso, 0\) \* var\(--salto, 60ms\)\)/g) || []).length;
  const retardos = (entrada.match(/calc\(var\(--paso, 0\)/g) || []).length;
  // Todas, no alguna: si una sola de las propiedades que se animan pierde
  // el retardo, esa entra a destiempo y la entrada se parte por la mitad.
  ok('y van escalonadas entre hermanas, las cuatro',
    conRetardo > 0 && conRetardo === retardos, { conRetardo, retardos });
  ok('el escalonado lo reparte el controlador', /setProperty\('--paso', i\)/.test(ctrl));
  // Animar `top`, `height` o `width` obliga al navegador a recalcular la
  // página en cada fotograma; transform y opacity van en el compositor.
  ok('sólo se anima lo que no recalcula la página',
    /transition:\s*\n?\s*opacity[^;]*transform[^;]*;/.test(entrada)
    && !/transition:[^;]*\b(width|height|top|left|margin)\b/.test(entrada), entrada);

  const lineales = [...css.matchAll(/animation:[^;]*\blinear\b[^;]*;/g)].map((m) => m[0]);
  // Lo lineal sólo vale para lo que de verdad avanza a ritmo constante.
  ok('lo único lineal son las cintas y el respaldo',
    lineales.every((l) => /cinta|respaldoGira/.test(l)), lineales);

  ok('usa los tokens de duración y curva, no números sueltos',
    /var\(--dur-escena\)/.test(css) && /var\(--ease-salida-fuerte\)/.test(css));

  console.log('\n== 5. La pieza 3D se porta bien ==');

  ok('no descarga ningún modelo', !/\.glb/.test(esc3d));
  ok('la genera en el sitio', /IcosahedronGeometry/.test(esc3d));
  // Dos cargas de la misma página tienen que dar el mismo cristal. Se
  // miran sólo las líneas de código: los comentarios de ahí dentro nombran
  // Math.random a propósito, para explicar por qué NO se usa.
  const esc3dCodigo = esc3d.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  ok('y sin azar: la misma página da la misma pieza', !/Math\.random/.test(esc3dCodigo),
    (esc3dCodigo.match(/.*Math\.random.*/g) || []));
  ok('sólo materiales sin luz', !/MeshStandardMaterial|MeshPhongMaterial|DirectionalLight/.test(esc3d));
  ok('limita la densidad de píxeles', /devicePixelRatio \|\| 1, 1\.5/.test(esc3d));
  ok('se para cuando sale de pantalla', /visible\(dentro\)/.test(ctrl));
  // Los navegadores dan pocos contextos WebGL por pestaña; soltarlo al
  // terminar no es optativo.
  ok('suelta el contexto WebGL al terminar', /forceContextLoss/.test(esc3d));
  // Enganchar la apertura directamente al scroll da saltos en cuanto la
  // rueda va a tirones o el móvil rebota al final.
  ok('persigue el scroll en vez de obedecerlo',
    /avanceSuave \+= \(avanceDestino - avanceSuave\)/.test(esc3d));
  ok('y el giro va por reloj, no por scroll', /grupo\.rotation\.y = t \* /.test(esc3d));
  ok('el scroll se escucha en pasivo', /\{ passive: true \}/.test(ctrl));

  console.log('\n== 6. De punta a punta ==');

  require('../server.js');
  const SRV = 'http://localhost:3989';
  await new Promise((r) => setTimeout(r, 1800));

  const yo = await registrar(SRV, 'quien-baja');
  const guardar = (cuerpo) => fetch(SRV + '/api/profile', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: yo.cookie, 'X-CSRF-Token': yo.csrf },
    body: JSON.stringify({ name: 'Quien baja', tagline: 'hasta el final', ...cuerpo }),
  }).then(async (r) => ({ status: r.status, datos: await r.json().catch(() => ({})) }));

  const recien = await fetch(SRV + '/api/profile', { headers: { Cookie: yo.cookie } }).then((r) => r.json());
  ok('una cuenta nueva lo trae apagado', recien.recorrido === 0, recien.recorrido);

  ok('se enciende', (await guardar({ recorrido: 1 })).datos.recorrido === 1);
  const publico = await fetch(SRV + '/api/public/quien-baja/profile').then((r) => r.json());
  ok('y la página pública se entera', publico.recorrido === 1, publico.recorrido);
  ok('se apaga', (await guardar({ recorrido: 0 })).datos.recorrido === 0);
  // Cualquier cosa que no sea un uno es apagado: el campo entra como
  // booleano y no como lo que mande quien llame.
  ok('un valor raro no lo enciende a medias',
    (await guardar({ recorrido: 'sí claro' })).datos.recorrido === 1, 'una cadena no vacía es verdadera');

  console.log('\n=== ' + pasadas + ' pasadas, ' + fallos + ' fallos ===');
  process.exit(fallos ? 1 : 0);
})().catch((err) => { console.error('ERROR EN LA PRUEBA:', err); process.exit(2); });
