'use strict';

// Base de conocimiento inicial.
//
// Esto es lo que el asistente sabe el primer día. Se siembra en la tabla
// `support_articles` la primera vez que arranca y a partir de ahí el dueño
// la edita desde el panel: los artículos viven en la base de datos, no
// aquí, porque enseñarle algo nuevo al asistente no debería requerir un
// despliegue.
//
// Todo lo que sigue está copiado de lo que la plataforma hace de verdad y
// de las páginas legales publicadas. Es importante que siga siéndolo: el
// asistente responde CON esto y sólo con esto, así que un dato desfasado
// aquí se convierte en una respuesta falsa dada con total seguridad. Si
// cambia un precio, cambia aquí.

const ARTICLES = [
  {
    slug: 'que-es',
    question: '¿Qué es ArleKing Social?',
    tags: 'que es, para que sirve, plataforma, bio link, enlaces',
    answer: [
      'ArleKing Social es una plataforma para crear tu página pública de enlaces: una sola dirección que reúne todas tus redes sociales, con tu nombre, tu foto, tu descripción y los enlaces que quieras.',
      'Tu página queda en arleking-social.net/tu-nombre y puedes compartirla donde sea.',
      'Crear la cuenta y usar la plataforma es gratis. Lo único de pago es la insignia VIP, que es un adorno opcional.',
    ].join('\n\n'),
  },
  {
    slug: 'crear-cuenta',
    question: '¿Cómo creo una cuenta?',
    tags: 'registro, registrarme, crear cuenta, nueva cuenta, empezar',
    answer: [
      'Entra a arleking-social.net y pulsa el botón de crear cuenta. Necesitas un nombre de usuario y una contraseña.',
      'También puedes entrar directamente con Google o con GitHub, sin escribir ninguna contraseña.',
      'Al crear la cuenta se genera tu página con tres enlaces de ejemplo que puedes editar o borrar desde el panel.',
    ].join('\n\n'),
  },
  {
    slug: 'cambiar-url',
    question: '¿Cómo cambio la dirección (URL) de mi página?',
    tags: 'url, direccion, slug, enlace de mi pagina, nombre de la pagina, cambiar',
    answer: [
      'En tu panel, pestaña Perfil, sección Identidad. Ahí está el campo de la dirección de tu página.',
      'Al escribir se comprueba en el momento si está libre. Hay nombres reservados (admin, api, login y algunos más) que no se pueden usar porque chocarían con páginas del propio sitio.',
      'Ojo: al cambiarla, el enlace anterior deja de funcionar. Si ya la compartiste, actualízala donde la tengas puesta.',
    ].join('\n\n'),
  },
  {
    slug: 'anadir-enlaces',
    question: '¿Cómo añado, edito u ordeno mis enlaces?',
    tags: 'enlaces, links, anadir, agregar, editar, borrar, ordenar, orden',
    answer: [
      'En tu panel, pestaña Enlaces. Desde ahí puedes crear uno nuevo, editar los que ya tienes, activarlos o desactivarlos sin borrarlos, y cambiarles el orden arrastrándolos.',
      'Cada enlace admite un título, un subtítulo, un icono o una imagen, y dos etiquetas pequeñas a los lados.',
      'Un enlace desactivado deja de verse en tu página pública pero no se pierde: sigue guardado para cuando lo quieras volver a mostrar.',
    ].join('\n\n'),
  },
  {
    slug: 'enlace-rechazado',
    question: 'Me dice que mi enlace no se puede guardar',
    tags: 'enlace rechazado, no me deja guardar, url bloqueada, error al guardar enlace',
    answer: [
      'La plataforma revisa cada enlace antes de guardarlo y bloquea sólo lo que no tiene ningún uso legítimo en una página de bio: direcciones que ejecutan código en el navegador o que llevan caracteres de control escondidos.',
      'Si tu enlace es una dirección web normal (empieza por https://) y aun así lo rechaza, es un fallo nuestro y queremos verlo. Cuéntamelo y lo paso a revisión.',
    ].join('\n\n'),
  },
  {
    slug: 'imagenes',
    question: '¿Cómo cambio mi foto de perfil o el fondo?',
    tags: 'foto, avatar, imagen, fondo, background, subir imagen',
    answer: [
      'En tu panel: la foto de perfil está en la pestaña Perfil (sección Identidad) y el fondo en la pestaña Apariencia (sección Fondo).',
      'Se suben desde tu dispositivo. Se recomienda una foto cuadrada para el avatar y una imagen apaisada y bastante grande para el fondo, porque se muestra a pantalla completa.',
    ].join('\n\n'),
  },
  {
    slug: 'colores-particulas',
    question: '¿Puedo cambiar los colores y los efectos de mi página?',
    tags: 'colores, personalizar, apariencia, particulas, nodos, diseno, tema',
    answer: [
      'Sí, en la pestaña Apariencia del panel.',
      'Los colores se eligen con dos tonos que forman el degradado de tu página: se aplica a los botones, al brillo del fondo y a los detalles.',
      'Los nodos de fondo (las partículas que se mueven) se pueden encender o apagar, cambiar de color y ajustar de densidad. Si prefieres una página más sobria, apágalos.',
    ].join('\n\n'),
  },
  {
    slug: 'verificacion-edad',
    question: '¿Qué es la verificación de edad?',
    tags: 'verificacion de edad, mayor de edad, +18, aviso, age gate',
    answer: [
      'Es un aviso opcional que aparece antes de tu página y pide confirmar que quien entra es mayor de edad.',
      'Se activa en la pestaña Apariencia, sección Verificación de edad, y puedes escribir tú mismo el título, el subtítulo y el texto del botón.',
      'Es un aviso, no una comprobación real de identidad: nadie sube ningún documento.',
    ].join('\n\n'),
  },
  {
    slug: 'vip-que-es',
    question: '¿Qué es la insignia VIP y qué incluye?',
    tags: 'vip, insignia, badge, corona, verificado, que incluye',
    answer: [
      'La insignia VIP es un sello decorativo que aparece junto a tu nombre en tu página pública mientras la suscripción esté activa.',
      'Es importante que quede claro: es un adorno cosmético. NO es una verificación de identidad, no acredita que seas famoso ni que sea una cuenta oficial, y no comprueba quién eres. Al contratarla estás pagando por el sello y por nada más.',
      'Hay dos niveles: Dollars, por 5 USD al mes, y THE KING, por 7,99 USD al mes.',
    ].join('\n\n'),
  },
  {
    slug: 'vip-contratar',
    question: '¿Cómo contrato la insignia VIP?',
    tags: 'contratar, comprar vip, suscribirme, pagar, suscripcion',
    answer: [
      'En tu panel, pestaña VIP. Ahí ves los dos niveles con una demostración de cómo se verá tu página, y eliges el que quieras.',
      'El pago lo procesa Stripe en su propia página segura. ArleKing Social nunca ve ni guarda los datos de tu tarjeta.',
      'En cuanto Stripe confirma el pago, la insignia aparece en tu página. Suele ser inmediato.',
    ].join('\n\n'),
  },
  {
    slug: 'vip-cancelar',
    question: '¿Cómo cancelo mi suscripción?',
    tags: 'cancelar, baja, dar de baja, anular, dejar de pagar, suscripcion',
    answer: [
      'Puedes cancelar cuando quieras y sin dar explicaciones. En tu panel, pestaña VIP, pulsa "Gestionar suscripción" y luego "Cancelar suscripción".',
      'Ese botón te lleva al portal seguro de Stripe, donde además puedes cambiar tu método de pago o descargar tus facturas.',
      'Al cancelar: no se te vuelve a cobrar, conservas la insignia hasta que termine el mes que ya pagaste, y al acabar ese periodo desaparece sola. Tu cuenta y tu página siguen funcionando igual.',
    ].join('\n\n'),
  },
  {
    slug: 'reembolsos',
    question: '¿Hay reembolsos?',
    tags: 'reembolso, devolucion, devolver dinero, me cobraron, refund',
    answer: [
      'La suscripción VIP no ofrece reembolsos. Es un producto digital que se entrega de inmediato: en cuanto el pago se confirma, la insignia ya está visible en tu página, así que no hay una parte sin consumir que devolver.',
      'Lo que sí puedes hacer en cualquier momento es cancelar la renovación, y conservas la insignia hasta el final del mes que ya pagaste.',
      'Hay tres excepciones que sí se revisan caso por caso y pueden acabar en devolución: un cobro duplicado por un error técnico nuestro, un cobro después de haber cancelado correctamente, o haber pagado y que la insignia nunca llegara a activarse por un fallo de la plataforma.',
    ].join('\n\n'),
  },
  {
    slug: 'vip-no-aparece',
    question: 'Pagué y la insignia no aparece',
    tags: 'no aparece, pague y nada, insignia no sale, no se activo, problema pago',
    answer: [
      'La insignia se activa cuando Stripe confirma el pago, y eso suele tardar segundos. Si ya pasó un rato:',
      'Primero recarga tu página pública con la caché limpia (Ctrl+F5, o Cmd+Shift+R en Mac). A veces el navegador sigue mostrando la versión anterior.',
      'Si sigue sin aparecer, es un caso que se revisa a mano y entra dentro de las excepciones de reembolso. Cuéntamelo con tu nombre de usuario y la fecha del cobro y lo paso al equipo.',
    ].join('\n\n'),
  },
  {
    slug: 'cobro-no-reconocido',
    question: 'Veo un cobro que no reconozco',
    tags: 'cobro desconocido, cargo, no reconozco, disputa, banco',
    answer: [
      'Lo mejor es contactarnos antes de abrir una disputa con el banco: casi siempre se resuelve más rápido directamente.',
      'Hace falta el nombre de usuario y la fecha del cargo. Si quieres, abro ahora mismo un ticket con esos datos.',
    ].join('\n\n'),
  },
  {
    slug: 'analiticas',
    question: '¿Qué son las analíticas y qué miden?',
    tags: 'analiticas, estadisticas, visitas, clics, metricas, ip, direccion ip, cookies, rastreo',
    answer: [
      'En la pestaña Analíticas de tu panel ves cuánta gente entra a tu página, de dónde viene, con qué navegador y dispositivo, y qué enlaces pulsa.',
      'Están medidas sin cookies y sin rastreadores. No se guarda la dirección IP de nadie: se usa sólo en memoria para calcular un identificador con una clave que cambia cada día, así que se puede contar cuánta gente distinta entró hoy sin poder seguir a nadie a lo largo del tiempo.',
      'Por eso tampoco hace falta banner de consentimiento: no se almacena nada en el dispositivo de quien visita.',
    ].join('\n\n'),
  },
  {
    slug: 'privacidad-datos',
    question: '¿Qué datos guardan de mí?',
    tags: 'privacidad, datos, informacion personal, gdpr, que guardan',
    answer: [
      'De tu cuenta: nombre de usuario y contraseña (guardada como hash Argon2id, nunca en texto plano), y un correo sólo si lo añades tú para poder recuperar la cuenta.',
      'De tu perfil público: nombre, descripción, enlaces, las imágenes que subas y tus opciones visuales.',
      'De tu actividad: la fecha de tu último acceso, que sirve para la limpieza de cuentas inactivas.',
      'Si vinculas Google o GitHub, se guarda tu identificador y tu correo de ese proveedor.',
      'Los datos se comparten sólo con Stripe (pagos), Render (alojamiento) y el proveedor de inicio de sesión que elijas. Está todo detallado en la página de Privacidad.',
    ].join('\n\n'),
  },
  {
    slug: 'contrasena-olvidada',
    question: 'Olvidé mi contraseña',
    tags: 'contrasena, password, olvide, recuperar, restablecer, entrar, acceso, perdi acceso, bloqueado',
    answer: [
      'En la pantalla de inicio de sesión hay un enlace para recuperar el acceso. Se envía un correo con un enlace para poner una contraseña nueva.',
      'Esto sólo funciona si antes añadiste un correo a tu cuenta y lo verificaste. Si nunca lo hiciste, no hay forma automática de recuperar el acceso, precisamente porque no se puede comprobar que la cuenta es tuya.',
      'Si entras con Google o GitHub, puedes seguir entrando por ahí aunque no recuerdes la contraseña.',
    ].join('\n\n'),
  },
  {
    slug: 'correo-recuperacion',
    question: '¿Cómo añado un correo de recuperación?',
    tags: 'correo, email, recuperacion, verificar correo, anadir correo',
    answer: [
      'En tu panel, pestaña Cuenta, sección Seguridad. Escribes el correo y se te envía un enlace de confirmación.',
      'Hasta que pulses ese enlace el correo queda como "sin verificar" y no sirve para recuperar la cuenta. La diferencia importa: escribirlo demuestra que lo escribiste, pulsar el enlace demuestra que es tuyo.',
      'Es lo más útil que puedes hacer hoy por tu cuenta: sin correo verificado, perder la contraseña significa perder el acceso.',
    ].join('\n\n'),
  },
  {
    slug: 'dos-pasos',
    question: '¿Cómo activo la verificación en dos pasos?',
    tags: 'dos pasos, 2fa, mfa, totp, codigo, authenticator, seguridad',
    answer: [
      'En tu panel, pestaña Cuenta, sección Seguridad. Se escanea un código QR con una app como Google Authenticator, Authy o 1Password, y se confirma con un código de seis dígitos.',
      'Al activarla se te muestran unos códigos de recuperación de un solo uso. Guárdalos: son la única forma de entrar si pierdes el teléfono. No se vuelven a mostrar.',
      'El código no se pide en cada entrada. Tras verificarlo, el dispositivo queda como de confianza durante 24 horas y en ese plazo basta con la contraseña.',
    ].join('\n\n'),
  },
  {
    slug: 'face-id',
    question: '¿Puedo entrar con Face ID o con la huella?',
    tags: 'face id, huella, biometrico, passkey, llave de acceso, windows hello, touch id',
    answer: [
      'Sí. La plataforma admite llaves de acceso (passkeys), que es la tecnología detrás de Face ID, Touch ID, Windows Hello y el lector de huella del móvil.',
      'Se registran desde tu panel, pestaña Cuenta, sección Seguridad, con el botón de añadir llave de acceso. Tu cara o tu huella nunca salen de tu dispositivo: sólo se envía una firma.',
      'Una vez registrada, en la pantalla de inicio de sesión aparece el botón para entrar con ella.',
    ].join('\n\n'),
  },
  {
    slug: 'sesiones',
    question: '¿Puedo cerrar sesión en otros dispositivos?',
    tags: 'sesiones, dispositivos, cerrar sesion, otros dispositivos, robaron',
    answer: [
      'Sí. En tu panel, pestaña Cuenta, sección Seguridad, ves cuántas sesiones tienes abiertas y puedes cerrar todas las demás sin cerrar la tuya.',
      'Si crees que alguien entró en tu cuenta, el orden correcto es: cambia la contraseña primero y cierra las otras sesiones después. Al revés, quien tenga la contraseña simplemente vuelve a entrar.',
    ].join('\n\n'),
  },
  {
    slug: 'borrar-cuenta',
    question: '¿Cómo elimino mi cuenta?',
    tags: 'borrar cuenta, eliminar cuenta, darme de baja, cerrar cuenta',
    answer: [
      'En tu panel, pestaña Cuenta, sección Zona de peligro. Se pide confirmación porque no tiene vuelta atrás.',
      'Al eliminarla se borran tu página, tus enlaces y las imágenes que subiste. Si tienes una suscripción activa, cancélala antes desde la pestaña VIP para que no se genere un cobro nuevo.',
    ].join('\n\n'),
  },
  {
    slug: 'cuentas-inactivas',
    question: '¿Qué pasa si no entro durante mucho tiempo?',
    tags: 'inactividad, inactiva, borran mi cuenta, 6 meses, tiempo sin entrar',
    answer: [
      'Las cuentas sin actividad durante 6 meses se eliminan automáticamente junto con sus archivos.',
      'Iniciar sesión reinicia el contador, así que con entrar de vez en cuando es suficiente.',
    ].join('\n\n'),
  },
  {
    slug: 'uso-aceptable',
    question: '¿Qué no puedo publicar en mi página?',
    tags: 'reglas, prohibido, uso aceptable, normas, suspension',
    answer: [
      'No se puede suplantar a otra persona, marca u organización; publicar contenido ilegal o enlaces a material que lo sea; ni intentar vulnerar, sobrecargar o interferir con el servicio.',
      'Las cuentas que incumplen esas reglas se pueden suspender o eliminar. Si se cancela una cuenta por incumplimiento, la suscripción se da de baja y no se generan cobros nuevos.',
    ].join('\n\n'),
  },
  {
    slug: 'contacto',
    question: '¿Cómo contacto con una persona?',
    tags: 'contacto, humano, hablar con alguien, soporte, correo, ayuda real',
    answer: [
      'Puedo abrir un ticket aquí mismo y llega directo al panel de soporte: sólo dime qué necesitas y, si quieres respuesta por correo, tu dirección.',
      'También puedes escribir directamente a ale-king@storexp.net.',
    ].join('\n\n'),
  },
];

module.exports = { ARTICLES };
