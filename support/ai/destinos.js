'use strict';

// Lo que el asistente puede señalar en el panel.
//
// Una lista cerrada, y es la decisión más importante de la guía visual. El
// modelo elige una CLAVE de esta lista; nunca escribe un selector CSS. Si
// pudiera, una inyección de prompt le haría resaltar cualquier cosa —o
// meter un selector que rompa la página—, y un selector escrito por un
// modelo se equivoca en cuanto cambia una clase. Así el modelo decide QUÉ
// enseñar y el código decide CÓMO encontrarlo.
//
// Cada destino dice en qué pestaña vive (para cambiarla antes de resaltar),
// qué elemento buscar, y qué parte recuadrar:
//
//   resaltar: 'elemento' — el propio elemento
//             'campo'    — su <label class="field"> (input + etiqueta)
//             'etiqueta' — su <label> más cercano (inputs de archivo ocultos)
//             'tarjeta'  — la tarjeta .card entera
//
// `siOculto` es lo que se le dice a la persona cuando el elemento existe pero
// no se ve, porque depende de su situación: el botón de gestionar la
// suscripción sólo aparece si tiene una.
//
// Si cambias un id del panel, cámbialo aquí también: un selector que ya no
// encuentra nada no rompe la guía (ese paso se salta), pero la deja coja.

