'use strict';

// Herramientas del asistente, en formato neutro.
//
// Cada una tiene un nombre, una descripción y un esquema JSON Schema — lo
// que entienden todos los proveedores de modelos — y un ejecutor. Nada de
// este archivo sabe qué proveedor hay detrás: el adaptador traduce la
// definición a su formato y la llamada de vuelta.
//
// Tres reglas que se cumplen en TODAS:
//
//  1. La entrada se valida aquí, siempre. Con el streaming de entradas
//     activado el proveedor ya no la valida, y un analizador tolerante puede
//     devolver un objeto truncado en vez de fallar. Una entrada que no pasa
//     no se ejecuta: vuelve al modelo como error para que lo reintente.
//  2. La identidad sale del contexto del servidor (la sesión), nunca de la
//     entrada. estado_de_mi_cuenta no tiene ni un parámetro por eso.
//  3. El resultado es texto. Lo que la interfaz necesita aparte —una guía,
//     un ticket— sale como `evento`, que el agente reenvía al navegador.

const { correoValido } = require('../store');
const { CLAVES, GUIAS_POR_ARTICULO, resolverPasos, catalogo, MAX_PASOS } = require('./destinos');

// ---- Validación mínima ----
//
// A mano y no con una librería de esquemas: son cuatro herramientas con dos
// o tres campos cada una, y el proyecto no usa ninguna.

class EntradaInvalida extends Error {}

function texto(valor, campo, { min = 1, max = 2000, opcional = false } = {}) {
  if (valor == null || valor === '') {
    if (opcional) return null;
    throw new EntradaInvalida(`Falta "${campo}".`);
  }
  if (typeof valor !== 'string') throw new EntradaInvalida(`"${campo}" debe ser texto.`);
  const limpio = valor.trim();
  if (limpio.length < min) {
    if (opcional) return null;
    throw new EntradaInvalida(`"${campo}" está vacío.`);
  }
  return limpio.slice(0, max);
}

function objeto(valor) {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) {
    throw new EntradaInvalida('La entrada debe ser un objeto.');
  }
  return valor;
}

// ---- Definiciones ----

function definiciones() {
  return [
    {
      nombre: 'buscar_ayuda',
      descripcion:
        'Busca en la base de conocimiento de ArleKing Social. Úsala antes de responder cualquier pregunta sobre la plataforma. '
        + 'Devuelve los artículos más parecidos (o nada si no hay ninguno relevante). Cuando un artículo trae "guia", es una guía visual '
        + 'ya preparada que puedes pasar a guiar_en_pantalla tal cual o adaptada.',
      esquema: {
        type: 'object',
        properties: {
          consulta: {
            type: 'string',
            description: 'Qué buscar, con las palabras del problema. Ej: "cancelar suscripcion", "insignia no aparece".',
          },
        },
        required: ['consulta'],
        additionalProperties: false,
      },
    },
    {
      nombre: 'guiar_en_pantalla',
      descripcion:
        'Enseña a la persona, sobre su propio panel, dónde está cada cosa: cambia de pestaña si hace falta, resalta el elemento y '
        + 'muestra tu indicación al lado, paso a paso. Úsala cuando la respuesta implique hacer algo en el panel. '
        + `Máximo ${MAX_PASOS} pasos. Destinos disponibles:\n${catalogo()}`,
      esquema: {
        type: 'object',
        properties: {
          pasos: {
            type: 'array',
            minItems: 1,
            maxItems: MAX_PASOS,
            items: {
              type: 'object',
              properties: {
                destino: { type: 'string', enum: CLAVES },
                texto: {
                  type: 'string',
                  description: 'Qué hacer en este paso, en una frase corta y en segunda persona.',
                },
              },
              required: ['destino', 'texto'],
              additionalProperties: false,
            },
          },
        },
        required: ['pasos'],
        additionalProperties: false,
      },
    },
    {
      nombre: 'estado_de_mi_cuenta',
      descripcion:
        'Consulta el estado real de la cuenta de la persona con la que hablas: su insignia VIP, si tiene suscripción, correo verificado, '
        + 'verificación en dos pasos, llaves de acceso y la dirección de su página. No recibe parámetros: siempre consulta a quien tiene la sesión abierta.',
      esquema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
      nombre: 'abrir_ticket',
      descripcion:
        'Abre un ticket para que una persona del equipo revise el caso. Úsala cuando no puedas resolverlo tú, cuando lo pidan, '
        + 'o cuando haya un cobro que revisar. El ticket llega al buzón del equipo, que responde en esta misma conversación.',
      esquema: {
        type: 'object',
        properties: {
          asunto: { type: 'string', description: 'Una línea que resuma el caso. Ej: "Cobro duplicado en marzo".' },
          resumen: {
            type: 'string',
            description: 'Qué necesita la persona, qué se ha comprobado ya y qué datos aportó. Escrito para quien lo va a atender.',
          },
          correo: {
            type: 'string',
            description: 'Correo de contacto SÓLO si la persona lo escribió en la conversación. No lo inventes ni lo deduzcas.',
          },
        },
        required: ['asunto', 'resumen'],
        additionalProperties: false,
      },
    },
  ];
}

