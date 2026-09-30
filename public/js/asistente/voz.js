/* Voz del asistente: escuchar y hablar.
 *
 * Igual que con la IA, el widget no habla con ningún proveedor de voz
 * directamente: usa window.AKVoz, y detrás hay un proveedor registrado. El
 * que viene incluido es el del propio navegador (Web Speech API): no
 * necesita claves, no cuesta nada y funciona en Chrome, Edge y Safari.
 *
 * Para usar otro (una voz en la nube, un reconocimiento propio), se
 * registra un objeto con esta forma y se activa con AKVoz.usar('nombre'):
 *
 *   {
 *     puedeEscuchar(): boolean
 *     puedeHablar(): boolean
 *     escuchar({ alParcial(texto), alFinal(texto), alError(codigo), alTerminar() }) -> { detener() }
 *     decir(frase, { alEmpezar(), alPalabra(), alTerminar() })   // una frase
 *     callar()
 *   }
 *
 * La cola, el troceo en frases y la limpieza del texto son de AKVoz, no del
 * proveedor: así se comportan igual todos.
 *
 * Privacidad: en Chrome y Edge el reconocimiento de voz lo hace el servicio
 * del navegador (Google o Microsoft), no este servidor. Está en la página de
 * privacidad.
 */
(function () {
  'use strict';

  // ---- Proveedor: el navegador ----

  function idiomaPreferido() {
    var lista = (navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language || ''];
    for (var i = 0; i < lista.length; i++) {
      if (/^es\b/i.test(lista[i])) return lista[i].indexOf('-') === -1 ? 'es-ES' : lista[i];
    }
    return 'es-ES';
  }

  // Voces "naturales" primero: las de Edge (Online/Natural), Google y las
  // mejoradas de Apple suenan mucho menos a máquina que las del sistema.
  function puntuarVoz(voz, idioma) {
    if (!/^es\b/i.test(voz.lang)) return -1;
    var p = 1;
    if (voz.lang.toLowerCase() === idioma.toLowerCase()) p += 3;
    if (/natural|neural|online|premium|enhanced|mejorad/i.test(voz.name)) p += 5;
    if (/google/i.test(voz.name)) p += 2;
    if (voz.localService === false) p += 1;
    return p;
  }

  function crearProveedorNavegador() {
    var Reconocedor = window.SpeechRecognition || window.webkitSpeechRecognition;
    var sintesis = window.speechSynthesis;
    var idioma = idiomaPreferido();
    var vozElegida = null;

    function elegirVoz() {
      if (!sintesis) return;
      var voces = sintesis.getVoices();
      var mejor = null;
      var mejorPuntos = 0;
      for (var i = 0; i < voces.length; i++) {
        var p = puntuarVoz(voces[i], idioma);
        if (p > mejorPuntos) { mejor = voces[i]; mejorPuntos = p; }
      }
      vozElegida = mejor;
    }
    if (sintesis) {
      elegirVoz();
      // Las voces llegan tarde en casi todos los navegadores.
      if (typeof sintesis.addEventListener === 'function') sintesis.addEventListener('voiceschanged', elegirVoz);
      else sintesis.onvoiceschanged = elegirVoz;
    }

    return {
      nombre: 'navegador',
      puedeEscuchar: function () { return Boolean(Reconocedor); },
      puedeHablar: function () { return Boolean(sintesis && window.SpeechSynthesisUtterance); },

      escuchar: function (h) {
        var rec = new Reconocedor();
        rec.lang = idioma;
        rec.interimResults = true;
        rec.continuous = false;
        rec.maxAlternatives = 1;
        var final = '';
        var terminado = false;

        rec.onresult = function (e) {
          var parcial = '';
          for (var i = e.resultIndex; i < e.results.length; i++) {
            var r = e.results[i];
            if (r.isFinal) final += r[0].transcript;
            else parcial += r[0].transcript;
          }
          if (h.alParcial) h.alParcial((final + parcial).trim());
        };
        rec.onerror = function (e) {
          if (h.alError) h.alError(e.error || 'desconocido');
        };
        rec.onend = function () {
          if (terminado) return;
          terminado = true;
          var texto = final.trim();
          if (texto && h.alFinal) h.alFinal(texto);
          if (h.alTerminar) h.alTerminar(texto);
        };

        try {
          rec.start();
        } catch (err) {
          terminado = true;
          if (h.alError) h.alError('no-arranca');
          if (h.alTerminar) h.alTerminar('');
        }
        return {
          detener: function () {
            try { rec.stop(); } catch (e) { /* ya estaba parado */ }
          },
          cancelar: function () {
            final = '';
            try { rec.abort(); } catch (e) { /* ya estaba parado */ }
          },
        };
      },

      decir: function (frase, h) {
        var u = new SpeechSynthesisUtterance(frase);
        u.lang = vozElegida ? vozElegida.lang : idioma;
        if (vozElegida) u.voice = vozElegida;
        u.rate = 1.04;
        u.pitch = 1.08;
        u.onstart = function () { if (h.alEmpezar) h.alEmpezar(); };
        u.onboundary = function (e) { if (e.name === 'word' && h.alPalabra) h.alPalabra(); };
        u.onend = function () { if (h.alTerminar) h.alTerminar(); };
        u.onerror = function () { if (h.alTerminar) h.alTerminar(); };
        sintesis.speak(u);
      },

      callar: function () {
        if (sintesis) sintesis.cancel();
      },
    };
  }

  // ---- AKVoz: cola, troceo y selección de proveedor ----

  var proveedores = {};
  var actual = null;

  var cola = [];
  var diciendo = false;
  var pendiente = '';
  // Mientras la respuesta sigue llegando, que la cola se vacíe no significa
  // que haya terminado de hablar: sólo que va más rápido que el texto.
  var abierta = false;
  var oyentes = { alEmpezar: null, alPalabra: null, alTerminar: null };
  var generacion = 0; // invalida los avisos de frases canceladas

  // Lo que no tiene sentido leer en voz alta.
  function limpiar(texto) {
    return String(texto || '')
      .replace(/https?:\/\/\S+/g, 'el enlace')
      .replace(/[↑]/g, ' arriba ')
      .replace(/[↓]/g, ' abajo ')
      .replace(/[•·✎👁🗑]/g, ' ')
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function siguiente() {
    if (diciendo) return;
    var frase = cola.shift();
    if (frase === undefined) {
      if (!abierta && oyentes.alTerminar) oyentes.alTerminar();
      return;
    }
    diciendo = true;
    var mia = generacion;
    actual.decir(frase, {
      alEmpezar: function () { if (mia === generacion && oyentes.alEmpezar) oyentes.alEmpezar(); },
      alPalabra: function () { if (mia === generacion && oyentes.alPalabra) oyentes.alPalabra(); },
      alTerminar: function () {
        if (mia !== generacion) return;
        diciendo = false;
        siguiente();
      },
    });
  }

  function encolar(frase) {
    var limpia = limpiar(frase);
    if (!limpia) return;
    cola.push(limpia);
    siguiente();
  }

  window.AKVoz = {
    registrar: function (nombre, proveedor) { proveedores[nombre] = proveedor; },
    usar: function (nombre) {
      if (!proveedores[nombre]) return false;
      this.callar();
      actual = proveedores[nombre];
      return true;
    },
    get proveedor() { return actual ? actual.nombre : null; },

    puedeEscuchar: function () { return Boolean(actual && actual.puedeEscuchar()); },
    puedeHablar: function () { return Boolean(actual && actual.puedeHablar()); },

    escuchar: function (h) {
      this.callar(); // nunca escuchar mientras habla: se oiría a sí mismo
      return actual.escuchar(h || {});
    },

    /** Avisos del habla: alEmpezar, alPalabra, alTerminar (cola vacía). */
    oyentes: function (o) {
      oyentes.alEmpezar = o.alEmpezar || null;
      oyentes.alPalabra = o.alPalabra || null;
      oyentes.alTerminar = o.alTerminar || null;
    },

    /** Texto que llega en trozos: se lee frase a frase según se completa. */
    alimentar: function (delta) {
      if (!this.puedeHablar()) return;
      abierta = true;
      pendiente += delta;
      var corte = /[.!?…:;](\s|$)|\n/;
      var m = pendiente.match(corte);
      while (m) {
        var fin = m.index + m[0].length;
        encolar(pendiente.slice(0, fin));
        pendiente = pendiente.slice(fin);
        m = pendiente.match(corte);
      }
    },
    /** Lee lo que quedara a medias al terminar la respuesta. */
    terminar: function () {
      if (!this.puedeHablar()) return;
      abierta = false;
      if (pendiente.trim()) encolar(pendiente);
      pendiente = '';
      if (!diciendo && !cola.length && oyentes.alTerminar) oyentes.alTerminar();
    },
    /** Una frase suelta, completa. */
    decir: function (frase) {
      if (!this.puedeHablar()) return;
      encolar(frase);
    },
    /** Descarta lo que aún no se ha empezado a leer (tras un reinicio). */
    descartarPendiente: function () {
      pendiente = '';
      cola = [];
    },
    callar: function () {
      generacion++;
      cola = [];
      pendiente = '';
      diciendo = false;
      abierta = false;
      if (actual) actual.callar();
    },
    get hablando() { return diciendo || cola.length > 0; },
  };

  window.AKVoz.registrar('navegador', crearProveedorNavegador());
  window.AKVoz.usar('navegador');
})();
