// Entrada libre: el panel se abre a cualquiera.
//
// Lo que de verdad hay que comprobar aquí no es que la portada cargue —eso
// se ve mirándola— sino las dos cosas que podrían estar mal sin que se
// notara:
//
//   1. Que abrir la puerta de la calle no abrió ninguna otra. La pantalla
//      que se enseña sin sesión es el mismo panel de siempre, así que lo
//      único que separa a un visitante de la página de otra persona es que
//      cada endpoint siga contestando 401. Si uno se quedara abierto, la
//      pantalla se vería exactamente igual.
//
//   2. Que `?volver=` no se convirtió en un trampolín. La pantalla de
//      entrar acepta ahora a dónde ir después, y eso es un redirect abierto
//      si se usa tal cual: un enlace que sale de nuestro dominio y acaba en
//      una copia de nuestro propio formulario.
//
// Se ejecuta con `npm test`. Base de datos en el directorio temporal.
const path = require('path');
const os = require('os');
const fs = require('fs');

const DATOS = path.join(os.tmpdir(), 'arleking-prueba-invitado');
if (fs.existsSync(DATOS)) fs.rmSync(DATOS, { recursive: true, force: true });

const RAIZ = path.join(__dirname, '..');
const leer = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8');

let pasadas = 0;
let fallos = 0;
function ok(nombre, cond, extra) {
  if (cond) { pasadas++; console.log('  ok    ' + nombre); }
  else { fallos++; console.log('  FALLO ' + nombre + (extra !== undefined ? '  -> ' + JSON.stringify(extra).slice(0, 300) : '')); }
}

