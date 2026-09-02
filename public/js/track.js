/* Rastreador de la página pública.
 *
 * Reglas que se impone a sí mismo:
 *
 *  - No guarda nada en el dispositivo. Ni cookie, ni localStorage. La
 *    identidad la deriva el servidor de un hash que rota a diario, así que
 *    aquí no hay nada que persistir y no hace falta banner de consentimiento.
 *  - No bloquea nada. Todo va por sendBeacon (o fetch con keepalive), que
 *    es asíncrono y sobrevive a que la pestaña se cierre.
 *  - Si falla, calla. Una métrica perdida no vale ni un error en la consola
 *    de la página de alguien.
 *  - Respeta "Do Not Track" y el ahorro de datos.
 */
(function () {
  if (navigator.doNotTrack === '1' || window.doNotTrack === '1') return;

  var slug = (window.location.pathname.split('/')[1] || '').trim();
  if (!slug) return;

  var inicio = Date.now();
  var salidaEnviada = false;

  function enviar(payload) {
    try {
      var cuerpo = JSON.stringify(payload);
      // sendBeacon es el único que el navegador garantiza durante el cierre
      // de la pestaña; fetch normal se cancelaría a mitad.
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/track', new Blob([cuerpo], { type: 'application/json' }));
        return;
      }
      fetch('/api/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: cuerpo,
        keepalive: true,
      }).catch(function () {});
    } catch (e) {
      /* silencio deliberado */
    }
  }

  enviar({ slug: slug, type: 'view' });

  // Clics en los enlaces. Delegado en document para que siga funcionando con
  // los enlaces que main.js pinta después.
  document.addEventListener('click', function (e) {
    var nodo = e.target && e.target.closest ? e.target.closest('[data-link-id]') : null;
    if (!nodo) return;
    var id = nodo.getAttribute('data-link-id');
    if (id) enviar({ slug: slug, type: 'click', linkId: Number(id) });
  }, true);

  // Tiempo de permanencia. 'visibilitychange' es lo que de verdad se dispara
  // al cambiar de app en un móvil; 'pagehide' cubre el cierre. 'unload' no
  // es fiable en móviles y por eso no se usa.
  function marcarSalida() {
    if (salidaEnviada) return;
    salidaEnviada = true;
    enviar({ slug: slug, type: 'leave', dwellMs: Date.now() - inicio });
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') marcarSalida();
  });
  window.addEventListener('pagehide', marcarSalida);
})();
