// El icono de un enlace: cualquier emoji, y los de Discord.
//
// Dos cosas distintas que comprobar, y la segunda es la que importa.
//
// La primera es contar. El campo admitía cuatro caracteres medidos en
// unidades UTF-16, que no es lo que nadie entiende por "cuatro caracteres":
// 👨‍👩‍👧‍👦 ocupa once y no cabía, mientras que "abcd" ocupa cuatro y sí. Aquí se
// comprueba con los emojis que de verdad rompían: familias, banderas, tonos
// de piel.
//
// La segunda es que, para traer un emoji de Discord, este servidor hace una
// petición a internet. Eso es una superficie nueva y es la que puede doler:
// si la dirección la pudiera escribir quien pega el emoji, tendríamos un
// servidor haciendo peticiones a donde le digan —la red interna, el endpoint
// de metadatos de la máquina— y devolviendo el resultado. Por eso la
// dirección se construye aquí a partir de un identificador de sólo dígitos,
// y por eso estas pruebas insisten tanto en lo que NO se trae.
//
// Se ejecuta con `npm test`. Base de datos en el directorio temporal.
const path = require('path');
const os = require('os');
const fs = require('fs');

const DATOS = path.join(os.tmpdir(), 'arleking-prueba-emoji');
if (fs.existsSync(DATOS)) fs.rmSync(DATOS, { recursive: true, force: true });

const RAIZ = path.join(__dirname, '..');
const leer = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8');

let pasadas = 0;
let fallos = 0;
function ok(nombre, cond, extra) {
  if (cond) { pasadas++; console.log('  ok    ' + nombre); }
  else { fallos++; console.log('  FALLO ' + nombre + (extra !== undefined ? '  -> ' + JSON.stringify(extra).slice(0, 300) : '')); }
}

// Un PNG de verdad de 1x1, para que lo que se comprueba sea la comprobación
// y no un montón de ceros con la cabecera pegada delante.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');
// Y un GIF, porque los emojis animados de Discord se piden como gif y la
// comprobación de bytes es por formato: devolver un PNG donde se pidió un
// gif es justo lo que tiene que fallar.
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

// Y uno que se mueve, hecho duplicando el único fotograma del de arriba: lo
// que distingue a un GIF animado es que trae más de un bloque de control
// (21 F9 04), uno por fotograma. No hace falta que se vea bonito.
const GIF_ANIMADO = (() => {
  const inicio = GIF.indexOf(0x21);            // el bloque de control del primero
  const fotograma = GIF.subarray(inicio, GIF.length - 1); // sin el 3B del final
  return Buffer.concat([GIF.subarray(0, inicio), fotograma, fotograma, Buffer.from([0x3b])]);
})();

// ---- El Discord de mentira ----
//
// Se interpone sólo en las peticiones a su CDN; todo lo demás —incluidas las
// que esta misma prueba le hace al servidor— sigue saliendo de verdad.
const fetchReal = globalThis.fetch;
let peticionesADiscord = [];
let siguienteRespuesta = null;
// Qué clase de emoji finge ser el de este servidor para las peticiones .gif:
// uno animado, uno fijo que de todos modos da un gif de un fotograma, o uno
// fijo que ni siquiera tiene versión .gif. Las tres cosas pasan de verdad
// según el emoji, y el código tiene que acabar bien en las tres.
let elGifDeDiscord = 'animado'; // 'animado' | 'fijo' | 'no-existe'

