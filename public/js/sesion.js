// Quien esta mirando el panel.
//
// El panel ya no es solo para quien tiene cuenta: la portada es esta misma
// pantalla y cualquiera entra a verla. Varios modulos necesitan saberlo —las
// encuestas no se le ensenan a un invitado, las analiticas no se piden, el
// asistente no se abre— y si cada uno lo preguntase por su cuenta serian
// cinco /api/auth/me identicos en cada carga, y cinco 401 en la consola de
// alguien que no ha hecho nada mal.
//
// Una sola peticion, compartida. Los modulos se cuelgan de `conCuenta()`.
//
// Va ANTES que los demas scripts del panel en el HTML, para que el enganche
// exista cuando cualquiera de ellos arranque.
(function () {
  var promesa = null;
  var ultima = null;
  var puerta = null;

  function cargar() {
    if (!promesa) {
      promesa = fetch('/api/auth/me')
        .then(function (r) { return r.json(); })
        // Sin red la respuesta honesta es "no hay sesion": asi el panel
        // entra en modo invitado en vez de quedarse a medio pintar.
        .catch(function () { return { authenticated: false }; })
        .then(function (d) {
          ultima = (d && typeof d === 'object') ? d : { authenticated: false };
          return ultima;
        });
    }
    return promesa;
  }

  // La ruta a la que volver despues de entrar. Con el hash, que es donde
  // guardan su sitio algunas pantallas; sin la query, que puede traer
  // tokens de un correo y no tiene nada que hacer en un viaje de ida y
  // vuelta.
  function aqui() {
    return window.location.pathname + window.location.hash;
  }

  function irAEntrar(motivo, modo) {
    var url = '/admin/login?volver=' + encodeURIComponent(aqui());
    if (motivo) url += '&motivo=' + encodeURIComponent(motivo);
    if (modo) url += '&mode=' + encodeURIComponent(modo);
    window.location.href = url;
  }

  window.AKSesion = {
    // La promesa, para quien quiera los datos enteros.
    datos: cargar,

    // Lo que ya se sabe, sin esperar. null = todavia no ha llegado, que no
    // es lo mismo que "es un invitado".
    conocida: function () { return ultima; },
    invitado: function () { return !!ultima && !ultima.authenticated; },

    // Para el modulo que no tiene nada que hacer con un invitado: se calla
    // en vez de pedir algo que va a volver 401.
    conCuenta: function (cb) {
      return cargar().then(function (s) { if (s.authenticated) cb(s); });
    },

    // El panel instala aqui su ventana de cristal. Si no la hubiera —otra
    // pagina, o admin.js que no llego a cargar— se va directo a la pantalla
    // de siempre: un boton que no hace nada seria peor que un salto.
    instalarPuerta: function (fn) { puerta = fn; },
    pedirCuenta: function (motivo) {
      if (puerta) return puerta(motivo);
      return irAEntrar(motivo);
    },

    irAEntrar: irAEntrar,
    aqui: aqui,
  };
})();
