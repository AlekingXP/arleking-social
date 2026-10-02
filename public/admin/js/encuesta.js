(function () {
  'use strict';

  // La encuesta, por el lado de quien la responde.
  //
  // Al entrar al panel se pregunta si hay alguna pendiente. Si la hay,
  // aparece un aviso deslizándose por abajo a la derecha; al pulsarlo se
  // abre la encuesta. Nada de esto existe en la página pública.
  //
  // Dos decisiones que se notan al usarlo:
  //
  //   El aviso NO se dispara al instante. Entrar al panel y recibir algo
  //   encima en el mismo segundo se lee como un anuncio y se cierra sin
  //   mirarlo; esperar a que la página esté quieta hace que se lea.
  //
  //   Se puede cerrar y no vuelve a saltar en esa visita, pero la encuesta
  //   no se da por respondida: sigue pendiente y vuelve a aparecer al
  //   entrar de nuevo. Un "ahora no" no es un "no".
  //
  // Todo lo que viene del servidor entra por textContent. La pregunta la
  // escribe quien lleva la plataforma, pero eso no la convierte en HTML de
  // confianza: una comilla suelta no debe poder romper nada.

  var RETRASO_MS = 2200;
  var CLAVE_POSPUESTA = 'aks.encuesta.pospuesta';

  function el(tag, clase, texto) {
    var n = document.createElement(tag);
    if (clase) n.className = clase;
    if (texto != null) n.textContent = texto;
    return n;
  }

  function leerSesion(clave) {
    try { return sessionStorage.getItem(clave); } catch (e) { return null; }
  }
  function guardarSesion(clave, valor) {
    try { sessionStorage.setItem(clave, valor); } catch (e) { /* modo privado */ }
  }

  function csrf() {
    var m = document.cookie.match(/(?:^|; )csrf_token=([^;]*)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  function pedir(url, opciones) {
    var o = opciones || {};
    var cabeceras = { 'Content-Type': 'application/json' };
    if (o.method && o.method !== 'GET') cabeceras['X-CSRF-Token'] = csrf();
    return fetch(url, {
      method: o.method || 'GET',
      headers: cabeceras,
      body: o.body ? JSON.stringify(o.body) : undefined,
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (datos) {
        return { ok: r.ok, status: r.status, datos: datos };
      });
    });
  }

  // ---- El aviso ----

  var aviso = null;

  function quitarAviso() {
    if (!aviso) return;
    var n = aviso;
    aviso = null;
    n.classList.remove('visible');
    setTimeout(function () { n.remove(); }, 260);
  }

  function mostrarAviso(encuesta) {
    quitarAviso();
    aviso = el('div', 'enc-aviso');
    aviso.setAttribute('role', 'status');

    var cuerpo = el('button', 'enc-aviso-cuerpo');
    cuerpo.type = 'button';
    cuerpo.appendChild(el('span', 'enc-aviso-punto'));
    var textos = el('span', 'enc-aviso-textos');
    textos.appendChild(el('strong', null, 'Tienes una encuesta nueva'));
    textos.appendChild(el('span', 'enc-aviso-pregunta', encuesta.pregunta));
    cuerpo.appendChild(textos);
    cuerpo.addEventListener('click', function () { abrir(encuesta); });

    var cerrar = el('button', 'enc-aviso-cerrar', '✕');
    cerrar.type = 'button';
    cerrar.setAttribute('aria-label', 'Ahora no');
    cerrar.addEventListener('click', function () {
      guardarSesion(CLAVE_POSPUESTA, encuesta.id);
      quitarAviso();
    });

    aviso.append(cuerpo, cerrar);
    document.body.appendChild(aviso);
    // Un fotograma con el estado inicial aplicado, o no hay transición que
    // animar y aparece de golpe.
    void aviso.offsetWidth;
    aviso.classList.add('visible');
  }

  // ---- La encuesta ----

  var capa = null;

  function cerrarEncuesta() {
    if (!capa) return;
    var n = capa;
    capa = null;
    document.removeEventListener('keydown', alTeclado);
    n.classList.remove('visible');
    setTimeout(function () { n.remove(); }, 220);
  }

  function alTeclado(e) {
    if (e.key === 'Escape') cerrarEncuesta();
  }

  function abrir(encuesta) {
    quitarAviso();
    cerrarEncuesta();

    capa = el('div', 'enc-capa');
    var tarjeta = el('div', 'enc-tarjeta');
    tarjeta.setAttribute('role', 'dialog');
    tarjeta.setAttribute('aria-modal', 'true');
    tarjeta.setAttribute('aria-label', 'Encuesta');

    var cabecera = el('div', 'enc-cabecera');
    cabecera.appendChild(el('span', 'enc-etiqueta', 'Encuesta'));
    var x = el('button', 'enc-cerrar', '✕');
    x.type = 'button';
    x.setAttribute('aria-label', 'Cerrar');
    x.addEventListener('click', cerrarEncuesta);
    cabecera.appendChild(x);

    tarjeta.appendChild(cabecera);
    tarjeta.appendChild(el('h2', 'enc-pregunta', encuesta.pregunta));
    if (encuesta.detalle) tarjeta.appendChild(el('p', 'enc-detalle', encuesta.detalle));

    // Dos botones grandes, uno al lado del otro. Mientras no elijas una, el
    // botón de enviar no se activa: es la única respuesta obligatoria.
    var elegida = null;
    var opciones = el('div', 'enc-opciones');
    var botones = {};
    [
      { valor: 'si', icono: '👍', texto: 'Sí, estoy de acuerdo' },
      { valor: 'no', icono: '👎', texto: 'No, no estoy de acuerdo' },
    ].forEach(function (o) {
      var b = el('button', 'enc-opcion');
      b.type = 'button';
      b.setAttribute('aria-pressed', 'false');
      b.appendChild(el('span', 'enc-opcion-icono', o.icono));
      b.appendChild(el('span', null, o.texto));
      b.addEventListener('click', function () {
        elegida = o.valor;
        Object.keys(botones).forEach(function (k) {
          var sel = k === o.valor;
          botones[k].classList.toggle('elegida', sel);
          botones[k].setAttribute('aria-pressed', String(sel));
        });
        enviar.disabled = false;
        error.textContent = '';
      });
      botones[o.valor] = b;
      opciones.appendChild(b);
    });
    tarjeta.appendChild(opciones);

    var etiqueta = el('label', 'enc-campo');
    etiqueta.appendChild(el('span', null, '¿Quieres añadir algo? (opcional)'));
    var texto = document.createElement('textarea');
    texto.rows = 3;
    texto.maxLength = 1000;
    texto.placeholder = 'Lo que se te ocurra: lo leo yo.';
    etiqueta.appendChild(texto);
    tarjeta.appendChild(etiqueta);

    var error = el('p', 'enc-error');
    tarjeta.appendChild(error);

    var pie = el('div', 'enc-pie');
    var luego = el('button', 'btn-outline btn-sm', 'Ahora no');
    luego.type = 'button';
    luego.addEventListener('click', function () {
      guardarSesion(CLAVE_POSPUESTA, encuesta.id);
      cerrarEncuesta();
    });
    var enviar = el('button', 'btn-pill btn-gradient', 'Enviar respuesta');
    enviar.type = 'button';
    enviar.disabled = true;
    enviar.addEventListener('click', function () {
      if (!elegida) return;
      enviar.disabled = true;
      enviar.textContent = 'Enviando…';
      pedir('/api/encuestas/' + encodeURIComponent(encuesta.id) + '/responder', {
        method: 'POST',
        body: { respuesta: elegida, comentario: texto.value },
      }).then(function (r) {
        if (!r.ok) {
          error.textContent = (r.datos && r.datos.error) || 'No se pudo enviar. Inténtalo otra vez.';
          enviar.disabled = false;
          enviar.textContent = 'Enviar respuesta';
          return;
        }
        gracias(tarjeta);
        // Si tenía más de una pendiente, la siguiente se anuncia sola.
        var siguiente = r.datos && r.datos.siguiente;
        if (siguiente) setTimeout(function () { mostrarAviso(siguiente); }, 2200);
      }).catch(function () {
        error.textContent = 'Se cortó la conexión. Inténtalo otra vez.';
        enviar.disabled = false;
        enviar.textContent = 'Enviar respuesta';
      });
    });
    pie.append(luego, enviar);
    tarjeta.appendChild(pie);

    capa.appendChild(tarjeta);
    capa.addEventListener('click', function (e) { if (e.target === capa) cerrarEncuesta(); });
    document.addEventListener('keydown', alTeclado);
    document.body.appendChild(capa);
    void capa.offsetWidth;
    capa.classList.add('visible');
    // El foco entra en la tarjeta, o con el teclado te quedas detrás de ella.
    botones.si.focus({ preventScroll: true });
  }

  function gracias(tarjeta) {
    tarjeta.textContent = '';
    tarjeta.classList.add('enc-gracias');
    tarjeta.appendChild(el('div', 'enc-tic', '✓'));
    tarjeta.appendChild(el('h2', 'enc-pregunta', '¡Gracias!'));
    tarjeta.appendChild(el('p', 'enc-detalle', 'Tu respuesta ya me llegó.'));
    setTimeout(cerrarEncuesta, 1800);
  }

  // ---- Arranque ----

  function buscarPendiente() {
    pedir('/api/encuestas/pendiente').then(function (r) {
      var encuesta = r.ok && r.datos && r.datos.encuesta;
      if (!encuesta) return;
      // "Ahora no" vale para esta visita, no para siempre.
      if (leerSesion(CLAVE_POSPUESTA) === encuesta.id) return;
      mostrarAviso(encuesta);
    }).catch(function () { /* sin encuesta se sigue igual */ });
  }

  function arrancar() {
    // Se espera a que la página esté quieta: la encuesta no tiene prisa y
    // compite con lo que la persona vino a hacer.
    if ('requestIdleCallback' in window) {
      requestIdleCallback(function () { setTimeout(buscarPendiente, RETRASO_MS); }, { timeout: 4000 });
    } else {
      setTimeout(buscarPendiente, RETRASO_MS);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', arrancar, { once: true });
  } else {
    arrancar();
  }

  // Para que el panel de quien la crea pueda enseñar una vista previa real
  // en vez de una captura que se quede vieja.
  window.AKEncuesta = { abrir: abrir, avisar: mostrarAviso };
})();