const DESTINOS = {
  pestana_perfil: { pestana: 'perfil', selector: '[data-tab="perfil"]', resaltar: 'elemento', descripcion: 'la pestaña Perfil' },
  pestana_apariencia: { pestana: 'apariencia', selector: '[data-tab="apariencia"]', resaltar: 'elemento', descripcion: 'la pestaña Apariencia' },
  pestana_enlaces: { pestana: 'enlaces', selector: '[data-tab="enlaces"]', resaltar: 'elemento', descripcion: 'la pestaña Enlaces' },
  pestana_analiticas: { pestana: 'analiticas', selector: '[data-tab="analiticas"]', resaltar: 'elemento', descripcion: 'la pestaña Analíticas' },
  pestana_vip: { pestana: 'vip', selector: '[data-tab="vip"]', resaltar: 'elemento', descripcion: 'la pestaña VIP' },
  pestana_cuenta: { pestana: 'cuenta', selector: '[data-tab="cuenta"]', resaltar: 'elemento', descripcion: 'la pestaña Cuenta' },

  perfil_foto: { pestana: 'perfil', selector: '#avatar-input', resaltar: 'etiqueta', descripcion: 'el botón para cambiar la foto de perfil' },
  perfil_nombre: { pestana: 'perfil', selector: '#p-name', resaltar: 'campo', descripcion: 'el campo del nombre' },
  perfil_url: { pestana: 'perfil', selector: '#p-slug', resaltar: 'campo', descripcion: 'el campo de la dirección (URL) de la página' },
  perfil_descripcion: { pestana: 'perfil', selector: '#p-tagline', resaltar: 'campo', descripcion: 'el campo de la descripción (tagline)' },
  perfil_guardar: { pestana: 'perfil', selector: '[data-panel="perfil"] .save-bar button', resaltar: 'elemento', descripcion: 'el botón Guardar cambios de Perfil' },

  apariencia_fondo: { pestana: 'apariencia', selector: '#background-input', resaltar: 'etiqueta', descripcion: 'el botón para cambiar el fondo' },
  apariencia_colores: { pestana: 'apariencia', selector: '#p-accent-from', resaltar: 'tarjeta', descripcion: 'la tarjeta de colores' },
  apariencia_particulas: { pestana: 'apariencia', selector: '#p-particles-enabled', resaltar: 'tarjeta', descripcion: 'la tarjeta de los nodos de fondo (partículas)' },
  apariencia_edad: { pestana: 'apariencia', selector: '#p-gate-enabled', resaltar: 'tarjeta', descripcion: 'la tarjeta de verificación de edad' },
  apariencia_guardar: { pestana: 'apariencia', selector: '[data-panel="apariencia"] .save-bar button', resaltar: 'elemento', descripcion: 'el botón Guardar cambios de Apariencia' },

  enlaces_agregar: { pestana: 'enlaces', selector: '#add-link-btn', resaltar: 'elemento', descripcion: 'el botón para agregar un enlace' },
  enlaces_lista: { pestana: 'enlaces', selector: '#links-admin-list', resaltar: 'elemento', descripcion: 'la lista de enlaces (flechas para ordenar, ojo para ocultar, lápiz para editar)' },

  analiticas_rango: { pestana: 'analiticas', selector: '#range-tabs', resaltar: 'elemento', descripcion: 'el selector de periodo de las analíticas' },

  vip_planes: { pestana: 'vip', selector: '.vip-plan-btn', resaltar: 'elemento', descripcion: 'los botones para suscribirse a un nivel VIP' },
  vip_gestionar: {
    pestana: 'vip',
    selector: '#vip-manage-btn',
    resaltar: 'elemento',
    descripcion: 'el botón para gestionar o cancelar la suscripción',
    siOculto: 'Este botón aparece aquí cuando tienes una suscripción activa.',
  },
  vip_demo: { pestana: 'vip', selector: '#vip-3d-viewer', resaltar: 'elemento', descripcion: 'la demostración de cómo se ve la insignia' },

  cuenta_dos_pasos: { pestana: 'cuenta', selector: '#mfa-toggle-btn', resaltar: 'elemento', descripcion: 'el botón para activar la verificación en dos pasos' },
  cuenta_correo: { pestana: 'cuenta', selector: '#email-edit-btn', resaltar: 'elemento', descripcion: 'el botón para añadir o cambiar el correo de recuperación' },
  cuenta_llaves: {
    pestana: 'cuenta',
    selector: '#passkey-add-btn',
    resaltar: 'elemento',
    descripcion: 'el botón para añadir una llave de acceso (Face ID, huella)',
    siOculto: 'Este navegador no admite llaves de acceso; prueba desde el móvil o con Safari, Chrome o Edge.',
  },
  cuenta_sesiones: { pestana: 'cuenta', selector: '#sessions-section', resaltar: 'elemento', descripcion: 'las sesiones abiertas y el botón para cerrar las demás' },
  cuenta_vinculadas: { pestana: 'cuenta', selector: '#linked-accounts-section', resaltar: 'elemento', descripcion: 'las cuentas vinculadas (Google, GitHub)' },
  cuenta_contrasena: { pestana: 'cuenta', selector: '#password-form', resaltar: 'elemento', descripcion: 'el formulario para cambiar la contraseña' },
  cuenta_eliminar: { pestana: 'cuenta', selector: '#delete-account-open', resaltar: 'elemento', descripcion: 'el botón para eliminar la cuenta' },

  ver_pagina_publica: { pestana: null, selector: '#view-public-link', resaltar: 'elemento', descripcion: 'el botón para ver la página pública' },
};

const CLAVES = Object.keys(DESTINOS);

