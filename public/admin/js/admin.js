(function () {
  let currentLinks = [];
  document.getElementById('slug-prefix').textContent = window.location.host + '/';

  function showToast(message, type) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'toast' + (type ? ' ' + type : '');
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 2600);
  }

  async function api(url, options) {
    const res = await fetch(url, {
      headers: options && options.body && !(options.body instanceof FormData)
        ? { 'Content-Type': 'application/json' }
        : undefined,
      ...options,
    });
    if (res.status === 401) {
      window.location.href = '/admin/login';
      throw new Error('No autenticado');
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error');
    return data;
  }

  // ---- Auth ----

  async function checkAuth() {
    const data = await fetch('/api/auth/me').then((r) => r.json());
    if (!data.authenticated) {
      window.location.href = '/admin/login';
      return false;
    }
    return true;
  }

  document.getElementById('logout-btn').addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' });
    window.location.href = '/admin/login';
  });

  // ---- Profile ----

  function fillProfileForm(profile) {
    document.getElementById('avatar-preview').src = profile.avatar_path || placeholder(profile.name);
    document.getElementById('background-preview').src = profile.background_path || '/images/hero-bg.jpg';
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
    renderVipStatus(profile);
  }

  const VIP_LABELS = { billete: '💵 Billete dorado', king: '👑 THE KING' };

  function renderVipStatus(profile) {
    const box = document.getElementById('vip-current');
    if (!profile.vip_tier) {
      box.classList.add('hidden');
      return;
    }
    document.getElementById('vip-current-label').textContent = VIP_LABELS[profile.vip_tier] || profile.vip_tier;
    document.getElementById('vip-manage-btn').classList.toggle('hidden', !profile.stripe_subscription_id);
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
        }),
      });
      showToast('Perfil actualizado', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('p-particles-density').addEventListener('input', (e) => {
    document.getElementById('p-particles-density-value').textContent = e.target.value;
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
    if (params.get('checkout') === 'cancel') showToast('Pago cancelado', 'error');
    if (params.has('checkout')) window.history.replaceState({}, '', '/admin/dashboard');
  })();

  // ---- VIP: demo preview (replays the reveal, doesn't touch real state) ----

  document.querySelectorAll('.vip-demo-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const buttons = document.querySelectorAll('.vip-demo-btn');
      buttons.forEach((b) => { b.disabled = true; });
      window.playVipDemo(btn.dataset.tier, document.getElementById('vip-demo-anchor'), () => {
        buttons.forEach((b) => { b.disabled = false; });
      });
    });
  });

  // ---- VIP: live 3D badge preview (Three.js, loaded as a module — may not
  // be ready yet when this script runs, so wait for its ready event too) ----

  function initVip3DViewer() {
    const container = document.getElementById('vip-3d-viewer');
    const hint = container && container.querySelector('.vip-3d-hint');
    if (!container) return;
    window.renderVip3D(container, 'king').then((handle) => {
      if (!handle && hint) hint.textContent = 'Vista 3D no disponible en este dispositivo — se usa el badge plano.';
    });
  }

  if (window.renderVip3D) {
    initVip3DViewer();
  } else {
    window.addEventListener('vip3d-ready', initVip3DViewer, { once: true });
  }

  // ---- VIP (modo de prueba, reemplazar por Stripe) ----

  document.getElementById('vip-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const profile = await api('/api/profile/vip-test', {
        method: 'PUT',
        body: JSON.stringify({ vip_tier: document.getElementById('vip-tier').value || null }),
      });
      renderVipStatus(profile);
      showToast('Tier VIP actualizado', 'success');
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
      showToast('Foto actualizada', 'success');
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
      document.getElementById('background-preview').src = profile.background_path;
      showToast('Fondo actualizado', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
    e.target.value = '';
  });

  document.getElementById('background-remove-btn').addEventListener('click', async () => {
    try {
      await api('/api/profile/background', { method: 'DELETE' });
      document.getElementById('background-preview').src = '/images/hero-bg.jpg';
      showToast('Fondo restablecido al predeterminado', 'success');
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
      showToast('Contraseña actualizada', 'success');
      loadAccountStatus();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // ---- Google account ----

  async function loadAccountStatus() {
    const data = await fetch('/api/auth/me').then((r) => r.json());
    if (!data.authenticated) return;

    document.getElementById('pw-current-field').classList.toggle('hidden', !data.hasPassword);
    document.getElementById('pw-new-label').textContent = data.hasPassword ? 'Contraseña nueva' : 'Crear contraseña';

    const googleStatus = await fetch('/api/auth/google/status').then((r) => r.json());
    const section = document.getElementById('google-link-section');
    if (!googleStatus.configured) {
      section.classList.add('hidden');
      return;
    }
    section.classList.remove('hidden');

    const statusText = document.getElementById('google-status-text');
    const linkBtn = document.getElementById('google-link-btn');
    const unlinkBtn = document.getElementById('google-unlink-btn');

    if (data.googleEmail) {
      statusText.textContent = `Vinculada: ${data.googleEmail}`;
      linkBtn.classList.add('hidden');
      unlinkBtn.classList.remove('hidden');
    } else {
      statusText.textContent = 'No vinculada';
      linkBtn.classList.remove('hidden');
      unlinkBtn.classList.add('hidden');
    }
  }

  document.getElementById('google-unlink-btn').addEventListener('click', async () => {
    try {
      await api('/api/auth/google-link', { method: 'DELETE' });
      showToast('Cuenta de Google desvinculada', 'success');
      loadAccountStatus();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  (function handleGoogleQueryParams() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('linked') === '1') showToast('Cuenta de Google vinculada', 'success');
    if (params.get('error') === 'google_taken') showToast('Esa cuenta de Google ya está vinculada a otra sesión', 'error');
    if (params.has('linked') || params.has('error')) {
      window.history.replaceState({}, '', '/admin/dashboard');
    }
  })();

  // ---- Links ----

  const PLATFORM_ICONS = {
    youtube: '▶️', twitch: '🎮', telegram: '✈️', discord: '💬',
    twitter: '🐦', instagram: '📸', tiktok: '🎵', wishlist: '🎁', custom: '🔗',
  };

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
      } else {
        thumb.textContent = link.icon || PLATFORM_ICONS[link.platform] || '🔗';
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
      showToast('Enlace eliminado', 'success');
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

  document.getElementById('l-platform').addEventListener('change', (e) => {
    const iconField = document.getElementById('l-icon');
    if (!iconField.value) iconField.value = PLATFORM_ICONS[e.target.value] || '🔗';
  });

  function openLinkModal(link) {
    document.getElementById('link-modal-title').textContent = link ? 'Editar enlace' : 'Nuevo enlace';
    document.getElementById('l-id').value = link ? link.id : '';
    document.getElementById('l-type').value = link ? link.type : 'simple';
    document.getElementById('l-platform').value = link ? link.platform : 'custom';
    document.getElementById('l-icon').value = link ? (link.icon || '') : '';
    document.getElementById('l-label').value = link ? link.label : '';
    document.getElementById('l-subtitle').value = link ? (link.subtitle || '') : '';
    document.getElementById('l-url').value = link ? link.url : '';
    document.getElementById('l-badge-left').value = link ? (link.badge_left || '') : '';
    document.getElementById('l-badge-right').value = link ? (link.badge_right || '') : '';
    document.getElementById('l-enabled').checked = link ? !!link.enabled : true;
    editingImageLinkId = link ? link.id : null;
    updateImageRowVisibility();
    modal.classList.remove('hidden');
  }

  function closeLinkModal() {
    modal.classList.add('hidden');
    linkForm.reset();
    editingImageLinkId = null;
  }

  document.getElementById('add-link-btn').addEventListener('click', () => openLinkModal(null));
  document.getElementById('link-cancel-btn').addEventListener('click', closeLinkModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeLinkModal(); });

  document.getElementById('l-image-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file || !editingImageLinkId) {
      if (file && !editingImageLinkId) showToast('Primero guarda el enlace, luego súbele la imagen', 'error');
      return;
    }
    const formData = new FormData();
    formData.append('image', file);
    try {
      await api(`/api/links/${editingImageLinkId}/image`, { method: 'POST', body: formData });
      showToast('Imagen actualizada', 'success');
      await loadLinks();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  linkForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('l-id').value;
    const payload = {
      type: document.getElementById('l-type').value,
      platform: document.getElementById('l-platform').value,
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
        showToast('Enlace actualizado', 'success');
        closeLinkModal();
      } else {
        const created = await api('/api/links', { method: 'POST', body: JSON.stringify(payload) });
        showToast('Enlace creado', 'success');
        if (payload.type === 'featured') {
          editingImageLinkId = created.id;
          document.getElementById('l-id').value = created.id;
          document.getElementById('link-modal-title').textContent = 'Editar enlace — ahora sube la imagen';
        } else {
          closeLinkModal();
        }
      }
      await loadLinks();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // ---- Init ----

  (async function init() {
    const ok = await checkAuth();
    if (!ok) return;
    await loadProfile();
    await loadLinks();
    await loadAccountStatus();
  })();
})();
