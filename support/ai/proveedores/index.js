'use strict';

// Registro de proveedores de IA.
//
// Cambiar de proveedor es cambiar SUPPORT_AI_PROVIDER. Añadir uno es crear
// un archivo en esta carpeta que cumpla el contrato de abajo y registrarlo
// en FABRICAS. Nada más del soporte —agente, herramientas, guías, voz,
// interfaz— tiene que tocarse.
//
// ---- Contrato ----
//
//   {
//     id: 'nombre',
//     disponible(): boolean          // ¿tiene credenciales y puede atender?
//     describir(): { proveedor, modelo, ... }   // para el panel del dueño
//     esAbandono(err): boolean       // ¿el error es que se canceló la petición?
//
//     async *turno({ sistema, contexto, mensajes, herramientas, senal })
//   }
//
// `turno` recibe:
//   sistema      texto fijo (cacheable) con las instrucciones
//   contexto     texto que cambia en cada petición
//   mensajes     la conversación en formato neutro:
//                  { rol: 'usuario',    texto }
//                  { rol: 'asistente',  texto, llamadas: [{ id, nombre, entrada }], crudo }
//                  { rol: 'resultados', resultados: [{ id, contenido, error }] }
//                `crudo` es lo que el propio adaptador devolvió en ese turno
//                (su formato nativo). Si es suyo, debe reenviarlo tal cual; si
//                viene de otro proveedor, reconstruye desde texto + llamadas.
//   herramientas [{ nombre, descripcion, esquema }]  (JSON Schema)
//   senal        AbortSignal: se dispara si la persona cierra el chat
//
// y emite, en este orden:
//   { tipo: 'texto', delta }       cero o más, según se genera
//   { tipo: 'reinicio' }           si tiene que repetir el turno tras emitir texto
//   { tipo: 'turno', parada, texto, llamadas, crudo, uso, ofrecerTicket? }   una vez, al final
//
// `parada`: 'fin' | 'herramientas' | 'rechazo' | 'limite' | 'pausa'
// `uso`:    { entrada, salida, cache }  en tokens, para el presupuesto diario
//
// Lo que NO hace un adaptador: ejecutar herramientas, validar sus entradas,
// guardar mensajes ni decidir cuándo parar. Eso es del agente, y por eso es
// igual para todos.

const { crearProveedorAnthropic } = require('./anthropic');
const { crearProveedorLocal } = require('./local');

const FABRICAS = {
  anthropic: crearProveedorAnthropic,
  local: crearProveedorLocal,
};

function crearProveedores(opciones = {}) {
  const nombre = opciones.principal || process.env.SUPPORT_AI_PROVIDER || 'anthropic';
  const fabrica = Object.prototype.hasOwnProperty.call(FABRICAS, nombre) ? FABRICAS[nombre] : null;
  if (!fabrica) {
    console.warn(`[soporte] proveedor de IA desconocido "${nombre}"; se usa el modo sin modelo.`);
  }
  const principal = fabrica ? fabrica(opciones[nombre] || {}) : null;
  const local = crearProveedorLocal();
  return { principal, local, nombre };
}

module.exports = { crearProveedores, FABRICAS };
