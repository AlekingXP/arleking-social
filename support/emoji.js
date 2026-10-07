'use strict';

// El icono de un enlace: un emoji cualquiera, o uno de Discord.
//
// Dos problemas distintos metidos en el mismo campo.
//
// El primero era de contar. El campo admitía cuatro caracteres, pero
// `maxlength` cuenta unidades UTF-16, no letras: 🔗 ocupa dos, 👍🏽 cuatro y
// 👨‍👩‍👧‍👦 once. Así que media tabla de emojis —familias, banderas, cualquier
// cosa con tono de piel— no cabía, y el navegador la recortaba por la mitad
// en silencio dejando medio carácter. Aquí se cuenta por grafemas, que es lo
// que una persona entiende por "un emoji", por complicado que sea por dentro.
//
// El segundo es que los emojis de Discord no son emojis. Son imágenes de su
// servidor, y lo que se copia de allí llega en tres formas distintas: el
// enlace del CDN, la marca `<:nombre:id>` de un mensaje, o el atajo
// `:nombre:`, que es sólo el nombre y no se puede resolver sin ser de ese
// servidor. Las dos primeras traen el identificador, que es lo único que
// hace falta.
//
// Y cuando lo traen, la imagen se DESCARGA y se queda aquí, en vez de
// enlazar a Discord:
//
//   - La CSP de esta página sólo deja cargar imágenes del propio sitio.
//     Enlazar fuera obligaría a abrirla para un dominio entero.
//   - Enlazar significa que cada visitante de la página pide esa imagen a
//     Discord, y le entrega su IP sin saberlo.
//   - Y si mañana el emoji cambia o lo borran del servidor, el icono se
//     queda roto en una página que no tiene nada que ver.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Cuántos "emojis" caben en el círculo del icono. Cuatro, que es lo que
// admitía antes de contarlos bien, para no romper los iconos que ya existen
// —alguno es texto corto, tipo "AK"— ahora que uno complejo ocupa uno y no
// once.
const MAX_GRAFEMAS = 4;

// Lo que se deja pegar en el campo. Un enlace de Discord con sus parámetros
// ronda los cien caracteres; esto deja sitio de sobra y corta una novela.
const MAX_TEXTO = 300;

// De dónde se acepta traer una imagen. Es una lista cerrada a propósito: la
// URL no la escribe quien pega nada, se construye aquí a partir de un
// identificador de sólo dígitos, así que no hay forma de apuntar este fetch
// a la red interna ni a un endpoint de metadatos.
const SERVIDORES_DISCORD = new Set(['cdn.discordapp.com', 'media.discordapp.net']);

const EXTENSIONES = new Set(['.png', '.gif', '.webp', '.jpg', '.jpeg']);

// Los primeros bytes de cada formato. Lo que conteste el servidor de Discord
// se comprueba igual que un archivo subido a mano: que diga image/png en la
// cabecera no prueba nada.
const FIRMAS = {
  '.png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  '.gif': (b) => b.subarray(0, 6).toString('latin1').startsWith('GIF8'),
  '.webp': (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
  '.jpg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
};
FIRMAS['.jpeg'] = FIRMAS['.jpg'];

const MAX_BYTES = 512 * 1024; // un emoji de Discord no pasa de 256 KB
const ESPERA_MS = 8000;

/** Un fallo con mensaje para la persona, no para el registro. */
class ErrorEmoji extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.name = 'ErrorEmoji';
    this.paraLaPersona = true;
  }
}

// Node trae Intl.Segmenter desde la 16. El respaldo cuenta puntos de código,
// que ya es mucho mejor que contar unidades UTF-16 aunque parta una familia.
const SEGMENTADOR = (typeof Intl !== 'undefined' && Intl.Segmenter)
  ? new Intl.Segmenter('es', { granularity: 'grapheme' })
  : null;

function contarGrafemas(texto) {
  if (SEGMENTADOR) {
    let n = 0;
    for (const _ of SEGMENTADOR.segment(texto)) n++;
    return n;
  }
  return [...texto].length;
}

/**
 * ¿Esto que han pegado es un emoji de Discord? Devuelve su identificador y
 * si es animado, o null si no lo es.
 *
 * Reconoce las dos formas que traen el identificador:
 *   <:deus:1234567890123456789>     copiado de un mensaje
 *   <a:deus:1234567890123456789>    igual, pero animado
 *   https://cdn.discordapp.com/emojis/1234567890123456789.webp?size=96
 */
