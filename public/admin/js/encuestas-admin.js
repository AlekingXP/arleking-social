(function () {
  'use strict';

  // Las encuestas, por el lado de quien las hace.
  //
  // Vive en la pestaña Soporte, que ya es el sitio donde se atiende a la
  // gente. Si el servidor responde 403 la tarjeta se esconde y no vuelve a
  // pedir nada: quien no lleva la plataforma no tiene por qué saber que
  // esto existe.
  //
  // Todo lo que escribe otra persona —los comentarios— entra por
  // textContent. Es la única parte de este panel donde aparece texto que no
  // ha escrito quien lo está mirando.

  var caja = document.getElementById('enc-lista');
  if (!caja) return;

  var form = document.getElementById('enc-form');
  var campoPregunta = document.getElementById('enc-pregunta');
  var campoDetalle = document.getElementById('enc-detalle');
  var botonNueva = document.getElementById('enc-nueva-btn');
  var tarjeta = caja.closest('.card');

  function el(tag, clase, texto) {
    var n = document.createElement(tag);
    if (clase) n.className = clase;
    if (texto != null) n.textContent = texto;
    return n;
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

  function avisar(texto, tipo) {
    if (window.showToast) window.showToast(texto, tipo);
  }

  function fecha(iso) {
    if (!iso) return '';
    var d = new Date(iso.replace(' ', 'T') + 'Z');
    return isNaN(d) ? iso : d.toLocaleDateString('es', { day: 'numeric', month: 'short' });
  }

  // ---- Pintar ----

  /** La barra de resultados. Dos trozos proporcionales; nada de librerías. */
  function barra(recuento, total) {
    var n = el('div', 'enc-barra');
    if (!total) {
      n.appendChild(el('span', 'enc-barra-vacia'));
      return n;
    }
    var si = el('span', 'enc-barra-si');
    si.style.width = Math.round((recuento.si / total) * 100) + '%';
    var no = el('span', 'enc-barra-no');
    no.style.width = Math.round((recuento.no / total) * 100) + '%';
    n.append(si, no);
    return n;
  }

  function pintarUna(e) {
    var fila = el('div', 'enc-item');

    var cab = el('div', 'enc-item-cab');
    var titulo = el('p', 'enc-item-pregunta', e.pregunta);
    cab.appendChild(titulo);
    var estado = el('span', 'enc-estado ' + (e.estado === 'abierta' ? 'abierta' : 'cerrada'),
      e.estado === 'abierta' ? 'Abierta' : 'Cerrada');
    cab.appendChild(estado);
    fila.appendChild(cab);

    fila.appendChild(barra(e.recuento, e.total));

    var cifras = el('p', 'enc-cifras');
    if (e.total) {
      cifras.textContent = e.recuento.si + ' a favor · ' + e.recuento.no + ' en contra · '
        + e.total + (e.total === 1 ? ' respuesta' : ' respuestas')
        + (e.comentarios ? ' · ' + e.comentarios + (e.comentarios === 1 ? ' comentario' : ' comentarios') : '');
    } else {
      cifras.textContent = 'Sin respuestas todavía · enviada el ' + fecha(e.creada);
    }
    fila.appendChild(cifras);

    var acciones = el('div', 'enc-item-acciones');

    if (e.total) {
      var ver = el('button', 'btn-outline btn-sm', 'Ver respuestas');
      ver.type = 'button';
      ver.addEventListener('click', function () { alternarDetalle(fila, e, ver); });
      acciones.appendChild(ver);
    }

    var cerrar = el('button', 'btn-outline btn-sm', e.estado === 'abierta' ? 'Cerrar' : 'Reabrir');
    cerrar.type = 'button';
    cerrar.addEventListener('click', function () {
      var accion = e.estado === 'abierta' ? 'cerrar' : 'reabrir';
      pedir('/api/encuestas/' + encodeURIComponent(e.id) + '/' + accion, { method: 'POST' })
        .then(function (r) {
          if (!r.ok) return avisar((r.datos && r.datos.error) || 'No se pudo.', 'error');
          avisar(accion === 'cerrar' ? 'Encuesta cerrada' : 'Encuesta reabierta', 'success');
          cargar();
        });
    });
    acciones.appendChild(cerrar);

    var borrar = el('button', 'btn-outline btn-sm enc-borrar', 'Borrar');
    borrar.type = 'button';
    borrar.addEventListener('click', function () {
      // Borrar se lleva por delante las respuestas; se pregunta.
      if (!window.confirm('¿Borrar esta encuesta y todas sus respuestas?')) return;
      pedir('/api/encuestas/' + encodeURIComponent(e.id), { method: 'DELETE' }).then(function (r) {
        if (!r.ok) return avisar((r.datos && r.datos.error) || 'No se pudo borrar.', 'error');
        avisar('Encuesta borrada', 'success');
        cargar();
      });
    });
    acciones.appendChild(borrar);

    fila.appendChild(acciones);
    return fila;
  }

  function alternarDetalle(fila, e, boton) {
    var abierto = fila.querySelector('.enc-respuestas');
    if (abierto) {
      abierto.remove();
      boton.textContent = 'Ver respuestas';
      return;
    }
    boton.textContent = 'Cargando…';
    pedir('/api/encuestas/' + encodeURIComponent(e.id)).then(function (r) {
      boton.textContent = 'Ocultar respuestas';
      if (!r.ok) return avisar('No se pudieron cargar.', 'error');
      var lista = el('div', 'enc-respuestas');
      (r.datos.respuestas || []).forEach(function (resp) {
        var n = el('div', 'enc-respuesta');
        var cab = el('div', 'enc-respuesta-cab');
        cab.appendChild(el('span', 'enc-voto ' + resp.respuesta, resp.respuesta === 'si' ? '👍 A favor' : '👎 En contra'));
        cab.appendChild(el('span', 'enc-quien', resp.usuario));
        n.appendChild(cab);
        if (resp.comentario) n.appendChild(el('p', 'enc-comentario', resp.comentario));
        lista.appendChild(n);
      });
      fila.appendChild(lista);
    });
  }

  function cargar() {
    pedir('/api/encuestas').then(function (r) {
      if (r.status === 403) {
        // No es dueño: la tarjeta no debería ni estar.
        if (tarjeta) tarjeta.classList.add('hidden');
        return;
      }
      caja.textContent = '';
      var lista = (r.datos && r.datos.encuestas) || [];
      if (!lista.length) {
        caja.appendChild(el('p', 'stat-empty', 'Todavía no has preguntado nada.'));
        return;
      }
      lista.forEach(function (e) { caja.appendChild(pintarUna(e)); });
    });
  }

  // ---- Crear ----

  botonNueva.addEventListener('click', function () {
    var oculto = form.classList.toggle('hidden');
    botonNueva.textContent = oculto ? 'Nueva encuesta' : 'Cerrar';
    if (!oculto) campoPregunta.focus();
  });

  document.getElementById('enc-cancelar').addEventListener('click', function () {
    form.classList.add('hidden');
    botonNueva.textContent = 'Nueva encuesta';
    form.reset();
  });

  // Una vista previa de verdad, con el mismo código que verán ellos: una
  // captura en la ayuda se queda vieja en cuanto se toca el diseño.
  document.getElementById('enc-previsualizar').addEventListener('click', function () {
    var pregunta = campoPregunta.value.trim();
    if (!pregunta) return avisar('Escribe la pregunta primero.', 'error');
    if (!window.AKEncuesta) return avisar('La vista previa no está disponible.', 'error');
    window.AKEncuesta.avisar({ id: '(vista previa)', pregunta: pregunta, detalle: campoDetalle.value.trim() || null });
  });

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var pregunta = campoPregunta.value.trim();
    if (!pregunta) return;
    pedir('/api/encuestas', { method: 'POST', body: { pregunta: pregunta, detalle: campoDetalle.value.trim() } })
      .then(function (r) {
        if (!r.ok) return avisar((r.datos && r.datos.error) || 'No se pudo crear.', 'error');
        avisar('Encuesta enviada a todas las cuentas', 'success');
        form.reset();
        form.classList.add('hidden');
        botonNueva.textContent = 'Nueva encuesta';
        cargar();
      });
  });

  // No se carga sola: espera a que support.js confirme que esta cuenta
  // lleva la plataforma. Preguntar por nuestra cuenta seria otro 403 en la
  // consola de todo el que no lo es.
  window.AKEncuestasAdmin = { cargar: cargar };
})();
