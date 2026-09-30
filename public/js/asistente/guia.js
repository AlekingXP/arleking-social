/* Guía visual: el asistente señala cosas en el panel, paso a paso.
 *
 * Recibe los pasos ya resueltos por el servidor —{ pestana, selector,
 * resaltar, texto, siOculto }— y para cada uno: cambia de pestaña si hace
 * falta, lleva el elemento a la vista, oscurece el resto de la pantalla
 * dejando un hueco a su alrededor y pone la indicación al lado.
 *
 * Los selectores salen de una lista fija del servidor; el modelo sólo elige
 * claves de esa lista. Aun así aquí se tratan como no fiables: se buscan
 * con try/catch, y el texto entra con textContent.
 *
 * El hueco del foco deja pasar los clics: la persona puede pulsar el botón
 * resaltado sin cerrar la guía.
 *
 *   AKGuia.iniciar(pasos, { alPaso(paso, rect, i, total), alTerminar(motivo) })
 *   AKGuia.detener()
 *   AKGuia.activa
 */
(function () {
  'use strict';

  var PESTANAS = ['perfil', 'apariencia', 'enlaces', 'analiticas', 'vip', 'cuenta', 'soporte'];
  var MARGEN = 8;
  var movimientoReducido = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var pasos = [];
  var indice = 0;
  var opciones = {};
  var capa = null;
  var foco = null;
  var globo = null;
  var partes = {};
  var destinoActual = null;
  var marco = 0;
  var techo = 0; // fondo de una cabecera fija, si la hay: el globo no se mete debajo
  var RESERVA_PERSONAJE = 150; // px a la derecha que ocupa el personaje abajo

  /** El borde inferior de lo que esté fijo arriba del todo (una cabecera pegajosa). */
  function medirTecho() {
    var nodo = document.elementFromPoint(window.innerWidth / 2, 2);
    while (nodo && nodo !== document.body && nodo !== document.documentElement) {
      var pos = getComputedStyle(nodo).position;
      if (pos === 'fixed' || pos === 'sticky') return Math.max(0, nodo.getBoundingClientRect().bottom);
      nodo = nodo.parentElement;
    }
    return 0;
  }

  function el(tag, clase, texto) {
    var n = document.createElement(tag);
    if (clase) n.className = clase;
    if (texto != null) n.textContent = texto;
    return n;
  }

  function construir() {
    capa = el('div', 'akg-capa');
    capa.setAttribute('aria-hidden', 'false');

    foco = el('div', 'akg-foco');
    globo = el('div', 'akg-globo');
    globo.setAttribute('role', 'dialog');
    globo.setAttribute('aria-live', 'polite');

    partes.contador = el('p', 'akg-contador');
    partes.texto = el('p', 'akg-texto');
    partes.nota = el('p', 'akg-nota');
    partes.cerrar = el('button', 'akg-cerrar', '×');
    partes.cerrar.type = 'button';
    partes.cerrar.setAttribute('aria-label', 'Cerrar la guía');

    var acciones = el('div', 'akg-acciones');
    partes.atras = el('button', 'akg-btn akg-btn-sec', 'Atrás');
    partes.atras.type = 'button';
    partes.siguiente = el('button', 'akg-btn', 'Siguiente');
    partes.siguiente.type = 'button';
    acciones.append(partes.atras, partes.siguiente);

    globo.append(partes.cerrar, partes.contador, partes.texto, partes.nota, acciones);
    capa.append(foco, globo);
    document.body.appendChild(capa);

    partes.cerrar.addEventListener('click', function () { detener('cerrada'); });
    partes.atras.addEventListener('click', function () { ir(indice - 1, -1); });
    partes.siguiente.addEventListener('click', function () {
      if (indice >= pasos.length - 1) detener('completada');
      else ir(indice + 1, 1);
    });

    document.addEventListener('keydown', alTeclado, true);
    window.addEventListener('resize', programarRecolocar, { passive: true });
    window.addEventListener('scroll', programarRecolocar, { passive: true, capture: true });
  }

  function alTeclado(e) {
    if (!capa) return;
    if (e.key === 'Escape') { e.preventDefault(); detener('cerrada'); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); partes.siguiente.click(); }
    else if (e.key === 'ArrowLeft' && indice > 0) { e.preventDefault(); partes.atras.click(); }
  }

  function buscar(paso) {
    var nodo = null;
    try {
      nodo = document.querySelector(paso.selector);
    } catch (e) {
      return null;
    }
    if (!nodo) return null;
    if (paso.resaltar === 'campo') return nodo.closest('.field') || nodo;
    if (paso.resaltar === 'etiqueta') return nodo.closest('label') || nodo;
    if (paso.resaltar === 'tarjeta') return nodo.closest('.card') || nodo;
    return nodo;
  }

  function visible(nodo) {
    if (!nodo || !nodo.isConnected) return false;
    var r = nodo.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    var estilo = getComputedStyle(nodo);
    return estilo.visibility !== 'hidden' && estilo.display !== 'none';
  }

  /** El ancestro visible más cercano: donde señalar si el propio no se ve. */
  function anclaVisible(nodo) {
    var actual = nodo && nodo.parentElement;
    while (actual && actual !== document.body) {
      if (visible(actual) && actual.classList.contains('card')) return actual;
      actual = actual.parentElement;
    }
    return null;
  }

  function esperarFotogramas(n) {
    return new Promise(function (resolver) {
      function uno() {
        if (n-- <= 0) resolver();
        else requestAnimationFrame(uno);
      }
      requestAnimationFrame(uno);
    });
  }

  /** Espera a que el desplazamiento suave termine (el rectángulo deja de moverse). */
  function esperarQuieto(nodo) {
    return new Promise(function (resolver) {
      var anterior = null;
      var estables = 0;
      var vueltas = 0;
      function mirar() {
        var r = nodo.getBoundingClientRect();
        var clave = Math.round(r.top) + ':' + Math.round(r.left);
        estables = clave === anterior ? estables + 1 : 0;
        anterior = clave;
        if (estables >= 3 || ++vueltas > 90) resolver();
        else requestAnimationFrame(mirar);
      }
      requestAnimationFrame(mirar);
    });
  }

  function colocar() {
    if (!capa || !destinoActual) return;
    var r = destinoActual.getBoundingClientRect();
    var x = Math.max(4, r.left - MARGEN);
    var y = Math.max(4, r.top - MARGEN);
    var w = Math.min(window.innerWidth - x - 4, r.width + MARGEN * 2);
    var h = r.height + MARGEN * 2;
    foco.style.transform = 'translate(' + x + 'px,' + y + 'px)';
    foco.style.width = w + 'px';
    foco.style.height = h + 'px';

    // El globo va debajo si cabe; si no, encima, sin meterse bajo una
    // cabecera fija. Si el elemento es tan alto que no cabe por ningún lado
    // (una tarjeta entera), se fija abajo, encima del propio elemento y lejos
    // del personaje.
    var gw = globo.offsetWidth;
    var gh = globo.offsetHeight;
    var gx = Math.min(Math.max(12, r.left + r.width / 2 - gw / 2), window.innerWidth - gw - 12);
    var debajo = r.bottom + MARGEN + 12;
    var encima = r.top - MARGEN - 12 - gh;
    var gy;
    if (debajo + gh <= window.innerHeight - 12) {
      gy = debajo;
    } else if (encima >= techo + 8) {
      gy = encima;
    } else {
      gy = window.innerHeight - gh - 16;
      gx = Math.min(Math.max(16, r.left + 16), window.innerWidth - gw - RESERVA_PERSONAJE);
      gx = Math.max(12, gx);
    }
    globo.style.transform = 'translate(' + gx + 'px,' + gy + 'px)';

    return r;
  }

  function programarRecolocar() {
    if (marco) return;
    marco = requestAnimationFrame(function () {
      marco = 0;
      colocar();
    });
  }

  async function ir(i, direccion) {
    if (i < 0 || i >= pasos.length) return;
    indice = i;
    var paso = pasos[i];

    if (paso.pestana && PESTANAS.indexOf(paso.pestana) !== -1 && typeof window.showDashTab === 'function') {
      var activa = document.querySelector('.tab[aria-selected="true"]');
      if (!activa || activa.dataset.tab !== paso.pestana) {
        window.showDashTab(paso.pestana);
        await esperarFotogramas(2);
      }
    }

    var nodo = buscar(paso);
    var nota = '';
    if (!visible(nodo)) {
      var ancla = anclaVisible(nodo);
      if (ancla && paso.siOculto) {
        nodo = ancla;
        nota = paso.siOculto;
      } else if (paso.siOculto && paso.pestana) {
        nodo = document.querySelector('[data-tab="' + paso.pestana + '"]');
        nota = paso.siOculto;
      } else {
        nodo = null;
      }
    }

    if (!nodo) {
      // No hay nada que señalar: se salta en la dirección en que se iba.
      var siguienteI = i + (direccion || 1);
      if (siguienteI >= 0 && siguienteI < pasos.length) return ir(siguienteI, direccion);
      return detener('sin-destinos');
    }

    destinoActual = nodo;
    capa.classList.add('moviendo');
    nodo.scrollIntoView({ block: 'center', inline: 'nearest', behavior: movimientoReducido ? 'auto' : 'smooth' });
    await esperarQuieto(nodo);
    if (!capa) return; // se cerró mientras tanto

    partes.contador.textContent = pasos.length > 1 ? 'Paso ' + (i + 1) + ' de ' + pasos.length : '';
    partes.texto.textContent = paso.texto;
    partes.nota.textContent = nota;
    partes.nota.hidden = !nota;
    partes.atras.hidden = i === 0;
    partes.siguiente.textContent = i === pasos.length - 1 ? 'Listo' : 'Siguiente';
    globo.setAttribute('aria-label', partes.contador.textContent || 'Guía');

    var rect = colocar();
    capa.classList.remove('moviendo');
    // Reinicia el pulso del foco en cada paso.
    foco.classList.remove('pulso');
    void foco.offsetWidth;
    foco.classList.add('pulso');
    partes.siguiente.focus({ preventScroll: true });

    if (typeof opciones.alPaso === 'function') opciones.alPaso(paso, rect, i, pasos.length);
  }

  function detener(motivo) {
    if (!capa) return;
    document.removeEventListener('keydown', alTeclado, true);
    window.removeEventListener('resize', programarRecolocar);
    window.removeEventListener('scroll', programarRecolocar, { capture: true });
    if (marco) cancelAnimationFrame(marco);
    marco = 0;
    var vieja = capa;
    capa = null;
    foco = null;
    globo = null;
    destinoActual = null;
    vieja.classList.add('saliendo');
    setTimeout(function () { vieja.remove(); }, movimientoReducido ? 0 : 220);
    var fin = opciones.alTerminar;
    opciones = {};
    pasos = [];
    if (typeof fin === 'function') fin(motivo || 'cerrada');
  }

  window.AKGuia = {
    iniciar: function (lista, opts) {
      if (!Array.isArray(lista) || !lista.length) return false;
      if (capa) detener('reemplazada');
      pasos = lista.filter(function (p) { return p && typeof p.selector === 'string' && typeof p.texto === 'string'; });
      if (!pasos.length) return false;
      opciones = opts || {};
      techo = medirTecho(); // antes de la capa, que taparía la medida
      construir();
      ir(0, 1);
      return true;
    },
    detener: function () { detener('cerrada'); },
    get activa() { return Boolean(capa); },
  };
})();
