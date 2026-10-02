(function () {
  'use strict';

  // Idiomas.
  //
  // El castellano es el original y se queda ESCRITO en el HTML y en el
  // codigo. No hay un diccionario "es": quien ya esta en castellano no
  // descarga nada y, si el JavaScript falla, la pagina sigue leyendose. Solo
  // quien tiene el telefono en otro idioma se baja un archivo.
  //
  // Como se marca una cadena:
  //
  //   En el HTML   <span data-i18n="enc.titulo">Encuesta</span>
  //                <input data-i18n-ph="enc.placeholder" placeholder="..." />
  //                <button data-i18n-aria="enc.cerrar" aria-label="Cerrar">
  //
  //   En el JS     AKI18n.t('enc.gracias', '¡Gracias!')
  //
  // El segundo argumento es el castellano. Eso hace que el codigo se siga
  // leyendo (no quedan claves sueltas sin saber que dicen) y que un idioma
  // al que le falte una traduccion caiga en castellano en vez de enseñar
  // "enc.gracias" a la cara.
  //
  // Que idioma se elige, por orden:
  //   1. el que la persona haya elegido a mano (queda guardado)
  //   2. el del navegador o el telefono (navigator.languages)
  //   3. castellano

  var SOPORTADOS = ['es', 'en'];
  var BASE = 'es';
  var CLAVE = 'aks.idioma';

  var diccionario = null;   // null mientras no haga falta o no haya llegado
  var idioma = BASE;
  var pendientes = [];      // lo que haya que repintar cuando llegue

  function guardado() {
    try { return localStorage.getItem(CLAVE); } catch (e) { return null; }
  }

  /** Reduce "es-419", "en-GB" o "pt_BR" a "es", "en", "pt". */
  function raiz(etiqueta) {
    return String(etiqueta || '').toLowerCase().split(/[-_]/)[0];
  }

  function detectar() {
    var elegido = guardado();
    if (elegido && SOPORTADOS.indexOf(elegido) !== -1) return elegido;

    // navigator.languages viene ordenado por preferencia de la persona; es
    // mas fiable que navigator.language a secas, que es solo el primero.
    var lista = (navigator.languages && navigator.languages.length)
      ? navigator.languages
      : [navigator.language || navigator.userLanguage || BASE];

    for (var i = 0; i < lista.length; i++) {
      var r = raiz(lista[i]);
      if (SOPORTADOS.indexOf(r) !== -1) return r;
    }
    // Un idioma que no tenemos cae en ingles, no en castellano: quien tiene
    // el telefono en aleman entiende antes el ingles.
    return SOPORTADOS.indexOf('en') !== -1 ? 'en' : BASE;
  }

  function t(clave, enCastellano) {
    if (idioma === BASE || !diccionario) return enCastellano;
    var v = diccionario[clave];
    return (v === undefined || v === null || v === '') ? enCastellano : v;
  }

  /** Mete los valores en una cadena: t(...).replace() a mano se olvida. */
  function con(texto, valores) {
    if (!valores) return texto;
    return String(texto).replace(/\{(\w+)\}/g, function (todo, k) {
      return Object.prototype.hasOwnProperty.call(valores, k) ? valores[k] : todo;
    });
  }

  /**
   * Traduce un trozo de pagina. Se puede llamar las veces que haga falta:
   * el texto original se guarda la primera vez, asi que volver al castellano
   * o cambiar de idioma no pierde nada.
   */
  function aplicar(raizDom) {
    var donde = raizDom || document;
    var campos = [
      ['data-i18n', null],
      ['data-i18n-ph', 'placeholder'],
      ['data-i18n-aria', 'aria-label'],
      ['data-i18n-title', 'title'],
    ];

    campos.forEach(function (par) {
      var attr = par[0];
      var destino = par[1];
      var nodos = donde.querySelectorAll('[' + attr + ']');
      for (var i = 0; i < nodos.length; i++) {
        var n = nodos[i];
        var clave = n.getAttribute(attr);
        var memoria = 'i18nOrig' + attr.replace(/-/g, '');
        if (n.dataset[memoria] === undefined) {
          n.dataset[memoria] = destino ? (n.getAttribute(destino) || '') : n.textContent;
        }
        var original = n.dataset[memoria];
        var texto = t(clave, original);
        if (destino) n.setAttribute(destino, texto);
        else n.textContent = texto;
      }
    });

    document.documentElement.lang = idioma;
  }

  function cargar() {
    if (idioma === BASE) return Promise.resolve();
    // Caché normal, no `force-cache`: con force-cache el navegador se queda
    // con el primer diccionario que vio y una traducción corregida no le
    // llega nunca. Con la revalidación de siempre, el coste es un 304.
    return fetch('/i18n/' + idioma + '.json')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        diccionario = d;
        if (!d) {
          // Sin diccionario nos quedamos en castellano, que es el original.
          idioma = BASE;
          return;
        }
        aplicar();
        pendientes.forEach(function (f) { try { f(); } catch (e) { /* uno roto no tumba al resto */ } });
        pendientes = [];
      })
      .catch(function () { idioma = BASE; });
  }

  idioma = detectar();
  document.documentElement.lang = idioma;

  var listo = cargar();

  window.AKI18n = {
    /** El idioma que se esta usando ahora mismo. */
    get idioma() { return idioma; },
    disponibles: SOPORTADOS.slice(),
    t: function (clave, enCastellano, valores) { return con(t(clave, enCastellano), valores); },
    aplicar: aplicar,
    /** Promesa que se resuelve cuando el diccionario esta puesto. */
    listo: function () { return listo; },
    /**
     * Para lo que se pinta con JavaScript: se ejecuta ya y otra vez cuando
     * llegue el diccionario, para que no se quede en castellano por haber
     * corrido antes de tiempo.
     */
    alCambiar: function (f) {
      try { f(); } catch (e) { /* la primera pasada puede ser pronto */ }
      if (idioma !== BASE && !diccionario) pendientes.push(f);
    },
    elegir: function (nuevo) {
      if (SOPORTADOS.indexOf(nuevo) === -1) return;
      try { localStorage.setItem(CLAVE, nuevo); } catch (e) { /* modo privado */ }
      window.location.reload();
    },
  };
})();
