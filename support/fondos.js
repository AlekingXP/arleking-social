'use strict';

// Las claves de los fondos generativos, del lado del servidor.
//
// El catálogo de verdad —los algoritmos— vive en public/js/wallpapers.js,
// porque se dibuja en el navegador. Aquí sólo hacen falta los nombres, para
// no guardar en la base lo primero que mande alguien: ese valor acaba en un
// atributo de la página pública, y una lista cerrada es más barata y más
// segura que cualquier saneado.
//
// Que las dos listas se separen es el riesgo evidente de tenerlas en dos
// sitios, así que no se vigila a ojo: test/fondos.js las compara y falla si
// alguien añade un fondo en uno y se olvida del otro.
const CLAVES = [
  'malla',
  'deriva',
  'lluvia',
  'aurora',
  'orbitas',
  'interferencia',
  'celdas',
  'rejilla',
  'polvo',
];

const CONJUNTO = new Set(CLAVES);

/** Null —ningún fondo— es una respuesta válida, y es la de por defecto. */
function limpiarFondo(valor) {
  if (typeof valor !== 'string') return null;
  const v = valor.trim();
  return CONJUNTO.has(v) ? v : null;
}

module.exports = { CLAVES, limpiarFondo };
