'use strict';

// URL analysis. A link-in-bio platform is, structurally, a redirect service:
// whatever a user stores here gets shown to their audience under your domain
// and your reputation. These rules look for the two things that actually
// matter -- links that can run code in a visitor's browser, and links built
// to look like something they aren't.

// Schemes that execute code or read local content when navigated to.
const EXECUTABLE_SCHEMES = ['javascript:', 'data:', 'vbscript:', 'blob:', 'file:'];

// Schemes a bio page has a legitimate reason to use.
const ALLOWED_SCHEMES = ['http:', 'https:', 'mailto:', 'tel:'];

// Not malicious in themselves -- they just mean the real destination is
// invisible to both the visitor and to this scanner.
const SHORTENERS = new Set([
  'bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly',
  'adf.ly', 'shorte.st', 'cutt.ly', 'rebrand.ly', 'bl.ink', 's.id',
  'rb.gy', 'shorturl.at', 'tiny.cc', 'lnkd.in',
]);

// Words that show up in credential-harvesting hostnames far more often than
// in honest ones. Only meaningful next to a brand name, hence the pairing.
const LURE_WORDS = [
  'login', 'signin', 'verify', 'verification', 'secure', 'account',
  'update', 'confirm', 'wallet', 'recover', 'unlock', 'suspended', 'billing',
];

const BRANDS = [
  'google', 'paypal', 'apple', 'microsoft', 'facebook', 'instagram',
  'whatsapp', 'netflix', 'amazon', 'binance', 'metamask', 'coinbase',
  'steam', 'discord', 'tiktok', 'stripe', 'bancolombia', 'bbva', 'santander',
];

// Built from escape sequences rather than typed literally, so the ranges
// stay readable and no raw control byte ends up pasted into this file.
const CONTROL_CHARS = new RegExp('[\u0000-\u001F\u007F]');
const CONTROL_AND_SPACE = new RegExp('[\u0000-\u0020\u007F]', 'g');
const CYRILLIC = new RegExp('[\u0400-\u052F]');
const GREEK = new RegExp('[\u0370-\u03FF]');
const LATIN = /[a-zA-Z]/;

function finding(severity, code, message, detail) {
  return { severity, code, message, detail };
}

/**
 * Analyses a single URL string. Returns an array of findings -- empty means
 * nothing stood out. Never throws: a URL too broken to parse is itself a
 * finding, not a crash.
 */
function analyzeUrl(raw) {
  const findings = [];
  const value = String(raw == null ? '' : raw).trim();

  if (!value) {
    findings.push(finding('medium', 'url_empty', 'El enlace está vacío.'));
    return findings;
  }

  // Control characters can hide a scheme from a naive check while the
  // browser still honours it (e.g. "java\tscript:").
  if (CONTROL_CHARS.test(value)) {
    findings.push(finding('critical', 'url_control_chars',
      'El enlace contiene caracteres de control, una técnica para esconder el esquema real.',
      JSON.stringify(value.slice(0, 120))));
  }

  // Strip whitespace and control chars before checking the scheme, for the
  // same reason: the browser ignores them, so a naive check must too.
  const stripped = value.replace(CONTROL_AND_SPACE, '').toLowerCase();
  for (const scheme of EXECUTABLE_SCHEMES) {
    if (stripped.startsWith(scheme)) {
      findings.push(finding('critical', 'url_executable_scheme',
        `Esquema "${scheme}": al abrirse puede ejecutar código en el navegador de quien visita la página.`,
        value.slice(0, 160)));
      return findings; // nothing else about this URL matters
    }
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    // A relative or malformed value isn't automatically dangerous, but it
    // will not do what its author expects either.
    findings.push(finding('medium', 'url_unparseable',
      'El enlace no es una URL válida; el navegador lo tratará como una ruta relativa.',
      value.slice(0, 160)));
    return findings;
  }

  if (!ALLOWED_SCHEMES.includes(url.protocol)) {
    findings.push(finding('high', 'url_unexpected_scheme',
      `Esquema inesperado "${url.protocol}".`, value.slice(0, 160)));
  }

  if (url.username || url.password) {
    findings.push(finding('high', 'url_embedded_credentials',
      'El enlace lleva credenciales antes del dominio ("usuario@dominio"), forma clásica de disfrazar el destino real.',
      value.slice(0, 160)));
  }

  const host = url.hostname;

  if (/%[0-9a-fA-F]{2}/.test(host)) {
    findings.push(finding('high', 'url_encoded_host',
      'El dominio está codificado en porcentajes, lo que oculta a dónde apunta realmente.', host));
  }

  // new URL() normalises an international hostname to punycode, which
  // erases the very mixing this check is looking for -- so read the host
  // straight out of the original text instead.
  const rawAuthority = (value.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/([^/?#]*)/) || [])[1] || '';
  const rawHost = rawAuthority.split('@').pop().split(':')[0];

  // Mixing alphabets inside one hostname is how "apple.com" with a Cyrillic
  // "a" is built. A hostname entirely in one non-Latin script is legitimate.
  const mixedScript = LATIN.test(rawHost) && (CYRILLIC.test(rawHost) || GREEK.test(rawHost));
  if (mixedScript) {
    findings.push(finding('high', 'url_mixed_script_host',
      'El dominio mezcla alfabetos (latino con cirílico o griego): la forma habitual de imitar un dominio conocido.',
      `${rawHost} -> ${host}`));
  }

  // Punycode on its own is legitimate for a genuinely international domain;
  // it only earns a mention when the mixed-script check hasn't already
  // explained it.
  if (!mixedScript && (host.startsWith('xn--') || host.includes('.xn--'))) {
    findings.push(finding('medium', 'url_punycode_host',
      'Dominio en punycode: se muestra distinto de como se escribe. Verifica que sea el que dice ser.', host));
  }

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')) {
    findings.push(finding('medium', 'url_ip_host',
      'El enlace apunta a una dirección IP en vez de a un dominio.', host));
  }

  if (SHORTENERS.has(host.replace(/^www\./, ''))) {
    findings.push(finding('low', 'url_shortener',
      'Acortador de enlaces: ni el visitante ni este análisis pueden ver el destino real.', host));
  }

  const hostWords = host.toLowerCase();
  const lure = LURE_WORDS.find((w) => hostWords.includes(w));
  const brand = BRANDS.find((b) => hostWords.includes(b));
  // A brand name outside its own domain, next to a lure word, is the
  // signature of a phishing host: "paypal-verify.example.com".
  if (lure && brand && !hostWords.endsWith(`${brand}.com`)) {
    findings.push(finding('high', 'url_phishing_pattern',
      `El dominio combina la marca "${brand}" con "${lure}" sin ser el dominio oficial: patrón típico de phishing.`,
      host));
  }

  if (host.split('.').length > 5) {
    findings.push(finding('low', 'url_deep_subdomains',
      'Muchos subdominios encadenados: se usa para empujar el dominio real fuera de la vista en móvil.', host));
  }

  if (value.length > 2000) {
    findings.push(finding('low', 'url_very_long',
      'Enlace desproporcionadamente largo.', `${value.length} caracteres`));
  }

  return findings;
}

module.exports = { analyzeUrl, EXECUTABLE_SCHEMES, ALLOWED_SCHEMES };
