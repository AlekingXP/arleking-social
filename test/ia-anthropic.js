// El adaptador de Claude contra un simulador de la Messages API. Se ataca
// el adaptador directamente, sin levantar la aplicación: lo que se prueba
// aquí es su lado del contrato de support/ai/proveedores/index.js, que es lo
// que permite cambiar de proveedor sin tocar el resto del soporte.
//
// Se ejecuta con `npm test`. Ni una llamada a internet.
const http = require('http');

let pasadas = 0;
let fallos = 0;
function ok(nombre, cond, extra) {
  if (cond) { pasadas++; console.log('  ok    ' + nombre); }
  else { fallos++; console.log('  FALLO ' + nombre + (extra !== undefined ? '  -> ' + JSON.stringify(extra).slice(0, 400) : '')); }
}

const guiones = [];
const peticiones = [];

function sse(eventos) {
  return eventos.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
}

/** Un mensaje completo, en eventos, como los manda la API de verdad. */
function guionDe({ texto, bloques, parada, uso }) {
  const contenido = bloques || (texto ? [{ type: 'text', text: texto }] : []);
  const ev = [{
    type: 'message_start',
    message: {
      id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-de-prueba',
      content: [], stop_reason: null, stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 0 },
    },
  }];
  contenido.forEach((b, i) => {
    if (b.type === 'text') {
      ev.push({ type: 'content_block_start', index: i, content_block: { type: 'text', text: '' } });
      for (const parte of b.text.match(/.{1,8}/gs)) {
        ev.push({ type: 'content_block_delta', index: i, delta: { type: 'text_delta', text: parte } });
      }
    } else if (b.type === 'thinking') {
      ev.push({ type: 'content_block_start', index: i, content_block: { type: 'thinking', thinking: '', signature: '' } });
      ev.push({ type: 'content_block_delta', index: i, delta: { type: 'thinking_delta', thinking: b.thinking } });
      ev.push({ type: 'content_block_delta', index: i, delta: { type: 'signature_delta', signature: 'firma' } });
    } else if (b.type === 'tool_use') {
      ev.push({ type: 'content_block_start', index: i, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } });
      const json = b.crudo !== undefined ? b.crudo : JSON.stringify(b.input);
      for (const parte of json.match(/.{1,6}/gs)) {
        ev.push({ type: 'content_block_delta', index: i, delta: { type: 'input_json_delta', partial_json: parte } });
      }
    } else if (b.type === 'fallback') {
      // La forma de verdad: el bloque nombra el modelo que declinó y el que
      // sigue, no un `model` suelto.
      ev.push({
        type: 'content_block_start',
        index: i,
        content_block: {
          type: 'fallback',
          from: { model: 'claude-de-prueba' },
          to: { model: 'claude-respaldo' },
          trigger: { type: 'refusal' },
        },
      });
    }
    ev.push({ type: 'content_block_stop', index: i });
  });
  ev.push({
    type: 'message_delta',
    delta: { stop_reason: parada || 'end_turn', stop_sequence: null },
    usage: uso || { input_tokens: 100, output_tokens: 25, cache_read_input_tokens: 10 },
  });
  ev.push({ type: 'message_stop' });
  return sse(ev);
}

const falso = http.createServer((req, res) => {
  let cuerpo = '';
  req.on('data', (c) => { cuerpo += c; });
  req.on('end', () => {
    peticiones.push({ url: req.url, betas: req.headers['anthropic-beta'] || '', cuerpo: cuerpo ? JSON.parse(cuerpo) : null });
    const guion = guiones.shift();
    if (!guion) { res.writeHead(500, { 'content-type': 'application/json' }); res.end('{"type":"error","error":{"type":"api_error","message":"sin guion"}}'); return; }
    if (guion.status) {
      res.writeHead(guion.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: guion.mensaje || 'error' } }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(guionDe(guion));
  });
});

const HERRAMIENTAS = [
  { nombre: 'buscar_ayuda', descripcion: 'Busca en la ayuda', esquema: { type: 'object', properties: { consulta: { type: 'string' } }, required: ['consulta'] } },
];

async function correr(proveedor, mensajes) {
  const eventos = [];
  for await (const ev of proveedor.turno({
    sistema: 'instrucciones fijas', contexto: 'contexto de la peticion',
    mensajes, herramientas: HERRAMIENTAS, senal: undefined,
  })) eventos.push(ev);
  return eventos;
}
const soloTexto = (evs) => evs.filter((e) => e.tipo === 'texto').map((e) => e.delta).join('');
const elTurno = (evs) => evs.find((e) => e.tipo === 'turno');