(async () => {
  process.env.PORT = '3994';
  process.env.DATA_DIR = DATOS;
  process.env.OWNER_USERNAMES = 'la-duena';
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;

  require('../server.js');
  const SRV = 'http://localhost:3994';
  await new Promise((r) => setTimeout(r, 1800));

  console.log('== 1. La portada es el panel, y no pide nada ==');

  const portada = await fetch(SRV + '/');
  const htmlPortada = await portada.text();
  ok('la portada responde', portada.status === 200, portada.status);
  ok('y es el panel, no el formulario de entrar',
    htmlPortada.includes('id="dash-tabs"'), htmlPortada.slice(0, 120));
  ok('con el aviso de quien entra sin cuenta', htmlPortada.includes('id="aviso-invitado"'));
  ok('y con la puerta preparada', htmlPortada.includes('id="puerta-modal"'));

  // Es la única petición que hace un invitado, y de ella depende que los
  // demás módulos se callen. Si se cerrara, el panel se quedaría a medias.
  const quienSoy = await fetch(SRV + '/api/auth/me');
  const datosQuienSoy = await quienSoy.json();
  ok('/api/auth/me contesta sin sesión', quienSoy.status === 200, quienSoy.status);
  ok('y dice que no hay nadie', datosQuienSoy.authenticated === false, datosQuienSoy);

  // saveUninitialized: false. Mirar la portada no debe crear una fila de
  // sesión por visita: con tráfico, eso es una tabla que crece sola.
  const cookies = portada.headers.getSetCookie ? portada.headers.getSetCookie() : [];
  ok('mirar la portada no abre sesión',
    !cookies.some((c) => c.startsWith('aks.sid=')), cookies);

  const entrar = await fetch(SRV + '/admin/login');
  const htmlEntrar = await entrar.text();
  ok('la pantalla de entrar sigue en su sitio',
    entrar.status === 200 && htmlEntrar.includes('id="login-form"'), entrar.status);
  ok('y tiene dónde decir por qué te mandaron',
    htmlEntrar.includes('id="motivo-entrada"'));

  console.log('\n== 2. Pero por dentro no se abrió nada ==');

  // Todo lo que el panel pide o manda. Si alguna contestara algo que no sea
  // 401 o 403, un visitante estaría leyendo o tocando la página de otra
  // persona desde la misma pantalla que ahora ve cualquiera.
  const CERRADAS = [
    ['GET', '/api/profile'],
    ['PUT', '/api/profile'],
    ['DELETE', '/api/profile/background'],
    ['GET', '/api/links'],
    ['POST', '/api/links'],
    ['PUT', '/api/links/reorder'],
    ['DELETE', '/api/links/1'],
    ['GET', '/api/analytics?range=7d'],
    ['GET', '/api/auth/sessions'],
    ['PUT', '/api/auth/password'],
    ['POST', '/api/auth/email'],
    ['GET', '/api/auth/passkeys'],
    ['POST', '/api/auth/mfa/setup'],
    ['POST', '/api/account/delete'],
    ['POST', '/api/checkout'],
    ['POST', '/api/billing-portal'],
    ['GET', '/api/encuestas'],
    ['GET', '/api/encuestas/pendiente'],
    ['GET', '/api/support/status'],
    ['POST', '/api/support/chat'],
    ['GET', '/api/support/tickets'],
  ];

  const abiertas = [];
  for (const [metodo, ruta] of CERRADAS) {
    const r = await fetch(SRV + ruta, {
      method: metodo,
      headers: { 'Content-Type': 'application/json' },
      body: metodo === 'GET' ? undefined : '{}',
    });
    if (r.status !== 401 && r.status !== 403) abiertas.push(metodo + ' ' + ruta + ' -> ' + r.status);
  }
  ok('las ' + CERRADAS.length + ' rutas del panel siguen pidiendo sesión', abiertas.length === 0, abiertas);

  // Y lo público sigue siendo público: esto no iba de cerrar nada.
  const inexistente = await fetch(SRV + '/api/public/no-existe/profile');
  ok('una página que no existe sigue siendo 404, no 401', inexistente.status === 404, inexistente.status);

  console.log('\n== 3. `volver` no es un trampolín ==');

  // Se prueba la función que de verdad se envía al navegador, no una copia:
  // se recorta del archivo y se ejecuta con un `params` de mentira. Si
  // alguien la mueve o la renombra, el recorte falla y la prueba lo dice.
  const fuenteLogin = leer('public/admin/js/login.js');
  const desde = fuenteLogin.indexOf('  const PANEL =');
  const hasta = fuenteLogin.indexOf('\n  }', fuenteLogin.indexOf('function destino()', desde)) + 4;
  const codigo = fuenteLogin.slice(desde, hasta);
  ok('se encontró la función que decide el destino',
    desde > 0 && hasta > desde && codigo.includes('function destino()'), codigo.slice(0, 80));

  const aDonde = (valor) => new Function('params', codigo + '\n    return destino();')({
    get: () => valor,
  });

  const PANEL = '/admin/dashboard';
  ok('sin volver, al panel', aDonde(null) === PANEL, aDonde(null));
  ok('una ruta de aquí se respeta', aDonde('/perfil') === '/perfil');
  ok('con ancla también', aDonde('/admin/dashboard#enlaces') === '/admin/dashboard#enlaces');
  ok('la portada a secas se respeta', aDonde('/') === '/');
  ok('otro dominio, no', aDonde('https://ejemplo-malo.test/copia') === PANEL, aDonde('https://ejemplo-malo.test/copia'));
  // El que se cuela sin pensarlo: el navegador lee //sitio como protocolo
  // relativo, así que sale del dominio aunque empiece por barra.
  ok('protocolo relativo, no', aDonde('//ejemplo-malo.test') === PANEL, aDonde('//ejemplo-malo.test'));
  ok('y con barra invertida tampoco',
    aDonde('/' + String.fromCharCode(92) + 'ejemplo-malo.test') === PANEL);
  ok('javascript: tampoco', aDonde('javascript:alert(1)') === PANEL, aDonde('javascript:alert(1)'));
  ok('ni disfrazado de ruta', aDonde('/x:javascript:alert(1)') === PANEL);
  ok('una cadena vacía, al panel', aDonde('') === PANEL);

  console.log('\n== 4. El panel sabe callarse ==');

  const admin = leer('public/admin/js/admin.js');

  // El corte está en api(), que es por donde pasan todas las peticiones del
  // panel. Si estuviera en cada botón, el que se añada mañana saldría sin
  // protección y no se vería hasta toparse con un 401 en producción.
  ok('api() corta a quien no tiene cuenta', admin.includes('window.AKSesion.invitado()'));
  ok('y sólo abre la puerta en lo que cambia algo',
    admin.includes("(opts.method || 'GET').toUpperCase() !== 'GET'"));

  // Esto es lo que se quitó: el panel echaba a la calle a quien no tuviera
  // sesión en cuanto cargaba.
  ok('el panel ya no echa a nadie al cargar', !admin.includes('checkAuth'));
  ok('ni manda a entrar sin camino de vuelta',
    !admin.includes("location.href = '/admin/login'"),
    admin.match(/location\.href = '[^']*'/g) || []);
  // La sesión que caduca con el panel abierto es el otro camino a la
  // pantalla de entrar, y ése sí tiene que volver donde estabas.
  ok('si la sesión caduca, se vuelve donde estabas',
    admin.includes("AKSesion.irAEntrar('sesion')"));
  ok('cerrar sesión deja en la vista libre', admin.includes("location.href = '/';"));

  // El arranque de invitado no pide NADA. Si pidiera algo serían 401 en la
  // consola de alguien que no ha hecho nada, y la puerta saltaría sola.
  const arranque = admin.slice(admin.indexOf('function arrancarComoInvitado()'),
    admin.indexOf('// ---- Init ----'));
  ok('se encontró el arranque de invitado', arranque.length > 200, arranque.length);
  // Sin los comentarios: ahí dentro se nombra api() a propósito, al explicar
  // por qué el resto del panel sí puede confiar en él, y eso no es una
  // llamada. Se quitan las líneas que son sólo comentario, que es donde
  // está esa prosa.
  const arranqueCodigo = arranque.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  ok('y no pide nada al servidor',
    !/\bapi\(/.test(arranqueCodigo) && !/\bfetch\(/.test(arranqueCodigo),
    arranqueCodigo.slice(0, 200));

  // Ni por el camino largo. Buscar sólo "api(" no vale: un loadProfile()
  // pide exactamente lo mismo y no se parece en nada, y entonces el panel
  // de un invitado soltaría un 401 y la puerta saltaría sola nada más
  // entrar. Estas tres son las que cargan el panel de quien sí tiene
  // cuenta; se nombran a mano porque son las tres únicas puertas de
  // entrada, y todo lo demás cuelga de un botón, que ya pasa por api().
  ok('ni por el camino largo',
    !/\bloadProfile\(|\bloadLinks\(|\bloadAccountStatus\(/.test(arranqueCodigo),
    arranqueCodigo.match(/\b(loadProfile|loadLinks|loadAccountStatus)\(/g) || []);

  // Casi todo el panel engancha sus oyentes al cargar, así que acaban en
  // api() y api() abre la puerta. Cuenta y Analíticas no: los suyos se
  // enganchan dentro de las funciones que piden el estado al servidor, que
  // sin sesión no corren. Sin la delegación, pulsar "Activar" o "30 días"
  // no hace absolutamente nada —ni puerta, ni aviso, ni error— y eso parece
  // una página rota, no una que te pide cuenta.
  ok('los botones que no se enganchan solos tienen puerta igual',
    arranque.includes("['cuenta', 'analiticas']")
    && arranque.includes("e.target.closest('button')"));

  // Y los huecos que rellenaría el servidor no se quedan en "Comprobando…"
  // para siempre, que es la otra forma de parecer roto.
  ok('la pestaña Cuenta no se queda comprobando eternamente',
    arranque.includes("'mfa-status'") && arranque.includes("'sessions-status'"));

  // Un invitado no llega ni a rellenar la ventana del enlace: pedirle
  // cuenta después de escribirlo todo es hacerle perder el trabajo.
  ok('agregar enlace pide cuenta antes de abrir la ventana',
    /add-link-btn[\s\S]{0,400}AKSesion\.invitado\(\)[\s\S]{0,200}pedirCuenta\('enlaces'\)/.test(admin));

  console.log('\n== 5. Y los demás módulos también ==');

  const sesion = leer('public/js/sesion.js');
  // Una sola petición, compartida. Si cada módulo preguntara por su cuenta
  // serían cinco /api/auth/me idénticos en cada carga del panel.
  const cuantosFetch = (sesion.match(/fetch\(/g) || []).length;
  ok('sesion.js pregunta una sola vez', cuantosFetch === 1, cuantosFetch);
  ok('y guarda la respuesta', sesion.includes('if (!promesa)'));
  ok('sin red, se comporta como invitado', /catch[\s\S]{0,120}authenticated: false/.test(sesion));

  for (const [archivo, nombre] of [
    ['public/admin/js/encuesta.js', 'las encuestas'],
    ['public/admin/js/support.js', 'el buzón de soporte'],
    ['public/js/support-widget.js', 'el asistente'],
  ]) {
    ok(nombre + ': espera a saber si hay cuenta', leer(archivo).includes('AKSesion.conCuenta('));
  }

  // El asistente se paga por mensaje: un chat abierto sin sesión es una
  // factura que escribe cualquiera.
  ok('el asistente no se pinta siquiera sin cuenta',
    leer('public/js/support-widget.js').includes('iniciarConCuenta'));

  const dashboard = leer('public/admin/dashboard.html');
  ok('sesion.js va antes que el resto del panel',
    dashboard.indexOf('/js/sesion.js') > 0
    && dashboard.indexOf('/js/sesion.js') < dashboard.indexOf('/admin/js/admin.js'));
  ok('los dos juegos de botones nacen ocultos',
    dashboard.includes('class="topbar-group hidden" id="acciones-con-cuenta"')
    && dashboard.includes('class="topbar-group hidden" id="acciones-invitado"'));

  // La portada dejó de ser la pantalla de entrar, así que las partículas no
  // pueden seguir dando por hecho que ahí no hay perfil que cargar: con los
  // valores de fábrica se encendían, y a quien las tiene apagadas no se le
  // volvían a apagar nunca.
  const particulas = leer('public/js/particles.js');
  ok('las partículas ya no dan por hecho que / no tiene perfil',
    !particulas.includes("path === '/' || path === '/admin/login'"));
  ok('pero la pantalla de entrar sigue con las de fábrica',
    particulas.includes("path === '/admin/login') return DEFAULTS"));

  console.log('\n=== ' + pasadas + ' pasadas, ' + fallos + ' fallos ===');
  process.exit(fallos ? 1 : 0);
})().catch((err) => { console.error('ERROR EN LA PRUEBA:', err); process.exit(2); });
