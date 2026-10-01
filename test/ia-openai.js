// El soporte de punta a punta con OpenAI, contra un simulador de Chat
// Completions. Levanta la aplicación de verdad —sesiones, CSRF, base de
// datos, presupuesto— y sólo finge la API del proveedor, así que lo que
// comprueba es el camino que recorre un mensaje real.
//
// Se ejecuta con `npm test`. No toca nada de producción: base de datos
// aparte en el directorio temporal del sistema y ni una llamada a internet.
const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');

const DATOS = path.join(os.tmpdir(), 'arleking-prueba-ia-openai');
if (fs.existsSync(DATOS)) fs.rmSync(DATOS, { recursive: true, force: true });

let pasadas = 0;
let fallos = 0;
function ok(nombre, cond, extra) {
  if (cond) { pasadas++; console.log('  ok    ' + nombre); }
  else { fallos++; console.log('  FALLO ' + nombre + (extra !== undefined ? '  -> ' + JSON.stringify(extra).slice(0, 400) : '')); }
}

// ---------------------------------------------------------------------------
// Simulador de la API
// ---------------------------------------------------------------------------
const guiones = [];
const peticiones = [];
const BASE = { id: 'chatcmpl-x', object: 'chat.completion.chunk', created: 1, model: 'gpt-prueba' };

function trozosDe({ texto, rechazo, llamadas, motivo, uso }) {
  const t = [];
  if (texto) {
    for (const parte of texto.match(/.{1,10}/gs)) {
      t.push({ ...BASE, choices: [{ index: 0, delta: { content: parte }, finish_reason: null }] });
    }
  }
  if (rechazo) t.push({ ...BASE, choices: [{ index: 0, delta: { refusal: rechazo }, finish_reason: null }] });
  (llamadas || []).forEach((l, i) => {
    t.push({ ...BASE, choices: [{ index: 0, delta: { tool_calls: [{ index: i, id: l.id, type: 'function', function: { name: l.nombre, arguments: '' } }] }, finish_reason: null }] });
    const args = l.argumentosCrudos !== undefined ? l.argumentosCrudos : JSON.stringify(l.entrada);
    // Troceado, como llega de verdad.
    for (const parte of args.match(/.{1,8}/gs)) {
      t.push({ ...BASE, choices: [{ index: 0, delta: { tool_calls: [{ index: i, function: { arguments: parte } }] }, finish_reason: null }] });
    }
  });
  t.push({ ...BASE, choices: [{ index: 0, delta: {}, finish_reason: motivo }] });
  t.push({ ...BASE, choices: [], usage: uso || { prompt_tokens: 100, completion_tokens: 25, total_tokens: 125 } });
  return t.map((x) => 'data: ' + JSON.stringify(x) + '\n\n').join('') + 'data: [DONE]\n\n';
}

const falso = http.createServer((req, res) => {
  let cuerpo = '';
  req.on('data', (c) => { cuerpo += c; });
  req.on('end', () => {
    const json = cuerpo ? JSON.parse(cuerpo) : null;
    peticiones.push({ url: req.url, cuerpo: json });
    const guion = guiones.shift();
    if (!guion) { res.writeHead(500, { 'content-type': 'application/json' }); res.end('{"error":{"message":"sin guion"}}'); return; }
    if (guion.status) {
      res.writeHead(guion.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: guion.mensaje || 'error', type: 'invalid_request_error' } }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    if (guion.lento) { res.write(': esperando\n\n'); res.on('close', () => { guion.cerrada = true; }); return; }
    res.end(trozosDe(guion));
  });
});

// ---------------------------------------------------------------------------
async function chatEnVivo(base, sesion, cuerpo, { abortarTras } = {}) {
  const control = new AbortController();
  const r = await fetch(base + '/api/support/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: sesion.cookie, 'X-CSRF-Token': sesion.csrf },
    body: JSON.stringify(cuerpo),
    signal: control.signal,
  });
  if (!r.ok) return { status: r.status, json: await r.json().catch(() => null), eventos: [] };
  const eventos = [];
  const lector = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { value, done } = await lector.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let corte;
      while ((corte = buf.indexOf('\n\n')) !== -1) {
        const bloque = buf.slice(0, corte);
        buf = buf.slice(corte + 2);
        let tipo = 'message';
        let datos = '';
        for (const linea of bloque.split('\n')) {
          if (linea.startsWith('event: ')) tipo = linea.slice(7);
          else if (linea.startsWith('data: ')) datos += linea.slice(6);
        }
        if (!datos) continue;
        eventos.push({ tipo, datos: JSON.parse(datos) });
        if (abortarTras && eventos.length >= abortarTras) { control.abort(); return { status: 200, eventos, abortado: true }; }
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError') throw err;
  }
  return { status: r.status, eventos };
}

