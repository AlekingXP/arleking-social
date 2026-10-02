// El envío de correo, contra un servidor SMTP de mentira que habla el
// protocolo de verdad y se queda con el mensaje.
//
// Existe por el salto de nodemailer 9 a 10, que es un cambio mayor: que el
// paquete instale no prueba que siga enviando. Aquí se recorre el camino
// entero —EHLO, AUTH, MAIL FROM, RCPT TO, DATA— y se comprueba lo que
// llega al otro lado, que es lo único que le importa a quien espera un
// enlace de recuperación en su bandeja.
//
// Se ejecuta con `npm test`. Ni una conexión a internet.
const net = require('net');
const http = require('http');

let pasadas = 0;
let fallos = 0;
function ok(nombre, cond, extra) {
  if (cond) { pasadas++; console.log('  ok    ' + nombre); }
  else { fallos++; console.log('  FALLO ' + nombre + (extra !== undefined ? '  -> ' + JSON.stringify(extra).slice(0, 300) : '')); }
}

/** Servidor SMTP mínimo: responde lo justo y guarda lo que recibe. */
function servidorSmtp() {
  const recibidos = [];
  const servidor = net.createServer((sock) => {
    let enDatos = false;
    let mensaje = '';
    const sesion = { de: null, para: [], cuerpo: '', autenticado: false };
    let resto = '';

    sock.write('220 localhost ESMTP de mentira\r\n');

    sock.on('data', (trozo) => {
      resto += trozo.toString('utf8');
      let corte;
      while ((corte = resto.indexOf('\r\n')) !== -1) {
        const linea = resto.slice(0, corte);
        resto = resto.slice(corte + 2);

        if (enDatos) {
          if (linea === '.') {
            enDatos = false;
            sesion.cuerpo = mensaje;
            recibidos.push({ ...sesion, para: [...sesion.para] });
            mensaje = '';
            sock.write('250 2.0.0 Aceptado\r\n');
          } else {
            // Un punto al principio va escapado por el protocolo.
            mensaje += (linea.startsWith('..') ? linea.slice(1) : linea) + '\n';
          }
          continue;
        }

        const orden = linea.split(' ')[0].toUpperCase();
        if (orden === 'EHLO' || orden === 'HELO') {
          sock.write('250-localhost\r\n250-AUTH PLAIN LOGIN\r\n250-8BITMIME\r\n250 SMTPUTF8\r\n');
        } else if (orden === 'AUTH') {
          if (/AUTH\s+LOGIN/i.test(linea)) {
            sock.write('334 VXNlcm5hbWU6\r\n'); // "Username:"
            sesion.esperandoLogin = 'usuario';
          } else {
            sesion.autenticado = true;
            sock.write('235 2.7.0 Adelante\r\n');
          }
        } else if (sesion.esperandoLogin === 'usuario') {
          sesion.usuario = Buffer.from(linea, 'base64').toString('utf8');
          sesion.esperandoLogin = 'clave';
          sock.write('334 UGFzc3dvcmQ6\r\n'); // "Password:"
        } else if (sesion.esperandoLogin === 'clave') {
          sesion.esperandoLogin = null;
          sesion.autenticado = true;
          sock.write('235 2.7.0 Adelante\r\n');
        } else if (orden === 'MAIL') {
          sesion.de = (linea.match(/<([^>]*)>/) || [])[1] || null;
          sock.write('250 2.1.0 OK\r\n');
        } else if (orden === 'RCPT') {
          sesion.para.push((linea.match(/<([^>]*)>/) || [])[1] || null);
          sock.write('250 2.1.5 OK\r\n');
        } else if (orden === 'DATA') {
          enDatos = true;
          sock.write('354 Manda el mensaje y termina con un punto\r\n');
        } else if (orden === 'QUIT') {
          sock.write('221 2.0.0 Adios\r\n');
          sock.end();
        } else if (orden === 'RSET') {
          sock.write('250 2.0.0 OK\r\n');
        } else {
          sock.write('250 2.0.0 OK\r\n');
        }
      }
    });
    sock.on('error', () => {});
  });
  return { servidor, recibidos };
}

/** Quoted-Printable a texto. Junta los bytes y LUEGO los lee como UTF-8:
 *  hacerlo carácter a carácter parte las letras acentuadas en dos. */