(async () => {
  await new Promise((r) => falso.listen(0, r));
  const BASE = 'http://127.0.0.1:' + falso.address().port;
  const { crearProveedorAnthropic } = require('../support/ai/proveedores/anthropic');
  const nuevo = (extra = {}) => crearProveedorAnthropic({ apiKey: 'sk-de-prueba', baseURL: BASE, ...extra });

  console.log('== 1. El modelo y el esfuerzo salen de las variables nuevas ==');
  process.env.ANTHROPIC_MODEL = 'claude-de-variable';
  process.env.ANTHROPIC_EFFORT = 'high';
  process.env.SUPPORT_MODEL = 'no-deberia-usarse';
  process.env.SUPPORT_EFFORT = 'medium';
  ok('ANTHROPIC_MODEL manda sobre SUPPORT_MODEL', nuevo().describir().modelo === 'claude-de-variable', nuevo().describir());
  ok('ANTHROPIC_EFFORT manda sobre SUPPORT_EFFORT', nuevo().describir().esfuerzo === 'high');
  ok('las opciones mandan sobre las variables', nuevo({ modelo: 'a-mano' }).describir().modelo === 'a-mano');
  delete process.env.ANTHROPIC_MODEL;
  delete process.env.ANTHROPIC_EFFORT;
  ok('sin ellas sigue valiendo SUPPORT_MODEL', nuevo().describir().modelo === 'no-deberia-usarse', nuevo().describir());
  delete process.env.SUPPORT_MODEL;
  delete process.env.SUPPORT_EFFORT;
  ok('y sin nada, el de fábrica', nuevo().describir().modelo === 'claude-opus-5' && nuevo().describir().esfuerzo === 'low', nuevo().describir());

  console.log('\n== 2. La petición sigue teniendo su forma ==');
  const p = nuevo({ modelo: 'claude-de-prueba' });
  guiones.push({ texto: 'Hola, te cuento.', parada: 'end_turn' });
  peticiones.length = 0;
  const e2 = await correr(p, [{ rol: 'usuario', texto: '¿como cancelo?' }]);
  const c2 = peticiones[0].cuerpo;
  ok('el texto llega troceado y completo', soloTexto(e2) === 'Hola, te cuento.', soloTexto(e2));
  ok('pide los fallbacks del servidor', c2.fallbacks === 'default' && /server-side-fallback/.test(peticiones[0].betas), peticiones[0].betas);
  ok('pensamiento adaptativo y esfuerzo', c2.thinking.type === 'adaptive' && c2.output_config.effort === 'low', { t: c2.thinking, o: c2.output_config });
  ok('instrucciones fijas cacheadas y contexto aparte',
    c2.system[0].cache_control.type === 'ephemeral' && c2.system[1].text === 'contexto de la peticion', c2.system);
  ok('con servidor propio NO manda eager_input_streaming', !('eager_input_streaming' in c2.tools[0]), c2.tools[0]);
  ok('la herramienta va con su esquema', c2.tools[0].name === 'buscar_ayuda' && c2.tools[0].input_schema.required[0] === 'consulta');
  const t2 = elTurno(e2);
  ok('cierra con parada fin y el gasto', t2.parada === 'fin' && t2.uso.entrada === 100 && t2.uso.salida === 25 && t2.uso.cache === 10, t2.uso);

  console.log('\n== 3. Herramienta: se devuelve y se reenvía el turno entero ==');
  guiones.push({
    bloques: [
      { type: 'thinking', thinking: 'me lo pienso' },
      { type: 'text', text: 'Lo busco.' },
      { type: 'tool_use', id: 'toolu_1', name: 'buscar_ayuda', input: { consulta: 'cancelar' } },
    ],
    parada: 'tool_use',
  }, { texto: 'Ya está.', parada: 'end_turn' });
  peticiones.length = 0;
  const e3 = await correr(p, [{ rol: 'usuario', texto: 'cancelar' }]);
  const t3 = elTurno(e3);
  ok('pide la herramienta con su entrada',
    t3.parada === 'herramientas' && t3.llamadas[0].nombre === 'buscar_ayuda' && t3.llamadas[0].entrada.consulta === 'cancelar', t3.llamadas);
  ok('el crudo guarda el pensamiento', t3.crudo.contenido.some((b) => b.type === 'thinking'), t3.crudo.contenido.map((b) => b.type));

  const e3b = await correr(p, [
    { rol: 'usuario', texto: 'cancelar' },
    { rol: 'asistente', texto: t3.texto, llamadas: t3.llamadas, crudo: t3.crudo },
    { rol: 'resultados', resultados: [{ id: 'toolu_1', contenido: 'CONTENIDO DE LA AYUDA' }] },
  ]);
  const m3 = peticiones[1].cuerpo.messages;
  ok('reenvía el turno con pensamiento y tool_use',
    m3[1].role === 'assistant' && m3[1].content.some((b) => b.type === 'thinking') && m3[1].content.some((b) => b.type === 'tool_use'), m3[1].content.map((b) => b.type));
  ok('el resultado va en UN mensaje de usuario',
    m3[2].role === 'user' && m3[2].content.length === 1 && m3[2].content[0].type === 'tool_result' && m3[2].content[0].tool_use_id === 'toolu_1', m3[2]);
  ok('y la conversación sigue', soloTexto(e3b) === 'Ya está.', soloTexto(e3b));

  console.log('\n== 4. Cambio de modelo a mitad: lo del intento declinado no se ejecuta ==');
  guiones.push({
    bloques: [
      { type: 'thinking', thinking: 'del intento viejo' },
      { type: 'text', text: 'Empiezo...' },
      { type: 'tool_use', id: 'toolu_viejo', name: 'buscar_ayuda', input: { consulta: 'vieja' } },
      { type: 'fallback' },
      { type: 'text', text: 'Ahora sí: ' },
      { type: 'tool_use', id: 'toolu_nuevo', name: 'buscar_ayuda', input: { consulta: 'nueva' } },
    ],
    parada: 'tool_use',
  });
  const t4 = elTurno(await correr(p, [{ rol: 'usuario', texto: 'algo' }]));
  ok('sólo ejecuta la herramienta de después del cambio',
    t4.llamadas.length === 1 && t4.llamadas[0].id === 'toolu_nuevo', t4.llamadas.map((l) => l.id));
  ok('el texto que vale es el de después', t4.texto === 'Ahora sí: ', t4.texto);
  ok('no reenvía el pensamiento ni la herramienta del intento declinado',
    !t4.crudo.contenido.some((b) => b.type === 'thinking') && !t4.crudo.contenido.some((b) => b.id === 'toolu_viejo'),
    t4.crudo.contenido.map((b) => b.type + ':' + (b.id || '')));
  ok('conserva el texto de los dos intentos para el historial',
    t4.crudo.contenido.filter((b) => b.type === 'text').length === 2, t4.crudo.contenido.filter((b) => b.type === 'text'));
  ok('y no cuela el marcador fallback', !t4.crudo.contenido.some((b) => b.type === 'fallback'));

  console.log('\n== 5. Paradas ==');
  guiones.push({ texto: 'No puedo.', parada: 'refusal' });
  ok('rechazo', elTurno(await correr(p, [{ rol: 'usuario', texto: 'x' }])).parada === 'rechazo');
  guiones.push({ bloques: [{ type: 'tool_use', id: 'toolu_c', name: 'buscar_ayuda', input: { consulta: 'x' } }], parada: 'max_tokens' });
  const t5 = elTurno(await correr(p, [{ rol: 'usuario', texto: 'x' }]));
  ok('cortado por el tope: no ejecuta nada', t5.parada === 'limite' && t5.llamadas.length === 0, t5.parada);
  guiones.push({ texto: 'sigo', parada: 'pause_turn' });
  ok('pausa', elTurno(await correr(p, [{ rol: 'usuario', texto: 'x' }])).parada === 'pausa');

  console.log('\n== 6. Los fallbacks se apagan solos si la API los rechaza ==');
  const q = nuevo({ modelo: 'claude-de-prueba' });
  guiones.push({ status: 400, mensaje: 'unexpected parameter: fallbacks' }, { texto: 'Sin fallbacks.', parada: 'end_turn' });
  peticiones.length = 0;
  const e6 = await correr(q, [{ rol: 'usuario', texto: 'x' }]);
  ok('responde igualmente', soloTexto(e6) === 'Sin fallbacks.', soloTexto(e6));
  ok('el reintento va sin el parámetro', !('fallbacks' in peticiones[1].cuerpo), Object.keys(peticiones[1].cuerpo));
  ok('y quedan apagados', q.describir().fallbacks === false);

  console.log('\n== 7. Entrada de herramienta ilegible: repite el turno ==');
  const r = nuevo({ modelo: 'claude-de-prueba' });
  guiones.push(
    { bloques: [{ type: 'text', text: 'Mira...' }, { type: 'tool_use', id: 'toolu_x', name: 'buscar_ayuda', crudo: 'esto no es json {{' }], parada: 'tool_use' },
    { texto: 'A la segunda.', parada: 'end_turn' },
  );
  const e7 = await correr(r, [{ rol: 'usuario', texto: 'x' }]);
  ok('avisa de que descarta lo emitido', e7.some((ev) => ev.tipo === 'reinicio'), e7.map((ev) => ev.tipo));
  ok('y termina bien', elTurno(e7).texto === 'A la segunda.', elTurno(e7).texto);

  console.log(`\n=== ${pasadas} pasadas, ${fallos} fallos ===`);
  falso.close();
  process.exit(fallos ? 1 : 0);
})().catch((err) => { console.error('ERROR EN LA PRUEBA:', err); process.exit(2); });
