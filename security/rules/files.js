'use strict';

// File analysis by content, not by name.
//
// The upload filter in routes/admin.js trusts path.extname(originalname),
// which the uploader chooses. Renaming payload.exe to payload.jpg walks
// straight past it. These rules read the actual first bytes instead, so the
// file has to be what it claims to be.

const fs = require('fs');

// Magic byte signatures. Offset 0 unless stated.
const SIGNATURES = [
  { type: 'png',   ext: ['.png'],           bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { type: 'jpeg',  ext: ['.jpg', '.jpeg'],  bytes: [0xff, 0xd8, 0xff] },
  { type: 'gif',   ext: ['.gif'],           bytes: [0x47, 0x49, 0x46, 0x38] },
  { type: 'bmp',   ext: ['.bmp'],           bytes: [0x42, 0x4d] },
  { type: 'tiff',  ext: ['.tif', '.tiff'],  bytes: [0x49, 0x49, 0x2a, 0x00] },
  { type: 'pdf',   ext: ['.pdf'],           bytes: [0x25, 0x50, 0x44, 0x46] },

  // Executables and archives: never a legitimate profile image.
  { type: 'pe-executable',    ext: [], bytes: [0x4d, 0x5a], danger: 'critical' },
  { type: 'elf-executable',   ext: [], bytes: [0x7f, 0x45, 0x4c, 0x46], danger: 'critical' },
  { type: 'mach-o-executable',ext: [], bytes: [0xcf, 0xfa, 0xed, 0xfe], danger: 'critical' },
  { type: 'mach-o-executable',ext: [], bytes: [0xce, 0xfa, 0xed, 0xfe], danger: 'critical' },
  { type: 'java-class',       ext: [], bytes: [0xca, 0xfe, 0xba, 0xbe], danger: 'critical' },
  { type: 'zip-or-office',    ext: [], bytes: [0x50, 0x4b, 0x03, 0x04], danger: 'high' },
  { type: 'rar',              ext: [], bytes: [0x52, 0x61, 0x72, 0x21], danger: 'high' },
  { type: '7z',               ext: [], bytes: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c], danger: 'high' },
  { type: 'gzip',             ext: [], bytes: [0x1f, 0x8b], danger: 'high' },
  { type: 'ms-compound',      ext: [], bytes: [0xd0, 0xcf, 0x11, 0xe0], danger: 'high' },
];

