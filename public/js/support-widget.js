/* Widget de soporte.
 *
 * Se monta solo: basta con incluir el script y aparece el botón flotante.
 * No hay nada que llamar ni que configurar desde la página.
 *
 * Dos decisiones que conviene no deshacer:
 *
 *  1. Todo el texto que viene del servidor entra con `textContent`, nunca
 *     con innerHTML. En este chat se muestran tres cosas de origen ajeno
 *     —lo que escribe el visitante, lo que responde el modelo y lo que
 *     escribe soporte— y cualquiera de las tres puede traer `<script>`.
 *     El único innerHTML que hay son iconos SVG escritos aquí a mano, sin
 *     ni una interpolación.
 *
 *  2. El identificador de la conversación se guarda en localStorage junto a
 *     su testigo. Es lo que permite volver al día siguiente y encontrar la
 *     respuesta de una persona en el mismo hilo. Si el navegador bloquea el
 *     almacenamiento, el chat sigue funcionando: se pierde la continuidad,
 *     no la conversación en curso.
 */
(function () {
  'use strict';

  var CLAVE = 'aks.soporte.hilo';
  var API = '/api/support';

  var SUGERENCIAS = [
    '¿Qué es la insignia VIP?',
    '¿Cómo cancelo mi suscripción?',
    '¿Cómo cambio la URL de mi página?',
    'Quiero hablar con una persona',
  ];

  var ICONO_CHAT = '<svg class="sup-icon-chat" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>'
    + '<svg class="sup-icon-close" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';

  var ICONO_ENVIAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>';

  // ---- Almacenamiento tolerante a fallos ----

  function leerHilo() {
    try {
      var crudo = localStorage.getItem(CLAVE);
      if (!crudo) return null;
      var dato = JSON.parse(crudo);
      return dato && dato.conversationId && dato.secret ? dato : null;
    } catch (e) {
      return null;
    }
  }

  function guardarHilo(dato) {
    try {
      localStorage.setItem(CLAVE, JSON.stringify(dato));
    } catch (e) {
      // Modo privado o almacenamiento bloqueado: sin continuidad entre
      // visitas, pero la conversación de ahora sigue viva en memoria.
    }
  }

  function olvidarHilo() {
    try {
      localStorage.removeItem(CLAVE);
    } catch (e) { /* nada que hacer */ }
  }

  // En qué página pública está escribiendo, si es que está en una. Se saca
  // de la URL y no de un atributo en el HTML para que el widget siga siendo
  // "incluir el script y ya": una sola ruta de un segmento que no sea una
  // página del sitio es el slug de alguien.
  var NO_SON_PERFILES = ['admin', 'terminos', 'privacidad', 'reembolsos', 'api', 'uploads'];

  function slugDeLaPagina() {
    var partes = window.location.pathname.split('/').filter(Boolean);
    if (partes.length !== 1) return null;
    if (NO_SON_PERFILES.indexOf(partes[0]) !== -1) return null;
    return partes[0];
  }

  function csrf() {
    var m = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  function pedir(ruta, opciones) {
    var opts = opciones || {};
    var cabeceras = { 'Content-Type': 'application/json' };
    // Sólo hace falta cuando hay sesión iniciada, pero mandarlo siempre no
    // molesta y evita que el chat se rompa al entrar al panel.
    var token = csrf();
    if (token) cabeceras['X-CSRF-Token'] = token;

    return fetch(API + ruta, {
      method: opts.method || 'GET',
      headers: cabeceras,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (datos) {
        return { ok: res.ok, status: res.status, datos: datos };
      });
    });
  }

  // ---- Construcción del widget ----

  function el(tag, clase, texto) {
    var nodo = document.createElement(tag);
    if (clase) nodo.className = clase;
    if (texto != null) nodo.textContent = texto;
    return nodo;
  }

  function montar() {
    var raiz = el('div', 'sup');
    raiz.setAttribute('data-sup', '');

    // ---- Panel ----
    var panel = el('div', 'sup-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Ayuda de ArleKing Social');
    // Arranca inerte: el panel está plegado y su contenido no debe recibir
    // el foco al tabular por la página.
    panel.inert = true;

    var cabecera = el('div', 'sup-head');
    var avatar = el('div', 'sup-avatar', '✦');
    avatar.setAttribute('aria-hidden', 'true');
    var textos = el('div');
    var titulo = el('p', 'sup-title', 'Ayuda');
    var sub = el('p', 'sup-sub');
    var pulso = el('span', 'sup-pulse');
    pulso.setAttribute('aria-hidden', 'true');
    var subTexto = el('span', null, 'Respuesta inmediata');
    sub.append(pulso, subTexto);
    textos.append(titulo, sub);
    cabecera.append(avatar, textos);

    var registro = el('div', 'sup-log');
    registro.setAttribute('role', 'log');
    registro.setAttribute('aria-live', 'polite');

    var sugerencias = el('div', 'sup-sugerencias');

    var formulario = el('form', 'sup-form');
    var entrada = el('textarea', 'sup-input');
    entrada.rows = 1;
    entrada.placeholder = 'Escribe tu pregunta…';
    entrada.maxLength = 2000;
    entrada.setAttribute('aria-label', 'Tu pregunta');
    var enviar = el('button', 'sup-enviar');
    enviar.type = 'submit';
    enviar.setAttribute('aria-label', 'Enviar');
    enviar.innerHTML = ICONO_ENVIAR;
    formulario.append(entrada, enviar);

    var contacto = el('form', 'sup-contacto');
    contacto.hidden = true;
    var correo = el('input');
    correo.type = 'email';
    correo.placeholder = 'Tu correo (opcional, para responderte)';
    correo.setAttribute('aria-label', 'Tu correo');
    var botonContacto = el('button', null, 'Pasar mi consulta a una persona');
    botonContacto.type = 'submit';
    contacto.append(correo, botonContacto);

    var pie = el('p', 'sup-pie');
    pie.append(document.createTextNode('Asistente automático. '));
    var enlaceLegal = el('a', null, 'Términos');
    enlaceLegal.href = '/terminos';
    pie.append(enlaceLegal, document.createTextNode(' · '));
    var enlacePriv = el('a', null, 'Privacidad');
    enlacePriv.href = '/privacidad';
    pie.append(enlacePriv);

    panel.append(cabecera, registro, sugerencias, contacto, formulario, pie);

    // ---- Botón ----
    var boton = el('button', 'sup-launcher');
    boton.type = 'button';
    boton.setAttribute('aria-label', 'Abrir la ayuda');
    boton.setAttribute('aria-expanded', 'false');
    boton.innerHTML = ICONO_CHAT;
    var punto = el('span', 'sup-dot');
    punto.hidden = true;
    boton.appendChild(punto);

    raiz.append(panel, boton);
    document.body.appendChild(raiz);

    return {
      raiz: raiz, panel: panel, registro: registro, sugerencias: sugerencias,
      formulario: formulario, entrada: entrada, enviar: enviar,
      contacto: contacto, correo: correo, boton: boton, punto: punto,
      sub: subTexto, pulso: pulso,
    };
  }

  // ---- Lógica ----

  function iniciar() {
    var ui = montar();
    var hilo = leerHilo();
    var abierto = false;
    var enviando = false;
    var asistenteActivo = true;
    var hiloCargado = false;
    var nodoEscribiendo = null;

    function alFondo() {
      ui.registro.scrollTop = ui.registro.scrollHeight;
    }

    function burbuja(rol, texto, quien) {
      var nodo = el('div', 'sup-msg de-' + rol);
      if (quien) {
        var etiqueta = el('span', 'sup-quien', quien);
        nodo.appendChild(etiqueta);
      }
      // textContent y no innerHTML: esto viene de fuera.
      nodo.appendChild(document.createTextNode(texto));
      ui.registro.appendChild(nodo);
      alFondo();
      return nodo;
    }

    function aviso(texto, referencia) {
      var nodo = el('div', 'sup-aviso');
      nodo.appendChild(document.createTextNode(texto));
      if (referencia) {
        nodo.appendChild(document.createTextNode(' Referencia: '));
        nodo.appendChild(el('span', 'sup-ref', referencia));
      }
      ui.registro.appendChild(nodo);
      alFondo();
    }

    function mostrarEscribiendo() {
      nodoEscribiendo = el('div', 'sup-escribiendo');
      nodoEscribiendo.append(el('i'), el('i'), el('i'));
      ui.registro.appendChild(nodoEscribiendo);
      alFondo();
    }

    function quitarEscribiendo() {
      if (nodoEscribiendo && nodoEscribiendo.parentNode) nodoEscribiendo.remove();
      nodoEscribiendo = null;
    }

    function pintarSugerencias() {
      ui.sugerencias.textContent = '';
      SUGERENCIAS.forEach(function (texto) {
        var chip = el('button', 'sup-chip', texto);
        chip.type = 'button';
        chip.addEventListener('click', function () {
          ui.sugerencias.hidden = true;
          mandar(texto);
        });
        ui.sugerencias.appendChild(chip);
      });
      ui.sugerencias.hidden = false;
    }

    function bienvenida() {
      burbuja('asistente', asistenteActivo
        ? '¡Hola! Soy el asistente de ArleKing Social. Pregúntame lo que quieras sobre tu página, la insignia VIP o tu cuenta, y si no lo sé te paso con una persona.'
        : 'Hola. Busco por ti en la ayuda y, si no encuentras lo que necesitas, paso tu consulta a una persona del equipo.');
      pintarSugerencias();
    }

    function pintarHistorial(mensajes) {
      ui.registro.textContent = '';
      mensajes.forEach(function (m) {
        if (m.role === 'visitante') burbuja('visitante', m.body);
        else if (m.role === 'soporte') burbuja('soporte', m.body, 'Equipo de ArleKing');
        else burbuja('asistente', m.body);
      });
    }

    /** Trae el hilo guardado. Es lo que hace visible la respuesta humana. */
    function cargarHilo() {
      if (!hilo) { bienvenida(); hiloCargado = true; return Promise.resolve(); }

      return pedir('/thread?conversationId=' + encodeURIComponent(hilo.conversationId)
        + '&secret=' + encodeURIComponent(hilo.secret))
        .then(function (r) {
          hiloCargado = true;
          if (!r.ok || !r.datos.messages || !r.datos.messages.length) {
            // Caducó o se limpió por el barrido: se empieza de cero sin
            // decírselo a nadie, porque no cambia nada para quien pregunta.
            olvidarHilo();
            hilo = null;
            bienvenida();
            return;
          }
          pintarHistorial(r.datos.messages);
          if (r.datos.ticket && r.datos.ticket.status !== 'cerrado') {
            aviso('Tu consulta está con el equipo.', r.datos.ticket.reference);
          }
          if (r.datos.maxed) {
            aviso('Esta conversación ya es larga. Recarga la página para empezar una nueva.');
            bloquear();
          }
        })
        .catch(function () {
          hiloCargado = true;
          bienvenida();
        });
    }

    function bloquear() {
      ui.entrada.disabled = true;
      ui.enviar.disabled = true;
      ui.entrada.placeholder = 'Conversación cerrada';
    }

    function marcarSinLeer(hay) {
      ui.punto.hidden = !hay;
    }

    function mandar(texto) {
      if (enviando || !texto) return;
      enviando = true;
      ui.enviar.disabled = true;
      ui.sugerencias.hidden = true;

      burbuja('visitante', texto);
      mostrarEscribiendo();

      var cuerpo = { message: texto };
      if (hilo) { cuerpo.conversationId = hilo.conversationId; cuerpo.secret = hilo.secret; }
      var slug = slugDeLaPagina();
      if (slug) cuerpo.slug = slug;

      pedir('/chat', { method: 'POST', body: cuerpo })
        .then(function (r) {
          quitarEscribiendo();

          if (!r.ok) {
            burbuja('asistente', r.datos.error || 'No pude responder ahora mismo. Inténtalo de nuevo en un momento.');
            if (r.datos.maxed) bloquear();
            mostrarContacto();
            return;
          }

          if (r.datos.conversationId && r.datos.secret) {
            hilo = { conversationId: r.datos.conversationId, secret: r.datos.secret };
            guardarHilo(hilo);
          }

          burbuja('asistente', r.datos.reply);

          if (r.datos.ticket) {
            aviso('He pasado tu consulta a una persona del equipo. Te responderán aquí mismo.', r.datos.ticket.reference);
            ui.contacto.hidden = true;
          } else if (r.datos.offerTicket) {
            mostrarContacto();
          }
        })
        .catch(function () {
          quitarEscribiendo();
          burbuja('asistente', 'Se me cayó la conexión. Inténtalo otra vez en un momento.');
        })
        .finally(function () {
          enviando = false;
          ui.enviar.disabled = false;
          ui.entrada.focus();
        });
    }

    function mostrarContacto() {
      ui.contacto.hidden = false;
    }

    // ---- Apertura y cierre ----

    function alternar(forzar) {
      abierto = forzar != null ? forzar : !abierto;
      ui.raiz.classList.toggle('is-open', abierto);
      ui.panel.inert = !abierto;
      ui.boton.setAttribute('aria-expanded', String(abierto));
      ui.boton.setAttribute('aria-label', abierto ? 'Cerrar la ayuda' : 'Abrir la ayuda');

      if (abierto) {
        marcarSinLeer(false);
        var listo = hiloCargado ? Promise.resolve() : cargarHilo();
        listo.then(function () {
          alFondo();
          if (!ui.entrada.disabled) ui.entrada.focus();
        });
      }
    }

    ui.boton.addEventListener('click', function () { alternar(); });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && abierto) {
        alternar(false);
        ui.boton.focus();
      }
    });

    ui.formulario.addEventListener('submit', function (e) {
      e.preventDefault();
      var texto = ui.entrada.value.trim();
      if (!texto) return;
      ui.entrada.value = '';
      ui.entrada.style.height = 'auto';
      mandar(texto);
    });

    // Enter envía, Mayús+Enter hace salto de línea: es lo que espera
    // cualquiera que haya usado un chat.
    ui.entrada.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        ui.formulario.requestSubmit();
      }
    });

    // El campo crece con el texto hasta el tope que marca el CSS.
    ui.entrada.addEventListener('input', function () {
      ui.entrada.style.height = 'auto';
      ui.entrada.style.height = Math.min(ui.entrada.scrollHeight, 110) + 'px';
    });

    ui.contacto.addEventListener('submit', function (e) {
      e.preventDefault();
      var mensajes = [].slice.call(ui.registro.querySelectorAll('.sup-msg.de-visitante'));
      var ultimo = mensajes.length ? mensajes[mensajes.length - 1].textContent : '';
      if (ultimo.length < 10) {
        burbuja('asistente', 'Cuéntame primero qué necesitas y lo paso al equipo con el detalle.');
        return;
      }

      var cuerpo = { body: ultimo, subject: ultimo.slice(0, 70) };
      if (ui.correo.value.trim()) cuerpo.email = ui.correo.value.trim();
      if (hilo) { cuerpo.conversationId = hilo.conversationId; cuerpo.secret = hilo.secret; }

      pedir('/ticket', { method: 'POST', body: cuerpo }).then(function (r) {
        if (!r.ok) {
          burbuja('asistente', r.datos.error || 'No pude abrir la consulta. Inténtalo de nuevo.');
          return;
        }
        if (r.datos.conversationId && r.datos.secret) {
          hilo = { conversationId: r.datos.conversationId, secret: r.datos.secret };
          guardarHilo(hilo);
        }
        ui.contacto.hidden = true;
        aviso(r.datos.emailNotice
          ? 'Listo. Te avisamos por correo en cuanto te respondan.'
          : 'Listo, el equipo ya lo tiene. Vuelve por aquí para ver la respuesta.',
          r.datos.ticket.reference);
      });
    });

    // ---- Estado del servicio ----

    pedir('/status').then(function (r) {
      if (!r.ok) return;
      asistenteActivo = Boolean(r.datos.assistant);
      if (!asistenteActivo) {
        ui.sub.textContent = 'Te ayudo a buscar';
        ui.pulso.style.background = '#fbbf24';
      }
    }).catch(function () { /* el widget funciona igual sin esto */ });

    // Si quedó una conversación abierta, se mira si hay respuesta nueva sin
    // abrir el panel: el punto verde es lo que hace que alguien vuelva.
    if (hilo) {
      pedir('/thread?conversationId=' + encodeURIComponent(hilo.conversationId)
        + '&secret=' + encodeURIComponent(hilo.secret))
        .then(function (r) {
          if (!r.ok || !r.datos.messages) return;
          var ultimo = r.datos.messages[r.datos.messages.length - 1];
          if (ultimo && ultimo.role === 'soporte') marcarSinLeer(true);
        })
        .catch(function () { /* sin aviso, nada roto */ });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar);
  } else {
    iniciar();
  }
})();
