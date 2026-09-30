'use strict';

// Asistente autónomo de soporte — punto de entrada.
//
// La lógica vive en support/ai/:
//
//   agente.js         el bucle de herramientas, igual para cualquier proveedor
//   herramientas.js   buscar_ayuda, guiar_en_pantalla, estado_de_mi_cuenta,
//                     abrir_ticket (definición neutra + ejecución validada)
//   destinos.js       lo que el asistente puede señalar en el panel
//   instrucciones.js  qué es y cómo se comporta
//   proveedores/      un archivo por proveedor de IA; ver index.js para el
//                     contrato que cumple cada uno
//
// Este archivo conserva la interfaz que ya usaban las rutas —reply(),
// status(), enabled()— y añade stream() para la respuesta en vivo.

const { crearAgente } = require('./ai/agente');
const { crearProveedores } = require('./ai/proveedores');

function createAssistant({ db, kb, store, proveedores } = {}) {
  const agente = crearAgente({ db, kb, store, proveedores: proveedores || crearProveedores() });

  /** Eventos en vivo: texto, herramienta, guia, ticket, reinicio y fin. */
  function stream(opciones) {
    return agente.atender(opciones);
  }

  /** La misma respuesta, entera, para quien no puede recibirla en vivo. */
  async function reply(opciones) {
    let texto = '';
    let fin = null;
    for await (const ev of agente.atender(opciones)) {
      if (ev.tipo === 'texto') texto += ev.delta;
      else if (ev.tipo === 'reinicio') texto = ev.texto;
      else if (ev.tipo === 'fin') fin = ev;
    }
    return {
      text: fin ? fin.texto : texto,
      sources: fin ? fin.fuentes : [],
      ticket: fin && fin.ticket ? { public_id: fin.ticket.reference } : null,
      guide: fin ? fin.guia : null,
      degraded: fin ? fin.degradado : true,
      offerTicket: fin ? fin.ofrecerTicket : true,
    };
  }

  return {
    stream,
    reply,
    status: agente.estado,
    enabled: agente.principalActivo,
    presupuestoAgotado: agente.presupuestoAgotado,
  };
}

module.exports = { createAssistant };