// Active content that must never appear inside a file served as an image.
// Checked over the whole buffer, not just the header, because a polyglot is
// a valid image with a payload appended after the image data ends.
//
// Every pattern here is long enough that it cannot plausibly occur by
// chance in compressed image data -- an earlier version included a bare
// "<%" and flagged a perfectly good PNG whose deflate stream happened to
// contain those two bytes.
const ACTIVE_CONTENT = [
  { pattern: /<script[\s>]/i,            label: 'etiqueta <script>' },
  { pattern: /<\/script>/i,              label: 'cierre de <script>' },
  { pattern: /<\?php/i,                  label: 'código PHP' },
  { pattern: /<%@\s*page/i,              label: 'plantilla JSP' },
  { pattern: /javascript:/i,             label: 'esquema javascript:' },
  { pattern: /\son(error|load|click|mouseover)\s*=\s*["']/i, label: 'manejador de eventos inline' },
  { pattern: /<iframe[\s>]/i,            label: 'etiqueta <iframe>' },
  { pattern: /<embed[\s>]/i,             label: 'etiqueta <embed>' },
  { pattern: /<!DOCTYPE\s+html/i,        label: 'documento HTML' },
  { pattern: /#!\s*\/bin\/(ba)?sh/,      label: 'shebang de script de shell' },
];

// Minimum length of a printable run to be considered text rather than
// coincidence. Real injected markup arrives as readable prose; binary noise
// does not stay printable for sixteen bytes in a row.
const MIN_TEXT_RUN = 16;

/**
 * Pulls out the readable stretches of a binary file. Matching patterns
 * against these instead of against the raw bytes is what separates an
 * actual embedded payload from a lucky byte sequence inside a deflate
 * stream.
 */
function printableRuns(buffer) {
  const runs = [];
  let current = '';
  for (let i = 0; i < buffer.length; i++) {
    const byte = buffer[i];
    const printable = (byte >= 0x20 && byte <= 0x7e) || byte === 0x09 || byte === 0x0a || byte === 0x0d;
    if (printable) {
      current += String.fromCharCode(byte);
    } else {
      if (current.length >= MIN_TEXT_RUN) runs.push(current);
      current = '';
    }
  }
  if (current.length >= MIN_TEXT_RUN) runs.push(current);
  return runs.join('\n');
}

function finding(severity, code, message, detail) {
  return { severity, code, message, detail };
}

function matchesSignature(buffer, signature) {
  if (buffer.length < signature.bytes.length) return false;
  return signature.bytes.every((b, i) => buffer[i] === b);
}

function detectType(buffer) {
  for (const signature of SIGNATURES) {
    if (matchesSignature(buffer, signature)) return signature;
  }
  // WEBP is RIFF....WEBP -- the marker sits at offset 8, not 0.
  if (buffer.length >= 12 &&
      buffer.slice(0, 4).toString('latin1') === 'RIFF' &&
      buffer.slice(8, 12).toString('latin1') === 'WEBP') {
    return { type: 'webp', ext: ['.webp'], bytes: [] };
  }
  return null;
}

const IMAGE_TYPES = new Set(['png', 'jpeg', 'gif', 'webp', 'bmp', 'tiff']);

/**
 * Reads a file from disk and reports what is actually inside it.
 * `declaredExt` is the extension the file is stored under (lowercase).
 */
function analyzeFile(absolutePath, declaredExt) {
  const findings = [];
  let stat;
  let buffer;

  try {
    stat = fs.statSync(absolutePath);
    buffer = fs.readFileSync(absolutePath);
  } catch (err) {
    return [finding('medium', 'file_unreadable', 'No se pudo leer el archivo.', err.message)];
  }

  if (stat.size === 0) {
    return [finding('low', 'file_empty', 'El archivo está vacío.')];
  }

  const detected = detectType(buffer);

  if (!detected) {
    findings.push(finding('high', 'file_unknown_type',
      'El contenido no corresponde a ningún formato de imagen conocido, pese a tener extensión de imagen.',
      `primeros bytes: ${buffer.slice(0, 8).toString('hex')}`));
  } else if (detected.danger) {
    findings.push(finding(detected.danger, 'file_dangerous_type',
      `El archivo es en realidad un ${detected.type}, servido bajo extensión "${declaredExt}". La página estaría alojando y distribuyendo este contenido.`,
      `primeros bytes: ${buffer.slice(0, 8).toString('hex')}`));
  } else if (detected.ext.length && !detected.ext.includes(declaredExt)) {
    findings.push(finding('medium', 'file_extension_mismatch',
      `El contenido es ${detected.type} pero la extensión dice "${declaredExt}".`,
      `esperado: ${detected.ext.join(' o ')}`));
  }

  // Polyglots: a header that passes as an image, with active content hidden
  // further in. Only worth reporting when the header did look like an image,
  // otherwise file_unknown_type already covers it.
  if (detected && IMAGE_TYPES.has(detected.type)) {
    const text = printableRuns(buffer);
    for (const { pattern, label } of ACTIVE_CONTENT) {
      if (pattern.test(text)) {
        findings.push(finding('high', 'file_polyglot',
          `Imagen válida con contenido activo incrustado (${label}): construcción típica de un archivo polyglot.`,
          `${detected.type} de ${stat.size} bytes`));
        break;
      }
    }
  }

  // SVG is not in the allowed extension list, but check anyway -- if one
  // ever gets through it is served inline and scripts in it will run.
  if (/<svg[\s>]/i.test(buffer.slice(0, 2048).toString('latin1'))) {
    findings.push(finding('critical', 'file_svg',
      'El archivo es un SVG. Los SVG se renderizan como documento y ejecutan el script que lleven dentro.'));
  }

  return findings;
}

module.exports = { analyzeFile, detectType, IMAGE_TYPES };
