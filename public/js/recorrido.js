/* El recorrido: lo que hay debajo de los enlaces.
 *
 * El orden importa y es deliberado. Quien entra a una página de enlaces
 * viene a pulsar uno, y lo tiene delante nada más abrir. El recorrido
 * empieza por debajo del pliegue: es para quien se queda, no un peaje para
 * quien no.
 *
 * Cuatro reglas de montaje, que son las que separan esto de una página con
 * cosas que aparecen:
 *
 *   Nada entra con una sola propiedad. Una opacidad sola es un parpadeo;
 *   opacidad más desplazamiento más escala es algo que llega.
 *
 *   Lo que entra junto, entra escalonado. Sesenta milisegundos entre
 *   hermanos. Todo a la vez se lee como un corte, no como una entrada.
 *
 *   Nada de curvas lineales salvo lo que de verdad avanza a ritmo
 *   constante, que aquí es sólo la tira de datos.
 *
 *   Hay quietud. Entre una sección y otra no pasa nada, y eso es parte del
 *   diseño: el movimiento continuo se lee como barato, el contraste entre
 *   moverse y pararse se lee como caro.
 *
 * Lo pesado llega tarde a propósito. Three.js son unos cientos de
 * kilobytes y sólo se pide cuando la sección del cristal está a punto de
 * entrar en pantalla; en un dispositivo que no da la talla no se pide
 * nunca y queda el respaldo plano, que también está dibujado.
 */
(function () {
  'use strict';

  var raiz = null;
  var escena3D = null;
  var pidiendo3D = false;

  var quieto = window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- Revelados ----

  function montarRevelados() {
    var piezas = [].slice.call(raiz.querySelectorAll('[data-revelar]'));
    if (!piezas.length) return;

    // Sin IntersectionObserver —o sin movimiento— se enseña todo y punto.
    // Lo que no puede pasar nunca es que el contenido se quede invisible
    // porque la animación no arrancó.
    if (!window.IntersectionObserver || quieto) {
      piezas.forEach(function (p) { p.classList.add('visible'); });
      return;
    }

    var ojo = new IntersectionObserver(function (entradas) {
      entradas.forEach(function (e) {
        if (!e.isIntersecting) return;
        var caja = e.target;
        var hijos = [].slice.call(caja.querySelectorAll('[data-paso]'));
        hijos.forEach(function (h, i) {
          // El escalonado va en una variable y lo aplica el CSS como
          // retardo: así el navegador lo resuelve en el compositor en vez
          // de que nosotros montemos veinte temporizadores.
          h.style.setProperty('--paso', i);
        });
        caja.classList.add('visible');
        // Una vez dentro, se deja de vigilar. Repetir la entrada cada vez
        // que algo cruza la pantalla marea al subir y bajar.
        ojo.unobserve(caja);
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.1 });

    piezas.forEach(function (p) { ojo.observe(p); });
  }

  // ---- La tira de datos ----

  /* Unos y ceros, repetidos lo justo para que el bucle no se vea. La
     marquesina va en CSS con una animación lineal, que es el único sitio de
     toda la página donde lo lineal es lo correcto: una cinta que acelera y
     frena no es una cinta. */
  function llenarTira() {
    var tiras = [].slice.call(raiz.querySelectorAll('[data-tira]'));
    tiras.forEach(function (tira, n) {
      var trozos = [];
      for (var i = 0; i < 40; i++) {
        var grupo = '';
        for (var j = 0; j < 10; j++) {
          // Determinista: la misma página enseña la misma tira en cada
          // visita, que es lo que hace que parezca un dato y no ruido.
          grupo += ((i * 7 + j * 13 + n * 29) % 3 === 0) ? '1' : '0';
        }
        trozos.push(grupo);
      }
      var texto = trozos.join('/') + '/';
      // Dos copias seguidas: la animación desplaza exactamente la mitad y
      // el salto cae donde la segunda copia empieza igual que la primera.
      tira.textContent = texto + texto;
    });
  }

  // ---- El cristal ----

  function montar3D(opciones) {
    var seccion = raiz.querySelector('[data-cristal]');
    if (!seccion) return;
    var lienzo = seccion.querySelector('canvas');
    var respaldo = seccion.querySelector('[data-respaldo]');
    if (!lienzo) return;

    function rendirse() {
      lienzo.remove();
      if (respaldo) respaldo.classList.remove('hidden');
    }

    if (!window.IntersectionObserver) return rendirse();

    var ojo = new IntersectionObserver(function (entradas) {
      var dentro = entradas.some(function (e) { return e.isIntersecting; });
      if (escena3D) { escena3D.visible(dentro); return; }
      if (!dentro || pidiendo3D) return;
      pidiendo3D = true;

      // Aquí es donde se paga Three.js, y sólo aquí.
      Promise.all([
        import('/js/three-kit.js'),
        import('/js/recorrido-3d.js'),
      ]).then(function (mods) {
        var kit = mods[0];
        var cristal = mods[1];
        // La sonda abre un contexto WebGL de 64 píxeles y cronometra unos
        // fotogramas. En un teléfono viejo esto sale caro y es justo donde
        // una pieza en 3D a pantalla completa arruina la página.
        if (!kit.dispositivoApto()) { rendirse(); return; }
        escena3D = cristal.montarCristal(lienzo, opciones);
        if (!escena3D) { rendirse(); return; }
        escena3D.visible(true);
        alScroll();
      }).catch(function () {
        // Sin red para el módulo, o un fallo al compilar los shaders: el
        // respaldo es una pieza dibujada, no un hueco.
        rendirse();
      });
    // 200px por delante: lo justo para que el módulo esté listo cuando la
    // sección llegue, sin pedirlo a quien abre la página y no baja. Con 400
    // una página de tres enlaces lo descargaba nada más abrir, porque la
    // sección ya cae dentro del margen.
    }, { rootMargin: '200px 0px' });

    ojo.observe(seccion);
  }

  /* De dónde sale el avance: cuánto ha recorrido la sección la pantalla.
     Cero cuando asoma por abajo, uno cuando se va por arriba. */
  function alScroll() {
    if (!escena3D) return;
    var seccion = raiz.querySelector('[data-cristal]');
    if (!seccion) return;
    var caja = seccion.getBoundingClientRect();
    var alto = window.innerHeight || 1;
    var p = (alto - caja.top) / (alto + caja.height);
    escena3D.avance(p);
  }

  // ---- Arranque ----

  function iniciar(perfil) {
    raiz = document.getElementById('recorrido');
    if (!raiz) return;
    raiz.classList.remove('hidden');

    llenarTira();
    montarRevelados();
    montar3D({ desde: perfil.accent_from, hasta: perfil.accent_to });

    // passive: el navegador no tiene que esperar a ver si cancelamos el
    // scroll, que es lo que lo vuelve pegajoso en móvil.
    window.addEventListener('scroll', alScroll, { passive: true });

    var volver = raiz.querySelector('[data-volver]');
    if (volver) {
      volver.addEventListener('click', function () {
        var destino = document.getElementById('links-list') || document.body;
        destino.scrollIntoView({ behavior: quieto ? 'auto' : 'smooth', block: 'start' });
      });
    }
  }

  window.AKRecorrido = { iniciar: iniciar };
})();