// ---- Ejecución ----

function crearEjecutor({ db, kb, store }) {
  const consultaCuenta = db.prepare(`
    SELECT u.username, u.email, u.email_verified_at, u.mfa_enabled, u.created_at,
           p.slug, p.vip_tier, p.vip_activated_at,
           (p.stripe_subscription_id IS NOT NULL) AS tiene_suscripcion,
           (SELECT COUNT(*) FROM links l WHERE l.user_id = u.id) AS enlaces
    FROM users u LEFT JOIN profile p ON p.user_id = u.id
    WHERE u.id = ?
  `);

  // La tabla de llaves la crea el módulo de WebAuthn; se tolera que falte.
  let consultaLlaves = null;
  try {
    consultaLlaves = db.prepare('SELECT COUNT(*) AS n FROM webauthn_credentials WHERE user_id = ?');
  } catch {
    consultaLlaves = null;
  }

  function fecha(valor) {
    if (!valor) return null;
    try {
      return new Date(String(valor).replace(' ', 'T') + 'Z')
        .toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
    } catch {
      return valor;
    }
  }

  function enmascarar(correo) {
    const [usuario, dominio] = String(correo || '').split('@');
    if (!dominio) return null;
    return `${usuario.slice(0, 2)}${'•'.repeat(Math.max(1, usuario.length - 2))}@${dominio}`;
  }

  const TIERS = { billete: 'Dollars (5 USD/mes)', king: 'THE KING (7,99 USD/mes)' };

  /** Lista blanca estricta: los ids de Stripe, el hash y el secreto TOTP no salen. */
  function leerCuenta(userId) {
    const fila = consultaCuenta.get(userId);
    if (!fila) return { error: 'No se encontró la cuenta.' };
    let llaves = 0;
    try {
      if (consultaLlaves) llaves = consultaLlaves.get(userId).n;
    } catch {
      llaves = 0;
    }
    return {
      usuario: fila.username,
      pagina: fila.slug ? `arleking-social.net/${fila.slug}` : null,
      enlaces: fila.enlaces,
      cuenta_creada: fecha(fila.created_at),
      insignia_vip: fila.vip_tier ? (TIERS[fila.vip_tier] || fila.vip_tier) : 'sin insignia',
      insignia_activa_desde: fecha(fila.vip_activated_at),
      suscripcion_de_pago_activa: fila.tiene_suscripcion ? 'sí' : 'no',
      correo_de_recuperacion: fila.email ? enmascarar(fila.email) : 'no configurado',
      correo_verificado: fila.email
        ? (fila.email_verified_at ? 'sí' : 'no, falta pulsar el enlace de confirmación')
        : 'no aplica',
      verificacion_en_dos_pasos: fila.mfa_enabled ? 'activada' : 'desactivada',
      llaves_de_acceso: llaves,
    };
  }

  const ejecutores = {
    buscar_ayuda(entrada, ctx) {
      const consulta = texto(objeto(entrada).consulta, 'consulta', { max: 300 });
      const encontrados = kb.search(consulta);
      if (!encontrados.length) {
        return {
          contenido: 'Sin coincidencias. La base de conocimiento no cubre esto: dilo con naturalidad y ofrece abrir un ticket.',
        };
      }
      encontrados.forEach((e) => ctx.fuentes.add(e.articulo.id));
      return {
        contenido: JSON.stringify(encontrados.map((e) => ({
          articulo: e.articulo.slug,
          titulo: e.articulo.question,
          contenido: e.articulo.answer,
          ...(GUIAS_POR_ARTICULO[e.articulo.slug] ? { guia: GUIAS_POR_ARTICULO[e.articulo.slug] } : {}),
        }))),
      };
    },

    guiar_en_pantalla(entrada, ctx) {
      const pasos = resolverPasos(objeto(entrada).pasos);
      if (!pasos.length) {
        throw new EntradaInvalida('Ningún paso es válido: usa sólo destinos de la lista y escribe un texto para cada uno.');
      }
      ctx.guia = pasos;
      return {
        contenido: `Guía mostrada en pantalla (${pasos.length} ${pasos.length === 1 ? 'paso' : 'pasos'}). No repitas los pasos en tu respuesta: basta una frase.`,
        evento: { tipo: 'guia', pasos },
      };
    },

    estado_de_mi_cuenta(entrada, ctx) {
      // Aunque el modelo mande argumentos, se ignoran: no hay de quién preguntar
      // más que de la sesión.
      if (!ctx.userId) {
        return { contenido: 'No hay sesión iniciada, así que no hay ninguna cuenta que consultar.' };
      }
      return { contenido: JSON.stringify(leerCuenta(ctx.userId)) };
    },

    abrir_ticket(entrada, ctx) {
      const e = objeto(entrada);
      const asunto = texto(e.asunto, 'asunto', { max: 160 });
      const resumen = texto(e.resumen, 'resumen', { max: 2000 });
      const propuesto = texto(e.correo, 'correo', { opcional: true, max: 200 });

      // El correo verificado de la sesión manda. El que propone el modelo
      // sólo se acepta si no hay otro, y validado: sin esto, una inyección
      // podría dirigir el aviso a un tercero.
      let correo = null;
      if (ctx.cuenta && ctx.cuenta.email) correo = ctx.cuenta.email;
      else if (propuesto && correoValido(propuesto)) correo = propuesto;

      const { ticket, created } = store.createTicket({
        conversationId: ctx.conversationId,
        userId: ctx.userId,
        username: ctx.cuenta ? ctx.cuenta.username : null,
        email: correo,
        subject: asunto,
        summary: resumen,
      });
      ctx.ticket = ticket;
      if (created) ctx.ticketCreado = true;

      return {
        contenido: JSON.stringify(created
          ? { estado: 'abierto', referencia: ticket.public_id, aviso_por_correo: correo ? 'sí' : 'no hay correo de contacto' }
          : { estado: 'ya existía uno abierto para esta conversación', referencia: ticket.public_id }),
        evento: created ? { tipo: 'ticket', referencia: ticket.public_id } : null,
      };
    },
  };

  /**
   * Ejecuta una llamada. Nunca lanza: una entrada inválida o un fallo vuelven
   * como resultado de error, que el modelo puede leer y corregir.
   */
  function ejecutar(nombre, entrada, ctx) {
    if (!Object.prototype.hasOwnProperty.call(ejecutores, nombre)) {
      return { contenido: `No existe la herramienta "${nombre}".`, error: true };
    }
    try {
      return ejecutores[nombre](entrada, ctx);
    } catch (err) {
      if (err instanceof EntradaInvalida) {
        return { contenido: JSON.stringify({ INVALID_INPUT: err.message, recibido: entrada }), error: true };
      }
      console.error(`[soporte] fallo en la herramienta ${nombre}:`, err.message);
      return { contenido: 'La herramienta falló. Dilo con naturalidad y ofrece abrir un ticket.', error: true };
    }
  }

  return { ejecutar, leerCuenta, consultaCuenta };
}

module.exports = { definiciones, crearEjecutor, EntradaInvalida };
