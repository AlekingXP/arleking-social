'use strict';

// Content-Security-Policy.
//
// The pages are static HTML with a handful of inline <script> blocks (an
// import map and two small initialisers), so a nonce is not available --
// there is no template step to inject one into. The alternative that people
// reach for is 'unsafe-inline', which throws away most of what CSP is for:
// it re-permits exactly the injected <script> the policy exists to stop.
//
// Instead the hashes of the inline blocks are computed from the files at
// boot. That gives a script-src with no 'unsafe-inline', and it maintains
// itself -- editing an inline script changes its hash and the next restart
// picks it up, rather than silently breaking the page.
//
// style-src does keep 'unsafe-inline': style="..." attributes are used
// throughout, and injected CSS cannot execute script. That is a real but
// much smaller exposure than allowing inline JS, and closing it would mean
// rewriting every template for no meaningful gain here.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const INLINE_SCRIPT = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;

function hashesForDirectory(dir) {
  const hashes = new Set();

  function walk(current) {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.html')) {
        let html;
        try {
          html = fs.readFileSync(full, 'utf8');
        } catch {
          continue;
        }
        for (const match of html.matchAll(INLINE_SCRIPT)) {
          const body = match[1];
          if (!body.trim()) continue;
          // Normalised to LF first. The HTML parser converts CRLF to LF
          // while building the element's text content, so the browser
          // hashes LF even when the file on disk has CRLF. Hashing the raw
          // bytes matches only on a checkout that happens to use LF, and
          // silently blocks the script everywhere else.
          const normalised = body.split('\r\n').join('\n');
          const digest = crypto.createHash('sha256').update(normalised, 'utf8').digest('base64');
          hashes.add(`'sha256-${digest}'`);
        }
      }
    }
  }

  walk(dir);
  return [...hashes];
}

function buildPolicy({ publicDir, isProduction }) {
  const inlineHashes = hashesForDirectory(publicDir);

  const directives = {
    'default-src': ["'self'"],
    // unpkg serves the Three.js module graph used by the 3D badge preview.
    //
    // 'wasm-unsafe-eval' is needed by the meshopt decoder, which compiles a
    // WebAssembly module at runtime to unpack the GLB geometry. Despite the
    // name it does NOT re-enable eval() or new Function() on JavaScript --
    // it permits WebAssembly compilation and nothing else, which is the
    // narrow grant this needs. 'unsafe-eval' would be the dangerous one.
    'script-src': ["'self'", "'wasm-unsafe-eval'", 'https://unpkg.com', ...inlineHashes],
    'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
    // data: for the generated SVG badge icons, blob: for canvas output.
    'img-src': ["'self'", 'data:', 'blob:'],
    // blob: because GLTFLoader unpacks each texture embedded in the .glb
    // into an object URL and then fetches it back. Those blobs are created
    // by this page from bytes it already loaded, so allowing them opens no
    // new origin -- a blob: URL cannot reach anything off-site.
    'connect-src': ["'self'", 'blob:', 'https://unpkg.com'],
    // The meshopt decoder instantiates its WASM worker from a blob URL.
    'worker-src': ["'self'", 'blob:'],
    'object-src': ["'none'"],
    'base-uri': ["'none'"],
    'frame-ancestors': ["'self'"],
    'form-action': ["'self'"],
    'manifest-src': ["'self'"],
  };

  if (isProduction) directives['upgrade-insecure-requests'] = [];

  return Object.entries(directives)
    .map(([name, values]) => (values.length ? `${name} ${values.join(' ')}` : name))
    .join('; ');
}

module.exports = { buildPolicy, hashesForDirectory };
