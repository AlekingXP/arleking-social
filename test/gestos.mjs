// La línea de tiempo del personaje y sus coreografías.
//
// Es código de navegador, pero no toca el navegador: son matemáticas y una
// tabla de datos, así que se pueden ejecutar aquí. Lo que se comprueba no es
// que "se vea bonito" —eso se mira con los ojos— sino las dos cosas que, si
// fallan, dejan al personaje roto y nadie se entera:
//
//   · que todo gesto TERMINE, y
//   · que termine EN EL REPOSO.
//
// Una coreografía que acaba con el ladeo a 0,2 deja al personaje torcido
// para el resto de la sesión, y eso no sale en ninguna captura.
//
// Se ejecuta con `npm test`.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// En el navegador estos dos archivos se cargan como módulos y no hay nada que
// hacer. Node, en cambio, lee cualquier `.js` de este proyecto como CommonJS
// —no es un paquete de módulos— y se niega a importarlos. Así que se copian
// con extensión .mjs, que es lo único que cambia: el contenido es el mismo
// archivo que se publica, no una versión para pruebas.
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const ORIGEN = path.join(AQUI, '..', 'public', 'js', 'asistente');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-gestos-'));
for (const archivo of ['anim.js', 'gestos.js']) {
  const texto = fs.readFileSync(path.join(ORIGEN, archivo), 'utf8')
    .replace("from './anim.js'", "from './anim.mjs'");
  fs.writeFileSync(path.join(TMP, archivo.replace(/\.js$/, '.mjs')), texto);
}
process.on('exit', () => fs.rmSync(TMP, { recursive: true, force: true }));

const { Ease, Linea, Muelle, acotar } = await import(pathToFileURL(path.join(TMP, 'anim.mjs')).href);
const { GESTOS, SIN_GIRO_EN_CALMA, FUERZA_EN_CALMA } = await import(pathToFileURL(path.join(TMP, 'gestos.mjs')).href);

let pasadas = 0;
let fallos = 0;
function ok(nombre, cond, extra) {
  if (cond) { pasadas++; console.log('  ok    ' + nombre); }
  else { fallos++; console.log('  FALLO ' + nombre + (extra !== undefined ? '  -> ' + JSON.stringify(extra).slice(0, 300) : '')); }
}

// Dónde queda cada propiedad cuando no pasa nada.
const REPOSO = { oy: 0, ox: 0, tilt: 0, giro: 0, sx: 1, sy: 1 };
const esEscala = (p) => p === 'sx' || p === 'sy';

/** Reproduce un gesto a 60 fps y devuelve el recorrido de cada propiedad. */
function reproducir(receta, { fuerza = 1, sinGiro = false } = {}) {
  const linea = new Linea();
  Object.keys(REPOSO).forEach((p) => linea.fijar(p, REPOSO[p]));

  Object.keys(receta).forEach((prop) => {
    if (sinGiro && prop === 'giro') return;
    const reposo = esEscala(prop) ? 1 : 0;
    linea.a(prop, receta[prop].map(([v, ms, e]) => [reposo + (v - reposo) * fuerza, ms, e]));
  });

  const recorrido = {};
  Object.keys(receta).forEach((p) => { recorrido[p] = []; });
  let fotogramas = 0;
  while (linea.activa() && fotogramas < 600) { // 10 s de tope
    Object.keys(recorrido).forEach((p) => recorrido[p].push(linea.v(p)));
    linea.paso(1 / 60);
    fotogramas++;
  }
  Object.keys(recorrido).forEach((p) => recorrido[p].push(linea.v(p)));
  return { recorrido, fotogramas, linea, termino: !linea.activa() };
}

console.log('== 1. Las curvas ==');
ok('todas empiezan en 0 y acaban en 1',
  Object.keys(Ease).every((k) => Math.abs(Ease[k](0)) < 1e-9 && Math.abs(Ease[k](1) - 1) < 1e-9),
  Object.keys(Ease).map((k) => [k, +Ease[k](0).toFixed(6), +Ease[k](1).toFixed(6)]));
ok('"rebote" se pasa de largo y por eso parece vivo',
  Math.max(...Array.from({ length: 101 }, (_, i) => Ease.rebote(i / 100))) > 1.05,
  Math.max(...Array.from({ length: 101 }, (_, i) => Ease.rebote(i / 100))).toFixed(3));
ok('"fuera" frena al final (avanza más al principio)',
  Ease.fuera(0.25) > 0.5 && Ease.fuera(0.75) > 0.9);
ok('acotar respeta los extremos', acotar(5, 0, 1) === 1 && acotar(-5, 0, 1) === 0 && acotar(0.4, 0, 1) === 0.4);

console.log('\n== 2. El muelle no se dispara con un fotograma largo ==');
// Una pestaña que vuelve del fondo entrega un salto de tiempo enorme. Si el
// muelle se integrara de una vez, el personaje pegaría un bote.
const corto = new Muelle(0, 0.4, 0.7); corto.objetivo = 1;
for (let i = 0; i < 25; i++) corto.paso(1 / 60);
const largo = new Muelle(0, 0.4, 0.7); largo.objetivo = 1;
largo.paso(0.5);
ok('con dt enorme sigue acotado', Math.abs(largo.valor) < 2 && Number.isFinite(largo.valor), largo.valor);
ok('y acaba donde debe', Math.abs(corto.valor - 1) < 0.05, corto.valor);

console.log('\n== 3. Cada gesto termina y vuelve al reposo ==');
const nombres = Object.keys(GESTOS);
ok('hay gestos definidos', nombres.length >= 6, nombres);

