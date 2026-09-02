(function () {
  const form = document.getElementById('login-form');
  const errorEl = document.getElementById('login-error');
  const subtitleEl = document.getElementById('login-subtitle');
  const orbLabelEl = document.getElementById('orb-label');
  const submitBtn = document.getElementById('submit-btn');
  const confirmField = document.getElementById('password-confirm-field');
  const confirmInput = document.getElementById('password-confirm');
  const googleDivider = document.getElementById('google-divider');
  const providerList = document.getElementById('provider-list');
  const modeToggle = document.getElementById('mode-toggle');
  const modeToggleLink = document.getElementById('mode-toggle-link');

  let mode = 'login';

  // Declarado arriba del todo: varios bloques de abajo leen la query string
  // (?reset=, ?verify=, ?mode=, ?error=) y `const` no se iza, asi que
  // tenerlo mas abajo los rompia con un error de zona muerta temporal.
  const params = new URLSearchParams(window.location.search);

  const PROVIDER_ICONS = {
    google: '<svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.68-3.87 2.68-6.62z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.96v2.33A9 9 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.95 10.7A5.4 5.4 0 0 1 3.66 9c0-.59.1-1.17.29-1.7V4.97H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.03l2.99-2.33z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.97l2.99 2.33C4.66 5.17 6.65 3.58 9 3.58z"/></svg>',
    github: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.4 7.4 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>',
    discord: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M13.55 3.11A13.2 13.2 0 0 0 10.3 2.1a9.3 9.3 0 0 0-.42.86 12.3 12.3 0 0 0-3.66 0A9 9 0 0 0 5.79 2.1c-1.14.2-2.23.54-3.25 1.01C.47 6.2-.09 9.2.19 12.16a13.3 13.3 0 0 0 4.03 2.04c.33-.44.61-.91.86-1.4-.47-.18-.92-.4-1.35-.65.11-.8.22-.17.33-.26a9.5 9.5 0 0 0 8.08 0l.32.26c-.43.26-.88.48-1.35.66.25.49.54.95.86 1.39a13.2 13.2 0 0 0 4.04-2.04c.33-3.43-.56-6.4-2.36-9.05zM5.35 10.35c-.79 0-1.44-.72-1.44-1.6 0-.89.63-1.61 1.44-1.61s1.46.72 1.44 1.6c0 .89-.64 1.61-1.44 1.61zm5.31 0c-.79 0-1.44-.72-1.44-1.6 0-.89.63-1.61 1.44-1.61s1.45.72 1.44 1.6c0 .89-.63 1.61-1.44 1.61z"/></svg>',
  };

  // ---- Recuperacion de contrasena ----

  (function setupRecovery() {
    const line = document.getElementById('forgot-line');
    const panel = document.getElementById('forgot-panel');
    const resetPanel = document.getElementById('reset-panel');
    const form = document.getElementById('login-form');
    const toggle = document.getElementById('mode-toggle');
    if (!line) return;

    function say(el, text, isError) {
      el.textContent = text;
      el.classList.remove('hidden');
      el.style.color = isError ? 'var(--danger)' : 'var(--text-dim)';
    }

    // El enlace del correo trae ?reset=<token>. Se muestra el panel para
    // elegir contrasena y se limpia la URL, para que el token no quede en el
    // historial ni se reenvie en un Referer.
    const token = params.get('reset');
    if (token) {
      form.classList.add('hidden');
      toggle.classList.add('hidden');
      resetPanel.classList.remove('hidden');
  window.history.replaceState({}, '', '/admin/login');

      const msg = document.getElementById('reset-msg');
      document.getElementById('reset-send').addEventListener('click', async () => {
        const pass = document.getElementById('reset-password').value;
        try {
          const res = await fetch('/api/auth/recovery/reset', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, newPassword: pass }),
          });
          const data = await res.json();
          if (!res.ok) return say(msg, data.error || 'No se pudo cambiar la contraseña.', true);

          resetPanel.classList.add('hidden');
          form.classList.remove('hidden');
          toggle.classList.remove('hidden');
          say(document.getElementById('login-error'), data.mfaRequired
            ? 'Contraseña actualizada. Inicia sesión con la nueva y tu código de verificación.'
            : 'Contraseña actualizada. Ya puedes iniciar sesión.', false);
          document.getElementById('login-error').classList.remove('hidden');
        } catch {
          say(msg, 'Error de conexión con el servidor.', true);
        }
      });
      return;
    }

    // El enlace solo se ofrece si el servidor puede mandar correo; si no,
    // llevaria a un callejon sin salida.
    fetch('/api/auth/recovery/status')
      .then((r) => r.json())
      .then((d) => { if (d && d.available) line.classList.remove('hidden'); })
      .catch(() => {});

    document.getElementById('forgot-link').addEventListener('click', (e) => {
      e.preventDefault();
      panel.classList.remove('hidden');
      line.classList.add('hidden');
      form.classList.add('hidden');
      document.getElementById('forgot-email').focus();
    });

    document.getElementById('forgot-cancel').addEventListener('click', () => {
      panel.classList.add('hidden');
      line.classList.remove('hidden');
      form.classList.remove('hidden');
    });

    document.getElementById('forgot-send').addEventListener('click', async () => {
      const msg = document.getElementById('forgot-msg');
      const btn = document.getElementById('forgot-send');
      btn.disabled = true;
      try {
        const res = await fetch('/api/auth/recovery/request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: document.getElementById('forgot-email').value.trim() }),
        });
        const data = await res.json();
        // La respuesta es la misma exista o no la cuenta, y aqui se muestra
        // tal cual: cambiar el texto delataria cuales estan registradas.
        say(msg, data.message || data.error || 'Listo.', !res.ok);
      } catch {
        say(msg, 'Error de conexión con el servidor.', true);
      } finally {
        btn.disabled = false;
      }
    });
  })();

  // ---- Passkeys ----

  (function setupPasskeyLogin() {
    const btn = document.getElementById('passkey-login-btn');
    const label = document.getElementById('passkey-login-label');
    if (!btn || !window.passkeys) return;

    // Only offered when the device actually has a built-in authenticator.
    window.passkeys.platformAvailable().then((available) => {
      if (available) btn.classList.remove('hidden');
    });

    btn.addEventListener('click', async () => {
      btn.disabled = true;
      const original = label.textContent;
      label.textContent = 'Esperando…';
      errorEl.classList.add('hidden');

      try {
        const options = await fetch('/api/auth/passkey/login/options', { method: 'POST' })
          .then((r) => r.json());
        if (options.error) throw new Error(options.error);

        const assertion = await window.passkeys.authenticate(options);

        const res = await fetch('/api/auth/passkey/login/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ response: assertion }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'No se pudo verificar la llave.');

        window.location.href = '/admin/dashboard';
      } catch (err) {
        errorEl.textContent = window.passkeys.describeError(err);
        errorEl.classList.remove('hidden');
        btn.disabled = false;
        label.textContent = original;
      }
    });
  })();

  const ERROR_MESSAGES = {
    oauth_failed: 'No se pudo completar el inicio de sesión.',
    oauth_state: 'La sesión expiró, intenta de nuevo.',
    oauth_not_configured: 'Ese método de inicio de sesión no está configurado.',
    session: 'No se pudo iniciar la sesión, intenta de nuevo.',
    must_login: 'Inicia sesión primero.',
  };

  // Shown when you land here with a session already open: says who you are,
  // offers the way back, and leaves the form usable underneath.
  function showSignedInNotice(username) {
    const notice = document.getElementById('signed-in-notice');
    if (!notice) return;
    document.getElementById('signed-in-user').textContent = username || 'tu cuenta';
    notice.classList.remove('hidden');

    document.getElementById('signed-in-logout').addEventListener('click', async (e) => {
      e.preventDefault();
      await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
      window.location.reload();
    });
  }

  const errorCode = params.get('error');
  if (errorCode && ERROR_MESSAGES[errorCode]) {
    const provider = params.get('provider');
    errorEl.textContent = ERROR_MESSAGES[errorCode] + (provider ? ` (${provider})` : '');
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

      // Confirmacion de correo: ?verify=<token> desde el enlace del mensaje.
  (function handleVerify() {
    const token = params.get('verify');
    if (!token) return;
    fetch('/api/auth/email/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        errorEl.textContent = ok ? 'Correo confirmado. Ya puedes usarlo para recuperar tu cuenta.' : (d.error || 'No se pudo confirmar el correo.');
        errorEl.style.color = ok ? 'var(--ok)' : 'var(--danger)';
        errorEl.classList.remove('hidden');
      })
      .catch(() => {});
  })();


  fetch('/api/auth/me')
    .then((r) => r.json())
    .then((data) => {
      if (data.authenticated) {
        // Deliberately does NOT bounce to the dashboard. Someone who comes
        // here with a session open is here on purpose -- to sign in with a
        // passkey, or as a different account -- and redirecting them away
        // made both impossible without first hunting for the logout button.
        showSignedInNotice(data.username);
      }
      setMode(params.get('mode') === 'register' ? 'register' : 'login');
      return fetch('/api/auth/providers').then((r) => r.json());
    })
    .then((providers) => {
      if (!providers) return;
      // Only providers with credentials on the server are offered — a
      // button for an unconfigured one would just bounce off an error.
      const available = providers.filter((p) => p.configured);
      if (!available.length) return;

      googleDivider.classList.remove('hidden');
      available.forEach((p) => {
        const a = document.createElement('a');
        a.href = `/api/auth/${p.key}?intent=login`;
        a.className = `btn-outline provider-btn provider-${p.key}`;
        a.style.width = '100%';
        a.innerHTML = `${PROVIDER_ICONS[p.key] || ''}<span>Continuar con ${p.label}</span>`;
        providerList.appendChild(a);
      });
      providerList.classList.remove('hidden');
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
    const totpField = document.getElementById('totp-field');
    const totpValue = document.getElementById('totp').value.trim();

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, ...(totpValue ? { totp: totpValue } : {}) }),
      });
      const data = await res.json();

      if (!res.ok) {
        // The password was right and a second factor is needed. Reveal the
        // field only now: showing it up front would tell an attacker which
        // accounts have MFA before they even guess a password.
        if (data.mfaRequired) {
          totpField.classList.remove('hidden');
          document.getElementById('totp').focus();
        }
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
