/* Panel de soporte: buzón de tickets y base de conocimiento.
 *
 * La pestaña nace oculta en el HTML y se descubre aquí, y sólo si el
 * servidor contesta a /api/support/assistant. Quien no lleva la plataforma
 * recibe un 403 y no ve nada — la pestaña oculta no es la protección, sólo
 * evita enseñar una puerta que no se abre; la protección está en el
 * servidor.
 *
 * Igual que en el widget público: aquí se pinta texto escrito por
 * desconocidos, así que todo entra por textContent.
 */
(function () {
  'use strict';

  function csrf() {
    var m = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  function api(url, opciones) {
    var opts = opciones || {};
    var cabeceras = { 'X-CSRF-Token': csrf() };
    if (opts.body) cabeceras['Content-Type'] = 'application/json';
    return fetch(url, {
      method: opts.method || 'GET',
      headers: cabeceras,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (datos) {
        if (!res.ok) throw new Error(datos.error || 'Error ' + res.status);
        return datos;
      });
    });
  }

  function el(tag, clase, texto) {
    var nodo = document.createElement(tag);
    if (clase) nodo.className = clase;
    if (texto != null) nodo.textContent = texto;
    return nodo;
  }

  function aviso(mensaje, tipo) {
    var toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = mensaje;
    toast.className = 'toast' + (tipo ? ' ' + tipo : '');
    toast.classList.remove('hidden');
    setTimeout(function () { toast.classList.add('hidden'); }, 2600);
  }

  function fecha(valor) {
    if (!valor) return '';
    try {
      var d = new Date(String(valor).replace(' ', 'T') + 'Z');
      var hoy = new Date();
      var mismoDia = d.toDateString() === hoy.toDateString();
      return mismoDia
        ? d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
        : d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
    } catch (e) {
      return '';
    }
  }

  var ETIQUETAS = { abierto: 'Abierto', respondido: 'Respondido', cerrado: 'Cerrado' };

  var estadoActual = 'abierto';
  var ticketAbierto = null;
  var editando = null;

  // ---- Buzón ----

  function pintarLista(tickets) {
    var caja = document.getElementById('sop-lista');
    caja.textContent = '';

    if (!tickets.length) {
      caja.appendChild(el('p', 'stat-empty',
        estadoActual === 'abierto' ? 'Nada pendiente. El asistente lo está llevando solo.' : 'No hay nada aquí.'));
      return;
    }

    tickets.forEach(function (t) {
      var fila = el('button', 'sop-item');
      fila.type = 'button';
      if (ticketAbierto === t.id) fila.classList.add('activo');

      var arriba = el('div', 'sop-item-top');
      arriba.append(
        el('span', 'sop-estado e-' + t.status, ETIQUETAS[t.status] || t.status),
        el('span', 'sop-fecha', fecha(t.updated_at))
      );

      var asunto = el('p', 'sop-asunto', t.subject);
      var quien = el('p', 'sop-quien-fila', t.username ? '@' + t.username : 'Visitante sin cuenta');

      fila.append(arriba, asunto, quien);
      fila.addEventListener('click', function () { abrirTicket(t.id); });
      caja.appendChild(fila);
    });
  }

  function pintarContadores(cuentas) {
    var a = document.getElementById('sop-n-abierto');
    var r = document.getElementById('sop-n-respondido');
    if (a) a.textContent = cuentas.abierto || 0;
    if (r) r.textContent = cuentas.respondido || 0;

    // Un punto en la pestaña cuando hay algo esperando: el buzón sólo sirve
    // si te enteras de que tiene algo dentro.
    var pestana = document.getElementById('tab-soporte');
    if (pestana) pestana.classList.toggle('con-aviso', (cuentas.abierto || 0) > 0);
  }

  function cargarTickets() {
    return api('/api/support/tickets?status=' + encodeURIComponent(estadoActual))
      .then(function (datos) {
        pintarLista(datos.tickets);
        pintarContadores(datos.counts);
      })
      .catch(function (err) {
        document.getElementById('sop-lista').textContent = '';
        document.getElementById('sop-lista').appendChild(el('p', 'stat-empty', err.message));
      });
  }

  function abrirTicket(id) {
    ticketAbierto = id;
    var caja = document.getElementById('sop-detalle');
    caja.textContent = '';
    caja.appendChild(el('p', 'stat-empty', 'Cargando…'));

    api('/api/support/tickets/' + id).then(function (datos) {
      pintarDetalle(datos.ticket, datos.messages);
      // Repinta la lista para marcar cuál está abierto.
      [].forEach.call(document.querySelectorAll('.sop-item'), function (n) {
        n.classList.remove('activo');
      });
    }).catch(function (err) {
      caja.textContent = '';
      caja.appendChild(el('p', 'stat-empty', err.message));
    });
  }

  function pintarDetalle(ticket, mensajes) {
    var caja = document.getElementById('sop-detalle');
    caja.textContent = '';

    var cabecera = el('div', 'sop-det-head');
    cabecera.appendChild(el('h3', 'sop-det-asunto', ticket.subject));

    var meta = el('div', 'sop-det-meta');
    meta.appendChild(el('span', 'sop-estado e-' + ticket.status, ETIQUETAS[ticket.status] || ticket.status));
    meta.appendChild(el('span', null, ticket.username ? '@' + ticket.username : 'Sin cuenta'));
    if (ticket.email) meta.appendChild(el('span', null, ticket.email));
    meta.appendChild(el('span', null, 'Ref. ' + ticket.public_id));
    cabecera.appendChild(meta);
    caja.appendChild(cabecera);

    // El resumen lo escribe el asistente para que no haya que leerse el
    // hilo entero antes de saber de qué va.
    if (ticket.summary) {
      var resumen = el('div', 'sop-resumen');
      resumen.appendChild(el('span', 'sop-resumen-tit', 'Resumen del asistente'));
      resumen.appendChild(el('p', null, ticket.summary));
      caja.appendChild(resumen);
    }

    var hilo = el('div', 'sop-hilo');
    if (!mensajes.length) {
      hilo.appendChild(el('p', 'stat-empty', 'Sin mensajes.'));
    } else {
      mensajes.forEach(function (m) {
        var nodo = el('div', 'sop-msg m-' + m.role);
        var quien = m.role === 'visitante' ? 'Visitante'
          : m.role === 'soporte' ? 'Tú' : 'Asistente';
        nodo.appendChild(el('span', 'sop-msg-quien', quien + ' · ' + fecha(m.at)));
        nodo.appendChild(el('p', null, m.body));
        hilo.appendChild(nodo);
      });
    }
    caja.appendChild(hilo);

    if (ticket.status !== 'cerrado') {
      var responder = el('div', 'sop-responder');
      var texto = el('textarea', 'sop-respuesta');
      texto.rows = 4;
      texto.maxLength = 4000;
      texto.placeholder = ticket.email
        ? 'Tu respuesta. Llega al chat y por correo a ' + ticket.email
        : 'Tu respuesta. Aparecerá en su chat la próxima vez que entre.';
      responder.appendChild(texto);

      var acciones = el('div', 'sop-responder-acciones');
      var cerrar = el('button', 'btn-outline btn-sm', 'Cerrar sin responder');
      cerrar.type = 'button';
      cerrar.addEventListener('click', function () { cambiarEstado(ticket.id, 'cerrado'); });

      var enviar = el('button', 'btn-pill btn-sm', 'Responder');
      enviar.type = 'button';
      enviar.addEventListener('click', function () {
        var cuerpo = texto.value.trim();
        if (!cuerpo) { aviso('Escribe una respuesta.', 'error'); return; }
        enviar.disabled = true;
        api('/api/support/tickets/' + ticket.id + '/reply', { method: 'POST', body: { body: cuerpo } })
          .then(function (r) {
            // Se dice si el correo salió o no, en vez de dar por hecho que
            // sí: creer que avisaste a alguien cuando no lo hiciste es peor
            // que saber que no salió.
            if (r.email && r.email.sent) aviso('Respondido y enviado por correo.');
            else if (r.email && r.email.reason === 'sin-correo') aviso('Respondido. No dejó correo, lo verá en el chat.');
            else if (r.email && r.email.reason === 'sin-proveedor') aviso('Respondido. Sin proveedor de correo: lo verá en el chat.');
            else aviso('Respondido, pero el correo falló. Lo verá en el chat.', 'error');
            abrirTicket(ticket.id);
            cargarTickets();
          })
          .catch(function (err) { aviso(err.message, 'error'); enviar.disabled = false; });
      });

      acciones.append(cerrar, enviar);
      responder.appendChild(acciones);
      caja.appendChild(responder);
    } else {
      var reabrir = el('button', 'btn-outline btn-sm', 'Reabrir');
      reabrir.type = 'button';
      reabrir.addEventListener('click', function () { cambiarEstado(ticket.id, 'abierto'); });
      caja.appendChild(reabrir);
    }
  }

  function cambiarEstado(id, estado) {
    api('/api/support/tickets/' + id + '/status', { method: 'POST', body: { status: estado } })
      .then(function () { abrirTicket(id); cargarTickets(); })
      .catch(function (err) { aviso(err.message, 'error'); });
  }

  // ---- Estado del asistente ----

  function pintarAsistente(estado) {
    var caja = document.getElementById('sop-asistente');
    caja.textContent = '';

    var fila = el('div', 'sop-estado-asistente');
    var punto = el('span', 'sop-luz ' + (estado.enabled ? (estado.exhausted ? 'ambar' : 'verde') : 'gris'));
    fila.appendChild(punto);

    var texto = estado.enabled
      ? (estado.exhausted
        ? 'Presupuesto del día agotado. Sigue buscando en la ayuda y abriendo tickets, pero no conversa hasta mañana.'
        : 'Activo. Responde solo y abre tickets cuando no sabe algo.')
      : 'Sin ANTHROPIC_API_KEY: el soporte funciona buscando en estos artículos y abriendo tickets, pero no conversa.';
    fila.appendChild(el('span', null, texto));
    caja.appendChild(fila);

    if (estado.enabled) {
      var uso = el('p', 'hint');
      uso.textContent = 'Hoy: ' + estado.today.calls + ' de ' + estado.today.callLimit + ' consultas · '
        + estado.today.tokens.toLocaleString('es') + ' de ' + estado.today.tokenLimit.toLocaleString('es') + ' tokens.';
      caja.appendChild(uso);
    }
  }

  // ---- Base de conocimiento ----

  function pintarKb(articulos) {
    var caja = document.getElementById('sop-kb');
    caja.textContent = '';

    if (!articulos.length) {
      caja.appendChild(el('p', 'stat-empty', 'No hay artículos. El asistente no sabrá responder nada.'));
      return;
    }

    articulos.forEach(function (a) {
      var fila = el('div', 'sop-art' + (a.enabled ? '' : ' apagado'));

      var izq = el('div', 'sop-art-texto');
      izq.appendChild(el('p', 'sop-art-preg', a.question));
      var pie = el('p', 'sop-art-meta');
      pie.textContent = (a.hits ? 'Usado ' + a.hits + (a.hits === 1 ? ' vez' : ' veces') : 'Sin usar todavía')
        + (a.enabled ? '' : ' · desactivado');
      izq.appendChild(pie);

      var acciones = el('div', 'sop-art-acciones');

      var editar = el('button', 'icon-btn', '✎');
      editar.type = 'button';
      editar.title = 'Editar';
      editar.addEventListener('click', function () { abrirEditor(a); });

      var alternar = el('button', 'icon-btn', a.enabled ? '👁' : '🚫');
      alternar.type = 'button';
      alternar.title = a.enabled ? 'Desactivar' : 'Activar';
      alternar.addEventListener('click', function () {
        api('/api/support/kb/' + a.id, { method: 'PUT', body: { enabled: !a.enabled } })
          .then(cargarKb)
          .catch(function (err) { aviso(err.message, 'error'); });
      });

      var borrar = el('button', 'icon-btn danger', '🗑');
      borrar.type = 'button';
      borrar.title = 'Borrar';
      borrar.addEventListener('click', function () {
        if (!window.confirm('¿Borrar "' + a.question + '"? El asistente dejará de saber responderlo.')) return;
        api('/api/support/kb/' + a.id, { method: 'DELETE' })
          .then(function () { aviso('Artículo borrado.'); cargarKb(); })
          .catch(function (err) { aviso(err.message, 'error'); });
      });

      acciones.append(editar, alternar, borrar);
      fila.append(izq, acciones);
      caja.appendChild(fila);
    });
  }

  function cargarKb() {
    return api('/api/support/kb')
      .then(function (datos) { pintarKb(datos.articles); })
      .catch(function (err) {
        var caja = document.getElementById('sop-kb');
        caja.textContent = '';
        caja.appendChild(el('p', 'stat-empty', err.message));
      });
  }

  function abrirEditor(articulo) {
    editando = articulo || null;
    document.getElementById('sop-ed-pregunta').value = articulo ? articulo.question : '';
    document.getElementById('sop-ed-respuesta').value = articulo ? articulo.answer : '';
    document.getElementById('sop-ed-etiquetas').value = articulo ? articulo.tags : '';
    document.getElementById('sop-editor').classList.remove('hidden');
    document.getElementById('sop-ed-pregunta').focus();
  }

  function cerrarEditor() {
    editando = null;
    document.getElementById('sop-editor').classList.add('hidden');
  }

  function guardarArticulo() {
    var cuerpo = {
      question: document.getElementById('sop-ed-pregunta').value.trim(),
      answer: document.getElementById('sop-ed-respuesta').value.trim(),
      tags: document.getElementById('sop-ed-etiquetas').value.trim(),
    };
    if (!cuerpo.question || !cuerpo.answer) {
      aviso('Hacen falta la pregunta y la respuesta.', 'error');
      return;
    }

    var peticion = editando
      ? api('/api/support/kb/' + editando.id, { method: 'PUT', body: cuerpo })
      : api('/api/support/kb', { method: 'POST', body: cuerpo });

    peticion.then(function () {
      aviso(editando ? 'Artículo actualizado.' : 'Artículo añadido.');
      cerrarEditor();
      cargarKb();
    }).catch(function (err) { aviso(err.message, 'error'); });
  }

  // ---- Arranque ----

  var iniciado = false;
  var primeraRespuestaTickets = null;

  function init() {
    if (iniciado) return;
    iniciado = true;

    var filtros = document.getElementById('sop-filtros');
    filtros.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-estado]');
      if (!btn) return;
      estadoActual = btn.dataset.estado;
      [].forEach.call(filtros.querySelectorAll('[data-estado]'), function (b) {
        b.setAttribute('aria-selected', String(b === btn));
      });
      cargarTickets();
    });

    document.getElementById('sop-kb-nuevo').addEventListener('click', function () { abrirEditor(null); });
    document.getElementById('sop-ed-cancelar').addEventListener('click', cerrarEditor);
    document.getElementById('sop-ed-guardar').addEventListener('click', guardarArticulo);

    api('/api/support/assistant').then(pintarAsistente).catch(function () { /* ya se vio arriba */ });

    // La comprobacion de acceso, al cargar la pagina, ya trajo los tickets
    // abiertos para poder marcar la pestana. Se reaprovecha esa respuesta en
    // vez de pedir lo mismo otra vez al abrirla.
    if (primeraRespuestaTickets) {
      pintarLista(primeraRespuestaTickets.tickets);
      pintarContadores(primeraRespuestaTickets.counts);
      primeraRespuestaTickets = null;
    } else {
      cargarTickets();
    }
    cargarKb();
  }

  /* Descubre la pestaña sólo si esta cuenta puede ver el buzón. Un 403 deja
     todo como estaba y nadie se entera de que existe. */
  function comprobarAcceso() {
    // Una sola peticion: este endpoint tambien devuelve 403 a quien no es del
    // equipo, asi que sirve de comprobacion de acceso y de contador a la vez.
    // Antes eran dos, y las dos se repetian al abrir la pestana.
    api('/api/support/tickets?status=abierto')
      .then(function (d) {
        var pestana = document.getElementById('tab-soporte');
        if (pestana) pestana.classList.remove('hidden');
        pintarContadores(d.counts);
        primeraRespuestaTickets = d;
      })
      .catch(function () { /* no es del equipo: la pestaña sigue oculta */ });
  }

  window.initSoporte = init;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', comprobarAcceso);
  } else {
    comprobarAcceso();
  }
})();