for (const nombre of nombres) {
  const { recorrido, fotogramas, linea, termino } = reproducir(GESTOS[nombre]);
  ok(`${nombre}: termina`, termino, { fotogramas });

  const desviados = Object.keys(recorrido).filter((p) => Math.abs(linea.v(p) - REPOSO[p]) > 1e-6);
  ok(`${nombre}: acaba en reposo`, desviados.length === 0,
    desviados.map((p) => [p, +linea.v(p).toFixed(4), 'debería ser', REPOSO[p]]));

  // Nada de valores absurdos: una escala negativa da la vuelta a la malla y
  // un desplazamiento grande la saca del lienzo.
  const fuera = Object.keys(recorrido).filter((p) => {
    const max = Math.max(...recorrido[p].map(Math.abs));
    if (esEscala(p)) return Math.min(...recorrido[p]) <= 0.2 || max > 2;
    if (p === 'giro') return max > Math.PI * 4 + 0.01;
    return max > 0.6;
  });
  ok(`${nombre}: se mantiene dentro de lo razonable`, fuera.length === 0,
    fuera.map((p) => [p, +Math.max(...recorrido[p].map(Math.abs)).toFixed(3)]));

  // Un gesto que no se mueve no es un gesto.
  const movio = Object.keys(recorrido).some((p) => {
    const vs = recorrido[p];
    return Math.max(...vs) - Math.min(...vs) > 0.01;
  });
  ok(`${nombre}: se mueve de verdad`, movio);
}

console.log('\n== 4. Con "menos movimiento" se baja, no se apaga ==');
for (const nombre of nombres) {
  const sinGiro = SIN_GIRO_EN_CALMA.includes(nombre);
  const normal = reproducir(GESTOS[nombre]);
  const calmo = reproducir(GESTOS[nombre], { fuerza: FUERZA_EN_CALMA, sinGiro });

  const amplitud = (r) => Object.keys(r.recorrido)
    .filter((p) => p !== 'giro')
    .reduce((s, p) => s + (Math.max(...r.recorrido[p]) - Math.min(...r.recorrido[p])), 0);

  const a = amplitud(normal);
  const b = amplitud(calmo);
  if (a > 0.01) {
    ok(`${nombre}: en calma se nota menos`, b < a * 0.6, { normal: +a.toFixed(3), calmo: +b.toFixed(3) });
    ok(`${nombre}: pero sigue habiendo gesto`, b > 0, +b.toFixed(4));
  }
  const desviados = Object.keys(calmo.recorrido).filter((p) => Math.abs(calmo.linea.v(p) - REPOSO[p]) > 1e-6);
  ok(`${nombre}: en calma también acaba en reposo`, desviados.length === 0, desviados);
}

console.log('\n== 5. Las vueltas sobre sí mismo sí se quitan en calma ==');
for (const nombre of SIN_GIRO_EN_CALMA) {
  ok(`${nombre} tiene giro que quitar`, Boolean(GESTOS[nombre] && GESTOS[nombre].giro), nombre);
  const calmo = reproducir(GESTOS[nombre], { fuerza: FUERZA_EN_CALMA, sinGiro: true });
  ok(`${nombre}: en calma no da vueltas`, Math.abs(calmo.linea.v('giro')) < 1e-9, calmo.linea.v('giro'));
}

console.log('\n== 6. Un gesto nuevo interrumpe al anterior ==');
const l = new Linea();
l.fijar('oy', 0);
l.a('oy', [[-0.5, 1000, Ease.lineal]]);
for (let i = 0; i < 30; i++) l.paso(1 / 60); // medio camino
const mitad = l.v('oy');
l.a('oy', [[0, 200, Ease.fuera]]);
ok('la nueva arranca desde donde estaba, no desde cero', Math.abs(l.v('oy') - mitad) < 1e-6, { mitad, ahora: l.v('oy') });
for (let i = 0; i < 20; i++) l.paso(1 / 60);
ok('y llega a su destino', Math.abs(l.v('oy')) < 1e-6, l.v('oy'));

console.log('\n== 7. Repetir un gesto se ve igual la segunda vez ==');
// El fallo que destapó esta prueba: `saludo` acababa con el giro en 2π. Una
// vuelta entera se ve igual que ninguna, así que por pantalla no se notaba —
// pero el siguiente saludo arrancaba DESDE 2π hacia 2π y no giraba. El
// personaje habría dado la vuelta una sola vez por sesión.
for (const nombre of nombres) {
  const linea = new Linea();
  Object.keys(REPOSO).forEach((p) => linea.fijar(p, REPOSO[p]));

  const correr = () => {
    const receta = GESTOS[nombre];
    Object.keys(receta).forEach((prop) => linea.a(prop, receta[prop]));
    const amplitudes = {};
    Object.keys(receta).forEach((p) => { amplitudes[p] = { min: Infinity, max: -Infinity }; });
    let f = 0;
    while (linea.activa() && f < 600) {
      Object.keys(amplitudes).forEach((p) => {
        const v = linea.v(p);
        amplitudes[p].min = Math.min(amplitudes[p].min, v);
        amplitudes[p].max = Math.max(amplitudes[p].max, v);
      });
      linea.paso(1 / 60);
      f++;
    }
    return Object.keys(amplitudes)
      .map((p) => +(amplitudes[p].max - amplitudes[p].min).toFixed(4));
  };

  const primera = correr();
  const segunda = correr();
  ok(`${nombre}: la segunda vez se mueve lo mismo`,
    JSON.stringify(primera) === JSON.stringify(segunda), { primera, segunda });
}

console.log(`\n=== ${pasadas} pasadas, ${fallos} fallos ===`);
process.exit(fallos ? 1 : 0);