globalThis.fetch = async function (recurso, opciones) {
  const direccion = String(recurso && recurso.url ? recurso.url : recurso);
  if (!direccion.startsWith('https://cdn.discordapp.com/')) {
    return fetchReal(recurso, opciones);
  }
  peticionesADiscord.push(direccion);

  if (siguienteRespuesta) {
    return new Response(siguienteRespuesta.cuerpo, {
      status: siguienteRespuesta.estado,
      headers: { 'Content-Type': siguienteRespuesta.tipo || 'image/png' },
    });
  }

  if (direccion.endsWith('.gif')) {
    if (elGifDeDiscord === 'no-existe') {
      return new Response('nope', { status: 415, headers: { 'Content-Type': 'text/plain' } });
    }
    return new Response(elGifDeDiscord === 'animado' ? GIF_ANIMADO : GIF,
      { status: 200, headers: { 'Content-Type': 'image/gif' } });
  }
  return new Response(PNG, { status: 200, headers: { 'Content-Type': 'image/png' } });
};

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
  process.env.PORT = '3993';
  process.env.DATA_DIR = DATOS;
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;

  const { resolverIcono, referenciaDiscord, contarGrafemas, gifSeMueve, esImagen, ErrorEmoji } = require('../support/emoji');
  const { uploadsDir } = require('../paths');

  // Pide y recoge el mensaje, que es la mitad de lo que se prueba aquí: un
  // "no" sin explicación deja a quien pegó el emoji sin saber qué hacer.
  async function rechaza(valor, anterior) {
    try {
      const r = await resolverIcono(valor, { uploadsDir, anterior });
      return { rechazado: false, resultado: r };
    } catch (err) {
      return { rechazado: err instanceof ErrorEmoji, mensaje: err.message };
    }
  }

  console.log('== 1. Cuenta emojis, no unidades UTF-16 ==');

  // Los que no cabían en cuatro. Entre paréntesis, lo que medían con el
  // límite viejo.
  const COMPLEJOS = [
    ['👨‍👩‍👧‍👦', 'familia (11)'],
    ['🏳️‍🌈', 'bandera arcoíris (6)'],
    ['👍🏽', 'pulgar con tono de piel (4)'],
    ['👩‍💻', 'programadora (5)'],
    ['🧑‍🚀', 'astronauta (5)'],
    ['❤️', 'corazón (2)'],
    ['🔗', 'el de siempre (2)'],
  ];
  for (const [emoji, nombre] of COMPLEJOS) {
    ok('cuenta como uno: ' + nombre, contarGrafemas(emoji) === 1, contarGrafemas(emoji));
  }
  ok('la familia medía once con el límite viejo', '👨‍👩‍👧‍👦'.length === 11, '👨‍👩‍👧‍👦'.length);

  for (const [emoji, nombre] of COMPLEJOS) {
    ok('se guarda tal cual: ' + nombre, await resolverIcono(emoji, { uploadsDir }) === emoji);
  }

  ok('cuatro caracteres sueltos siguen valiendo', await resolverIcono('AKXP', { uploadsDir }) === 'AKXP');
  const cinco = await rechaza('ABCDE');
  ok('cinco ya no', cinco.rechazado, cinco);
  const cincoEmojis = await rechaza('🔗🔗🔗🔗🔗');
  ok('ni cinco emojis', cincoEmojis.rechazado, cincoEmojis);
  ok('vacío cae en el de siempre', await resolverIcono('   ', { uploadsDir }) === '🔗');

  console.log('\n== 2. Reconoce un emoji de Discord ==');

  const ID = '1234567890123456789';
  ok('la marca de un mensaje', referenciaDiscord(`<:deus:${ID}>`).id === ID);
  ok('y sabe que no es animada', referenciaDiscord(`<:deus:${ID}>`).extension === '.png');
  ok('la marca de uno animado', referenciaDiscord(`<a:deus:${ID}>`).extension === '.gif');
  ok('el enlace del CDN', referenciaDiscord(`https://cdn.discordapp.com/emojis/${ID}.webp`).id === ID);
  ok('con parámetros detrás',
    referenciaDiscord(`https://cdn.discordapp.com/emojis/${ID}.webp?size=96&quality=lossless`).extension === '.webp');
  ok('y el del otro dominio suyo',
    referenciaDiscord(`https://media.discordapp.net/emojis/${ID}.png`).id === ID);
  ok('sin extensión, se pide png',
    referenciaDiscord(`https://cdn.discordapp.com/emojis/${ID}`).extension === '.png');

  console.log('\n== 3. Y sobre todo: lo que NO se trae ==');

  // Esto es lo que convierte una comodidad en un agujero. La dirección no la
  // escribe quien pega: se arma aquí con un identificador de sólo dígitos.
  const NO_SON = [
    [`https://cdn.discordapp.com.ejemplo-malo.test/emojis/${ID}.png`, 'un dominio que sólo empieza igual'],
    [`https://ejemplo-malo.test/emojis/${ID}.png`, 'otro dominio cualquiera'],
    [`http://cdn.discordapp.com/emojis/${ID}.png`, 'sin cifrar'],
    ['http://169.254.169.254/latest/meta-data/', 'el endpoint de metadatos de la máquina'],
    ['http://127.0.0.1:3993/api/profile', 'nuestro propio servidor'],
    ['file:///etc/passwd', 'un archivo del disco'],
    [`https://cdn.discordapp.com/attachments/1/2/algo.png`, 'otra ruta de Discord'],
    [`https://cdn.discordapp.com/emojis/no-es-un-numero.png`, 'un identificador que no son dígitos'],
    [`https://cdn.discordapp.com/emojis/${ID}/../../otra-cosa`, 'una ruta con trampa'],
  ];
  for (const [valor, nombre] of NO_SON) {
    ok('no lo reconoce: ' + nombre, referenciaDiscord(valor) === null, referenciaDiscord(valor));
  }

  peticionesADiscord = [];
  for (const [valor, nombre] of NO_SON) {
    const r = await rechaza(valor);
    ok('y lo rechaza con mensaje: ' + nombre, r.rechazado, r);
  }
  // Lo importante del bloque: ninguna de esas nueve llegó a salir a la red.
  ok('ninguna de esas salió a internet', peticionesADiscord.length === 0, peticionesADiscord);

  const soloNombre = await rechaza(':deus:');
  ok('el atajo suelto se rechaza', soloNombre.rechazado);
  // Es el error fácil —es lo que Discord enseña debajo del emoji— así que el
  // mensaje tiene que decir qué hacer, no sólo que no.
  ok('y explica qué hacer en su lugar', /copiar enlace/i.test(soloNombre.mensaje), soloNombre.mensaje);

  const etiqueta = await rechaza('<img src=x onerror=alert(1)>');
  ok('una etiqueta HTML no es un icono', etiqueta.rechazado, etiqueta);

  console.log('\n== 4. De punta a punta ==');

  require('../server.js');
  const SRV = 'http://localhost:3993';
  await new Promise((r) => setTimeout(r, 1800));

  const yo = await registrar(SRV, 'quien-pega-emojis');
  const pedir = (url, opciones = {}) => fetch(SRV + url, {
    method: opciones.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      Cookie: yo.cookie,
      ...(opciones.method && opciones.method !== 'GET' ? { 'X-CSRF-Token': yo.csrf } : {}),
    },
    body: opciones.body ? JSON.stringify(opciones.body) : undefined,
  }).then(async (r) => ({ status: r.status, datos: await r.json().catch(() => ({})) }));

  const conFamilia = await pedir('/api/links', {
    method: 'POST',
    body: { label: 'Familia', url: 'https://ejemplo.test/', icon: '👨‍👩‍👧‍👦' },
  });
  ok('se crea un enlace con un emoji que antes no cabía', conFamilia.status === 201, conFamilia);
  ok('y llega entero, sin recortar', conFamilia.datos.icon === '👨‍👩‍👧‍👦', conFamilia.datos.icon);

  // Un emoji fijo: su versión .gif no existe, así que se cae a la extensión
  // que venía en el enlace.
  elGifDeDiscord = 'no-existe';
  peticionesADiscord = [];
  const conDiscord = await pedir('/api/links', {
    method: 'POST',
    body: { label: 'Deuses', url: 'https://ejemplo.test/d', icon: `https://cdn.discordapp.com/emojis/${ID}.png?size=96` },
  });
  ok('se crea uno con un emoji de Discord', conDiscord.status === 201, conDiscord);
  // Las direcciones que salen son las que armamos nosotros, sin los
  // parámetros con los que llegó el enlace.
  ok('se preguntó primero si se movía',
    peticionesADiscord[0] === `https://cdn.discordapp.com/emojis/${ID}.gif`, peticionesADiscord);
  ok('y al no moverse, se pidió como venía',
    peticionesADiscord[1] === `https://cdn.discordapp.com/emojis/${ID}.png`, peticionesADiscord);
  ok('dos peticiones y no más', peticionesADiscord.length === 2, peticionesADiscord);

  const guardado = conDiscord.datos.icon;
  ok('y lo que se guarda es una imagen nuestra, no el enlace de Discord',
    esImagen(guardado) && !guardado.includes('discord'), guardado);
  const enDisco = path.join(uploadsDir, path.basename(guardado));
  ok('la imagen está en el disco', fs.existsSync(enDisco));
  ok('y es el PNG que mandó Discord', fs.readFileSync(enDisco).equals(PNG));

  // La página pública la sirve igual que cualquier otra imagen nuestra, así
  // que no hace falta abrir la CSP a un dominio de fuera.
  const servida = await fetch(SRV + guardado);
  ok('se sirve desde nuestro propio dominio', servida.status === 200, servida.status);

  console.log('\n== 4b. Y si el emoji se mueve, sigue moviéndose ==');

  // Lo que fallaba: "Copiar enlace" en Discord da un .webp tanto si el
  // emoji gira como si no, y un .webp de uno animado es una foto fija. El
  // check que gira en Discord llegaba aquí quieto. Ahora, cuando el enlace
  // no dice ya .gif, se pregunta por el .gif antes de conformarse.
  ok('un gif de un fotograma no se mueve', gifSeMueve(GIF) === false);
  ok('y uno de dos, sí', gifSeMueve(GIF_ANIMADO) === true);
  ok('un PNG no es un gif que se mueva', gifSeMueve(PNG) === false);

  elGifDeDiscord = 'animado';
  peticionesADiscord = [];
  const animado = await pedir('/api/links', {
    method: 'POST',
    body: { label: 'Deuses oficial', url: 'https://ejemplo.test/a', icon: `https://cdn.discordapp.com/emojis/${ID}.webp?size=96&quality=lossless` },
  });
  ok('el enlace .webp de un emoji animado se acepta', animado.status === 201, animado);
  ok('se pidió el gif', peticionesADiscord[0] === `https://cdn.discordapp.com/emojis/${ID}.gif`, peticionesADiscord);
  ok('y con eso bastó: no se pidió el webp', peticionesADiscord.length === 1, peticionesADiscord);
  ok('se guarda como gif', animado.datos.icon.endsWith('.gif'), animado.datos.icon);
  const bytesAnimado = fs.readFileSync(path.join(uploadsDir, path.basename(animado.datos.icon)));
  ok('y lo guardado se mueve de verdad', gifSeMueve(bytesAnimado), bytesAnimado.length);

  // El caso raro: Discord da un .gif pero de un solo fotograma. Entonces no
  // aporta nada sobre el .webp original, así que se queda el original.
  elGifDeDiscord = 'fijo';
  peticionesADiscord = [];
  const gifQuieto = await pedir('/api/links', {
    method: 'POST',
    body: { label: 'Fijo', url: 'https://ejemplo.test/f', icon: `https://cdn.discordapp.com/emojis/${ID}.png` },
  });
  ok('un gif de un solo fotograma no se queda', gifQuieto.datos.icon.endsWith('.png'), gifQuieto.datos.icon);
  ok('y se pidió la versión original después', peticionesADiscord.length === 2, peticionesADiscord);

  // Y cuando Discord ya nos dice si se mueve, no se pregunta de más: la
  // marca de un mensaje trae esa información en la "a".
  elGifDeDiscord = 'animado';
  peticionesADiscord = [];
  const marcaFija = await pedir('/api/links', {
    method: 'POST',
    body: { label: 'Marca fija', url: 'https://ejemplo.test/m', icon: `<:quieto:${ID}>` },
  });
  ok('<:...> no pregunta por el gif', peticionesADiscord.length === 1, peticionesADiscord);
  ok('y se queda en png', marcaFija.datos.icon.endsWith('.png'), marcaFija.datos.icon);

  console.log('\n== 5. No se vuelve a descargar, y se limpia al cambiar ==');

  peticionesADiscord = [];
  const sinTocar = await pedir('/api/links/' + conDiscord.datos.id, {
    method: 'PUT',
    body: { label: 'Deuses', url: 'https://ejemplo.test/d', icon: guardado },
  });
  ok('guardar sin tocar el icono lo deja como estaba', sinTocar.datos.icon === guardado, sinTocar.datos.icon);
  ok('y no vuelve a pedírselo a Discord', peticionesADiscord.length === 0, peticionesADiscord);
  ok('la imagen sigue ahí', fs.existsSync(enDisco));

  const cambiado = await pedir('/api/links/' + conDiscord.datos.id, {
    method: 'PUT',
    body: { label: 'Deuses', url: 'https://ejemplo.test/d', icon: '🔥' },
  });
  ok('cambiar a un emoji normal funciona', cambiado.datos.icon === '🔥', cambiado.datos.icon);
  // Si no se borrara, cada cambio de icono dejaría un archivo que nadie mira
  // y que el análisis de seguridad acabaría cantando como huérfano.
  await new Promise((r) => setTimeout(r, 120));
  ok('y la imagen que ya no se usa se borra del disco', !fs.existsSync(enDisco));

  // Y la imagen de otra persona no se puede reclamar escribiendo su ruta.
  const otra = await registrar(SRV, 'otra-persona');
  const robado = await fetch(SRV + '/api/links', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: otra.cookie, 'X-CSRF-Token': otra.csrf },
    body: JSON.stringify({ label: 'Robo', url: 'https://ejemplo.test/r', icon: '/uploads/loquesea.png' }),
  }).then(async (r) => ({ status: r.status, datos: await r.json().catch(() => ({})) }));
  ok('una ruta de /uploads escrita a mano no se acepta',
    robado.datos.icon === '🔗', robado.datos.icon);

  console.log('\n== 6. Borrar el enlace se lleva su imagen ==');

  elGifDeDiscord = 'animado';
  peticionesADiscord = [];
  const paraBorrar = await pedir('/api/links', {
    method: 'POST',
    body: { label: 'Temporal', url: 'https://ejemplo.test/t', icon: `<a:deus:${ID}>` },
  });
  ok('la marca <a:...> también se trae', esImagen(paraBorrar.datos.icon), paraBorrar.datos);
  ok('y se pide como gif, que es lo que es',
    peticionesADiscord[0] === `https://cdn.discordapp.com/emojis/${ID}.gif`, peticionesADiscord[0]);
  ok('y se guarda con su extensión', paraBorrar.datos.icon.endsWith('.gif'), paraBorrar.datos.icon);

  const suArchivo = path.join(uploadsDir, path.basename(paraBorrar.datos.icon));
  ok('su archivo existe', fs.existsSync(suArchivo));
  ok('y es el gif animado, no otra cosa', fs.readFileSync(suArchivo).equals(GIF_ANIMADO));
  ok('que además se mueve', gifSeMueve(fs.readFileSync(suArchivo)));
  // La "a" de la marca ya decía que se movía, así que no hubo que preguntar.
  ok('y no hizo falta preguntar dos veces', peticionesADiscord.length === 1, peticionesADiscord);

  // Un PNG servido donde se pidió un gif es exactamente lo que tiene que
  // fallar: la extensión la elegimos nosotros y los bytes tienen que
  // corresponder.
  siguienteRespuesta = { estado: 200, cuerpo: PNG, tipo: 'image/gif' };
  const formatoCambiado = await rechaza(`<a:x:${ID}>`);
  ok('un formato que no corresponde se rechaza', formatoCambiado.rechazado, formatoCambiado);
  siguienteRespuesta = null;
  await pedir('/api/links/' + paraBorrar.datos.id, { method: 'DELETE' });
  await new Promise((r) => setTimeout(r, 120));
  ok('al borrar el enlace se va con él', !fs.existsSync(suArchivo));

  console.log('\n== 7. Lo que conteste Discord se comprueba igual ==');

  // Que la cabecera diga image/png no prueba nada: se miran los bytes, como
  // con cualquier archivo que suba alguien a mano.
  siguienteRespuesta = { estado: 200, cuerpo: Buffer.from('<html>no soy una imagen</html>'), tipo: 'image/png' };
  const noEsImagen = await rechaza(`<:x:${ID}>`);
  ok('lo que no es una imagen se rechaza', noEsImagen.rechazado, noEsImagen);

  siguienteRespuesta = { estado: 200, cuerpo: Buffer.alloc(600 * 1024, 0x41), tipo: 'image/png' };
  const enorme = await rechaza(`<:x:${ID}>`);
  ok('y lo que pesa demasiado para un emoji, también', enorme.rechazado, enorme);

  siguienteRespuesta = { estado: 404, cuerpo: Buffer.from('nope'), tipo: 'text/plain' };
  const noExiste = await rechaza(`<:x:${ID}>`);
  ok('un emoji que ya no existe lo dice claro',
    noExiste.rechazado && /no encuentra/i.test(noExiste.mensaje), noExiste);

  siguienteRespuesta = null;

  console.log('\n== 8. La página pública no interpreta lo que escribe nadie ==');

  // El icono va al círculo de la página pública, que lo pintaba con
  // innerHTML. Con cuatro caracteres apenas daba para nada; con trescientos
  // sería una etiqueta servida a los visitantes. Y de paso el nombre, el
  // subtítulo y los badges, que son del mismo formulario y tenían el mismo
  // problema — el panel sí los escapaba, la página pública no.
  const publico = leer('public/js/main.js');
  ok('hay una función que escribe como texto', publico.includes('node.textContent = contenido'));
  for (const campo of ['link.label', 'link.subtitle', 'link.badge_left', 'link.badge_right']) {
    const conInnerHtml = new RegExp("el\\('[a-z]+', [^)]*" + campo.replace('.', '\\.'));
    ok(campo + ' ya no va por innerHTML', !conInnerHtml.test(publico),
      (publico.match(conInnerHtml) || [])[0]);
  }
  ok('y el icono se pone con textContent', publico.includes('circulo.textContent = link.icon'));

  console.log('\n=== ' + pasadas + ' pasadas, ' + fallos + ' fallos ===');
  process.exit(fallos ? 1 : 0);
})().catch((err) => { console.error('ERROR EN LA PRUEBA:', err); process.exit(2); });