function deQP(texto) {
  const sinPliegues = texto.replace(/=\r?\n/g, '');
  const bytes = [];
  for (let i = 0; i < sinPliegues.length; i++) {
    const hex = sinPliegues.slice(i + 1, i + 3);
    if (sinPliegues[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(hex)) {
      bytes.push(parseInt(hex, 16));
      i += 2;
    } else {
      bytes.push(sinPliegues.charCodeAt(i) & 0xff);
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

/** Las cabeceras con acentos viajan como "palabras codificadas" (RFC 2047),
 *  que es lo correcto; para leerlas hay que deshacerlas. */
function cabecerasDe(mensaje) {
  const corte = mensaje.indexOf('\n\n');
  const crudas = (corte === -1 ? mensaje : mensaje.slice(0, corte))
    .replace(/\n[ \t]+/g, ' '); // una cabecera partida en dos líneas
  return crudas.replace(/=\?UTF-8\?([QB])\?([^?]*)\?=/gi, (_, cod, texto) =>
    cod.toUpperCase() === 'B'
      ? Buffer.from(texto, 'base64').toString('utf8')
      : deQP(texto.replace(/_/g, ' ')));
}

/** Cierra y deja que el proceso termine solo.
 *
 * NO se llama a `process.exit`. Matar el proceso con sockets del SDK todavia
 * abiertos en keep-alive revienta en Windows con 0xC0000409 una de cada
 * cuatro veces, DESPUES de imprimir el resumen: las pruebas pasan y el
 * proceso devuelve basura, que es como una integracion continua se pone roja
 * sin motivo. Cerrando los servidores y soltando el bucle, Node sale cuando
 * no le queda nada vivo, que es lo que de verdad significa "termino bien".
 *
 * La red de seguridad es un temporizador sin ref: si algo se quedara colgado
 * no fija la prueba para siempre, y como no retiene el bucle, no retrasa la
 * salida cuando todo va bien.
 */
function terminar(fallos, ...servidores) {
  servidores.filter(Boolean).forEach((s) => {
    if (s.closeAllConnections) s.closeAllConnections();
    s.close();
  });
  process.exitCode = fallos ? 1 : 0;
  setTimeout(() => process.exit(fallos ? 1 : 0), 15000).unref();
}

(async () => {
  const { servidor, recibidos } = servidorSmtp();
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  const puertoSmtp = servidor.address().port;

  // Receptor HTTP, para el camino que NO usa nodemailer.
  const porHttp = [];
  const http_ = http.createServer((req, res) => {
    let cuerpo = '';
    req.on('data', (c) => { cuerpo += c; });
    req.on('end', () => {
      porHttp.push({ url: req.url, auth: req.headers.authorization, cuerpo: JSON.parse(cuerpo || '{}') });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"id":"abc"}');
    });
  });
  await new Promise((r) => http_.listen(0, '127.0.0.1', r));
  const puertoHttp = http_.address().port;

  // Las variables se leen al cargar el módulo, así que van antes del require.
  process.env.MAIL_FROM = 'ArleKing Social <no-reply@arleking-social.net>';
  process.env.MAIL_REPLY_TO = 'hola@arleking-social.net';
  process.env.SMTP_HOST = '127.0.0.1';
  process.env.SMTP_PORT = String(puertoSmtp);
  process.env.SMTP_USER = 'usuario-de-prueba';
  process.env.SMTP_PASS = 'clave-de-prueba';
  delete process.env.RESEND_API_KEY;
  delete process.env.POSTMARK_API_TOKEN;
  delete process.env.BREVO_API_KEY;

  const { createMailer, detectProvider, parseAddress } = require('../security/auth/mailer');

  console.log('== 1. Se elige el proveedor por las variables que hay ==');
  ok('con sólo SMTP, elige smtp', detectProvider() === 'smtp', detectProvider());
  process.env.RESEND_API_KEY = 'clave-resend';
  ok('Resend manda sobre SMTP', detectProvider() === 'resend', detectProvider());
  delete process.env.RESEND_API_KEY;
  ok('y vuelve a smtp al quitarla', detectProvider() === 'smtp');

  console.log('\n== 2. Envío por SMTP de verdad (nodemailer) ==');
  const correo = createMailer();
  ok('el correo está activado', correo.enabled() === true);
  await correo.send({
    to: 'destino@ejemplo.com',
    subject: 'Recupera tu contraseña',
    html: '<p>Pulsa <a href="https://arleking-social.net/x">aquí</a> para entrar.</p>',
    text: 'Pulsa https://arleking-social.net/x para entrar.',
  });
  ok('el servidor recibió un mensaje', recibidos.length === 1, recibidos.length);

  const m = recibidos[0];
  const cuerpo = deQP(m.cuerpo);
  const cab = cabecerasDe(m.cuerpo);
  ok('autenticó antes de enviar', m.autenticado === true);
  ok('el sobre sale de MAIL_FROM', m.de === 'no-reply@arleking-social.net', m.de);
  ok('y va al destinatario pedido', m.para.length === 1 && m.para[0] === 'destino@ejemplo.com', m.para);
  ok('la cabecera From lleva el nombre', /From: ArleKing Social <no-reply@arleking-social\.net>/.test(cab), cab.slice(0, 200));
  // El acento viaja codificado, que es lo correcto; lo que importa es que se
  // pueda volver a leer al otro lado.
  ok('el asunto llega con su acento intacto', /Subject: Recupera tu contraseña/.test(cab), (cab.match(/Subject: .*/) || [])[0]);
  ok('respeta MAIL_REPLY_TO', /Reply-To: .*hola@arleking-social\.net/.test(cab), (cab.match(/Reply-To: .*/) || [])[0]);
  ok('lleva versión en texto y en HTML', /multipart\/alternative/.test(cab) && /text\/plain/.test(cuerpo) && /text\/html/.test(cuerpo));
  ok('el enlace llega sin romperse', /arleking-social\.net\/x/.test(cuerpo));

  console.log('\n== 3. Dos envíos reutilizan la misma conexión configurada ==');
  await correo.send({ to: 'otro@ejemplo.com', subject: 'Segundo', html: '<p>b</p>', text: 'b' });
  ok('llega el segundo', recibidos.length === 2, recibidos.length);
  ok('con su propio destinatario', recibidos[1].para[0] === 'otro@ejemplo.com', recibidos[1].para);

  console.log('\n== 4. Lo que no debe salir ==');
  let fallo = null;
  try { await correo.send({ to: 'esto-no-es-un-correo', subject: 'x', html: 'x', text: 'x' }); }
  catch (err) { fallo = err.message; }
  ok('una dirección inválida se rechaza antes de conectar', /inválida/i.test(fallo || ''), fallo);
  ok('y no llegó nada al servidor', recibidos.length === 2, recibidos.length);

  // Sin NINGUNA variable de correo: el módulo se recarga porque las lee al
  // cargarse. (Pasar provider: null no vale, porque cae en la autodetección
  // y las de SMTP siguen puestas.)
  const guardadas = { ...process.env };
  ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'RESEND_API_KEY', 'POSTMARK_API_TOKEN', 'BREVO_API_KEY']
    .forEach((v) => delete process.env[v]);
  delete require.cache[require.resolve('../security/auth/mailer')];
  const sinNada = require('../security/auth/mailer');
  ok('sin ninguna variable no hay proveedor', sinNada.detectProvider() === null, sinNada.detectProvider());
  const sinProveedor = sinNada.createMailer();
  ok('y enabled() es false', sinProveedor.enabled() === false);
  let fallo2 = null;
  try { await sinProveedor.send({ to: 'a@b.com', subject: 'x', html: 'x', text: 'x' }); }
  catch (err) { fallo2 = err.message; }
  ok('enviar lanza en vez de callar', /No hay proveedor/.test(fallo2 || ''), fallo2);
  Object.assign(process.env, guardadas);

  console.log('\n== 5. El camino sin nodemailer sigue igual (Resend por HTTP) ==');
  process.env.RESEND_API_KEY = 'clave-resend';
  process.env.RESEND_API_URL = `http://127.0.0.1:${puertoHttp}/emails`;
  delete require.cache[require.resolve('../security/auth/mailer')];
  const mailer2 = require('../security/auth/mailer');
  await mailer2.createMailer().send({ to: 'x@ejemplo.com', subject: 'Por HTTP', html: '<p>h</p>', text: 'h' });
  ok('hace el POST', porHttp.length === 1 && porHttp[0].url === '/emails', porHttp);
  ok('con la clave en la cabecera', porHttp[0].auth === 'Bearer clave-resend', porHttp[0].auth);
  ok('y el cuerpo que toca', porHttp[0].cuerpo.to[0] === 'x@ejemplo.com' && porHttp[0].cuerpo.subject === 'Por HTTP', porHttp[0].cuerpo);

  console.log('\n== 6. Partir "Nombre <correo>" ==');
  ok('con nombre', parseAddress('Ale King <ale@x.com>').email === 'ale@x.com' && parseAddress('Ale King <ale@x.com>').name === 'Ale King');
  ok('sin nombre', parseAddress('  ale@x.com ').email === 'ale@x.com');

  console.log(`\n=== ${pasadas} pasadas, ${fallos} fallos ===`);
  terminar(fallos, servidor, http_);
})().catch((err) => { console.error('ERROR EN LA PRUEBA:', err); process.exit(2); });
