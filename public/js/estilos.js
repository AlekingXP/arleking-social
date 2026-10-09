/* Un fondo no es solo un fondo.
 *
 * Elegir fondo cambia tambien la tipografia y la manera en que las cosas
 * aparecen al bajar. Esa es la idea entera: diez fondos no son diez
 * texturas distintas detras de la misma pagina, son diez paginas.
 *
 * El reparto de tareas es deliberado y conviene no romperlo:
 *
 *   Aqui, en JavaScript, vive UNA sola cosa: que familia tipografica
 *   necesita cada fondo. Es lo unico que hay que pedirle a la red, y por
 *   eso tiene que estar en un sitio donde se pueda decidir en el momento.
 *
 *   Todo lo demas -pesos, espaciados, mayusculas, como entra cada escena,
 *   cuanto dura, cuanto se escalona, si el scroll se enclava- vive en CSS,
 *   colgando de [data-estilo="..."]. No hay una segunda lista de fuentes
 *   en la hoja de estilos: CSS lee --font-titulo y --font-cuerpo y no sabe
 *   como se llama ninguna fuente. Una lista, no dos, que es la unica forma
 *   de que no se separen.
 *
 * Las fuentes se piden tarde y de una en una. Diez familias en la cabecera
 * de la pagina publica serian diez descargas para enseñar una: solo se
 * pide la del fondo que hay puesto, y solo cuando ya se sabe cual es.
 */
(function () {
  'use strict';

  // clave del fondo -> familias de Google Fonts y pilas de respaldo.
  //
  // `display` es la cara con la que se escriben el nombre y los titulares.
  // `cuerpo` solo se rellena cuando la familia aguanta un parrafo: una
  // Archivo Black o una Syne a 0,9rem son ilegibles, y en esos casos el
  // cuerpo se queda en la monoespaciada de siempre.
  var ESTILOS = {
    // El de casa: la monoespaciada que ya carga la pagina. Cero peticiones.
    malla: { familias: [], display: null, cuerpo: null },

    deriva: {
      familias: ['Cormorant+Garamond:wght@300;500;600'],
      display: "'Cormorant Garamond', Georgia, 'Times New Roman', serif",
      cuerpo: "'Cormorant Garamond', Georgia, 'Times New Roman', serif",
    },
    lluvia: {
      familias: ['Oswald:wght@300;500;700'],
      display: "'Oswald', 'Arial Narrow', Impact, sans-serif",
      cuerpo: null,
    },
    aurora: {
      familias: ['Jost:wght@300;400;600'],
      display: "'Jost', 'Futura', 'Century Gothic', sans-serif",
      cuerpo: "'Jost', 'Futura', 'Century Gothic', sans-serif",
    },
    orbitas: {
      familias: ['Space+Grotesk:wght@400;500;700'],
      display: "'Space Grotesk', 'Helvetica Neue', Arial, sans-serif",
      cuerpo: "'Space Grotesk', 'Helvetica Neue', Arial, sans-serif",
    },
    interferencia: {
      familias: ['Syne:wght@600;800'],
      display: "'Syne', 'Helvetica Neue', Arial, sans-serif",
      cuerpo: null,
    },
    celdas: {
      familias: ['Sora:wght@300;400;700'],
      display: "'Sora', 'Helvetica Neue', Arial, sans-serif",
      cuerpo: "'Sora', 'Helvetica Neue', Arial, sans-serif",
    },
    rejilla: {
      familias: ['Archivo+Black'],
      display: "'Archivo Black', 'Helvetica Neue', Arial, sans-serif",
      cuerpo: null,
    },
    polvo: {
      familias: ['Fraunces:opsz,wght@9..144,300;9..144,600'],
      display: "'Fraunces', Georgia, serif",
      cuerpo: "'Fraunces', Georgia, serif",
    },
    viva: {
      familias: ['Cinzel:wght@400;700'],
      display: "'Cinzel', 'Trajan Pro', Georgia, serif",
      cuerpo: null,
    },
  };

  var pedidas = {};

  /* Una hoja de Google Fonts por familia, y nunca dos veces la misma.
     Falla en silencio a proposito: si la red no la trae, el navegador se
     queda con el respaldo de la pila y la pagina se lee igual. */
  function pedir(familias) {
    familias.forEach(function (fam) {
      if (pedidas[fam]) return;
      pedidas[fam] = true;
      var hoja = document.createElement('link');
      hoja.rel = 'stylesheet';
      // display=swap: el texto se enseña ya con la fuente de respaldo y
      // cambia cuando llega la buena. Sin eso hay un parpadeo en blanco.
      hoja.href = 'https://fonts.googleapis.com/css2?family=' + fam + '&display=swap';
      document.head.appendChild(hoja);
    });
  }

  function existe(clave) {
    return Object.prototype.hasOwnProperty.call(ESTILOS, clave);
  }

  /* Deja la pagina con el estilo de un fondo. Sin fondo, o con uno que no
     esta en la tabla, la deja como venia de fabrica. */
  function aplicar(clave) {
    var raiz = document.documentElement;
    var e = ESTILOS[clave];
    if (!e) {
      delete raiz.dataset.estilo;
      raiz.style.removeProperty('--font-titulo');
      raiz.style.removeProperty('--font-cuerpo');
      return;
    }
    raiz.dataset.estilo = clave;
    pedir(e.familias);
    if (e.display) raiz.style.setProperty('--font-titulo', e.display);
    else raiz.style.removeProperty('--font-titulo');
    if (e.cuerpo) raiz.style.setProperty('--font-cuerpo', e.cuerpo);
    else raiz.style.removeProperty('--font-cuerpo');
  }

  /* Para el selector del panel: pide la fuente de un fondo sin tocar la
     pagina, para poder escribir su nombre con su propia letra. */
  function precargar(clave) {
    var e = ESTILOS[clave];
    if (e) pedir(e.familias);
  }

  /* La pila de la cara de un fondo, para escribir con ella en un sitio
     suelto -la chapa de una miniatura- sin cambiar la pagina entera. */
  function cara(clave) {
    var e = ESTILOS[clave];
    return (e && e.display) || null;
  }

  window.AKEstilos = {
    claves: function () { return Object.keys(ESTILOS); },
    existe: existe,
    aplicar: aplicar,
    precargar: precargar,
    cara: cara,
  };
})();
