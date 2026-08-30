(function () {
  const form = document.getElementById('login-form');
  const errorEl = document.getElementById('login-error');
  const orb = document.getElementById('login-orb');
  const trigger = document.getElementById('orb-trigger');

  fetch('/api/auth/me')
    .then((r) => r.json())
    .then((data) => {
      if (data.authenticated) window.location.href = '/admin/dashboard.html';
    });

  trigger.addEventListener('click', () => {
    orb.classList.add('expanded');
    trigger.classList.add('hidden');
    form.classList.remove('hidden');
    setTimeout(() => document.getElementById('username').focus(), 300);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.classList.add('hidden');

    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();

      if (!res.ok) {
        errorEl.textContent = data.error || 'No se pudo iniciar sesión';
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
