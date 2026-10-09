/* El selector de fondo: una pared de monitores.
 *
 * Cada baldosa dibuja el fondo de verdad, en miniatura y en movimiento, con
 * los colores de acento de quien está mirando. Una captura no serviría: lo
 * único que diferencia a estos ocho fondos es cómo se mueven, y una foto de
 * algo que se mueve no dice nada.
 *
 * La pinta de circuito cerrado —el punto de grabación, la etiqueta CAM, las
 * líneas de barrido— no es decoración gratuita: convierte ocho recuadros
 * oscuros parecidos en ocho canales distinguibles, que es exactamente el
 * problema que había que resolver.
 *
 * Ocho lienzos animados a la vez costarían caro si no se vigilara, así que
 * el motor de fondos para cada uno que se sale de la pantalla y todos
 * cuando la pestaña pasa a segundo plano. Aquí sólo hay que no estorbarle.
 */
(function () {
  'use strict';

  var T = function (clave, es) { return window.AKI18n ? window.AKI18n.t(clave, es) : es; };

  var rejilla = null;
  var montados = [];      // lo devuelto por AKFondos.montar, para poder parar
  var elegido = null;
  var alCambiar = null;
  var imagen = null;      // la foto de fondo de esta cuenta, para «Viva»

  function colores() {
    var desde = document.getElementById('p-accent-from');
    var hasta = document.getElementById('p-accent-to');
    return {
      desde: (desde && desde.value) || '#ff5f8f',
      hasta: (hasta && hasta.value) || '#ff9a5a',
    };
  }

  function marcar(clave) {
    elegido = clave;
    [].forEach.call(rejilla.querySelectorAll('.monitor'), function (b) {
      var suyo = (b.dataset.clave || '') === (clave || '');
      b.classList.toggle('elegido', suyo);
      b.setAttribute('aria-checked', String(suyo));
      // Sólo el elegido es alcanzable con el tabulador, que es como se
      // comporta un grupo de opciones: dentro se navega con las flechas.
      b.tabIndex = suyo ? 0 : -1;
    });
    // Si no había ninguno elegido, el primero tiene que poder recibir el
    // foco o no se entra al grupo con el teclado.
    if (!rejilla.querySelector('.monitor.elegido')) {
      var primero = rejilla.querySelector('.monitor');
      if (primero) primero.tabIndex = 0;
    }
  }

  function baldosa(def, indice) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'monitor';
    b.setAttribute('role', 'radio');
    b.dataset.clave = def ? def.clave : '';

    var pantalla = document.createElement('span');
    pantalla.className = 'monitor-pantalla';

    if (def && def.necesitaImagen && !imagen) {
      // «Viva» sin imagen no tiene nada que animar. Mejor decirlo en la
      // propia baldosa que enseñar un recuadro vacio y que parezca roto.
      var falta = document.createElement('span');
      falta.className = 'monitor-vacio monitor-falta';
      falta.textContent = T('adm.sube_una_imagen', 'Sube una imagen abajo');
      pantalla.appendChild(falta);
    } else if (def) {
      var lienzo = document.createElement('canvas');
      pantalla.appendChild(lienzo);
      b.dataset.lienzo = '1';
    } else {
      var vacio = document.createElement('span');
      vacio.className = 'monitor-vacio';
      vacio.textContent = '—';
      pantalla.appendChild(vacio);
    }

    var barrido = document.createElement('span');
    barrido.className = 'monitor-barrido';
    barrido.setAttribute('aria-hidden', 'true');
    pantalla.appendChild(barrido);

    var chapa = document.createElement('span');
    chapa.className = 'monitor-chapa';
    var punto = document.createElement('span');
    punto.className = 'monitor-rec';
    punto.setAttribute('aria-hidden', 'true');
    var nombre = document.createElement('span');
    nombre.className = 'monitor-nombre';
    nombre.textContent = def ? def.nombre : T('adm.sin_fondo_animado', 'Sin fondo animado');
    // El nombre de cada fondo, escrito con la letra que ese fondo pone en
    // la pagina. Es la forma mas corta de enseñar que elegir fondo tambien
    // elige tipografia: se ve, no hay que leerlo en ningun sitio.
    //
    // Cuesta una descarga de fuente por baldosa, y se paga a proposito:
    // esto es el panel, donde se esta eligiendo justamente eso, y es una
    // sola vez porque despues queda en cache.
    if (def && window.AKEstilos) {
      var cara = window.AKEstilos.cara(def.clave);
      if (cara) {
        window.AKEstilos.precargar(def.clave);
        nombre.style.fontFamily = cara;
      }
    }
    var canal = document.createElement('span');
    canal.className = 'monitor-canal';
    canal.setAttribute('aria-hidden', 'true');
    canal.textContent = def ? ('CAM-' + String(indice).padStart(2, '0')) : 'OFF';
    chapa.append(punto, nombre, canal);

    b.append(pantalla, chapa);
    // El resumen va al título y no debajo: ocho párrafos convierten una
    // pared de monitores en una lista con fotos.
    if (def) b.title = def.resumen;
    return b;
  }

  function pintar() {
    if (!rejilla || !window.AKFondos) return;
    pararTodo();
    rejilla.textContent = '';

    var catalogo = window.AKFondos.catalogo();
    var c = colores();

    rejilla.appendChild(baldosa(null, 0));
    catalogo.forEach(function (def, i) {
      var b = baldosa(def, i + 1);
      rejilla.appendChild(b);
      var lienzo = b.querySelector('canvas');
      if (!lienzo) return;
      var vivo = window.AKFondos.montar(lienzo, {
        clave: def.clave,
        desde: c.desde,
        hasta: c.hasta,
        imagen: imagen,
        // Las miniaturas miden la décima parte: sin subir el grosor de las
        // líneas y el tamaño de las motas, todas se verían igual de grises.
        escala: 2.2,
      });
      if (vivo) montados.push(vivo);
    });

    marcar(elegido);
  }

  function pararTodo() {
    montados.forEach(function (m) { try { m.parar(); } catch (e) { /* ya parado */ } });
    montados = [];
  }

  function alPulsar(e) {
    var b = e.target.closest ? e.target.closest('.monitor') : null;
    if (!b || !rejilla.contains(b)) return;
    var clave = b.dataset.clave || null;
    marcar(clave);
    if (alCambiar) alCambiar(clave);
  }

  // Flechas para moverse dentro del grupo, como manda el patrón de radios.
  function alTeclear(e) {
    var teclas = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'];
    if (teclas.indexOf(e.key) === -1) return;
    var botones = [].slice.call(rejilla.querySelectorAll('.monitor'));
    var i = botones.indexOf(document.activeElement);
    if (i === -1) return;
    e.preventDefault();
    var adelante = e.key === 'ArrowRight' || e.key === 'ArrowDown';
    var siguiente = botones[(i + (adelante ? 1 : -1) + botones.length) % botones.length];
    siguiente.focus();
    siguiente.click();
  }

  function iniciar(opciones) {
    rejilla = document.getElementById('wallpaper-grid');
    if (!rejilla || !window.AKFondos) return null;
    alCambiar = opciones && opciones.alCambiar;
    elegido = (opciones && opciones.elegido) || null;
    imagen = (opciones && opciones.imagen) || null;

    rejilla.addEventListener('click', alPulsar);
    rejilla.addEventListener('keydown', alTeclear);
    pintar();

    return {
      elegido: function () { return elegido; },
      poner: function (clave) { marcar(clave); },
      // Los acentos cambian mientras se trastea con los dos selectores de
      // color, y los fondos los llevan dentro: hay que rehacerlos. Se espera
      // a que la persona suelte el ratón, porque un `input` de color dispara
      // decenas de eventos por segundo y reconstruir ocho lienzos en cada
      // uno es lo que convierte un panel en un horno.
      recolorear: pintar,
      // Al subir o quitar la foto de fondo, «Viva» pasa de tener algo que
      // animar a no tenerlo. Es la unica baldosa que depende de datos de
      // fuera del selector, asi que hay que avisarla.
      imagen: function (ruta) {
        var antes = imagen;
        imagen = ruta || null;
        if (!!antes !== !!imagen || antes !== imagen) pintar();
      },
    };
  }

  window.AKSelectorFondo = { iniciar: iniciar };
})();
