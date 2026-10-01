/* Asistente virtual del panel.
 *
 * Se monta solo: basta con incluir el script. Hoy sólo lo incluye el panel,
 * y sus endpoints piden sesión — no sirve en una página pública.
 *
 * Qué hace:
 *   · Un personaje flota en la esquina y sigue el cursor con la mirada. Es
 *     una imagen fija al cargar y pasa a 3D en vivo cuando la página ya está
 *     quieta y el dispositivo aguanta (personaje.js). Sin 3D, la imagen
 *     flota y se inclina hacia el cursor con CSS.
 *   · Al pulsarlo se abre el chat. La respuesta llega en vivo, frase a
 *     frase, y el personaje piensa, habla y escucha según lo que pasa.
 *   · Voz (voz.js): el micrófono abre un modo conversación —escucha,
 *     responde en voz alta y vuelve a escuchar— hasta que lo cierras.
 *   · Guía (guia.js): cuando la respuesta implica hacer algo, el asistente
 *     lo señala en tu propio panel, paso a paso, y el personaje mira hacia
 *     donde señala.
 *   · Si no puede resolverlo, abre un ticket en el buzón que ya existía, y
 *     la respuesta de la persona aparece en este mismo hilo.
 *
 * Dos decisiones que conviene no deshacer:
 *
 *  1. Todo el texto que viene del servidor entra con textContent, nunca con
 *     innerHTML. Aquí se muestra lo que escribe la persona, lo que responde
 *     el modelo y lo que escribe soporte, y cualquiera puede traer <script>.
 *     Los únicos innerHTML son iconos SVG escritos aquí, sin interpolar.
 *
 *  2. El hilo se guarda en localStorage con su testigo, para volver al día
 *     siguiente y encontrar la respuesta humana. Si el almacenamiento está
 *     bloqueado, el chat funciona igual; sólo se pierde la continuidad.
 */
