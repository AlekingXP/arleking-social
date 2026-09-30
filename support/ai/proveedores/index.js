'use strict';

// Registro de proveedores de IA.
//
// Cambiar de proveedor es poner su clave (o SUPPORT_AI_PROVIDER). Añadir uno
// es crear un archivo en esta carpeta que cumpla el contrato de abajo y
// registrarlo en FABRICAS. Nada más del soporte —agente, herramientas,
// guías, voz, interfaz— tiene que tocarse.
//
// Hoy vienen tres:
//   openai      Chat Completions. Vale también para los proveedores que
//               hablan ese mismo formato (Groq, Together, Mistral,
//               OpenRouter, DeepSeek, Ollama...) con OPENAI_BASE_URL.
//   anthropic   Claude, con su SDK oficial.
//   local       Sin modelo: busca en la ayuda, guía y abre tickets.
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

const { crearProveedorOpenAI } = require('./openai');
const { crearProveedorAnthropic } = require('./anthropic');
const { crearProveedorLocal } = require('./local');

const FABRICAS = {
  openai: crearProveedorOpenAI,
  anthropic: crearProveedorAnthropic,
  local: crearProveedorLocal,
};

// Sin SUPPORT_AI_PROVIDER se elige por la clave que haya, en este orden.
// Es el mismo criterio que ya usa el envío de correo: quien despliega pone
// una clave y el resto se acomoda, sin una variable más que recordar.
const ORDEN = [
  { nombre: 'openai', variable: 'OPENAI_API_KEY' },
  { nombre: 'anthropic', variable: 'ANTHROPIC_API_KEY' },
];

function detectar() {
  const encontrado = ORDEN.find((p) => process.env[p.variable]);
  return encontrado ? encontrado.nombre : ORDEN[0].nombre;
}

function crearProveedores(opciones = {}) {
  const pedido = opciones.principal || process.env.SUPPORT_AI_PROVIDER || null;
  const nombre = pedido || detectar();
  const fabrica = Object.prototype.hasOwnProperty.call(FABRICAS, nombre) ? FABRICAS[nombre] : null;
  if (!fabrica) {
    console.warn(`[soporte] proveedor de IA desconocido "${nombre}"; se usa el modo sin modelo.`);
  }
  const principal = fabrica ? fabrica(opciones[nombre] || {}) : null;
  const local = crearProveedorLocal();
  return { principal, local, nombre };
}

module.exports = { crearProveedores, FABRICAS, detectar };