function referenciaDiscord(texto) {
  // En la marca de un mensaje, la "a" distingue un emoji animado de uno
  // fijo. Ahí no hay nada que averiguar.
  const marca = /^<(a?):[A-Za-z0-9_~]{1,64}:(\d{15,25})>$/.exec(texto);
  if (marca) {
    const animado = marca[1] === 'a';
    return { id: marca[2], extension: animado ? '.gif' : '.png', quizaAnimado: false };
  }

  let url;
  try {
    url = new URL(texto);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (!SERVIDORES_DISCORD.has(url.hostname)) return null;

  const enRuta = /^\/emojis\/(\d{15,25})(\.[a-z0-9]+)?$/i.exec(url.pathname);
  if (!enRuta) return null;

  const extension = (enRuta[2] || '.png').toLowerCase();
  const limpia = EXTENSIONES.has(extension) ? extension : '.png';

  // El enlace, en cambio, NO dice si el emoji se mueve. "Copiar enlace"
  // suele dar un .webp, y un .webp de un emoji animado es una foto fija:
  // pidiéndolo tal cual, el check que gira en Discord llegaba aquí quieto.
  // Cuando la extensión no es ya .gif, hay que preguntar.
  return { id: enRuta[1], extension: limpia, quizaAnimado: limpia !== '.gif' };
}

/**
 * ¿Este GIF se mueve, o es una sola imagen con extensión de GIF?
 *
 * Cada fotograma de un GIF animado va precedido de su bloque de control
 * (21 F9 04). Uno solo —o ninguno— es una imagen quieta. Se cuenta eso y no
 * los separadores de imagen (2C), que es un byte suelto y aparece por
 * casualidad dentro de los datos comprimidos continuamente.
 */
function gifSeMueve(bytes) {
  let fotogramas = 0;
  for (let i = 0; i + 2 < bytes.length; i++) {
    if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9 && bytes[i + 2] === 0x04) {
      fotogramas++;
      if (fotogramas > 1) return true;
    }
  }
  return false;
}

/**
 * Trae la imagen del emoji y la deja en uploads. Devuelve la ruta pública.
 */
async function descargar(id, extension) {
  const origen = `https://cdn.discordapp.com/emojis/${id}${extension}`;

  let respuesta;
  try {
    respuesta = await fetch(origen, {
      signal: AbortSignal.timeout(ESPERA_MS),
      headers: { Accept: 'image/*' },
    });
  } catch (err) {
    // Sin red, o Discord tardando: no es culpa de quien pegó el emoji, así
    // que se le dice que lo intente otra vez y no que lo hizo mal.
    throw new ErrorEmoji('No se pudo traer el emoji de Discord ahora mismo. Inténtalo de nuevo en un momento.');
  }

  if (respuesta.status === 404) {
    throw new ErrorEmoji('Discord no encuentra ese emoji. Comprueba que el enlace sea el del emoji y que siga existiendo.');
  }
  if (!respuesta.ok) {
    throw new ErrorEmoji('Discord no quiso darnos ese emoji (error ' + respuesta.status + ').');
  }

  // Dónde ha acabado de verdad la petición. fetch sigue las redirecciones
  // por su cuenta, y una redirección es justo la forma de que una dirección
  // de confianza termine sirviendo otra cosa desde otro sitio.
  //
  // Se mira `redirected` y no sólo la dirección final: cuando no se ha
  // seguido nada, la única dirección que hubo es la que armamos aquí arriba
  // a partir de un identificador de dígitos, y ésa ya se sabe de dónde es.
  if (respuesta.redirected) {
    let destino = null;
    try {
      destino = new URL(respuesta.url).hostname;
    } catch {
      throw new ErrorEmoji('Ese enlace no se pudo seguir.');
    }
    if (!SERVIDORES_DISCORD.has(destino)) {
      throw new ErrorEmoji('Ese enlace acaba fuera de Discord.');
    }
  }

  const declarado = Number(respuesta.headers.get('content-length'));
  if (declarado && declarado > MAX_BYTES) {
    throw new ErrorEmoji('Esa imagen pesa demasiado para ser un emoji.');
  }

  const bytes = Buffer.from(await respuesta.arrayBuffer());
  // Otra vez después de leer: la cabecera de arriba la escribe el servidor y
  // puede faltar o mentir.
  if (bytes.length > MAX_BYTES) {
    throw new ErrorEmoji('Esa imagen pesa demasiado para ser un emoji.');
  }
  if (bytes.length < 16) {
    throw new ErrorEmoji('Lo que devolvió Discord no es una imagen.');
  }

  const comprobar = FIRMAS[extension];
  if (!comprobar || !comprobar(bytes)) {
    throw new ErrorEmoji('Lo que devolvió Discord no es una imagen que podamos usar.');
  }

  return bytes;
}