(function () {
  'use strict';

  var CLAVE_HILO = 'aks.soporte.hilo';
  var CLAVE_VOZ = 'aks.soporte.voz';
  var CLAVE_SALUDO = 'aks.soporte.saludo';
  var API = '/api/support';
  var POSTER = '/models/asistente-poster.webp';

  var movimientoReducido = Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  var SUGERENCIAS = [
    '¿Cómo cancelo mi suscripción?',
    '¿Cómo cambio la URL de mi página?',
    'Quiero activar Face ID',
    'Quiero hablar con una persona',
  ];

  var ACTIVIDAD = {
    buscar_ayuda: 'Buscando en la ayuda…',
    estado_de_mi_cuenta: 'Mirando tu cuenta…',
    guiar_en_pantalla: 'Preparando la guía…',
    abrir_ticket: 'Avisando al equipo…',
  };

  var ICONO_ENVIAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>';
  var ICONO_MIC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><path d="M12 17v5"/></svg>';
  var ICONO_VOZ = '<svg class="sup-ic-on" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>'
    + '<svg class="sup-ic-off" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="m22 9-6 6"/><path d="m16 9 6 6"/></svg>';
  var ICONO_CERRAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';

  // ---- Almacenamiento tolerante a fallos ----

  function leer(almacen, clave) {
    try { return window[almacen].getItem(clave); } catch (e) { return null; }
  }
  function escribir(almacen, clave, valor) {
    try {
      if (valor === null) window[almacen].removeItem(clave);
      else window[almacen].setItem(clave, valor);
    } catch (e) { /* modo privado o bloqueado: se sigue sin recordar */ }
  }

  function leerHilo() {
    try {
      var dato = JSON.parse(leer('localStorage', CLAVE_HILO) || 'null');
      return dato && dato.conversationId && dato.secret ? dato : null;
    } catch (e) {
      return null;
    }
  }

  function csrf() {
    var m = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  function cabeceras() {
    var h = { 'Content-Type': 'application/json' };
    var t = csrf();
    if (t) h['X-CSRF-Token'] = t;
    return h;
  }

  function pedir(ruta, opciones) {
    var opts = opciones || {};
    return fetch(API + ruta, {
      method: opts.method || 'GET',
      headers: cabeceras(),
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (datos) {
        return { ok: res.ok, status: res.status, datos: datos };
      });
    });
  }

  /**
   * Chat en vivo: POST que responde con Server-Sent Events. EventSource no
   * sirve porque sólo hace GET, así que se lee el cuerpo a mano.
   * Resuelve { vivo: true } si llegó a recibir eventos, o { vivo: false,
   * status, datos } si el servidor contestó sin streaming (un error).
   */
  function chatEnVivo(cuerpo, alEvento, senal) {
    return fetch(API + '/chat/stream', {
      method: 'POST',
      headers: cabeceras(),
      body: JSON.stringify(cuerpo),
      signal: senal,
    }).then(function (res) {
      var tipo = res.headers.get('content-type') || '';
      if (!res.ok || tipo.indexOf('text/event-stream') === -1 || !res.body || !res.body.getReader) {
        return res.json().catch(function () { return {}; }).then(function (datos) {
          return { vivo: false, status: res.status, datos: datos };
        });
      }
      var lector = res.body.getReader();
      var decodificador = new TextDecoder();
      var bufer = '';
      function trocear() {
        var corte;
        while ((corte = bufer.indexOf('\n\n')) !== -1) {
          var bloque = bufer.slice(0, corte);
          bufer = bufer.slice(corte + 2);
          var tipoEv = 'message';
          var datos = '';
          bloque.split('\n').forEach(function (linea) {
            if (linea.indexOf('event: ') === 0) tipoEv = linea.slice(7);
            else if (linea.indexOf('data: ') === 0) datos += linea.slice(6);
          });
          if (!datos) continue; // latidos y comentarios
          var carga;
          try { carga = JSON.parse(datos); } catch (e) { continue; }
          alEvento(tipoEv, carga);
        }
      }
      function leerTrozo() {
        return lector.read().then(function (r) {
          if (r.done) {
            bufer += '\n\n';
            trocear();
            return { vivo: true };
          }
          bufer += decodificador.decode(r.value, { stream: true });
          trocear();
          return leerTrozo();
        });
      }
      return leerTrozo();
    });
  }

  // ---- Construcción ----

  function el(tag, clase, texto) {
    var nodo = document.createElement(tag);
    if (clase) nodo.className = clase;
    if (texto != null) nodo.textContent = texto;
    return nodo;
  }

  function boton(clase, etiqueta, icono) {
    var b = el('button', clase);
    b.type = 'button';
    b.setAttribute('aria-label', etiqueta);
    b.title = etiqueta;
    if (icono) b.innerHTML = icono;
    return b;
  }

  function montar() {
    var raiz = el('div', 'sup');
    raiz.dataset.estado = 'reposo';

    // ---- Panel ----
    var panel = el('div', 'sup-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Asistente de ArleKing Social');
    panel.inert = true;

    var cabecera = el('div', 'sup-head');
    var avatar = el('div', 'sup-avatar');
    avatar.setAttribute('aria-hidden', 'true');
    var mini = el('img');
    mini.src = POSTER;
    mini.alt = '';
    avatar.appendChild(mini);
    var textos = el('div', 'sup-head-textos');
    var titulo = el('p', 'sup-title', 'Asistente');
    var sub = el('p', 'sup-sub');
    var pulso = el('span', 'sup-pulse');
    pulso.setAttribute('aria-hidden', 'true');
    var subTexto = el('span', null, 'En línea');
    sub.append(pulso, subTexto);
    textos.append(titulo, sub);
    var voz = boton('sup-icono sup-voz', 'Leer las respuestas en voz alta', ICONO_VOZ);
    voz.setAttribute('aria-pressed', 'false');
    var cerrar = boton('sup-icono', 'Cerrar el asistente', ICONO_CERRAR);
    cabecera.append(avatar, textos, voz, cerrar);

    var registro = el('div', 'sup-log');
    registro.setAttribute('role', 'log');
    registro.setAttribute('aria-live', 'polite');

    var actividad = el('p', 'sup-actividad');
    actividad.hidden = true;

    var sugerencias = el('div', 'sup-sugerencias');

    var formulario = el('form', 'sup-form');
    var entrada = el('textarea', 'sup-input');
    entrada.rows = 1;
    entrada.placeholder = 'Escribe o pulsa el micro…';
    entrada.maxLength = 2000;
    entrada.setAttribute('aria-label', 'Tu pregunta');
    var mic = boton('sup-mic', 'Hablar con el asistente', ICONO_MIC);
    mic.setAttribute('aria-pressed', 'false');
    var enviar = el('button', 'sup-enviar');
    enviar.type = 'submit';
    enviar.setAttribute('aria-label', 'Enviar');
    enviar.innerHTML = ICONO_ENVIAR;
    formulario.append(entrada, mic, enviar);

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
    pie.append(document.createTextNode('Asistente automático · '));
    var enlacePriv = el('a', null, 'Privacidad');
    enlacePriv.href = '/privacidad';
    enlacePriv.target = '_blank';
    enlacePriv.rel = 'noopener';
    pie.append(enlacePriv);

    panel.append(cabecera, registro, actividad, sugerencias, contacto, formulario, pie);

    // ---- Personaje ----
    var lanzador = el('button', 'sup-launcher');
    lanzador.type = 'button';
    lanzador.setAttribute('aria-label', 'Abrir el asistente');
    lanzador.setAttribute('aria-expanded', 'false');
    var escenario = el('span', 'sup-escenario');
    var poster = el('img', 'sup-poster');
    poster.src = POSTER;
    poster.alt = '';
    poster.decoding = 'async';
    escenario.appendChild(poster);
    var sombra = el('span', 'sup-sombra');
    var punto = el('span', 'sup-dot');
    punto.hidden = true;
    lanzador.append(sombra, escenario, punto);

    var bocadillo = el('div', 'sup-bocadillo', '¿Te echo una mano?');
    bocadillo.setAttribute('role', 'status');
    bocadillo.hidden = true;

    raiz.append(panel, bocadillo, lanzador);
    document.body.appendChild(raiz);

    return {
      raiz: raiz, panel: panel, registro: registro, actividad: actividad,
      sugerencias: sugerencias, formulario: formulario, entrada: entrada,
      mic: mic, enviar: enviar, voz: voz, cerrar: cerrar,
      contacto: contacto, correo: correo,
      lanzador: lanzador, escenario: escenario, poster: poster,
      punto: punto, bocadillo: bocadillo,
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
    var personaje = null;       // el 3D, si llega a montarse
    var controlEnvio = null;    // AbortController de la respuesta en curso
    var escucha = null;         // reconocimiento de voz en curso
    var conversando = false;    // modo conversación por voz
    var silencios = 0;
    var vozRespuestas = leer('localStorage', CLAVE_VOZ) === '1';
    var hablarEsta = false;     // esta respuesta concreta se lee en voz alta
    var guiaPendiente = null;
    var trasHablar = null;      // lo que toca cuando termine de leer la respuesta
    var finHablando = 0;

    var AKVoz = window.AKVoz || null;
    var AKGuia = window.AKGuia || null;

    // ---- El personaje: 3D si lo hay, CSS si no ----

    var avatar = {
      estado: function (modo) {
        ui.raiz.dataset.estado = modo;
        if (personaje) personaje.estado(modo);
      },
      pulso: function () {
        if (personaje) personaje.pulso();
      },
      saltar: function () {
        if (personaje) personaje.emocionar('bote');
        else if (!movimientoReducido) {
          ui.escenario.classList.remove('bote');
          void ui.escenario.offsetWidth;
          ui.escenario.classList.add('bote');
        }
      },
      /** Una reacción del personaje. Sin 3D no hay nada que reaccione: el
       *  póster es una imagen fija y no se le inventa un sustituto. */
      emocionar: function (nombre) {
        if (personaje) personaje.emocionar(nombre);
      },
      /** Cada pulsación del lanzador, para que pueda marearse si insistes. */
      tocar: function (abriendo) {
        if (personaje) personaje.tocar(abriendo);
        else if (abriendo) avatar.saltar();
      },
      mirarA: function (x, y) {
        if (personaje) personaje.mirarA(x, y);
      },
    };

    // Inclinación del póster hacia el cursor (el 3D lo hace por su cuenta).
    if (!movimientoReducido) {
      var marco = 0;
      window.addEventListener('pointermove', function (e) {
        if (personaje || marco) return;
        marco = requestAnimationFrame(function () {
          marco = 0;
          var r = ui.escenario.getBoundingClientRect();
          var dx = (e.clientX - (r.left + r.width / 2)) / window.innerWidth;
          var dy = (e.clientY - (r.top + r.height / 3)) / window.innerHeight;
          ui.escenario.style.setProperty('--gy', (Math.max(-1, Math.min(1, dx)) * 28).toFixed(1) + 'deg');
          ui.escenario.style.setProperty('--gx', (Math.max(-1, Math.min(1, -dy)) * 14).toFixed(1) + 'deg');
        });
      }, { passive: true });
    }

    function conexionLenta() {
      var c = navigator.connection;
      return Boolean(c && (c.saveData || ['slow-2g', '2g'].indexOf(c.effectiveType) !== -1));
    }

    function volverAPoster() {
      if (personaje) {
        try { personaje.destruir(); } catch (e) { /* ya no está */ }
      }
      personaje = null;
      ui.escenario.classList.remove('en-vivo');
    }

    // El 3D se pide cuando el panel ya cargó lo suyo: Three.js pesa, y el
    // personaje no puede ser la razón de que el panel tarde en responder.
    //
    // Con "reducir movimiento" también se monta, pero tranquilo: sin flotar
    // ni botar. Esa preferencia la trae activada mucha gente desde Windows
    // sin haberla elegido por eso, y saltarse el 3D entero la dejaría sin
    // el personaje por algo que no pidió.
    function mejorarA3D() {
      if (conexionLenta()) return;
      var arrancar = function () {
        import('/js/asistente/personaje.js')
          .then(function (m) {
            return m.montarPersonaje(ui.escenario, { alPerderse: volverAPoster, calmado: movimientoReducido });
          })
          .then(function (p) {
            if (!p) return;
            personaje = p;
            personaje.estado(ui.raiz.dataset.estado || 'reposo');
            ui.escenario.classList.add('en-vivo');
          })
          .catch(function (err) { console.warn('Personaje 3D no disponible:', err && err.message); });
      };
      var cuandoQuieto = function () {
        if ('requestIdleCallback' in window) window.requestIdleCallback(arrancar, { timeout: 5000 });
        else setTimeout(arrancar, 800);
      };
      if (document.readyState === 'complete') setTimeout(cuandoQuieto, 1200);
      else window.addEventListener('load', function () { setTimeout(cuandoQuieto, 1200); }, { once: true });
    }

    // ---- Mensajes ----

    function alFondo() {
      ui.registro.scrollTop = ui.registro.scrollHeight;
    }

    function burbuja(rol, texto, quien) {
      var nodo = el('div', 'sup-msg de-' + rol);
      if (quien) nodo.appendChild(el('span', 'sup-quien', quien));
      var cuerpo = el('span', 'sup-cuerpo');
      cuerpo.textContent = texto || '';
      nodo.appendChild(cuerpo);
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

    function puntosEscribiendo(nodo) {
      var p = el('span', 'sup-escribiendo');
      p.append(el('i'), el('i'), el('i'));
      nodo.appendChild(p);
      return p;
    }

    function mostrarActividad(texto) {
      ui.actividad.textContent = texto || '';
      ui.actividad.hidden = !texto;
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
        ? '¡Hola! Soy tu asistente. Pregúntame lo que quieras sobre tu página, la insignia VIP o tu cuenta, y si hace falta te lo enseño en pantalla. También puedes hablarme con el micro.'
        : 'Hola. Busco por ti en la ayuda y te enseño en pantalla dónde está cada cosa. Si no lo encuentro, paso tu consulta a una persona del equipo.');
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

    function urlHilo() {
      return '/thread?conversationId=' + encodeURIComponent(hilo.conversationId)
        + '&secret=' + encodeURIComponent(hilo.secret);
    }

    /** Trae el hilo guardado. Es lo que hace visible la respuesta humana. */
    function cargarHilo() {
      if (!hilo) { bienvenida(); hiloCargado = true; return Promise.resolve(); }
      return pedir(urlHilo())
        .then(function (r) {
          hiloCargado = true;
          if (!r.ok || !r.datos.messages || !r.datos.messages.length) {
            escribir('localStorage', CLAVE_HILO, null);
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
      ui.mic.disabled = true;
      ui.entrada.placeholder = 'Conversación cerrada';
      terminarConversacion();
    }

    function guardarCredenciales(datos) {
      if (datos && datos.conversationId && datos.secret) {
        hilo = { conversationId: datos.conversationId, secret: datos.secret };
        escribir('localStorage', CLAVE_HILO, JSON.stringify(hilo));
      }
    }

    function pestanaActual() {
      var t = document.querySelector('.tab[aria-selected="true"]');
      return t ? t.dataset.tab : null;
    }

    function mostrarContacto() {
      ui.contacto.hidden = false;
    }

    // ---- Voz ----

    function puedeHablar() {
      return Boolean(AKVoz && AKVoz.puedeHablar());
    }

    function pintarBotonVoz() {
      ui.voz.setAttribute('aria-pressed', String(vozRespuestas));
      ui.voz.classList.toggle('activo', vozRespuestas);
      ui.voz.hidden = !puedeHablar();
    }

    if (AKVoz) {
      AKVoz.oyentes({
        alEmpezar: function () { avatar.estado('hablando'); },
        alPalabra: function () { avatar.pulso(); },
        alTerminar: function () {
          if (ui.raiz.dataset.estado === 'hablando') avatar.estado('reposo');
          // Una guía que esperaba a que acabara de leer la respuesta.
          if (trasHablar) {
            var siguiente = trasHablar;
            trasHablar = null;
            siguiente();
            return;
          }
          // Durante la guía lee cada paso; no es momento de escuchar.
          if (AKGuia && AKGuia.activa) return;
          // En modo conversación, cuando termina de hablar vuelve a escuchar.
          if (conversando && !enviando && abierto) setTimeout(escuchar, 350);
        },
      });
    }

    function escuchar() {
      if (!conversando || escucha || enviando) return;
      // Durante una guía no se escucha: cancelar la escucha al empezarla
      // avisa de que "terminó", y eso no debe reabrir el micrófono.
      if (AKGuia && AKGuia.activa) return;
      if (!AKVoz || !AKVoz.puedeEscuchar()) {
        aviso('Este navegador no permite dictar. Prueba con Chrome, Edge o Safari.');
        terminarConversacion();
        return;
      }
      ui.mic.classList.add('escuchando');
      avatar.estado('escuchando');
      mostrarActividad('Te escucho…');
      escucha = AKVoz.escuchar({
        alParcial: function (texto) {
          ui.entrada.value = texto;
        },
        alFinal: function (texto) {
          silencios = 0;
          ui.entrada.value = '';
          mandar(texto, { porVoz: true });
        },
        alError: function (codigo) {
          if (codigo === 'not-allowed' || codigo === 'service-not-allowed') {
            aviso('Para hablarme, permite el micrófono en el candado de la barra de direcciones.');
            terminarConversacion();
          } else if (codigo === 'no-speech') {
            silencios += 1;
          } else if (codigo === 'network') {
            aviso('El dictado necesita conexión con el servicio de voz del navegador y ahora no responde.');
            terminarConversacion();
          } else if (codigo !== 'aborted') {
            terminarConversacion();
          }
        },
        alTerminar: function (texto) {
          escucha = null;
          ui.mic.classList.remove('escuchando');
          if (!enviando) mostrarActividad('');
          if (ui.raiz.dataset.estado === 'escuchando') avatar.estado('reposo');
          // Dos silencios seguidos: se entiende que ya no quiere hablar.
          if (!texto && conversando) {
            if (silencios >= 2) terminarConversacion();
            else setTimeout(escuchar, 250);
          }
        },
      });
    }

    function empezarConversacion() {
      conversando = true;
      silencios = 0;
      ui.mic.setAttribute('aria-pressed', 'true');
      ui.mic.classList.add('activo');
      if (AKVoz) AKVoz.callar(); // interrumpirle es la forma natural de pedir la palabra
      escuchar();
    }

    function terminarConversacion() {
      conversando = false;
      ui.mic.setAttribute('aria-pressed', 'false');
      ui.mic.classList.remove('activo', 'escuchando');
      if (escucha) {
        var e = escucha;
        escucha = null;
        e.cancelar();
      }
      if (ui.raiz.dataset.estado === 'escuchando') avatar.estado('reposo');
      if (!enviando) mostrarActividad('');
    }

    // ---- Guía ----

    function iniciarGuia(pasos) {
      if (!AKGuia || !pasos || !pasos.length) return;
      var conVoz = hablarEsta && puedeHablar();
      ui.raiz.classList.add('guiando');
      if (escucha) escucha.cancelar();
      AKGuia.iniciar(pasos, {
        alPaso: function (paso, rect) {
          if (rect) avatar.mirarA(rect.left + rect.width / 2, rect.top + rect.height / 2);
          avatar.saltar();
          if (conVoz) {
            AKVoz.callar();
            AKVoz.decir(paso.texto);
          }
        },
        alTerminar: function () {
          ui.raiz.classList.remove('guiando');
          avatar.mirarA(null);
          if (abierto) {
            alFondo();
            if (conversando) setTimeout(escuchar, 400);
            else ui.entrada.focus({ preventScroll: true });
          }
        },
      });
    }

    // ---- Enviar ----

    function mandar(texto, opciones) {
      var porVoz = Boolean(opciones && opciones.porVoz);
      if (enviando || !texto) return;
      enviando = true;
      hablarEsta = (porVoz || vozRespuestas) && puedeHablar();
      ui.enviar.disabled = true;
      ui.sugerencias.hidden = true;
      trasHablar = null; // una pregunta nueva deja sin efecto la guía que esperaba
      if (AKGuia && AKGuia.activa) AKGuia.detener();
      if (AKVoz) AKVoz.callar();

      burbuja('visitante', texto);
      var respuesta = burbuja('asistente', '');
      var cuerpoRespuesta = respuesta.querySelector('.sup-cuerpo');
      var puntos = puntosEscribiendo(respuesta);
      respuesta.classList.add('en-curso');
      avatar.estado('pensando');

      var textoActual = '';
      var recibido = false;
      guiaPendiente = null;

      function quitarPuntos() {
        if (puntos && puntos.parentNode) puntos.remove();
        puntos = null;
      }

      function pintar(texto) {
        textoActual = texto;
        cuerpoRespuesta.textContent = texto;
        alFondo();
      }

      // Sin voz, el personaje "habla" mientras llega el texto.
      function marcarHablando() {
        if (hablarEsta) return;
        avatar.estado('hablando');
        avatar.pulso();
        clearTimeout(finHablando);
        finHablando = setTimeout(function () {
          if (ui.raiz.dataset.estado === 'hablando') avatar.estado(enviando ? 'pensando' : 'reposo');
        }, 700);
      }

      function terminar() {
        quitarPuntos();
        respuesta.classList.remove('en-curso');
        mostrarActividad('');
        enviando = false;
        ui.enviar.disabled = false;
        controlEnvio = null;

        // Con voz, la guía espera a que termine de leer la respuesta para no
        // cortarla a media frase. Tiene que quedar programada ANTES de
        // AKVoz.terminar(), que puede avisar de que acabó en el acto.
        var pasos = guiaPendiente;
        guiaPendiente = null;
        if (pasos) {
          if (hablarEsta) trasHablar = function () { setTimeout(function () { iniciarGuia(pasos); }, 250); };
          else setTimeout(function () { iniciarGuia(pasos); }, 450);
        }

        if (hablarEsta) AKVoz.terminar();
        else {
          if (ui.raiz.dataset.estado === 'pensando') avatar.estado('reposo');
          if (!pasos && conversando) setTimeout(escuchar, 400);
        }
        if (!conversando && abierto) ui.entrada.focus({ preventScroll: true });
      }

      function fallar(mensaje, extra) {
        quitarPuntos();
        pintar(mensaje);
        if (extra && extra.maxed) bloquear();
        mostrarContacto();
        if (hablarEsta) AKVoz.decir(mensaje);
        terminar();
      }

      var cuerpo = { message: texto, tab: pestanaActual(), voice: porVoz };
      if (hilo) { cuerpo.conversationId = hilo.conversationId; cuerpo.secret = hilo.secret; }

      controlEnvio = typeof AbortController === 'function' ? new AbortController() : null;

      function alEvento(tipo, datos) {
        recibido = true;
        if (tipo === 'inicio') {
          guardarCredenciales(datos);
        } else if (tipo === 'texto') {
          quitarPuntos();
          mostrarActividad('');
          pintar(textoActual + datos.delta);
          if (hablarEsta) AKVoz.alimentar(datos.delta);
          else marcarHablando();
        } else if (tipo === 'reinicio') {
          pintar(datos.texto || '');
          if (hablarEsta) AKVoz.descartarPendiente();
        } else if (tipo === 'herramienta') {
          mostrarActividad(ACTIVIDAD[datos.nombre] || 'Pensando…');
          if (ui.raiz.dataset.estado !== 'hablando') avatar.estado('pensando');
        } else if (tipo === 'guia') {
          guiaPendiente = datos.pasos;
        } else if (tipo === 'ticket') {
          aviso('He pasado tu consulta a una persona del equipo. Te responderán aquí mismo.', datos.referencia);
          ui.contacto.hidden = true;
          // No supo resolverlo: lo dice con el cuerpo, no sólo con el texto.
          avatar.emocionar('niega');
        } else if (tipo === 'fin') {
          if (datos.texto && datos.texto !== textoActual) pintar(datos.texto);
          if (datos.guia) guiaPendiente = datos.guia;
          if (datos.ofrecerTicket && !datos.ticket) mostrarContacto();
          // Resolvió él solo: un brinco corto. Si acabó en ticket o se ofreció
          // a abrirlo, no hay nada que celebrar.
          if (!datos.ticket && !datos.ofrecerTicket) avatar.emocionar('alegre');
        } else if (tipo === 'error') {
          quitarPuntos();
          if (!textoActual) pintar(datos.error || 'No pude responder ahora mismo.');
          avatar.emocionar('niega');
        }
      }

      chatEnVivo(cuerpo, alEvento, controlEnvio ? controlEnvio.signal : undefined)
        .then(function (r) {
          if (r.vivo) { terminar(); return null; }
          if (r.status === 404 || r.status === 405) return sinVivo();
          fallar((r.datos && r.datos.error) || 'No pude responder ahora mismo. Inténtalo de nuevo en un momento.', r.datos);
          return null;
        })
        .catch(function (err) {
          if (err && err.name === 'AbortError') { terminar(); return null; }
          // Si el directo falla antes de empezar, se intenta de una vez.
          if (!recibido) return sinVivo();
          fallar('Se me cortó la conexión. Pregúntamelo otra vez en un momento.');
          return null;
        });

      function sinVivo() {
        return pedir('/chat', { method: 'POST', body: cuerpo }).then(function (r) {
          if (!r.ok) {
            fallar(r.datos.error || 'No pude responder ahora mismo. Inténtalo de nuevo en un momento.', r.datos);
            return;
          }
          guardarCredenciales(r.datos);
          quitarPuntos();
          pintar(r.datos.reply || '');
          if (hablarEsta) AKVoz.decir(r.datos.reply || '');
          if (r.datos.guide) guiaPendiente = r.datos.guide;
          // Las mismas reacciones que por el camino en vivo: no puede
          // depender de si el navegador soporta streaming.
          if (r.datos.ticket) {
            aviso('He pasado tu consulta a una persona del equipo. Te responderán aquí mismo.', r.datos.ticket.reference);
            avatar.emocionar('niega');
          } else if (r.datos.offerTicket) {
            mostrarContacto();
          } else {
            avatar.emocionar('alegre');
          }
          terminar();
        }).catch(function () {
          fallar('Se me cayó la conexión. Inténtalo otra vez en un momento.');
        });
      }
    }

    // ---- Apertura y cierre ----

    function marcarSinLeer(hay) {
      ui.punto.hidden = !hay;
    }

    var ocultando = 0;
    function ocultarBocadillo() {
      if (ui.bocadillo.hidden) return;
      ui.bocadillo.classList.remove('visible');
      clearTimeout(ocultando);
      ocultando = setTimeout(function () { ui.bocadillo.hidden = true; }, 250);
    }

    function alternar(forzar) {
      abierto = forzar != null ? forzar : !abierto;
      ui.raiz.classList.toggle('is-open', abierto);
      ui.panel.inert = !abierto;
      ui.lanzador.setAttribute('aria-expanded', String(abierto));
      ui.lanzador.setAttribute('aria-label', abierto ? 'Cerrar el asistente' : 'Abrir el asistente');
      ocultarBocadillo();

      avatar.tocar(abierto);

      if (abierto) {
        marcarSinLeer(false);
        var listo = hiloCargado ? Promise.resolve() : cargarHilo();
        listo.then(function () {
          alFondo();
          if (!ui.entrada.disabled) ui.entrada.focus({ preventScroll: true });
        });
      } else {
        // Cerrar es terminar: no sigue escuchando, hablando ni guiando a
        // escondidas, y no se paga una respuesta que nadie va a leer.
        terminarConversacion();
        trasHablar = null;
        if (AKVoz) AKVoz.callar();
        if (AKGuia && AKGuia.activa) AKGuia.detener();
        if (controlEnvio) controlEnvio.abort();
        avatar.estado('reposo');
      }
    }

    ui.lanzador.addEventListener('click', function () { alternar(); });
    ui.cerrar.addEventListener('click', function () {
      alternar(false);
      ui.lanzador.focus();
    });
    ui.bocadillo.addEventListener('click', function () { alternar(true); });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && abierto && !(AKGuia && AKGuia.activa)) {
        alternar(false);
        ui.lanzador.focus();
      }
    });

    ui.voz.addEventListener('click', function () {
      vozRespuestas = !vozRespuestas;
      escribir('localStorage', CLAVE_VOZ, vozRespuestas ? '1' : null);
      if (!vozRespuestas && AKVoz) AKVoz.callar();
      pintarBotonVoz();
    });

    ui.mic.addEventListener('click', function () {
      if (conversando) terminarConversacion();
      else empezarConversacion();
    });
    if (!AKVoz || !AKVoz.puedeEscuchar()) {
      ui.mic.hidden = true;
      ui.entrada.placeholder = 'Escribe tu pregunta…';
    }
    pintarBotonVoz();

    ui.formulario.addEventListener('submit', function (e) {
      e.preventDefault();
      var texto = ui.entrada.value.trim();
      if (!texto) return;
      // Escribir cierra el modo conversación: está claro que prefiere teclear.
      if (conversando) terminarConversacion();
      ui.entrada.value = '';
      ui.entrada.style.height = 'auto';
      mandar(texto);
    });

    // Enter envía, Mayús+Enter hace salto de línea.
    ui.entrada.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        ui.formulario.requestSubmit();
      }
    });

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
        guardarCredenciales(r.datos);
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
        ui.sub.textContent = 'Modo ayuda';
        ui.pulso.classList.add('ambar');
      }
    }).catch(function () { /* el widget funciona igual sin esto */ });

    // Si quedó una conversación abierta, se mira si hay respuesta nueva sin
    // abrir el panel: el punto verde es lo que hace que alguien vuelva.
    if (hilo) {
      pedir(urlHilo())
        .then(function (r) {
          if (r.status === 404) {
            // El hilo ya no existe (lo barrió la limpieza, o es de otra
            // cuenta): se olvida ya, en vez de preguntar por él en cada carga.
            escribir('localStorage', CLAVE_HILO, null);
            hilo = null;
            return;
          }
          if (!r.ok || !r.datos.messages) return;
          var ultimo = r.datos.messages[r.datos.messages.length - 1];
          if (ultimo && ultimo.role === 'soporte') marcarSinLeer(true);
        })
        .catch(function () { /* sin aviso, nada roto */ });
    }

    // Un saludo por sesión, a los pocos segundos. Sin prisa ni sonido. Si la
    // pestaña está en segundo plano espera a que vuelva: un saludo que nadie
    // ve no debe gastar el único de la sesión.
    function saludar() {
      if (abierto || leer('sessionStorage', CLAVE_SALUDO)) return;
      if (document.hidden) {
        document.addEventListener('visibilitychange', function alVolver() {
          if (document.hidden) return;
          document.removeEventListener('visibilitychange', alVolver);
          setTimeout(saludar, 800);
        });
        return;
      }
      escribir('sessionStorage', CLAVE_SALUDO, '1');
      clearTimeout(ocultando);
      ui.bocadillo.hidden = false;
      void ui.bocadillo.offsetWidth; // aplica el estado inicial antes de animar
      ui.bocadillo.classList.add('visible');
      avatar.saltar();
      setTimeout(ocultarBocadillo, 6500);
    }
    if (!leer('sessionStorage', CLAVE_SALUDO)) setTimeout(saludar, 2600);

    mejorarA3D();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar);
  } else {
    iniciar();
  }
})();
