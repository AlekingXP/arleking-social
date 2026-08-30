(function () {
  const form = document.getElementById('login-form');
  const errorEl = document.getElementById('login-error');
  const subtitleEl = document.getElementById('login-subtitle');
  const orbLabelEl = document.getElementById('orb-label');
  const submitBtn = document.getElementById('submit-btn');
  const confirmField = document.getElementById('password-confirm-field');
  const confirmInput = document.getElementById('password-confirm');
  const googleDivider = document.getElementById('google-divider');
  const googleBtn = document.getElementById('google-btn');
  const googleLabel = document.getElementById('google-label');

  let mode = 'login';

  const ERROR_MESSAGES = {
    google_not_linked: 'Esa cuenta de Google no está vinculada a ningún administrador.',
    google_failed: 'No se pudo completar el inicio de sesión con Google.',
    google_state: 'La sesión de Google expiró, intenta de nuevo.',
    google_not_configured: 'El inicio de sesión con Google no está configurado.',
    setup_closed: 'Ya existe una cuenta de administrador.',
    must_login: 'Inicia sesión primero.',
  };

  const params = new URLSearchParams(window.location.search);
  const errorCode = params.get('error');
  if (errorCode && ERROR_MESSAGES[errorCode]) {
    errorEl.textContent = ERROR_MESSAGES[errorCode];
    errorEl.classList.remove('hidden');
  }
  if (errorCode) window.history.replaceState({}, '', '/admin/login.html');

  fetch('/api/auth/me')
    .then((r) => r.json())
    .then((data) => {
      if (data.authenticated) {
        window.location.href = '/admin/dashboard.html';
        return;
      }
      return fetch('/api/auth/setup-status').then((r) => r.json());
    })
    .then((setup) => {
      if (setup && setup.needsSetup) enableSetupMode();
      return fetch('/api/auth/google/status').then((r) => r.json());
    })
    .then((googleStatus) => {
      if (googleStatus && googleStatus.configured) {
        googleDivider.classList.remove('hidden');
        googleBtn.classList.remove('hidden');
        googleBtn.href = mode === 'register' ? '/api/auth/google?intent=register' : '/api/auth/google?intent=login';
        googleLabel.textContent = mode === 'register' ? 'Crear cuenta con Google' : 'Continuar con Google';
      }
    });

  function enableSetupMode() {
    mode = 'register';
    subtitleEl.textContent = 'Crea tu cuenta de administrador para empezar';
    orbLabelEl.textContent = 'Crear cuenta';
    submitBtn.textContent = 'Crear cuenta';
    confirmField.classList.remove('hidden');
    confirmInput.setAttribute('required', 'required');
    document.getElementById('password').setAttribute('minlength', '6');
    document.getElementById('password').setAttribute('autocomplete', 'new-password');
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.classList.add('hidden');

    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;

    if (mode === 'register' && password !== confirmInput.value) {
      errorEl.textContent = 'Las contraseñas no coinciden';
      errorEl.classList.remove('hidden');
      return;
    }

    const endpoint = mode === 'register' ? '/api/auth/register' : '/api/auth/login';

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();

      if (!res.ok) {
        errorEl.textContent = data.error || 'No se pudo completar la acción';
        errorEl.classList.remove('hidden');
        return;
      }

      window.location.href = '/admin/dashboard.html';
    } catch (err) {
      errorEl.textContent = 'Error de conexión con el servidor';
      errorEl.classList.remove('hidden');
    }
  });
})();
