// Corre las suites de test/ una a una, en su propio proceso.
//
// Cada suite levanta servidores y toca variables de entorno, así que
// compartir proceso las enredaría. Sale con 1 si alguna falla, para que
// sirva en cualquier integración continua.
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const AQUI = __dirname;
// .mjs además de .js: las suites que prueban código de navegador se escriben
// como módulos, porque eso es lo que son los archivos que prueban.
const suites = fs.readdirSync(AQUI)
  .filter((f) => (f.endsWith('.js') || f.endsWith('.mjs')) && f !== 'correr.js')
  .sort();

let fallaron = [];
for (const suite of suites) {
  console.log(`\n=========== ${suite} ===========`);
  const r = spawnSync(process.execPath, [path.join(AQUI, suite)], { stdio: 'inherit' });
  if (r.status !== 0) {
    // El motivo importa: una suite puede imprimir "0 fallos" y devolver
    // basura si el proceso se cae al cerrar (en Windows, 0xC0000409 al
    // salir con sockets nativos a medias). Sin este detalle, eso parece un
    // fallo de la prueba y se va a buscar donde no es.
    const motivo = r.signal ? `señal ${r.signal}`
      : r.status === null ? 'no llegó a terminar'
        : `salida ${r.status}${r.status === -1073740791 ? ' (0xC0000409: se cayó al cerrar, no es un fallo de la prueba)' : ''}`;
    fallaron.push(`${suite} — ${motivo}`);
  }
}

console.log('\n===================================');
if (fallaron.length) {
  console.log('FALLARON: ' + fallaron.join(', '));
  process.exit(1);
}
console.log(`${suites.length} suites, todas verdes.`);