function guardar(bytes, extension, uploadsDir) {
  const nombre = crypto.randomUUID() + extension;
  fs.writeFileSync(path.join(uploadsDir, nombre), bytes);
  return '/uploads/' + nombre;
}

/**
 * Trae la imagen del emoji y la deja en uploads. Devuelve la ruta pública.
 *
 * Cuando no se sabe si el emoji se mueve —que es lo que pasa al pegar un
 * enlace, porque Discord da .webp para los dos casos— se pide primero el
 * .gif, que es la única forma en la que sirve la animación. Si lo que llega
 * no se mueve, o no llega nada, se pide la extensión original.
 *
 * Es una petición de más, pero sólo al pegar el emoji, no al verlo: un
 * visitante de la página no paga nada por esto. Y lo contrario —quedarse el
 * .webp— es servir quieto para siempre algo que en Discord gira.
 */
async function traerDeDiscord({ id, extension, quizaAnimado }, uploadsDir) {
  if (quizaAnimado) {
    try {
      const comoGif = await descargar(id, '.gif');
      if (gifSeMueve(comoGif)) return guardar(comoGif, '.gif', uploadsDir);
    } catch (err) {
      // Que el .gif no exista es la respuesta normal para un emoji fijo, no
      // un fallo: se sigue con la extensión que venía en el enlace. Si el
      // problema es de verdad —no hay red, el emoji no existe— volverá a
      // salir en la petición de abajo, y entonces sí con su mensaje.
      if (!(err instanceof ErrorEmoji)) throw err;
    }
  }

  return guardar(await descargar(id, extension), extension, uploadsDir);
}

/** ¿El icono guardado es un archivo nuestro y no un emoji de texto? */
function esImagen(icono) {
  return typeof icono === 'string' && icono.startsWith('/uploads/');
}

/**
 * Convierte lo que venga del formulario en lo que se guarda en la base.
 *
 * Devuelve el emoji tal cual, o la ruta de la imagen ya descargada. Lanza
 * ErrorEmoji con un mensaje que se le puede enseñar a quien lo escribió.
 *
 * `anterior` es el icono que tenía el enlace: así, al guardar sin tocar el
 * campo, una imagen que ya está no se vuelve a descargar.
 */
async function resolverIcono(bruto, { uploadsDir, anterior = null } = {}) {
  const texto = String(bruto == null ? '' : bruto).trim();
  if (!texto) return '🔗';

  // El campo enseña la imagen que ya hay; si vuelve igual, no se toca.
  if (esImagen(texto)) {
    return texto === anterior ? texto : '🔗';
  }

  if (texto.length > MAX_TEXTO) {
    throw new ErrorEmoji('Eso es demasiado largo para un icono.');
  }

  const discord = referenciaDiscord(texto);
  if (discord) return traerDeDiscord(discord, uploadsDir);

  // El atajo suelto. Es el error fácil de cometer —es lo que Discord enseña
  // debajo del emoji en su buscador— y sin esta explicación quien lo pega
  // sólo ve que no funciona, sin saber qué hacer en su lugar.
  if (/^:[A-Za-z0-9_~]{1,64}:$/.test(texto)) {
    throw new ErrorEmoji('Eso es el nombre del emoji, no el emoji. En Discord, haz clic derecho sobre él → Copiar enlace, y pega aquí ese enlace.');
  }

  if (/^https?:\/\//i.test(texto) || texto.startsWith('<')) {
    throw new ErrorEmoji('De fuera sólo se pueden traer emojis de Discord. Para cualquier otra imagen, usa una tarjeta destacada.');
  }

  if (contarGrafemas(texto) > MAX_GRAFEMAS) {
    throw new ErrorEmoji(`El icono no puede pasar de ${MAX_GRAFEMAS} caracteres.`);
  }

  return texto;
}

module.exports = {
  resolverIcono,
  referenciaDiscord,
  contarGrafemas,
  gifSeMueve,
  esImagen,
  ErrorEmoji,
  MAX_GRAFEMAS,
  MAX_TEXTO,
};
