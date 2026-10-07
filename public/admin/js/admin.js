(function () {
  // Traduce si el modulo de idiomas esta; si no, devuelve el castellano.
  var T = function (clave, es, vals) { return window.AKI18n ? window.AKI18n.t(clave, es, vals) : es; };
  let currentLinks = [];
  let selectorFondo = null;
  document.getElementById('slug-prefix').textContent = window.location.host + '/';

  // Compartido con los demas modulos del panel (encuestas, soporte): un
  // solo aviso abajo, no uno por archivo.
  window.showToast = showToast;

  function showToast(message, type) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'toast' + (type ? ' ' + type : '');
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 2600);
  }

  // The server issues this cookie readable on purpose: it is the half of
  // the CSRF pair the page is meant to echo back in a header. The secret
  // half stays in the session, where another origin cannot reach it.
  function csrfToken() {
    const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : '';
  }

  // Lo que el invitado estaba intentando hacer, deducido de la ruta que iba
  // a llamar. La ventana lo usa para decir "para ANADIR UN ENLACE hace falta
  // cuenta" en vez de un "inicia sesion" a secas, que no explica nada.
  const MOTIVOS = [
    [/^\/api\/links/, 'enlaces'],
    [/^\/api\/profile\/(avatar|background)/, 'fondo'],
    [/^\/api\/profile/, 'perfil'],
    [/^\/api\/(checkout|billing-portal)/, 'vip'],
    [/^\/api\/(auth|account)/, 'cuenta'],
  ];

  function motivoDe(url) {
    for (const [patron, clave] of MOTIVOS) if (patron.test(url)) return clave;
    return null;
  }

  async function api(url, options) {
    const opts = options || {};
    const headers = {};

    // Quien no tiene cuenta no llama a nada: todo esto cambia una pagina que
    // todavia no existe. Se corta aqui, que es por donde pasan TODAS las
    // peticiones del panel — asi no hay que acordarse de comprobarlo en los
    // cuarenta botones de abajo, y el que se anada manana queda cubierto sin
    // tocar nada.
    if (window.AKSesion && window.AKSesion.invitado()) {
      // Solo lo que cambia algo abre la puerta. Una lectura que se cuele
      // —un modulo que no se callase bien— se queda en silencio: abrir la
      // ventana de "crea tu cuenta" sin que nadie haya pulsado nada es
      // echarle al visitante la culpa de algo que hizo la pagina.
      if ((opts.method || 'GET').toUpperCase() !== 'GET') {
        window.AKSesion.pedirCuenta(motivoDe(url));
      }
      throw new Error(T('adm.necesitas_una_cuenta_para_esto', 'Necesitas una cuenta para esto'));
    }

    if (opts.body && !(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json';
    // Sent on every request rather than only on writes: harmless on a GET,
    // and it means a new endpoint cannot be added without it by accident.
    headers['X-CSRF-Token'] = csrfToken();

    const res = await fetch(url, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });

    if (res.status === 401) {
      // Tenia sesion y se le acabo a mitad de faena. Se le manda a entrar
      // con el camino de vuelta puesto, no al principio: perder donde
      // estabas porque pasaron ocho horas es un castigo gratuito.
      window.AKSesion.irAEntrar('sesion');
      throw new Error('No autenticado');
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error');
    return data;
  }

  // El topbar se queda pegado arriba, así que la barra de pestañas se pega
  // justo debajo (ver la nota en admin.css). Para eso hace falta saber
  // cuánto mide, y eso cambia: con la ventana estrecha el título parte en
  // dos líneas y el alto se duplica. Un número fijo fallaría justo en ese
  // caso, que es cuando más molesta.
  (function medirTopbar() {
    const topbar = document.querySelector('.topbar');
    if (!topbar) return;

    const publicar = () => {
      // En móvil el topbar no está pegado; ahí el hueco es cero.
      const pegado = getComputedStyle(topbar).position === 'sticky';
      document.documentElement.style.setProperty(
        '--alto-topbar', (pegado ? topbar.offsetHeight : 0) + 'px'
      );
    };

    publicar();
    // El alto cambia al redimensionar y también cuando llega la fuente web,
    // que mueve el salto de línea del título.
    if (window.ResizeObserver) new ResizeObserver(publicar).observe(topbar);
    else window.addEventListener('resize', publicar);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(publicar);
  })();

  // ---- Pestanas ----

  (function setupTabs() {
    const bar = document.getElementById('dash-tabs');
    if (!bar) return;
    const tabs = [...bar.querySelectorAll('.tab')];
    const panels = [...document.querySelectorAll('.tab-panel')];
    const STORAGE_KEY = 'aks.dash.tab';

    let show = function (name) {
      // Una pestaña oculta NO cuenta como conocida. Soporte nace oculta y
      // sólo se descubre para quien lleva la plataforma; sin esto, bastaba
      // con haberla visitado una vez —o escribir la clave a mano en el
      // almacenamiento— para que el panel de soporte y el de encuestas se
      // pintaran en una cuenta cualquiera. Los datos nunca llegaban (el
      // servidor responde 403), pero se veía una sección que no es suya.
      const conocida = tabs.some((t) => t.dataset.tab === name && !t.classList.contains('hidden'));
      const target = conocida ? name : 'perfil';
      tabs.forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === target)));
      panels.forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== target));
      // Switching sections should start at the top, the way a page load
      // does -- otherwise you land halfway down a panel you have not seen.
      window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
      // Sólo se recuerda lo que se pudo cumplir. Si se pidió una pestaña
      // todavía oculta y caímos en Perfil, la preferencia se queda como
      // estaba: Soporte aparece unos cientos de milisegundos despues, y
      // pisarla aqui dejaria a su dueño siempre en Perfil.
      if (!conocida) return;
      try {
        localStorage.setItem(STORAGE_KEY, target);
      } catch {
        // Private mode or blocked storage: the tab still switches, it just
        // will not be remembered.
      }
    };

    // support.js descubre su pestana mas tarde, cuando el servidor confirma
    // que esta cuenta lleva la plataforma. Para entonces `show` ya corrio y
    // la rechazo por estar oculta, asi que necesita poder pedirla otra vez.
    window.AKPestanas = { mostrar: (nombre) => show(nombre) };

    tabs.forEach((tab) => tab.addEventListener('click', () => show(tab.dataset.tab)));

    // Left/right arrows move between tabs, per the ARIA tablist pattern.
    bar.addEventListener('keydown', (e) => {
      const index = tabs.indexOf(document.activeElement);
      if (index === -1) return;
      let next = null;
      if (e.key === 'ArrowRight') next = (index + 1) % tabs.length;
      if (e.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
      if (e.key === 'Home') next = 0;
      if (e.key === 'End') next = tabs.length - 1;
      if (next === null) return;
      e.preventDefault();
      tabs[next].focus();
      show(tabs[next].dataset.tab);
    });

    // Coming back from Stripe or from linking an account should land on the
    // section that action belongs to, not on whatever was open before.
    const params = new URLSearchParams(window.location.search);
    let initial = null;
    if (params.has('checkout')) initial = 'vip';
    else if (params.has('linked') || params.get('error') === 'oauth_taken') initial = 'cuenta';
    else {
      try {
        initial = localStorage.getItem(STORAGE_KEY);
      } catch {
        initial = null;
      }
    }
    show(initial || 'perfil');

    // Las analiticas se cargan la primera vez que se abre su pestana, no en
    // cada entrada al panel: la consulta es barata, pero pedirla a quien
    // nunca la mira lo es aun mas.
    let analiticasCargadas = false;
    let soporteCargado = false;
    const showOriginal = show;
    show = function (name) {
      showOriginal(name);
      // Sin cuenta no hay analiticas que pedir: las tarjetas se quedan en
      // cero —que es la verdad— en vez de gastar cuatro 401. Se espera a la
      // respuesta que ya esta en vuelo, no se pregunta de nuevo.
      if (name === 'analiticas' && !analiticasCargadas && window.initAnalytics) {
        analiticasCargadas = true;
        window.AKSesion.conCuenta(window.initAnalytics);
      }
      if (name === 'soporte' && !soporteCargado && window.initSoporte) {
        soporteCargado = true;
        window.initSoporte();
      }
    };
    if (initial === 'analiticas' || (!initial && false)) show('analiticas');

    // Lets other code jump to a section without reaching into the DOM.
    window.showDashTab = show;
  })();

  // ---- Auth ----

  // Cerrar sesion devuelve a la portada, que es este mismo panel en modo
  // libre. Antes iba a la pantalla de entrar, que era la portada; ahora
  // mandar ahi seria pedirle volver a entrar justo a quien acaba de salir.
  document.getElementById('logout-btn').addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' });
    window.location.href = '/';
  });

  // ---- Profile ----

  // El fondo puede ser foto o vídeo, así que la vista previa son dos
  // elementos y se enseña el que toque. Una sola función para los tres
  // sitios que la pintan: cargar el perfil, subir y quitar.
  const FONDO_ES_VIDEO = /\.(mp4|webm)$/i;

  function pintarFondo(ruta) {
    const url = ruta || '/images/hero-bg.jpg';
    const img = document.getElementById('background-preview');
    const video = document.getElementById('background-preview-video');
    if (FONDO_ES_VIDEO.test(url)) {
      video.src = url;
      video.muted = true;
      video.classList.remove('hidden');
      img.classList.add('hidden');
      const arranque = video.play();
      if (arranque && arranque.catch) arranque.catch(function () {});
      return;
    }
    img.src = url;
    img.classList.remove('hidden');
    video.classList.add('hidden');
    // Sin esto el vídeo anterior seguiría descargándose de fondo.
    video.removeAttribute('src');
    video.load();
  }

  function fillProfileForm(profile) {
    document.getElementById('avatar-preview').src = profile.avatar_path || placeholder(profile.name);
    pintarFondo(profile.background_path);
    document.getElementById('p-name').value = profile.name || '';
    document.getElementById('p-slug').value = profile.slug || '';
    document.getElementById('view-public-link').href = '/' + (profile.slug || '');
    document.getElementById('p-tagline').value = profile.tagline || '';
    document.getElementById('p-footer').value = profile.footer_text || '';
    document.getElementById('p-accent-from').value = profile.accent_from || '#ff5f8f';
    document.getElementById('p-accent-to').value = profile.accent_to || '#ff9a5a';
    document.getElementById('p-gate-enabled').checked = !!profile.age_gate_enabled;
    document.getElementById('p-gate-title').value = profile.age_gate_title || '';
    document.getElementById('p-gate-subtitle').value = profile.age_gate_subtitle || '';
    document.getElementById('p-gate-confirm').value = profile.age_gate_confirm || '';
    document.getElementById('p-particles-enabled').checked = !!profile.particles_enabled;
    document.getElementById('p-particles-color').value = profile.particles_color || '#ffffff';
    document.getElementById('p-particles-density').value = profile.particles_density ?? 60;
    document.getElementById('p-particles-density-value').textContent = profile.particles_density ?? 60;
    document.getElementById('vip-tier').value = profile.vip_tier || '';

    // El selector de fondo se arranca una sola vez, con lo que el perfil ya
    // tenia elegido. Despues ya lleva el estado el, porque es quien recibe
    // los clics.
    if (!selectorFondo && window.AKSelectorFondo) {
      selectorFondo = window.AKSelectorFondo.iniciar({ elegido: profile.wallpaper || null });
    } else if (selectorFondo) {
      selectorFondo.poner(profile.wallpaper || null);
    }

    renderVipStatus(profile);
  }

  const VIP_LABELS = { billete: '💵 Dollars', king: '👑 THE KING' };

  function renderVipStatus(profile) {
    const box = document.getElementById('vip-current');
    if (!profile.vip_tier) {
      box.classList.add('hidden');
      return;
    }
    document.getElementById('vip-current-label').textContent = VIP_LABELS[profile.vip_tier] || profile.vip_tier;
    // Cancel button + its explanation only make sense with a real Stripe
    // subscription behind them — a tier flipped on via the test toggle has
    // nothing to cancel.
    document.getElementById('vip-manage-wrap').classList.toggle('hidden', !profile.stripe_subscription_id);
    box.classList.remove('hidden');
  }

  function placeholder(name) {
    const letter = (name || '?').charAt(0).toUpperCase();
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
      <rect width="200" height="200" fill="#2a1420"/>
      <text x="50%" y="54%" font-family="sans-serif" font-size="80" fill="#f1ecf3" text-anchor="middle" dominant-baseline="middle">${letter}</text>
    </svg>`;
    return 'data:image/svg+xml;base64,' + btoa(svg);
  }

  async function loadProfile() {
    const profile = await api('/api/profile');
    fillProfileForm(profile);
    // particles.js necesita los mismos datos y antes los pedia aparte:
    // dos /api/profile identicos por carga. Ahora se los damos.
    if (window.aplicarParticulas) window.aplicarParticulas(profile);
    return profile;
  }

  document.getElementById('profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/profile', {
        method: 'PUT',
        body: JSON.stringify({
          name: document.getElementById('p-name').value.trim(),
          slug: document.getElementById('p-slug').value.trim(),
          tagline: document.getElementById('p-tagline').value.trim(),
          footer_text: document.getElementById('p-footer').value.trim(),
          accent_from: document.getElementById('p-accent-from').value,
          accent_to: document.getElementById('p-accent-to').value,
          age_gate_enabled: document.getElementById('p-gate-enabled').checked ? 1 : 0,
          age_gate_title: document.getElementById('p-gate-title').value.trim(),
          age_gate_subtitle: document.getElementById('p-gate-subtitle').value.trim(),
          age_gate_confirm: document.getElementById('p-gate-confirm').value.trim(),
          particles_enabled: document.getElementById('p-particles-enabled').checked ? 1 : 0,
          particles_color: document.getElementById('p-particles-color').value,
          particles_density: parseInt(document.getElementById('p-particles-density').value, 10),
          wallpaper: selectorFondo ? selectorFondo.elegido() : null,
        }),
      });
      showToast(T('adm.perfil_actualizado', 'Perfil actualizado'), 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('p-particles-density').addEventListener('input', (e) => {
    document.getElementById('p-particles-density-value').textContent = e.target.value;
  });

  // Los fondos llevan dentro los dos colores de acento, asi que al cambiarlos
  // hay que rehacerlos. Se escucha `change` y no `input`: arrastrando por el
  // selector de color saldrian decenas de eventos por segundo, y reconstruir
  // ocho lienzos animados en cada uno pone el ventilador a girar.
  ['p-accent-from', 'p-accent-to'].forEach((id) => {
    const campo = document.getElementById(id);
    if (campo) campo.addEventListener('change', () => {
      if (selectorFondo) selectorFondo.recolorear();
    });
  });

  // ---- VIP: real subscriptions via Stripe ----

  document.querySelectorAll('.vip-plan-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        const { url } = await api('/api/checkout', {
          method: 'POST',
          body: JSON.stringify({ tier: btn.dataset.tier }),
        });
        window.location.href = url;
      } catch (err) {
        showToast(err.message, 'error');
        btn.disabled = false;
      }
    });
  });

  document.getElementById('vip-manage-btn').addEventListener('click', async () => {
    try {
      const { url } = await api('/api/billing-portal', { method: 'POST' });
      window.location.href = url;
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  (function handleCheckoutQueryParams() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('checkout') === 'success') showToast('¡Listo! Tu suscripción quedará activa en unos segundos.', 'success');
    if (params.get('checkout') === 'cancel') showToast(T('adm.pago_cancelado', 'Pago cancelado'), 'error');
    if (params.has('checkout')) window.history.replaceState({}, '', '/admin/dashboard');
  })();

  // ---- VIP: visor 3D en vivo (Three.js) ----
  //
  // El modulo se trae con import() dinamico, no con una etiqueta <script>.
  // Estatico costaba 2,1 MB de Three.js desde unpkg en CADA carga del panel
  // —descarga, analisis y compilacion en el hilo principal— para una vista
  // que solo existe dentro de la pestana VIP y que la mayoria de las
  // visitas al panel no abre nunca. Ahora no se pide hasta que esa pestana
  // esta de verdad en pantalla.

  let current3DHandle = null;
  let promesaModulo3D = null;

  /** Trae el modulo una sola vez, aunque se pida a la vez desde dos sitios. */
  function cargarModulo3D() {
    if (window.renderVip3D) return Promise.resolve(true);
    if (!promesaModulo3D) {
      promesaModulo3D = import('/js/vip-3d.js')
        .then(() => true)
        .catch((err) => {
          console.error('No se pudo cargar el visor 3D:', err);
          promesaModulo3D = null; // que un fallo de red no lo deje muerto
          return false;
        });
    }
    return promesaModulo3D;
  }

  function show3DModel(tierKey) {
    const container = document.getElementById('vip-3d-viewer');
    if (!container) return;

    if (!window.renderVip3D) {
      container.innerHTML = '<span class="vip-3d-hint">Cargando vista 3D…</span>';
      cargarModulo3D().then((ok) => {
        if (ok) show3DModel(tierKey);
        else container.innerHTML = '<span class="vip-3d-hint">Vista 3D no disponible ahora mismo — se usa el badge plano.</span>';
      });
      return;
    }

    // Dispose (and free the WebGL context) BEFORE requesting a new one —
    // sandboxed/low-end environments can have very few concurrent WebGL
    // contexts available, and starting the next load while the previous
    // renderer is still holding its context can make the new one silently
    // fail to acquire a context of its own.
    if (current3DHandle) {
      current3DHandle.dispose();
      current3DHandle = null;
    }
    container.innerHTML = '<span class="vip-3d-hint">Cargando vista 3D…</span>';

    window.renderVip3D(container, tierKey)
      .then((handle) => {
        current3DHandle = handle;
        if (!handle) container.innerHTML = '<span class="vip-3d-hint">Vista 3D no disponible en este dispositivo — se usa el badge plano.</span>';
      })
      .catch((err) => {
        console.error('Error inesperado en el visor 3D:', err);
        container.innerHTML = '<span class="vip-3d-hint">Vista 3D no disponible en este dispositivo — se usa el badge plano.</span>';
      });
  }

  function initVip3DViewer() {
    show3DModel('billete');
  }

  // Deferred until the VIP panel is actually on screen. The renderer sizes
  // itself from container.clientWidth, which is 0 while the panel is hidden
  // — starting it early produced a 160x160 canvas floating in a 628px box.
  function initVip3DWhenVisible() {
    const container = document.getElementById('vip-3d-viewer');
    if (!container) return;

    if (container.clientWidth > 0) {
      initVip3DViewer();
      return;
    }
    if (typeof IntersectionObserver !== 'function') {
      initVip3DViewer(); // no observer: better a small canvas than none
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      observer.disconnect();
      initVip3DViewer();
    });
    observer.observe(container);
  }

  // Ya no hay que esperar al evento 'vip3d-ready': el observador de abajo
  // dispara la carga del modulo cuando hace falta.
  initVip3DWhenVisible();

  // ---- VIP: demo preview (replays the reveal + swaps the 3D model; touches
  // neither the profile's real vip_tier nor its "seen it already" flag) ----

  document.querySelectorAll('.vip-demo-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      show3DModel(btn.dataset.tier);
      const buttons = document.querySelectorAll('.vip-demo-btn');
      buttons.forEach((b) => { b.disabled = true; });
      window.playVipDemo(btn.dataset.tier, document.getElementById('vip-demo-anchor'), () => {
        buttons.forEach((b) => { b.disabled = false; });
      });
    });
  });

  // ---- VIP (modo de prueba, reemplazar por Stripe) ----

  document.getElementById('vip-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const profile = await api('/api/profile/vip-owner', {
        method: 'PUT',
        body: JSON.stringify({ vip_tier: document.getElementById('vip-tier').value || null }),
      });
      renderVipStatus(profile);
      showToast(T('adm.tier_vip_actualizado', 'Tier VIP actualizado'), 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('avatar-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('avatar', file);
    try {
      const profile = await api('/api/profile/avatar', { method: 'POST', body: formData });
      document.getElementById('avatar-preview').src = profile.avatar_path;
      showToast(T('adm.foto_actualizada', 'Foto actualizada'), 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
    e.target.value = '';
  });

  document.getElementById('background-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('background', file);
    try {
      const profile = await api('/api/profile/background', { method: 'POST', body: formData });
      pintarFondo(profile.background_path);
      showToast(T('adm.fondo_actualizado', 'Fondo actualizado'), 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
    e.target.value = '';
  });

  document.getElementById('background-remove-btn').addEventListener('click', async () => {
    try {
      await api('/api/profile/background', { method: 'DELETE' });
      pintarFondo(null);
      showToast(T('adm.fondo_restablecido_al_predeterminado', 'Fondo restablecido al predeterminado'), 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // ---- Password ----

  document.getElementById('password-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/auth/password', {
        method: 'PUT',
        body: JSON.stringify({
          currentPassword: document.getElementById('pw-current').value,
          newPassword: document.getElementById('pw-new').value,
        }),
      });
      document.getElementById('password-form').reset();
      showToast(T('adm.contrasena_actualizada', 'Contraseña actualizada'), 'success');
      loadAccountStatus();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // ---- Google account ----

  async function loadAccountStatus(datosPrecargados) {
    const data = datosPrecargados || await fetch('/api/auth/me').then((r) => r.json());
    if (!data.authenticated) return;

    document.getElementById('pw-current-field').classList.toggle('hidden', !data.hasPassword);
    document.getElementById('pw-new-label').textContent = data.hasPassword ? 'Contraseña nueva' : 'Crear contraseña';

    // Cosmetic only — the endpoint itself enforces this server-side.
    document.getElementById('vip-owner-section').classList.toggle('hidden', !data.isOwner);

    setupDeleteAccount(data.username);
    // Independientes entre sí: en paralelo, no una detrás de otra.
    await Promise.all([
      renderEmail(),
      renderPasskeys(),
      renderMfa(),
      renderLinkedAccounts(),
      renderSesiones(),
    ]);
  }

  // ---- Sesiones abiertas ----

  let sesionesWired = false;

  async function renderSesiones() {
    const estado = document.getElementById('sessions-status');
    const boton = document.getElementById('sessions-revoke-btn');
    if (!estado || !boton) return;

    try {
      const { active } = await api('/api/auth/sessions');
      const otras = Math.max(0, (active || 1) - 1);
      estado.textContent = otras
        ? `${active} en total · ${otras} además de esta`
        : 'Sólo esta';
      boton.disabled = otras === 0;
    } catch {
      estado.textContent = T('adm.no_se_pudo_comprobar', 'No se pudo comprobar');
      boton.disabled = true;
    }

    if (sesionesWired) return;
    sesionesWired = true;
    boton.addEventListener('click', async () => {
      boton.disabled = true;
      try {
        const { revoked } = await api('/api/auth/sessions/revoke-others', { method: 'POST' });
        showToast(revoked ? `${revoked} sesión(es) cerrada(s)` : 'No había otras sesiones', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
      renderSesiones();
    });
  }

  // ---- Correo de recuperacion ----

  let emailWired = false;

  async function renderEmail() {
    const status = document.getElementById('email-status');
    if (!status) return;
    const data = await fetch('/api/auth/email').then((r) => r.json());

    if (!data.canSend) {
      status.textContent = T('adm.el_servidor_no_tiene_envio_de_correo_configu', 'El servidor no tiene envío de correo configurado');
      document.getElementById('email-edit-btn').classList.add('hidden');
      return;
    }
    // "Verificada" es la distincion que importa: solo una direccion
    // confirmada sirve para recuperar la cuenta.
    status.textContent = data.email
      ? `${data.email} · ${data.verified ? 'verificada' : 'sin verificar'}`
      : T('adm.ninguna', 'Ninguna');

    if (emailWired) return;
    emailWired = true;

    const panel = document.getElementById('email-panel');
    document.getElementById('email-edit-btn').addEventListener('click', () => {
      document.getElementById('email-input').value = data.email || '';
      panel.classList.remove('hidden');
      document.getElementById('email-input').focus();
    });
    document.getElementById('email-cancel').addEventListener('click', () => panel.classList.add('hidden'));
    document.getElementById('email-save').addEventListener('click', async () => {
      const btn = document.getElementById('email-save');
      btn.disabled = true;
      try {
        await api('/api/auth/email', {
          method: 'POST',
          body: JSON.stringify({ email: document.getElementById('email-input').value.trim() }),
        });
        panel.classList.add('hidden');
        showToast(T('adm.te_enviamos_un_enlace_para_confirmar_la_dire', 'Te enviamos un enlace para confirmar la dirección'), 'success');
        renderEmail();
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        btn.disabled = false;
      }
    });
  }

  // ---- Llaves de acceso (passkeys) ----

  let passkeysWired = false;

  async function renderPasskeys() {
    const list = document.getElementById('passkey-list');
    const addBtn = document.getElementById('passkey-add-btn');
    const unsupported = document.getElementById('passkey-unsupported');
    if (!list) return;

    if (!window.passkeys || !window.passkeys.supported()) {
      unsupported.classList.remove('hidden');
      addBtn.classList.add('hidden');
    } else {
      unsupported.classList.add('hidden');
      addBtn.classList.remove('hidden');
    }

    const keys = await fetch('/api/auth/passkeys').then((r) => r.json());
    list.innerHTML = '';

    if (!keys.length) {
      const empty = document.createElement('p');
      empty.className = 'linked-status';
      empty.textContent = T('adm.ninguna', 'Ninguna');
      list.appendChild(empty);
    }

    keys.forEach((key) => {
      const row = document.createElement('div');
      row.className = 'linked-row';

      const info = document.createElement('div');
      const label = document.createElement('p');
      label.className = 'hint';
      label.style.margin = '0 0 4px';
      label.textContent = key.label || 'Dispositivo';
      const status = document.createElement('p');
      status.className = 'linked-status';
      // "Sincronizada" matters: an iCloud/Google-synced passkey survives
      // losing the phone, a device-bound one does not.
      status.textContent = key.synced ? 'Sincronizada entre tus dispositivos' : 'Solo en este dispositivo';
      info.append(label, status);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn-outline btn-sm btn-danger';
      remove.textContent = T('adm.eliminar', 'Eliminar');
      remove.addEventListener('click', async () => {
        try {
          await api(`/api/auth/passkeys/${key.id}`, { method: 'DELETE' });
          showToast(T('adm.llave_eliminada', 'Llave eliminada'), 'success');
          renderPasskeys();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });

      row.append(info, remove);
      list.appendChild(row);
    });

    if (passkeysWired) return;
    passkeysWired = true;

    addBtn.addEventListener('click', async () => {
      addBtn.disabled = true;
      const original = addBtn.textContent;
      addBtn.textContent = T('adm.esperando', 'Esperando…');
      try {
        const options = await api('/api/auth/passkey/register/options', { method: 'POST' });
        const credential = await window.passkeys.register(options);
        // A name the owner will recognise later; the browser never tells us
        // what the device is called.
        const guess = /iPhone|iPad/i.test(navigator.userAgent) ? 'iPhone'
          : /Macintosh/i.test(navigator.userAgent) ? 'Mac'
          : /Android/i.test(navigator.userAgent) ? 'Android'
          : /Windows/i.test(navigator.userAgent) ? 'Windows'
          : 'Dispositivo';
        await api('/api/auth/passkey/register/verify', {
          method: 'POST',
          body: JSON.stringify({ response: credential, label: guess }),
        });
        showToast(T('adm.llave_de_acceso_anadida', 'Llave de acceso añadida'), 'success');
        renderPasskeys();
      } catch (err) {
        showToast(window.passkeys ? window.passkeys.describeError(err) : err.message, 'error');
      } finally {
        addBtn.disabled = false;
        addBtn.textContent = original;
      }
    });
  }

  // ---- Verificacion en dos pasos ----

  let mfaWired = false;

  async function renderMfa() {
    const status = await fetch('/api/auth/mfa/status').then((r) => r.json());
    const label = document.getElementById('mfa-status');
    const toggle = document.getElementById('mfa-toggle-btn');

    const devicesRow = document.getElementById('mfa-devices-row');
    const devicesStatus = document.getElementById('mfa-devices-status');

    if (status.enabled) {
      label.textContent = `Activa · ${status.recoveryCodesLeft} código(s) de recuperación sin usar`;
      toggle.textContent = T('adm.desactivar', 'Desactivar');
      devicesRow.classList.remove('hidden');
      const n = status.trustedDevices || 0;
      devicesStatus.textContent = n
        ? `${n} · no piden código durante ${status.trustHours}h`
        : 'Ninguno';
    } else {
      label.textContent = T('adm.no_activa', 'No activa');
      toggle.textContent = T('adm.activar', 'Activar');
      devicesRow.classList.add('hidden');
    }

    if (mfaWired) return;
    mfaWired = true;

    const setup = document.getElementById('mfa-setup');
    const disable = document.getElementById('mfa-disable');
    const recovery = document.getElementById('mfa-recovery');

    toggle.addEventListener('click', async () => {
      const on = document.getElementById('mfa-status').textContent.startsWith('Activa');
      if (on) {
        disable.classList.remove('hidden');
        setup.classList.add('hidden');
        return;
      }
      try {
        const data = await api('/api/auth/mfa/setup', { method: 'POST' });
        document.getElementById('mfa-secret').textContent = data.secret;
        setup.classList.remove('hidden');
        recovery.classList.add('hidden');
        document.getElementById('mfa-code').focus();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    document.getElementById('mfa-forget-btn').addEventListener('click', async () => {
      try {
        const data = await api('/api/auth/mfa/forget-devices', { method: 'POST' });
        showToast(
          data.forgotten
            ? `${data.forgotten} dispositivo(s) olvidado(s)`
            : 'No había dispositivos recordados',
          'success'
        );
        renderMfa();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    document.getElementById('mfa-cancel-btn').addEventListener('click', () => {
      setup.classList.add('hidden');
      document.getElementById('mfa-code').value = '';
    });

    document.getElementById('mfa-confirm-btn').addEventListener('click', async () => {
      try {
        const data = await api('/api/auth/mfa/enable', {
          method: 'POST',
          body: JSON.stringify({ code: document.getElementById('mfa-code').value.trim() }),
        });
        setup.classList.add('hidden');
        document.getElementById('mfa-code').value = '';
        // Shown once. They are stored hashed, so this cannot be repeated.
        document.getElementById('mfa-codes').textContent = (data.recoveryCodes || []).join('\n');
        recovery.classList.remove('hidden');
        showToast(T('adm.verificacion_en_dos_pasos_activada', 'Verificación en dos pasos activada'), 'success');
        renderMfa();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    document.getElementById('mfa-off-cancel').addEventListener('click', () => {
      disable.classList.add('hidden');
      document.getElementById('mfa-off-password').value = '';
      document.getElementById('mfa-off-code').value = '';
    });

    document.getElementById('mfa-off-confirm').addEventListener('click', async () => {
      try {
        await api('/api/auth/mfa/disable', {
          method: 'POST',
          body: JSON.stringify({
            password: document.getElementById('mfa-off-password').value,
            code: document.getElementById('mfa-off-code').value.trim(),
          }),
        });
        disable.classList.add('hidden');
        document.getElementById('mfa-off-password').value = '';
        document.getElementById('mfa-off-code').value = '';
        recovery.classList.add('hidden');
        showToast('Verificación en dos pasos desactivada', 'success');
        renderMfa();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  // ---- Delete account ----

  function setupDeleteAccount(username) {
    const openBtn = document.getElementById('delete-account-open');
    const panel = document.getElementById('delete-account-confirm');
    const input = document.getElementById('delete-account-input');
    const submit = document.getElementById('delete-account-submit');
    const cancel = document.getElementById('delete-account-cancel');
    const error = document.getElementById('delete-account-error');
    document.getElementById('delete-account-username').textContent = username;

    openBtn.addEventListener('click', () => {
      panel.classList.remove('hidden');
      openBtn.classList.add('hidden');
      input.focus();
    });

    cancel.addEventListener('click', () => {
      panel.classList.add('hidden');
      openBtn.classList.remove('hidden');
      input.value = '';
      submit.disabled = true;
      error.classList.add('hidden');
    });

    // The button stays dead until the name matches, so the destructive
    // click can't happen by reflex.
    input.addEventListener('input', () => {
      submit.disabled = input.value !== username;
      error.classList.add('hidden');
    });

    submit.addEventListener('click', async () => {
      submit.disabled = true;
      submit.textContent = T('adm.eliminando', 'Eliminando…');
      try {
        await api('/api/account/delete', {
          method: 'POST',
          body: JSON.stringify({ confirm: input.value }),
        });
        // A la portada, no a la pantalla de entrar: la cuenta ya no existe.
        window.location.href = '/';
      } catch (err) {
        error.textContent = err.message;
        error.classList.remove('hidden');
        submit.textContent = T('adm.eliminar_definitivamente', 'Eliminar definitivamente');
        submit.disabled = input.value !== username;
      }
    });
  }

  async function renderLinkedAccounts() {
    const providers = await fetch('/api/auth/linked').then((r) => r.json());
    const section = document.getElementById('linked-accounts-section');
    const list = document.getElementById('linked-accounts-list');
    const available = providers.filter((p) => p.configured);

    // Nothing to show if the server has no OAuth credentials at all.
    if (!available.length) {
      section.classList.add('hidden');
      return;
    }
    section.classList.remove('hidden');
    list.innerHTML = '';

    // One row per linked account plus a row to add another, so a second
    // address on the same provider is visible and removable on its own.
    function makeRow(provider, account) {
      const row = document.createElement('div');
      row.className = 'linked-row';

      const info = document.createElement('div');
      const label = document.createElement('p');
      label.className = 'hint';
      label.style.margin = '0 0 4px';
      label.textContent = provider.label;
      const status = document.createElement('p');
      status.className = 'linked-status';
      status.textContent = account ? 'Vinculada' : 'No vinculada';
      info.append(label, status);

      // The address stays hidden behind a click so it never leaks into a
      // screenshot or a shoulder-surf — the brand alone says enough.
      if (account && account.email) {
        const reveal = document.createElement('button');
        reveal.type = 'button';
        reveal.className = 'linked-reveal';
        reveal.textContent = T('adm.ver_correo', 'Ver correo');
        reveal.setAttribute('aria-expanded', 'false');
        reveal.addEventListener('click', () => {
          const shown = reveal.getAttribute('aria-expanded') === 'true';
          reveal.textContent = shown ? T('adm.ver_correo', 'Ver correo') : account.email;
          reveal.setAttribute('aria-expanded', String(!shown));
          reveal.classList.toggle('is-revealed', !shown);
        });
        status.append(' · ', reveal);
      }

      const action = document.createElement(account ? 'button' : 'a');
      action.className = 'btn-outline btn-sm';
      if (account) {
        action.type = 'button';
        action.textContent = T('adm.desvincular', 'Desvincular');
        action.addEventListener('click', async () => {
          try {
            // Scoped to this account id — without it the server would drop
            // every address linked through this provider.
            await api(`/api/auth/${provider.key}/link?account=${encodeURIComponent(account.id)}`, { method: 'DELETE' });
            showToast(`${provider.label} desvinculada`, 'success');
            renderLinkedAccounts();
          } catch (err) {
            showToast(err.message, 'error');
          }
        });
      } else {
        action.href = `/api/auth/${provider.key}?intent=link`;
        action.textContent = `Vincular ${provider.label}`;
      }

      row.append(info, action);
      return row;
    }

    available.forEach((p) => {
      const accounts = p.accounts || (p.linked ? [{ id: null, email: p.email }] : []);
      if (!accounts.length) {
        list.appendChild(makeRow(p, null));
        return;
      }
      accounts.forEach((account) => list.appendChild(makeRow(p, account)));

      // Add-another, offered discreetly once at least one is linked.
      const add = document.createElement('a');
      add.className = 'linked-add';
      add.href = `/api/auth/${p.key}?intent=link`;
      add.textContent = `+ Vincular otra cuenta de ${p.label}`;
      list.appendChild(add);
    });
  }

  (function handleOauthQueryParams() {
    const params = new URLSearchParams(window.location.search);
    const linked = params.get('linked');
    if (linked) showToast(`Cuenta de ${linked} vinculada`, 'success');
    if (params.get('error') === 'oauth_taken') {
      showToast(T('adm.esa_cuenta_ya_esta_vinculada_a_otro_usuario', 'Esa cuenta ya está vinculada a otro usuario'), 'error');
    }
    if (params.has('linked') || params.has('error')) {
      window.history.replaceState({}, '', '/admin/dashboard');
    }
  })();

  // ---- Links ----

  const PLATFORM_ICONS = {
    youtube: '▶️', twitch: '🎮', telegram: '✈️', discord: '💬',
    twitter: '🐦', instagram: '📸', tiktok: '🎵', wishlist: '🎁', custom: '🔗',
  };

  // hasOwnProperty, not a bare lookup: platform is free text now, and a
  // plain PLATFORM_ICONS[name] would inherit from Object.prototype — a link
  // named "constructor" would otherwise render the function's source as its
  // icon.
  function platformIcon(platform) {
    return Object.prototype.hasOwnProperty.call(PLATFORM_ICONS, platform)
      ? PLATFORM_ICONS[platform]
      : '🔗';
  }

  async function loadLinks() {
    currentLinks = await api('/api/links');
    renderLinksAdmin();
  }

  function renderLinksAdmin() {
    const container = document.getElementById('links-admin-list');
    container.innerHTML = '';

    if (!currentLinks.length) {
      container.appendChild(Object.assign(document.createElement('div'), {
        className: 'empty-state',
        textContent: 'Todavía no agregaste ningún enlace.',
      }));
      return;
    }

    currentLinks.forEach((link, idx) => {
      const row = document.createElement('div');
      row.className = 'link-admin-row' + (link.enabled ? '' : ' disabled');

      const reorderCol = document.createElement('div');
      reorderCol.className = 'reorder-col';
      const upBtn = iconButton('↑', () => moveLink(idx, -1));
      const downBtn = iconButton('↓', () => moveLink(idx, 1));
      if (idx === 0) upBtn.disabled = true;
      if (idx === currentLinks.length - 1) downBtn.disabled = true;
      reorderCol.append(upBtn, downBtn);

      const thumb = document.createElement('div');
      thumb.className = 'link-thumb';
      if (link.type === 'featured' && link.image_path) {
        const img = document.createElement('img');
        img.src = link.image_path;
        thumb.appendChild(img);
      } else if (esIconoImagen(link.icon)) {
        // Un emoji de Discord: no es texto, es la imagen que se descargó al
        // pegarlo.
        const img = document.createElement('img');
        img.src = link.icon;
        img.alt = '';
        img.className = 'icono-imagen';
        thumb.appendChild(img);
      } else {
        thumb.textContent = link.icon || platformIcon(link.platform);
      }

      const info = document.createElement('div');
      info.className = 'link-admin-info';
      const labelDiv = document.createElement('div');
      labelDiv.className = 'label';
      labelDiv.innerHTML = `<span>${escapeHtml(link.label)}</span><span class="type-tag">${link.type === 'featured' ? 'Destacada' : 'Simple'}</span>`;
      const subDiv = document.createElement('div');
      subDiv.className = 'subtitle';
      subDiv.textContent = link.subtitle || link.url;
      info.append(labelDiv, subDiv);

      const actions = document.createElement('div');
      actions.className = 'link-admin-actions';
      actions.appendChild(iconButton(link.enabled ? '👁' : '🚫', () => toggleEnabled(link)));
      actions.appendChild(iconButton('✎', () => openLinkModal(link)));
      actions.appendChild(iconButton('🗑', () => deleteLink(link), true));

      row.append(reorderCol, thumb, info, actions);
      container.appendChild(row);
    });
  }

  function iconButton(label, onClick, danger) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'icon-btn' + (danger ? ' danger' : '');
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  async function moveLink(idx, dir) {
    const target = idx + dir;
    if (target < 0 || target >= currentLinks.length) return;
    const arr = currentLinks.slice();
    [arr[idx], arr[target]] = [arr[target], arr[idx]];
    currentLinks = arr;
    renderLinksAdmin();
    try {
      await api('/api/links/reorder', { method: 'PUT', body: JSON.stringify({ order: arr.map((l) => l.id) }) });
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function toggleEnabled(link) {
    try {
      await api(`/api/links/${link.id}`, {
        method: 'PUT',
        body: JSON.stringify({ ...link, enabled: link.enabled ? 0 : 1 }),
      });
      await loadLinks();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function deleteLink(link) {
    if (!confirm(`¿Eliminar el enlace "${link.label}"?`)) return;
    try {
      await api(`/api/links/${link.id}`, { method: 'DELETE' });
      showToast(T('adm.enlace_eliminado', 'Enlace eliminado'), 'success');
      await loadLinks();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // ---- Link modal ----

  const modal = document.getElementById('link-modal');
  const linkForm = document.getElementById('link-form');
  let editingImageLinkId = null;

  function updateImageRowVisibility() {
    const type = document.getElementById('l-type').value;
    document.getElementById('l-image-row').classList.toggle('hidden', type !== 'featured');
  }

  document.getElementById('l-type').addEventListener('change', updateImageRowVisibility);

  // The <select> only lists the presets, so "Personalizado" reveals a text
  // field for anything else (Spotify, Patreon, a personal site...).
  const PRESET_PLATFORMS = ['youtube', 'twitch', 'telegram', 'discord', 'twitter', 'instagram', 'tiktok', 'wishlist'];

  function updatePlatformCustomVisibility() {
    const isCustom = document.getElementById('l-platform').value === 'custom';
    document.getElementById('l-platform-custom-row').classList.toggle('hidden', !isCustom);
  }

  document.getElementById('l-platform').addEventListener('change', (e) => {
    updatePlatformCustomVisibility();
    const iconField = document.getElementById('l-icon');
    if (!iconField.value) iconField.value = platformIcon(e.target.value);
    pintarVistaIcono();
  });

  // ---- El icono: un emoji cualquiera, o uno de Discord ----

  function esIconoImagen(icono) {
    return typeof icono === 'string' && icono.startsWith('/uploads/');
  }

  // Las mismas dos formas que reconoce el servidor en support/emoji.js. Aquí
  // sólo deciden qué se enseña mientras se escribe; quien manda es el
  // servidor, que es el que va a buscar la imagen. Si algún día una deja de
  // cuadrar, lo peor que pasa es que la pista de abajo se quede corta.
  function pareceDiscord(valor) {
    if (/^<a?:[A-Za-z0-9_~]{1,64}:\d{15,25}>$/.test(valor)) return true;
    return /^https:\/\/(cdn\.discordapp\.com|media\.discordapp\.net)\/emojis\/\d{15,25}/.test(valor);
  }

  // Lo que se va a ver en el círculo, antes de guardar. Un emoji de Discord
  // todavía no se puede enseñar —vive en su servidor y esta página sólo
  // carga imágenes del propio sitio— así que se dice que llegará al guardar
  // en vez de enseñar un hueco roto.
  function pintarVistaIcono() {
    const valor = document.getElementById('l-icon').value.trim();
    const vista = document.getElementById('l-icon-preview');
    const pista = document.getElementById('l-icon-hint');
    if (!vista || !pista) return;

    vista.textContent = '';
    vista.classList.remove('esperando');

    if (esIconoImagen(valor)) {
      const img = document.createElement('img');
      img.src = valor;
      img.alt = '';
      img.className = 'icono-imagen';
      vista.appendChild(img);
      pista.textContent = T('adm.icono_discord_guardado',
        'Emoji de Discord guardado. Borra el campo y pega otro enlace para cambiarlo.');
      return;
    }

    if (pareceDiscord(valor)) {
      vista.textContent = '⬇';
      vista.classList.add('esperando');
      pista.textContent = T('adm.icono_discord_al_guardar',
        'Emoji de Discord reconocido. Se traerá a tu página al guardar.');
      return;
    }

    // El error fácil: copiar el nombre que Discord enseña debajo del emoji.
    if (/^:[A-Za-z0-9_~]{1,64}:$/.test(valor)) {
      vista.textContent = '?';
      pista.textContent = T('adm.icono_discord_solo_nombre',
        'Eso es el nombre del emoji, no el emoji. Clic derecho sobre él en Discord → Copiar enlace.');
      return;
    }

    vista.textContent = valor || '🔗';
    pista.textContent = T('adm.icono_pista',
      'Cualquier emoji. ¿Uno de Discord? Clic derecho sobre él → Copiar enlace, y pega aquí ese enlace.');
  }

  document.getElementById('l-icon').addEventListener('input', pintarVistaIcono);

  function openLinkModal(link) {
    document.getElementById('link-modal-title').textContent = link ? 'Editar enlace' : 'Nuevo enlace';
    document.getElementById('l-id').value = link ? link.id : '';
    document.getElementById('l-type').value = link ? link.type : 'simple';

    // A saved platform that isn't one of the presets belongs in the custom
    // text field. Assigning it straight to the <select> would silently
    // select nothing (value becomes ''), and saving would then wipe the
    // name the user had typed.
    const savedPlatform = link ? link.platform : 'custom';
    const isPreset = PRESET_PLATFORMS.includes(savedPlatform);
    document.getElementById('l-platform').value = isPreset ? savedPlatform : 'custom';
    document.getElementById('l-platform-custom').value =
      !isPreset && savedPlatform && savedPlatform !== 'custom' ? savedPlatform : '';

    document.getElementById('l-icon').value = link ? (link.icon || '') : '';
    pintarVistaIcono();
    document.getElementById('l-label').value = link ? link.label : '';
    document.getElementById('l-subtitle').value = link ? (link.subtitle || '') : '';
    document.getElementById('l-url').value = link ? link.url : '';
    document.getElementById('l-badge-left').value = link ? (link.badge_left || '') : '';
    document.getElementById('l-badge-right').value = link ? (link.badge_right || '') : '';
    document.getElementById('l-enabled').checked = link ? !!link.enabled : true;
    editingImageLinkId = link ? link.id : null;
    updateImageRowVisibility();
    updatePlatformCustomVisibility();
    modal.classList.remove('hidden');
  }

  function closeLinkModal() {
    modal.classList.add('hidden');
    linkForm.reset();
    editingImageLinkId = null;
  }

  document.getElementById('add-link-btn').addEventListener('click', () => {
    // Un invitado no llega ni a abrir la ventana del enlace. Dejarle
    // rellenarla entera y pedirle cuenta al guardar es hacerle perder el
    // trabajo, y es justo el momento en que se va.
    if (window.AKSesion.invitado()) return window.AKSesion.pedirCuenta('enlaces');
    openLinkModal(null);
  });
  document.getElementById('link-cancel-btn').addEventListener('click', closeLinkModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeLinkModal(); });

  document.getElementById('l-image-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file || !editingImageLinkId) {
      if (file && !editingImageLinkId) showToast(T('adm.primero_guarda_el_enlace_luego_subele_la_ima', 'Primero guarda el enlace, luego súbele la imagen'), 'error');
      return;
    }
    const formData = new FormData();
    formData.append('image', file);
    try {
      await api(`/api/links/${editingImageLinkId}/image`, { method: 'POST', body: formData });
      showToast(T('adm.imagen_actualizada', 'Imagen actualizada'), 'success');
      await loadLinks();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  linkForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('l-id').value;
    const selectedPlatform = document.getElementById('l-platform').value;
    const typedPlatform = document.getElementById('l-platform-custom').value.trim();
    const payload = {
      type: document.getElementById('l-type').value,
      // Falls back to the literal 'custom' when they pick Personalizado but
      // leave the name blank — same value the field had before this existed.
      platform: selectedPlatform === 'custom' ? (typedPlatform || 'custom') : selectedPlatform,
      icon: document.getElementById('l-icon').value.trim(),
      label: document.getElementById('l-label').value.trim(),
      subtitle: document.getElementById('l-subtitle').value.trim(),
      url: document.getElementById('l-url').value.trim(),
      badge_left: document.getElementById('l-badge-left').value.trim(),
      badge_right: document.getElementById('l-badge-right').value.trim(),
      enabled: document.getElementById('l-enabled').checked ? 1 : 0,
    };

    try {
      if (id) {
        await api(`/api/links/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
        showToast(T('adm.enlace_actualizado', 'Enlace actualizado'), 'success');
        closeLinkModal();
      } else {
        const created = await api('/api/links', { method: 'POST', body: JSON.stringify(payload) });
        showToast(T('adm.enlace_creado', 'Enlace creado'), 'success');
        if (payload.type === 'featured') {
          editingImageLinkId = created.id;
          document.getElementById('l-id').value = created.id;
          document.getElementById('link-modal-title').textContent = T('adm.editar_enlace_ahora_sube_la_imagen', 'Editar enlace — ahora sube la imagen');
        } else {
          closeLinkModal();
        }
      }
      await loadLinks();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // ---- La puerta ----
  //
  // La ventana que sale cuando alguien sin cuenta toca algo que de verdad
  // cambiaria su pagina. No es un muro: cierra con Escape, con un clic
  // fuera y con un enlace que dice "seguir mirando", porque quien venia a
  // ver tiene que poder seguir viendo.

  // Funcion y no constante: una constante se evalua al cargar el archivo,
  // que es ANTES de que llegue el diccionario de idiomas, y congelaria el
  // castellano. Ya paso con los chips del chat.
  function textoDeMotivo(clave) {
    var textos = {
      enlaces: T('adm.puerta_enlaces', 'Tus enlaces viven en tu cuenta. Créala y empieza a añadirlos: se tarda menos que en leer esto.'),
      perfil: T('adm.puerta_perfil', 'El nombre, la dirección y los colores de tu página hay que guardarlos en algún sitio, y ese sitio es tu cuenta.'),
      fondo: T('adm.puerta_fondo', 'Para subir tu foto o tu vídeo de fondo necesitas una cuenta donde dejarlos.'),
      vip: T('adm.puerta_vip', 'Primero la cuenta, luego el VIP: el badge se cuelga de una página, y la página es tu cuenta.'),
      cuenta: T('adm.puerta_cuenta', 'Esto son los ajustes de una cuenta. Crea la tuya y serán los tuyos.'),
    };
    return Object.prototype.hasOwnProperty.call(textos, clave)
      ? textos[clave]
      : T('adm.puerta_general', 'Lo que cambies hay que guardarlo en algún sitio, y ese sitio es tu cuenta.');
  }

  (function montarPuerta() {
    const modal = document.getElementById('puerta-modal');
    if (!modal) return;
    const motivoEl = document.getElementById('puerta-motivo');

    let motivoActual = null;
    let focoAnterior = null;

    function abrir(motivo) {
      motivoActual = motivo || null;
      motivoEl.textContent = textoDeMotivo(motivoActual);
      // A donde devolver el foco al cerrar: si no, cerrar la ventana deja a
      // quien va con teclado al principio de la pagina.
      focoAnterior = document.activeElement;
      modal.classList.remove('hidden');
      document.getElementById('puerta-crear').focus();
    }

    function cerrar() {
      modal.classList.add('hidden');
      if (focoAnterior && focoAnterior.focus) focoAnterior.focus();
    }

    document.getElementById('puerta-cerrar').addEventListener('click', cerrar);
    modal.addEventListener('click', (e) => { if (e.target === modal) cerrar(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !modal.classList.contains('hidden')) cerrar();
    });

    // El motivo viaja con ellos: la pantalla de entrar lo repite, para que
    // el salto no parezca que vino de ninguna parte.
    document.getElementById('puerta-crear')
      .addEventListener('click', () => window.AKSesion.irAEntrar(motivoActual, 'register'));
    document.getElementById('puerta-entrar')
      .addEventListener('click', () => window.AKSesion.irAEntrar(motivoActual));

    window.AKSesion.instalarPuerta(abrir);
  })();

  // ---- El panel para quien no tiene cuenta ----

  // El ejemplo con el que se rellena. Es un ejemplo y se le llama asi: no
  // sale del servidor ni de la pagina de nadie, porque no hay a quien
  // pedirsela. Un panel con todos los campos vacios no parece libre,
  // parece roto.
  const EJEMPLO = {
    name: 'Tu nombre',
    slug: 'tu-nombre',
    tagline: 'Una línea que diga quién eres.',
    footer_text: '© Tu nombre',
    avatar_path: null,
    background_path: null,
    accent_from: '#ff5f8f',
    accent_to: '#ff9a5a',
    age_gate_enabled: 0,
    age_gate_title: '',
    age_gate_subtitle: '',
    age_gate_confirm: '',
    particles_enabled: 1,
    particles_color: '#ffffff',
    particles_density: 60,
    vip_tier: '',
  };

  const EJEMPLO_ENLACES = [
    { id: 'ejemplo-1', platform: 'instagram', label: 'Instagram', url: 'https://instagram.com/tu-usuario', type: 'simple', enabled: 1 },
    { id: 'ejemplo-2', platform: 'youtube', label: 'YouTube', url: 'https://youtube.com/@tu-canal', type: 'simple', enabled: 1 },
    { id: 'ejemplo-3', platform: 'tiktok', label: 'TikTok', url: 'https://tiktok.com/@tu-usuario', type: 'simple', enabled: 0 },
  ];

  function arrancarComoInvitado() {
    document.getElementById('acciones-invitado').classList.remove('hidden');
    document.getElementById('aviso-invitado').classList.remove('hidden');

    // Ni una peticion. Todo lo que pintaria el panel de alguien con cuenta
    // volveria 401, asi que se pinta el ejemplo y se deja mirar.
    fillProfileForm(EJEMPLO);
    if (window.aplicarParticulas) window.aplicarParticulas(EJEMPLO);
    currentLinks = EJEMPLO_ENLACES.slice();
    renderLinksAdmin();

    // La pestana Cuenta nace diciendo "Comprobando..." y lo rellena quien
    // pide el estado al servidor. Sin cuenta nadie lo pide, asi que se
    // quedaba comprobando para siempre: parece que algo se ha colgado,
    // justo en la pestana donde hay que inspirar confianza.
    const conCuenta = T('adm.disponible_con_cuenta', 'Disponible con cuenta');
    ['mfa-status', 'email-status', 'sessions-status'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.textContent = conCuenta;
    });

    // Y sus botones se quedaban muertos, que es peor todavia.
    //
    // Casi todo el panel engancha sus oyentes al cargar el archivo, asi que
    // pulsar cualquier cosa acaba en api() y api() abre la puerta. Estas dos
    // pestanas no: los de Cuenta (activar el doble factor, cambiar el
    // correo, cerrar sesiones, anadir una llave) se enganchan DENTRO de las
    // funciones que piden su estado al servidor, y los de Analiticas dentro
    // de initAnalytics. Ninguna de las dos corre sin cuenta, asi que esos
    // botones no hacian absolutamente nada: ni puerta, ni aviso, ni error.
    //
    // Un solo oyente por pestana, delegado, en vez de uno por boton: asi el
    // que se anada manana queda cubierto sin que nadie se acuerde de esto.
    ['cuenta', 'analiticas'].forEach((nombre) => {
      const panel = document.querySelector('[data-panel="' + nombre + '"]');
      if (!panel) return;
      panel.addEventListener('click', (e) => {
        if (e.target.closest('button')) window.AKSesion.pedirCuenta('cuenta');
      });
    });

    // Y que las cifras en cero se entiendan: son de una pagina que todavia
    // no existe, no de una que no tiene visitas.
    const notaAnaliticas = document.getElementById('analiticas-invitado');
    if (notaAnaliticas) notaAnaliticas.classList.remove('hidden');

    // Estos tres van directos a la pantalla de entrar, sin explicar nada
    // por el camino: quien los pulsa ya ha decidido.
    const irARegistro = () => window.AKSesion.irAEntrar(null, 'register');
    document.getElementById('crear-cuenta-btn').addEventListener('click', irARegistro);
    document.getElementById('aviso-invitado-btn').addEventListener('click', irARegistro);
    document.getElementById('entrar-btn')
      .addEventListener('click', () => window.AKSesion.irAEntrar(null));
  }

  // ---- Init ----

  (async function init() {
    const sesion = await window.AKSesion.datos();
    if (!sesion.authenticated) return arrancarComoInvitado();

    document.getElementById('acciones-con-cuenta').classList.remove('hidden');

    // En paralelo, no en cadena. Las tres son independientes entre si, y
    // encadenadas con await el panel pagaba cuatro viajes de ida y vuelta
    // seguidos antes de pintar nada: en localhost no se nota, contra el
    // servidor real son varios cientos de milisegundos de espera pura.
    await Promise.all([
      loadProfile(),
      loadLinks(),
      loadAccountStatus(sesion),
    ]);
  })();
})();
