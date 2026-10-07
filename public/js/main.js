(function () {
  const GATE_SEEN_KEY = 'biolinks_gate_passed';

  const PLATFORM_ICONS = {
    youtube: '▶️',
    twitch: '🎮',
    telegram: '✈️',
    discord: '💬',
    twitter: '🐦',
    instagram: '📸',
    tiktok: '🎵',
    wishlist: '🎁',
    custom: '🔗',
  };

  // hasOwnProperty, not a bare lookup: platform is user-supplied free text,
  // and a plain PLATFORM_ICONS[name] would inherit from Object.prototype —
  // a link whose platform is "constructor" would otherwise render the
  // function's source in place of its icon.
  function platformIcon(platform) {
    return Object.prototype.hasOwnProperty.call(PLATFORM_ICONS, platform)
      ? PLATFORM_ICONS[platform]
      : '🔗';
  }

  function placeholderAvatar(letter) {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
        <rect width="200" height="200" fill="#2a1420"/>
        <text x="50%" y="54%" font-family="sans-serif" font-size="80" fill="#f5eef0"
              text-anchor="middle" dominant-baseline="middle">${letter}</text>
      </svg>`;
    return 'data:image/svg+xml;base64,' + btoa(svg);
  }

  function el(tag, className, html) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (html !== undefined) node.innerHTML = html;
    return node;
  }

  // Lo mismo, pero como texto. Para TODO lo que escribe una persona: el
  // nombre del enlace, el subtítulo, los badges y el icono.
  //
  // el() escribe con innerHTML, que está bien para las cadenas fijas de
  // aquí dentro y fatal para lo que venga de un formulario: lo que alguien
  // guardó como "<b>" se sirve como etiqueta. El panel ya escapaba el
  // nombre al pintar su lista; esta página, que es la que ven los
  // visitantes, no lo hacía. Y pasa a importar más ahora que el campo del
  // icono admite trescientos caracteres en vez de cuatro.
  function texto(tag, className, contenido) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (contenido !== undefined && contenido !== null) node.textContent = contenido;
    return node;
  }

  // Un emoji de Discord no es un emoji: es una imagen, que se descargó a
  // /uploads cuando lo pegaron. Los demás iconos son texto.
  function esIconoImagen(icono) {
    return typeof icono === 'string' && icono.startsWith('/uploads/');
  }

  function circuloDeIcono(link) {
    const circulo = el('div', 'icon-circle');
    if (esIconoImagen(link.icon)) {
      const img = document.createElement('img');
      img.src = link.icon;
      img.alt = '';
      img.loading = 'lazy';
      img.className = 'icono-imagen';
      circulo.appendChild(img);
      return circulo;
    }
    circulo.textContent = link.icon || platformIcon(link.platform);
    return circulo;
  }

  function renderFeatured(link) {
    const a = el('a', 'link-card featured');
    a.href = link.url;
    a.dataset.url = link.url;
    // Lo lee track.js para atribuir el clic a este enlace concreto.
    a.dataset.linkId = link.id;

    const media = el('div', 'media');
    if (link.image_path) media.style.backgroundImage = `url('${link.image_path}')`;

    const badgeRow = el('div', 'badge-row');
    if (link.badge_left) badgeRow.appendChild(texto('span', 'badge accent', link.badge_left));
    else badgeRow.appendChild(el('span'));
    if (link.badge_right) badgeRow.appendChild(texto('span', 'badge', link.badge_right));
    media.appendChild(badgeRow);
    a.appendChild(media);

    const body = el('div', 'body');
    const info = el('div', 'info');
    const labelRow = el('div', 'label-row');
    labelRow.appendChild(texto('span', null, link.label));
    info.appendChild(labelRow);
    info.appendChild(texto('div', 'subtitle', link.subtitle || ''));
    body.appendChild(info);
    body.appendChild(el('span', 'btn-pill btn-gradient open-btn', 'Abrir'));
    a.appendChild(body);

    return a;
  }

  function renderSimple(link) {
    const a = el('a', 'link-card simple');
    a.href = link.url;
    a.dataset.url = link.url;
    // Lo lee track.js para atribuir el clic a este enlace concreto.
    a.dataset.linkId = link.id;

    a.appendChild(circuloDeIcono(link));

    const info = el('div', 'info');
    info.appendChild(texto('div', 'label', link.label));
    if (link.subtitle) info.appendChild(texto('div', 'subtitle', link.subtitle));
    a.appendChild(info);

    a.appendChild(el('span', 'arrow', '→'));
    return a;
  }

  function getSlug() {
    return window.location.pathname.replace(/^\/+|\/+$/g, '');
  }

  async function loadData() {
    const slug = getSlug();
    const profileRes = await fetch(`/api/public/${slug}/profile`);
    if (!profileRes.ok) return { notFound: true };

    const [profile, links] = await Promise.all([
      profileRes.json(),
      fetch(`/api/public/${slug}/links`).then((r) => r.json()),
    ]);
    return { profile, links };
  }

  // El fondo puede ser una foto o un vídeo; se distingue por la extensión,
  // que la pone el servidor (siempre /uploads/<uuid>.<ext>) y no el visitante.
  const FONDO_ES_VIDEO = /\.(mp4|webm)$/i;

  /**
   * Monta el fondo en vídeo detrás de .bg-hero.
   *
   * Va detrás y no dentro porque .bg-hero termina en un color opaco que lo
   * taparía; con la clase `with-video` esa capa desaparece y quedan sólo
   * los degradados, que son los que oscurecen el fondo para que se lea el
   * texto. Así el vídeo recibe exactamente el mismo velo que tenía la foto.
   */
  function montarVideoDeFondo(url) {
    const hero = document.querySelector('.bg-hero');
    const video = document.createElement('video');
    video.className = 'bg-video';
    // muted + playsinline son requisito para que el navegador deje arrancar
    // un vídeo solo; sin los dos, en el móvil no se reproduce nada.
    video.muted = true;
    video.defaultMuted = true;
    video.setAttribute('muted', '');
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.loop = true;
    video.setAttribute('aria-hidden', 'true');
    video.tabIndex = -1;

    // Quien pide menos movimiento, o va con ahorro de datos, no se queda sin
    // el fondo que eligió el dueño: lo ve quieto, en su primer fotograma.
    const conexion = navigator.connection || {};
    const quieto = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      || conexion.saveData === true;

    video.preload = quieto ? 'metadata' : 'auto';
    video.src = url;
    if (hero) hero.classList.add('with-video');
    document.body.insertBefore(video, document.body.firstChild);

    if (quieto) {
      // Un salto mínimo fuerza a decodificar y pintar un fotograma; sin él
      // el elemento se queda en negro.
      video.addEventListener('loadedmetadata', () => {
        try { video.currentTime = 0.05; } catch (err) { /* da igual: queda el color de fondo */ }
      }, { once: true });
      return;
    }

    video.autoplay = true;
    const arranque = video.play();
    // Si el navegador lo bloquea igualmente, se queda en el primer
    // fotograma: un fondo quieto, no un hueco negro.
    if (arranque && arranque.catch) arranque.catch(() => {});
  }

  function applyTheme(profile) {
    document.documentElement.style.setProperty('--accent-from', profile.accent_from);
    document.documentElement.style.setProperty('--accent-to', profile.accent_to);

    // El fondo generativo manda sobre la foto, cuando hay uno elegido.
    //
    // Son dos funciones distintas y conviven: la foto es tuya, el fondo del
    // catálogo es un algoritmo que se dibuja solo. Si alguien tiene las dos
    // cosas puestas gana la elegida a mano en el catálogo, que es la que
    // tocó más tarde, y la foto le sigue esperando debajo por si cambia de
    // opinión.
    if (profile.wallpaper && window.AKFondos && window.AKFondos.existe(profile.wallpaper)) {
      const lienzo = document.getElementById('wallpaper-canvas');
      if (lienzo) {
        lienzo.classList.remove('hidden');
        // Sin foto debajo: dos fondos superpuestos se pelean y ninguno se ve.
        document.documentElement.style.setProperty('--hero-bg', 'none');
        window.AKFondos.montar(lienzo, {
          clave: profile.wallpaper,
          desde: profile.accent_from,
          hasta: profile.accent_to,
        });
        return;
      }
    }

    const fondo = profile.background_path || '/images/hero-bg.jpg';
    if (FONDO_ES_VIDEO.test(fondo)) {
      montarVideoDeFondo(fondo);
      return;
    }
    document.documentElement.style.setProperty('--hero-bg', `url('${fondo}')`);
  }

  function fillProfile(profile) {
    const avatarSrc = profile.avatar_path || placeholderAvatar((profile.name || '?').charAt(0).toUpperCase());

    document.getElementById('gate-avatar').src = avatarSrc;
    document.getElementById('gate-title').textContent = profile.age_gate_title || profile.name;
    document.getElementById('gate-subtitle').textContent = profile.age_gate_subtitle || profile.tagline;
    document.getElementById('gate-confirm').textContent = profile.age_gate_confirm;

    document.getElementById('main-avatar').src = avatarSrc;
    document.getElementById('main-name').textContent = profile.name;
    document.getElementById('main-tagline').textContent = profile.tagline;

    // El recorrido se alimenta de lo que el perfil ya tiene. Nada inventado:
    // su nombre, su dirección, su frase y su pie, en grande.
    if (profile.recorrido && window.AKRecorrido) {
      const slug = document.getElementById('recorrido-slug');
      if (slug) slug.textContent = '/' + (profile.slug || '');
      const nombre = document.getElementById('recorrido-nombre');
      if (nombre) nombre.textContent = profile.name || '';
      const frase = document.getElementById('recorrido-tagline');
      if (frase) frase.textContent = profile.tagline || '';
      const pie = document.getElementById('recorrido-pie');
      if (pie) pie.textContent = profile.footer_text || '';
      window.AKRecorrido.iniciar(profile);
    }

    document.getElementById('footer-text').textContent = profile.footer_text || profile.name;
    document.title = profile.name;
  }

  function renderLinks(links) {
    const container = document.getElementById('links-list');
    container.innerHTML = '';
    links.forEach((link) => {
      const node = link.type === 'featured' ? renderFeatured(link) : renderSimple(link);
      node.addEventListener('click', (e) => {
        e.preventDefault();
        window.open(link.url, '_blank', 'noopener');
      });
      container.appendChild(node);
    });
  }

  function showGate() {
    document.getElementById('age-gate').classList.remove('hidden');
    document.getElementById('main-page').classList.add('hidden');
  }

  function showMain() {
    document.getElementById('age-gate').classList.add('hidden');
    document.getElementById('main-page').classList.remove('hidden');
  }

  async function init() {
    const { profile, links, notFound } = await loadData();

    if (notFound) {
      document.body.innerHTML = '<div style="min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:#f5eef0;font-family:sans-serif;text-align:center;padding:24px;"><h1 style="margin:0;">Página no encontrada</h1><p style="opacity:.6;margin:0;">Este usuario no existe o cambió de dirección.</p></div>';
      return;
    }

    applyTheme(profile);
    // Las partículas necesitan el mismo perfil y antes lo pedían por su
    // cuenta: eran dos peticiones idénticas en cada visita.
    if (window.aplicarParticulas) window.aplicarParticulas(profile);
    fillProfile(profile);
    renderLinks(links);
    if (window.renderVipBadge) window.renderVipBadge(profile);

    const alreadyPassed = sessionStorage.getItem(GATE_SEEN_KEY) === '1';

    if (!profile.age_gate_enabled || alreadyPassed) {
      showMain();
    } else {
      showGate();
    }

    document.getElementById('enter-btn').addEventListener('click', () => {
      sessionStorage.setItem(GATE_SEEN_KEY, '1');
      showMain();
    });
  }

  init();
})();
