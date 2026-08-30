(function () {
  const form = document.getElementById('login-form');
  const errorEl = document.getElementById('login-error');
  const subtitleEl = document.getElementById('login-subtitle');
  const orbLabelEl = document.getElementById('orb-label');
  const submitBtn = document.getElementById('submit-btn');
  const confirmField = document.getElementById('password-confirm-field');
  const confirmInput = document.getElementById('password-confirm');

  let mode = 'login';

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