function tarro(res, t = {}) {
  (res.headers.getSetCookie ? res.headers.getSetCookie() : []).forEach((c) => {
    const par = c.split(';')[0];
    const i = par.indexOf('=');
    t[par.slice(0, i)] = par.slice(i + 1);
  });
  return t;
}
async function registrar(base, usuario) {
  const r = await fetch(base + '/api/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: usuario, password: 'Clave-Larga-De-Prueba-2026!' }),
  });
  const t = tarro(r);
  const g = await fetch(base + '/api/auth/me', { headers: { Cookie: Object.entries(t).map(([k, v]) => `${k}=${v}`).join('; ') } });
  tarro(g, t);
  const cookie = Object.entries(t).map(([k, v]) => `${k}=${v}`).join('; ');
  return { cookie, csrf: decodeURIComponent(t.csrf_token || '') };
}

const texto = (evs) => {
  let t = '';
  for (const e of evs) {
    if (e.tipo === 'texto') t += e.datos.delta;
    if (e.tipo === 'reinicio') t = e.datos.texto;
  }
  return t;
};

(async () => {
  await new Promise((r) => falso.listen(0, r));
  const puerto = falso.address().port;

  process.env.PORT = '3995';
  process.env.DATA_DIR = DATOS;
  // Para poder leer el estado que ve quien lleva la plataforma.
  process.env.OWNER_USERNAMES = 'ana-openai';
  // La suite mantiene muchas más conversaciones que una persona real, y el
  // tope por IP es de doce. Se sube PARA LA PRUEBA, y la sección 10
  // comprueba que el límite sigue existiendo y corta donde se le dice.
  process.env.SUPPORT_CHAT_PER_IP = '30';
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.SUPPORT_AI_PROVIDER;
  process.env.OPENAI_API_KEY = 'sk-prueba';
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${puerto}/v1`;
  process.env.OPENAI_MODEL = 'gpt-prueba';

  console.log('\n== 0. Elección de proveedor ==');
  const { detectar, crearProveedores } = require('../support/ai/proveedores');
  ok('con OPENAI_API_KEY elige openai', detectar() === 'openai', detectar());
  ok('crearProveedores monta openai', crearProveedores().nombre === 'openai');
  process.env.ANTHROPIC_API_KEY = 'sk-ant';
  delete process.env.OPENAI_API_KEY;
  ok('sin OpenAI y con Claude elige anthropic', detectar() === 'anthropic', detectar());
  process.env.OPENAI_API_KEY = 'sk-prueba';
  delete process.env.ANTHROPIC_API_KEY;
  ok('con ambas manda OpenAI', detectar() === 'openai');
  ok('SUPPORT_AI_PROVIDER manda sobre todo', crearProveedores({ principal: 'anthropic' }).nombre === 'anthropic');

  require('../server.js');
  const SRV = 'http://localhost:3995';
  await new Promise((r) => setTimeout(r, 1800));
  const ana = await registrar(SRV, 'ana-openai');
  const { db } = require('../db');

  console.log('\n== 1. Bucle completo: busca, guía y responde ==');
  guiones.push(
    { texto: 'Déjame mirarlo.', llamadas: [{ id: 'call_a', nombre: 'buscar_ayuda', entrada: { consulta: 'cancelar suscripcion' } }], motivo: 'tool_calls' },
    { llamadas: [{ id: 'call_b', nombre: 'guiar_en_pantalla', entrada: { pasos: [
      { destino: 'pestana_vip', texto: 'Ve a VIP.' },
      { destino: 'inventado', texto: 'no debe salir' },
      { destino: 'vip_gestionar', texto: 'Pulsa aquí.' },
    ] } }], motivo: 'tool_calls' },
    { texto: 'Te lo marco en pantalla.', motivo: 'stop' },
  );
  peticiones.length = 0;
  const r1 = await chatEnVivo(SRV, ana, { message: '¿Cómo cancelo mi suscripción?', tab: 'perfil', voice: true });
  ok('responde 200', r1.status === 200, r1.status);
  ok('llama a las dos herramientas', r1.eventos.filter((e) => e.tipo === 'herramienta').map((e) => e.datos.nombre).join(',') === 'buscar_ayuda,guiar_en_pantalla');
  const guia = r1.eventos.find((e) => e.tipo === 'guia');
  ok('emite la guía y descarta el destino inventado', guia && guia.datos.pasos.length === 2, guia && guia.datos.pasos);
  ok('los selectores son los del servidor', guia && guia.datos.pasos[1].selector === '#vip-manage-btn');
  ok('texto con separación entre turnos', texto(r1.eventos) === 'Déjame mirarlo.\n\nTe lo marco en pantalla.', texto(r1.eventos));
  const fin1 = r1.eventos.find((e) => e.tipo === 'fin');
  ok('termina sin degradar y con fuentes', fin1 && fin1.datos.degradado === false && fin1.datos.fuentes.length > 0);
  ok('tres peticiones a la API', peticiones.length === 3, peticiones.length);

  const p1 = peticiones[0].cuerpo;
  ok('va a /v1/chat/completions', peticiones[0].url === '/v1/chat/completions', peticiones[0].url);
  ok('modelo de OPENAI_MODEL', p1.model === 'gpt-prueba', p1.model);
  ok('pide el gasto en el streaming', p1.stream === true && p1.stream_options.include_usage === true);
  ok('con servidor propio usa max_tokens', 'max_tokens' in p1 && !('max_completion_tokens' in p1), Object.keys(p1));
  ok('no manda reasoning_effort si no se pide', !('reasoning_effort' in p1));
  ok('instrucciones fijas y contexto en dos mensajes de sistema',
    p1.messages[0].role === 'system' && p1.messages[1].role === 'system' && /ana-openai/.test(p1.messages[1].content));
  ok('el contexto trae pestaña y modo voz', /pestaña Perfil/.test(p1.messages[1].content) && /voz alta/.test(p1.messages[1].content));
  ok('cuatro herramientas en formato function', p1.tools.length === 4 && p1.tools[0].type === 'function' && p1.tools[0].function.name === 'buscar_ayuda');
  ok('la lista cerrada de destinos viaja en el esquema',
    p1.tools[1].function.parameters.properties.pasos.items.properties.destino.enum.includes('vip_gestionar'));

  const m2 = peticiones[1].cuerpo.messages;
  const asistente = m2.find((m) => m.role === 'assistant');
  ok('reenvía el turno del asistente con sus tool_calls',
    asistente && asistente.tool_calls[0].id === 'call_a' && JSON.parse(asistente.tool_calls[0].function.arguments).consulta === 'cancelar suscripcion', asistente);
  const herramienta = m2.filter((m) => m.role === 'tool');
  ok('un mensaje role:tool por resultado', herramienta.length === 1 && herramienta[0].tool_call_id === 'call_a', herramienta.length);
  ok('el resultado incluye la guía sugerida', /vip_gestionar/.test(herramienta[0].content));

  const uso = db.prepare('SELECT * FROM support_usage').get();
  ok('contabiliza el gasto', uso && uso.calls === 3 && uso.input_tokens === 300 && uso.output_tokens === 75, uso);

  console.log('\n== 2. Dos herramientas a la vez: dos mensajes role:tool ==');
  guiones.push(
    { llamadas: [
      { id: 'call_c', nombre: 'buscar_ayuda', entrada: { consulta: 'vip' } },
      { id: 'call_d', nombre: 'estado_de_mi_cuenta', entrada: {} },
    ], motivo: 'tool_calls' },
    { texto: 'Listo.', motivo: 'stop' },
  );
  peticiones.length = 0;
  await chatEnVivo(SRV, ana, { message: 'mi insignia' });
  const tools2 = peticiones[1].cuerpo.messages.filter((m) => m.role === 'tool');
  ok('llegan los dos resultados por separado', tools2.length === 2 && tools2[0].tool_call_id === 'call_c' && tools2[1].tool_call_id === 'call_d', tools2.map((t) => t.tool_call_id));
  ok('el de la cuenta trae datos reales', /ana-openai/.test(tools2[1].content), tools2[1].content.slice(0, 80));
  ok('y NO trae identificadores de Stripe', !/stripe/i.test(tools2[1].content));

  console.log('\n== 3. Argumentos que no son JSON ==');
  guiones.push(
    { llamadas: [{ id: 'call_e', nombre: 'buscar_ayuda', argumentosCrudos: 'esto no es json {{' }], motivo: 'tool_calls' },
    { texto: 'Perdona, ya está.', motivo: 'stop' },
  );
  peticiones.length = 0;
  const r3 = await chatEnVivo(SRV, ana, { message: 'algo' });
  const res3 = peticiones[1].cuerpo.messages.filter((m) => m.role === 'tool')[0];
  ok('no ejecuta la herramienta y devuelve el error', /INVALID_INPUT/.test(res3.content), res3.content.slice(0, 90));
  ok('la conversación continúa', texto(r3.eventos) === 'Perdona, ya está.', texto(r3.eventos));

  console.log('\n== 4. El modelo declina ==');
  guiones.push({ texto: 'Empiezo y', rechazo: 'No puedo ayudarte con eso.', motivo: 'stop' });
  const r4 = await chatEnVivo(SRV, ana, { message: 'algo que declina' });
  const tipos4 = r4.eventos.map((e) => e.tipo);
  ok('descarta lo parcial', tipos4.includes('reinicio'));
  ok('abre ticket', tipos4.includes('ticket'));
  ok('avisa de que lo verá una persona', /persona del equipo/.test(texto(r4.eventos)) && !/Empiezo/.test(texto(r4.eventos)), texto(r4.eventos));

  console.log('\n== 5. Cortado por el tope con una herramienta a medias ==');
  guiones.push({ llamadas: [{ id: 'call_f', nombre: 'abrir_ticket', entrada: { asunto: 'a medias', resumen: 'no debe abrirse' } }], motivo: 'length' });
  const antes5 = db.prepare('SELECT COUNT(*) AS n FROM support_tickets').get().n;
  const r5 = await chatEnVivo(SRV, ana, { message: 'pregunta larga' });
  const aMedias = db.prepare("SELECT COUNT(*) AS n FROM support_tickets WHERE subject = 'a medias'").get().n;
  ok('no ejecuta la herramienta truncada',
    aMedias === 0 && !r5.eventos.some((e) => e.tipo === 'herramienta'),
    { aMedias, tipos: r5.eventos.map((e) => e.tipo) });
  ok('aun así cierra la respuesta', r5.eventos.some((e) => e.tipo === 'fin'));
  // El turno se fue entero en la herramienta cortada, así que no dijo nada: el
  // agente lo pasa a una persona por su cuenta. Ese ticket sí es el que toca.
  const despues5 = db.prepare('SELECT COUNT(*) AS n FROM support_tickets').get().n;
  const ultimo5 = db.prepare('SELECT subject FROM support_tickets ORDER BY id DESC').get();
  ok('y como no llegó a responder, lo pasa a una persona',
    despues5 === antes5 + 1 && /sin resolver/.test(ultimo5.subject), { antes5, despues5, ultimo5 });

  console.log('\n== 6. La API rechaza el nombre del tope: se prueba el otro ==');
  guiones.push(
    { status: 400, mensaje: "Unsupported parameter: 'max_tokens'" },
    { texto: 'Con el otro campo.', motivo: 'stop' },
    { texto: 'Y la siguiente ya va bien.', motivo: 'stop' },
  );
  peticiones.length = 0;
  const topes = () => peticiones.map((p) => Object.keys(p.cuerpo).filter((k) => /tokens/.test(k)).join());
  const r6 = await chatEnVivo(SRV, ana, { message: 'hola' });
  ok('responde igualmente', texto(r6.eventos) === 'Con el otro campo.', texto(r6.eventos));
  ok('reintenta una sola vez', peticiones.length === 2, peticiones.length);
  ok('el reintento usa max_completion_tokens', topes()[1] === 'max_completion_tokens', topes());
  await chatEnVivo(SRV, ana, { message: 'otra vez' });
  ok('y se queda con ese campo', topes()[2] === 'max_completion_tokens', topes());

  console.log('\n== 6b. Un 400 que no es el campo: el cambio no se queda ==');
  guiones.push(
    { status: 400, mensaje: 'Unknown model' },
    { status: 400, mensaje: 'Unknown model' },
    { texto: 'Sigo con el campo bueno.', motivo: 'stop' },
  );
  peticiones.length = 0;
  const r6b = await chatEnVivo(SRV, ana, { message: 'como cancelo mi suscripcion' });
  const fin6b = r6b.eventos.find((e) => e.tipo === 'fin');
  ok('prueba el otro campo y, al fallar, degrada', peticiones.length === 2 && fin6b && fin6b.datos.degradado === true,
    { peticiones: topes(), degradado: fin6b && fin6b.datos.degradado });
  await chatEnVivo(SRV, ana, { message: 'otra mas' });
  ok('la siguiente vuelve al campo que sí funcionaba', topes()[2] === 'max_completion_tokens', topes());

  console.log('\n== 7. El proveedor falla antes de hablar: responde el modo local ==');
  guiones.push({ status: 500, mensaje: 'caido' }, { status: 500, mensaje: 'caido' });
  const r7 = await chatEnVivo(SRV, ana, { message: 'como cancelo mi suscripcion' });
  const fin7 = r7.eventos.find((e) => e.tipo === 'fin');
  ok('degrada sin romperse', fin7 && fin7.datos.degradado === true);
  ok('y aun así guía', r7.eventos.some((e) => e.tipo === 'guia'));

  console.log('\n== 7b. El panel del dueño dice POR QUÉ dejó de conversar ==');
  // Tener clave no es funcionar. Si la razón sólo queda en el registro del
  // servidor, quien lleva la plataforma ve un chat "que no funciona" y nada
  // que lo explique.
  const verEstado = () => fetch(SRV + '/api/support/assistant', { headers: { Cookie: ana.cookie } }).then((r) => r.json());
  const e7 = await verEstado();
  ok('registra el fallo con su motivo', e7.lastError && /500|caido/.test(e7.lastError.mensaje), e7.lastError);
  ok('y cuándo fue', Boolean(e7.lastError && Date.parse(e7.lastError.cuando)), e7.lastError);
  ok('sigue diciendo que hay clave configurada', e7.enabled === true, e7.enabled);

  guiones.push({ texto: 'Ya vuelvo a responder.', motivo: 'stop' });
  await chatEnVivo(SRV, ana, { message: 'otra vez' });
  const e7b = await verEstado();
  ok('y al volver a funcionar, lo olvida', e7b.lastError === null, e7b.lastError);

  // Algunos proveedores meten la clave en el mensaje de error: el 401 de
  // OpenAI es «Incorrect API key provided: sk-proj-****». Aunque esto sólo
  // lo vea el dueño, no se guarda un secreto que no hace falta.
  guiones.push({ status: 401, mensaje: 'Incorrect API key provided: sk-proj-AbCd1234EfGh5678. You can find your API key at…' });
  await chatEnVivo(SRV, ana, { message: 'con clave mala' });
  const e7c = await verEstado();
  ok('tapa la clave si el proveedor la devuelve',
    e7c.lastError && !/sk-proj/.test(e7c.lastError.mensaje) && /clave oculta/.test(e7c.lastError.mensaje),
    e7c.lastError);
  ok('pero deja el motivo, que es lo que sirve',
    /401|Incorrect API key/.test(e7c.lastError.mensaje), e7c.lastError);

  console.log('\n== 8. Cerrar el chat cancela la petición ==');
  const lento = { lento: true };
  guiones.push(lento);
  const r8 = await chatEnVivo(SRV, ana, { message: 'se abandona' }, { abortarTras: 1 });
  await new Promise((r) => setTimeout(r, 700));
  ok('el cliente cortó', r8.abortado === true);
  ok('el servidor canceló su petición', lento.cerrada === true);

  console.log('\n== 9. Estado que ve el dueño ==');
  const { createAssistant } = require('../support/assistant');
  const { createKb } = require('../support/kb');
  const { createStore } = require('../support/store');
  const a = createAssistant({ db, kb: createKb(db), store: createStore(db) });
  const estado = a.status();
  ok('dice qué proveedor y qué modelo', estado.provider === 'openai' && estado.model === 'gpt-prueba', estado);
  ok('y que está activo', estado.enabled === true);

  console.log('\n== 10. El tope por IP sigue cortando ==');
  // Se subió al principio para que la suite quepa. Esto comprueba que eso no
  // lo desactivó: el endpoint que cuesta dinero tiene que seguir cerrándose
  // a quien lo aporrea, y hacerlo donde dice la variable.
  let corto = 0;
  for (let i = 0; i < 45; i++) {
    const r = await fetch(SRV + '/api/support/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: ana.cookie, 'X-CSRF-Token': ana.csrf },
      body: JSON.stringify({ message: 'aporreando' }),
    });
    if (r.status === 429) { corto = i; break; }
  }
  ok('acaba devolviendo 429', corto > 0, corto);
  ok('y corta cerca del tope configurado (30)', corto <= 31, corto);

  console.log(`\n=== ${pasadas} pasadas, ${fallos} fallos ===`);
  process.exit(fallos ? 1 : 0);
})().catch((err) => { console.error('ERROR EN LA PRUEBA:', err); process.exit(2); });
