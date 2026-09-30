'use strict';

// Proveedor sin modelo.
//
// Es lo que atiende cuando no hay clave de ningún proveedor, cuando se agota
// el presupuesto del día o cuando el proveedor principal falla. En vez de
// ser un camino aparte, se comporta como un "modelo" con reglas fijas:
// pide buscar_ayuda, lee el resultado, y si el artículo trae guía pide
// guiar_en_pantalla. Así el agente, las herramientas, la validación y los
// eventos que llegan al navegador son exactamente los mismos con y sin IA,
// y lo que se prueba sin clave es lo mismo que corre con ella.

function ultimoDe(mensajes, rol) {
  for (let i = mensajes.length - 1; i >= 0; i--) {
    if (mensajes[i].rol === rol) return mensajes[i];
  }
  return null;
}

// Se emite en trozos para que la interfaz se comporte igual que con un
// modelo que escribe en vivo (y la voz lea por frases).
function* enTrozos(texto) {
  const partes = texto.match(/[^.!?\n]+[.!?\n]*\s*/g) || [texto];
  for (const p of partes) yield { tipo: 'texto', delta: p };
}

function crearProveedorLocal() {
  let secuencia = 0;

  async function* turno({ mensajes }) {
    const ultimo = mensajes[mensajes.length - 1];

    // Primer paso: buscar lo que acaba de preguntar.
    if (!ultimo || ultimo.rol === 'usuario') {
      const pregunta = ultimo ? ultimo.texto : '';
      yield {
        tipo: 'turno',
        parada: 'herramientas',
        texto: '',
        llamadas: [{ id: `local-${++secuencia}`, nombre: 'buscar_ayuda', entrada: { consulta: pregunta } }],
        crudo: null,
        uso: { entrada: 0, salida: 0, cache: 0 },
      };
      return;
    }

    if (ultimo.rol !== 'resultados') {
      yield { tipo: 'turno', parada: 'fin', texto: '', llamadas: [], crudo: null, uso: {} };
      return;
    }

    const peticion = ultimoDe(mensajes, 'asistente');
    const llamada = peticion && peticion.llamadas && peticion.llamadas[0];
    const resultado = ultimo.resultados[0];

    // Tras mostrar la guía no queda nada que decir.
    if (!llamada || llamada.nombre !== 'buscar_ayuda') {
      yield { tipo: 'turno', parada: 'fin', texto: '', llamadas: [], crudo: null, uso: {} };
      return;
    }

    let articulos = [];
    try {
      const datos = JSON.parse(resultado.contenido);
      if (Array.isArray(datos)) articulos = datos;
    } catch {
      articulos = [];
    }

    if (!articulos.length) {
      const texto = 'No encuentro nada sobre eso en la ayuda. Si me dejas tu consulta, la paso a una persona del equipo y te responderá aquí mismo.';
      yield* enTrozos(texto);
      yield {
        tipo: 'turno', parada: 'fin', texto, llamadas: [], crudo: null, uso: {},
        ofrecerTicket: true,
      };
      return;
    }

    // Sin modelo no se puede juzgar cuál de dos artículos responde mejor, así
    // que se da el primero entero y se nombra el segundo por si acaso.
    const [principal, otro] = articulos;
    let texto = principal.contenido;
    if (otro) texto += `\n\nTambién puede servirte: «${otro.titulo}».`;
    yield* enTrozos(texto);

    const llamadas = principal.guia
      ? [{ id: `local-${++secuencia}`, nombre: 'guiar_en_pantalla', entrada: { pasos: principal.guia } }]
      : [];

    yield {
      tipo: 'turno',
      parada: llamadas.length ? 'herramientas' : 'fin',
      texto,
      llamadas,
      crudo: null,
      uso: {},
      ofrecerTicket: true,
    };
  }

  return {
    id: 'local',
    disponible: () => true,
    describir: () => ({ proveedor: 'local', modelo: null }),
    turno,
    esAbandono: () => false,
  };
}

module.exports = { crearProveedorLocal };
