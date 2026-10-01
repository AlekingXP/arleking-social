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

  function renderFeatured(link) {
    const a = el('a', 'link-card featured');
    a.href = link.url;
    a.dataset.url = link.url;
    // Lo lee track.js para atribuir el clic a este enlace concreto.
    a.dataset.linkId = link.id;

    const media = el('div', 'media');
    if (link.image_path) media.style.backgroundImage = `url('${link.image_path}')`;

    const badgeRow = el('div', 'badge-row');
    if (link.badge_left) badgeRow.appendChild(el('span', 'badge accent', link.badge_left));
    else badgeRow.appendChild(el('span'));
    if (link.badge_right) badgeRow.appendChild(el('span', 'badge', link.badge_right));
    media.appendChild(badgeRow);
    a.appendChild(media);

    const body = el('div', 'body');
    const info = el('div', 'info');
    const labelRow = el('div', 'label-row');
    labelRow.appendChild(el('span', null, link.label));
    info.appendChild(labelRow);
    info.appendChild(el('div', 'subtitle', link.subtitle || ''));
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

    a.appendChild(el('div', 'icon-circle', link.icon || platformIcon(link.platform)));

    const info = el('div', 'info');
    info.appendChild(el('div', 'label', link.label));
    if (link.subtitle) info.appendChild(el('div', 'subtitle', link.subtitle));
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