// Guías ya escritas para los artículos de la base de conocimiento. Las usa
// el proveedor sin modelo tal cual, y el modelo las recibe junto al artículo
// como sugerencia que puede seguir o adaptar.
const GUIAS_POR_ARTICULO = {
  'vip-cancelar': [
    { destino: 'pestana_vip', texto: 'Todo lo de la suscripción está en la pestaña VIP.' },
    { destino: 'vip_gestionar', texto: 'Pulsa aquí: te lleva al portal de Stripe, donde puedes cancelar.' },
  ],
  'vip-contratar': [
    { destino: 'vip_demo', texto: 'Aquí ves cómo quedará la insignia en tu página.' },
    { destino: 'vip_planes', texto: 'Y aquí eliges el nivel. El pago lo procesa Stripe.' },
  ],
  'vip-que-es': [
    { destino: 'vip_demo', texto: 'Así se ve la insignia. Es un adorno, no una verificación.' },
  ],
  'cambiar-url': [
    { destino: 'perfil_url', texto: 'Escribe aquí la nueva dirección. Te avisa si ya está ocupada.' },
    { destino: 'perfil_guardar', texto: 'Y guarda. El enlace anterior deja de funcionar.' },
  ],
  'anadir-enlaces': [
    { destino: 'enlaces_agregar', texto: 'Con este botón creas un enlace nuevo.' },
    { destino: 'enlaces_lista', texto: 'Aquí los ordenas con las flechas, los ocultas con el ojo o los editas con el lápiz.' },
  ],
  imagenes: [
    { destino: 'perfil_foto', texto: 'Tu foto de perfil se cambia aquí.' },
    { destino: 'apariencia_fondo', texto: 'Y el fondo de la página, aquí.' },
  ],
  'colores-particulas': [
    { destino: 'apariencia_colores', texto: 'Estos dos colores forman el degradado de tu página.' },
    { destino: 'apariencia_particulas', texto: 'Aquí enciendes, apagas o ajustas las partículas.' },
    { destino: 'apariencia_guardar', texto: 'No olvides guardar.' },
  ],
  'verificacion-edad': [
    { destino: 'apariencia_edad', texto: 'Aquí activas el aviso y escribes sus textos.' },
  ],
  analiticas: [
    { destino: 'pestana_analiticas', texto: 'Tus estadísticas están en esta pestaña.' },
    { destino: 'analiticas_rango', texto: 'Aquí eliges el periodo que quieres ver.' },
  ],
  'correo-recuperacion': [
    { destino: 'cuenta_correo', texto: 'Añade aquí tu correo. Te llegará un enlace para confirmarlo.' },
  ],
  'dos-pasos': [
    { destino: 'cuenta_dos_pasos', texto: 'Pulsa aquí y escanea el código QR con tu app de autenticación.' },
  ],
  'face-id': [
    { destino: 'cuenta_llaves', texto: 'Pulsa aquí para registrar Face ID o tu huella en este dispositivo.' },
  ],
  sesiones: [
    { destino: 'cuenta_sesiones', texto: 'Aquí ves cuántas sesiones tienes y puedes cerrar las demás.' },
  ],
  'borrar-cuenta': [
    { destino: 'cuenta_eliminar', texto: 'Aquí se elimina la cuenta. Pide confirmación y no se puede deshacer.' },
  ],
  'contrasena-olvidada': [
    { destino: 'cuenta_contrasena', texto: 'Si ya estás dentro, cambias la contraseña aquí.' },
    { destino: 'cuenta_correo', texto: 'Y con un correo verificado podrás recuperarla si la olvidas.' },
  ],
  'vip-no-aparece': [
    { destino: 'ver_pagina_publica', texto: 'Abre tu página pública y recárgala con Ctrl+F5.' },
  ],
};

const MAX_PASOS = 6;
const MAX_TEXTO = 180;

/**
 * Valida los pasos que propone el modelo y los traduce a lo que necesita el
 * navegador. Descarta en silencio los destinos que no existen: un paso
 * inventado no debe tumbar la guía entera.
 */
function resolverPasos(pasos) {
  if (!Array.isArray(pasos)) return [];
  const salida = [];
  for (const paso of pasos) {
    if (salida.length >= MAX_PASOS) break;
    if (!paso || typeof paso !== 'object') continue;
    const clave = String(paso.destino || '');
    if (!Object.prototype.hasOwnProperty.call(DESTINOS, clave)) continue;
    const texto = String(paso.texto || '').trim().slice(0, MAX_TEXTO);
    if (!texto) continue;
    const d = DESTINOS[clave];
    salida.push({
      destino: clave,
      pestana: d.pestana,
      selector: d.selector,
      resaltar: d.resaltar,
      texto,
      siOculto: d.siOculto || null,
    });
  }
  return salida;
}

/** Lista legible para la descripción de la herramienta. */
function catalogo() {
  return CLAVES.map((clave) => `${clave}: ${DESTINOS[clave].descripcion}`).join('\n');
}

module.exports = { DESTINOS, CLAVES, GUIAS_POR_ARTICULO, resolverPasos, catalogo, MAX_PASOS };
