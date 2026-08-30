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
  const modeToggle = document.getElementById('mode-toggle');
  const modeToggleLink = document.getElementById('mode-toggle-link');

  let mode = 'login';

  const ERROR_MESSAGES = {
    google_failed: 'No se pudo completar el inicio de sesión con Google.',
    google_state: 'La sesión de Google expiró, intenta de nuevo.',
    google_not_configured: 'El inicio de sesión con Google no está configurado.',
    must_login: 'Inicia sesión primero.',
  };

  const params = new URLSearchParams(window.location.search);
  const errorCode = params.get('error');
  if (errorCode && ERROR_MESSAGES[errorCode]) {
    errorEl.textContent = ERROR_MESSAGES[errorCode];
    errorEl.classList.remove('hidden');
  }

  function setMode(newMode) {
    mode = newMode;
    form.reset();
    errorEl.classList.add('hidden');

    if (mode === 'register') {
      subtitleEl.textContent = 'Crea tu página en segundos';
      orbLabelEl.textContent = 'Crear cuenta';
      submitBtn.textContent = 'Crear cuenta';
      confirmField.classList.remove('hidden');
      confirmInput.setAttribute('required', 'required');
      document.getElementById('password').setAttribute('minlength', '6');
      document.getElementById('password').setAttribute('autocomplete', 'new-password');
      modeToggle.innerHTML = '¿Ya tienes cuenta? <a href="#" id="mode-toggle-link">Inicia sesión</a>';
    } else {
      subtitleEl.textContent = 'Inicia sesión para administrar tu página';
      orbLabelEl.textContent = 'Iniciar sesión';
      submitBtn.textContent = 'Entrar';
      confirmField.classList.add('hidden');
      confirmInput.removeAttribute('required');
      document.getElementById('password').setAttribute('autocomplete', 'current-password');
      modeToggle.innerHTML = '¿No tienes cuenta? <a href="#" id="mode-toggle-link">Crea una</a>';
    }

    document.getElementById('mode-toggle-link').addEventListener('click', (e) => {
      e.preventDefault();
      setMode(mode === 'register' ? 'login' : 'register');
    });
  }

  window.history.replaceState({}, '', '/admin/login');

  fetch('/api/auth/me')
    .then((r) => r.json())
    .then((data) => {
      if (data.authenticated) {
        window.location.href = '/admin/dashboard';
        return;
      }
      setMode(params.get('mode') === 'register' ? 'register' : 'login');
      return fetch('/api/auth/google/status').then((r) => r.json());
    })
    .then((googleStatus) => {
      if (googleStatus && googleStatus.configured) {
        googleDivider.classList.remove('hidden');
        googleBtn.classList.remove('hidden');
      }
    });

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

      window.location.href = '/admin/dashboard';
    } catch (err) {
      errorEl.textContent = 'Error de conexión con el servidor';
      errorEl.classList.remove('hidden');
    }
  });
})();
