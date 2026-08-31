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

    a.appendChild(el('div', 'icon-circle', link.icon || PLATFORM_ICONS[link.platform] || '🔗'));

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

  function applyTheme(profile) {
    document.documentElement.style.setProperty('--accent-from', profile.accent_from);
    document.documentElement.style.setProperty('--accent-to', profile.accent_to);
    const bgUrl = profile.background_path || '/images/hero-bg.jpg';
    document.documentElement.style.setProperty('--hero-bg', `url('${bgUrl}')`);
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
