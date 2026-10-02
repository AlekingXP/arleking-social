// Las encuestas del panel, de punta a punta.
//
// Lo que de verdad hay que comprobar aquí no es que se guarde una fila: es
// quién puede hacer qué, y qué ve cada uno. Una encuesta mal cerrada deja a
// cualquier cuenta leyendo lo que han contestado las demás, con nombre y
// comentario, y eso no se nota mirando la pantalla.
//
// Se ejecuta con `npm test`. Base de datos en el directorio temporal.
const path = require('path');
const os = require('os');
const fs = require('fs');

const DATOS = path.join(os.tmpdir(), 'arleking-prueba-encuestas');
if (fs.existsSync(DATOS)) fs.rmSync(DATOS, { recursive: true, force: true });

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
    nombre: usuario,
    cookie: Object.entries(t).map(([k, v]) => `${k}=${v}`).join('; '),
    csrf: decodeURIComponent(t.csrf_token || ''),
  };
}

(async () => {
  process.env.PORT = '3998';
  process.env.DATA_DIR = DATOS;
  process.env.OWNER_USERNAMES = 'la-duena';
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;

  require('../server.js');
  const SRV = 'http://localhost:3998';
  await new Promise((r) => setTimeout(r, 1800));

  const pedir = (sesion, url, opciones = {}) => fetch(SRV + url, {
    method: opciones.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      Cookie: sesion.cookie,
      ...(opciones.method && opciones.method !== 'GET' ? { 'X-CSRF-Token': sesion.csrf } : {}),
    },
    body: opciones.body ? JSON.stringify(opciones.body) : undefined,
  }).then(async (r) => ({ status: r.status, datos: await r.json().catch(() => ({})) }));

  const duena = await registrar(SRV, 'la-duena');
  const ana = await registrar(SRV, 'ana');
  const luis = await registrar(SRV, 'luis');

  console.log('== 1. Sólo quien lleva la plataforma pregunta ==');
  const comoAna = await pedir(ana, '/api/encuestas', { method: 'POST', body: { pregunta: 'me cuelo' } });
  ok('una cuenta normal no puede crear', comoAna.status === 403, comoAna.status);
  ok('ni leer la lista', (await pedir(ana, '/api/encuestas')).status === 403);

  const creada = await pedir(duena, '/api/encuestas', {
    method: 'POST',
    body: { pregunta: '¿Añado un modo oscuro?', detalle: 'Cambiaría toda la paleta.' },
  });
  ok('la dueña sí', creada.status === 201, creada);
  ok('y vuelve con su identificador', typeof creada.datos.id === 'string' && creada.datos.id.length === 16, creada.datos.id);
  ok('sin respuestas todavía', creada.datos.total === 0 && creada.datos.estado === 'abierta', creada.datos);

  const vacia = await pedir(duena, '/api/encuestas', { method: 'POST', body: { pregunta: '   ' } });
  ok('una pregunta en blanco se rechaza', vacia.status === 400, vacia);

  console.log('\n== 2. Le llega a todas las cuentas ==');
  const pAna = await pedir(ana, '/api/encuestas/pendiente');
  const pLuis = await pedir(luis, '/api/encuestas/pendiente');
  ok('a ana le sale', pAna.datos.encuesta && pAna.datos.encuesta.pregunta === '¿Añado un modo oscuro?', pAna.datos);
  ok('y a luis también', pLuis.datos.encuesta && pLuis.datos.encuesta.id === creada.datos.id);
  ok('a la dueña NO le salta la suya', (await pedir(duena, '/api/encuestas/pendiente')).datos.encuesta === null);

  // Lo que ve quien responde no incluye cuántos van ni quién ha contestado:
  // saberlo cambia lo que la gente vota.
  const vista = pAna.datos.encuesta;
  ok('quien responde no ve recuentos ni votos ajenos',
    !('recuento' in vista) && !('total' in vista) && !('respuestas' in vista),
    Object.keys(vista));

  console.log('\n== 3. Responder ==');
  const r1 = await pedir(ana, `/api/encuestas/${creada.datos.id}/responder`, {
    method: 'POST', body: { respuesta: 'si', comentario: 'Sí por favor, me quemo los ojos' },
  });
  ok('ana responde', r1.status === 200 && r1.datos.ok === true, r1);
  ok('y ya no le queda ninguna', r1.datos.siguiente === null, r1.datos.siguiente);
  ok('deja de salirle al preguntar', (await pedir(ana, '/api/encuestas/pendiente')).datos.encuesta === null);

  const repite = await pedir(ana, `/api/encuestas/${creada.datos.id}/responder`, { method: 'POST', body: { respuesta: 'no' } });
  ok('no puede responder dos veces', repite.status === 400 && /ya respondiste/i.test(repite.datos.error), repite.datos);

  const invalida = await pedir(luis, `/api/encuestas/${creada.datos.id}/responder`, { method: 'POST', body: { respuesta: 'quizá' } });
  ok('una opción inventada se rechaza', invalida.status === 400, invalida);

  await pedir(luis, `/api/encuestas/${creada.datos.id}/responder`, { method: 'POST', body: { respuesta: 'no' } });

  console.log('\n== 4. Los resultados vuelven al panel de la dueña ==');
  const lista = await pedir(duena, '/api/encuestas');
  const e = lista.datos.encuestas[0];
  ok('cuenta los dos votos', e.recuento.si === 1 && e.recuento.no === 1 && e.total === 2, e.recuento);
  ok('y sabe cuántos dejaron comentario', e.comentarios === 1, e.comentarios);

  const detalle = await pedir(duena, `/api/encuestas/${creada.datos.id}`);
  const deAna = detalle.datos.respuestas.find((x) => x.usuario === 'ana');
  ok('llega el comentario entero', deAna && /me quemo los ojos/.test(deAna.comentario), deAna);
  ok('con quién lo dijo y qué votó', deAna.respuesta === 'si', deAna);
  ok('y la de luis, sin comentario', detalle.datos.respuestas.some((x) => x.usuario === 'luis' && x.comentario === null));

  console.log('\n== 5. Nadie más lee las respuestas ==');
  ok('ana no puede leer el detalle', (await pedir(ana, `/api/encuestas/${creada.datos.id}`)).status === 403);
  const anon = await fetch(SRV + `/api/encuestas/${creada.datos.id}`);
  ok('y sin sesión tampoco', anon.status === 401 || anon.status === 403, anon.status);
  const anonPendiente = await fetch(SRV + '/api/encuestas/pendiente');
  ok('la pendiente también pide sesión', anonPendiente.status === 401, anonPendiente.status);

  console.log('\n== 6. Cerrar y reabrir ==');
  const cerrada = await pedir(duena, `/api/encuestas/${creada.datos.id}/cerrar`, { method: 'POST' });
  ok('se cierra', cerrada.datos.estado === 'cerrada', cerrada.datos);

  const tercero = await registrar(SRV, 'marta');
  ok('a quien llega nuevo ya no le sale', (await pedir(tercero, '/api/encuestas/pendiente')).datos.encuesta === null);
  const tarde = await pedir(tercero, `/api/encuestas/${creada.datos.id}/responder`, { method: 'POST', body: { respuesta: 'si' } });
  ok('y responderla fuera de plazo se rechaza', tarde.status === 400 && /cerrada/i.test(tarde.datos.error), tarde.datos);

  await pedir(duena, `/api/encuestas/${creada.datos.id}/reabrir`, { method: 'POST' });
  ok('reabierta, a marta le sale', (await pedir(tercero, '/api/encuestas/pendiente')).datos.encuesta !== null);

  console.log('\n== 7. Varias encuestas, una detrás de otra ==');
  const dos = await pedir(duena, '/api/encuestas', { method: 'POST', body: { pregunta: '¿Y una app de móvil?' } });
  // Marta tiene dos pendientes: debe salirle primero la más antigua.
  const primera = await pedir(tercero, '/api/encuestas/pendiente');
  ok('sale primero la más antigua', primera.datos.encuesta.id === creada.datos.id, primera.datos.encuesta.pregunta);
  const tras = await pedir(tercero, `/api/encuestas/${creada.datos.id}/responder`, { method: 'POST', body: { respuesta: 'si' } });
  ok('y al responderla, la siguiente viene en la misma respuesta',
    tras.datos.siguiente && tras.datos.siguiente.id === dos.datos.id, tras.datos.siguiente);

  console.log('\n== 8. Borrar se lleva las respuestas ==');
  ok('borra', (await pedir(duena, `/api/encuestas/${creada.datos.id}`, { method: 'DELETE' })).status === 200);
  ok('y desaparece de la lista',
    !(await pedir(duena, '/api/encuestas')).datos.encuestas.some((x) => x.id === creada.datos.id));
  const huerfanas = (await pedir(duena, '/api/encuestas')).datos.encuestas.length;
  ok('queda sólo la otra', huerfanas === 1, huerfanas);
  ok('una cuenta normal no puede borrar',
    (await pedir(ana, `/api/encuestas/${dos.datos.id}`, { method: 'DELETE' })).status === 403);

  console.log('\n== 9. Topes de texto ==');
  const larga = await pedir(duena, '/api/encuestas', { method: 'POST', body: { pregunta: 'x'.repeat(500) } });
  ok('la pregunta se recorta a 300', larga.datos.pregunta.length === 300, larga.datos.pregunta.length);
  const conChorro = await pedir(ana, `/api/encuestas/${dos.datos.id}/responder`, {
    method: 'POST', body: { respuesta: 'si', comentario: 'y'.repeat(3000) },
  });
  ok('el comentario se recorta a 1000', conChorro.status === 200);
  const det2 = await pedir(duena, `/api/encuestas/${dos.datos.id}`);
  ok('y se guarda recortado', det2.datos.respuestas[0].comentario.length === 1000, det2.datos.respuestas[0].comentario.length);

  console.log(`\n=== ${pasadas} pasadas, ${fallos} fallos ===`);
  process.exit(fallos ? 1 : 0);
})().catch((err) => { console.error('ERROR EN LA PRUEBA:', err); process.exit(2); });
