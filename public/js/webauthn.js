/* Passkeys en el navegador.
 *
 * La API de WebAuthn habla en ArrayBuffer y el servidor en base64url, así que
 * hace falta traducir en ambos sentidos. Son treinta líneas: escribirlas aquí
 * evita cargar @simplewebauthn/browser desde un CDN, que obligaría a abrir un
 * origen más en la CSP para algo que no lo necesita.
 *
 * Lo que el usuario llama "Face ID" es esto. El navegador decide qué gesto
 * pedir — Face ID en iPhone, huella en Android, Touch ID en Mac, Hello en
 * Windows — y esta capa es la misma para todos.
 */
(function () {
  function base64urlToBuffer(value) {
    const padded = String(value).replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(padded + '==='.slice((padded.length + 3) % 4));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  function bufferToBase64url(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  /** ¿Existe WebAuthn en este navegador? */
  function supported() {
    return typeof window.PublicKeyCredential === 'function'
      && !!(navigator.credentials && navigator.credentials.create);
  }

  /**
   * ¿Hay un autenticador integrado (Face ID, huella, Hello)? Distinto de
   * `supported()`: un navegador puede entender WebAuthn y no tener biometría,
   * en cuyo caso ofrecer "Entrar con Face ID" sería un botón muerto.
   */
  async function platformAvailable() {
    if (!supported()) return false;
    try {
      return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch {
      return false;
    }
  }

  async function register(options) {
    const publicKey = {
      ...options,
      challenge: base64urlToBuffer(options.challenge),
      user: { ...options.user, id: base64urlToBuffer(options.user.id) },
      excludeCredentials: (options.excludeCredentials || []).map((c) => ({
        ...c,
        id: base64urlToBuffer(c.id),
      })),
    };

    const credential = await navigator.credentials.create({ publicKey });
    if (!credential) throw new Error('El navegador no devolvió ninguna llave.');

    return {
      id: credential.id,
      rawId: bufferToBase64url(credential.rawId),
      type: credential.type,
      clientExtensionResults: credential.getClientExtensionResults(),
      response: {
        clientDataJSON: bufferToBase64url(credential.response.clientDataJSON),
        attestationObject: bufferToBase64url(credential.response.attestationObject),
        transports: credential.response.getTransports ? credential.response.getTransports() : [],
      },
    };
  }

  async function authenticate(options) {
    const publicKey = {
      ...options,
      challenge: base64urlToBuffer(options.challenge),
      allowCredentials: (options.allowCredentials || []).map((c) => ({
        ...c,
        id: base64urlToBuffer(c.id),
      })),
    };

    const assertion = await navigator.credentials.get({ publicKey });
    if (!assertion) throw new Error('El navegador no devolvió ninguna llave.');

    return {
      id: assertion.id,
      rawId: bufferToBase64url(assertion.rawId),
      type: assertion.type,
      clientExtensionResults: assertion.getClientExtensionResults(),
      response: {
        clientDataJSON: bufferToBase64url(assertion.response.clientDataJSON),
        authenticatorData: bufferToBase64url(assertion.response.authenticatorData),
        signature: bufferToBase64url(assertion.response.signature),
        userHandle: assertion.response.userHandle
          ? bufferToBase64url(assertion.response.userHandle)
          : undefined,
      },
    };
  }

  /**
   * Traduce los errores del navegador a algo accionable. Los mensajes nativos
   * son crípticos y a menudo idénticos para causas muy distintas.
   */
  function describeError(err) {
    if (!err) return 'No se pudo completar la operación.';
    if (err.name === 'NotAllowedError') {
      return 'Se canceló o expiró la operación. Inténtalo otra vez.';
    }
    if (err.name === 'InvalidStateError') {
      return 'Este dispositivo ya está registrado en tu cuenta.';
    }
    if (err.name === 'NotSupportedError') {
      return 'Este dispositivo no admite llaves de acceso.';
    }
    if (err.name === 'SecurityError') {
      return 'Las llaves de acceso necesitan una conexión segura (https).';
    }
    return err.message || 'No se pudo completar la operación.';
  }

  window.passkeys = { supported, platformAvailable, register, authenticate, describeError };
})();
