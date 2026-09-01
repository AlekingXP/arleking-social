'use strict';

// Text field analysis.
//
// Most profile text reaches the page through textContent, which escapes
// automatically -- so a stored <script> tag is inert today. It is reported
// anyway, at a severity that says so: the value sitting in the database is
// the liability, because it becomes live the day any of that text is moved
// into innerHTML, an email, a PDF export, or a server-rendered page. This is
// about what the database is allowed to hold, not only about today's render
// path.

const INJECTION_PATTERNS = [
  { pattern: /<script[\s>]/i,               code: 'text_script_tag',    label: 'etiqueta <script>' },
  { pattern: /<iframe[\s>]/i,               code: 'text_iframe',        label: 'etiqueta <iframe>' },
  { pattern: /<img[^>]+\son\w+\s*=/i,       code: 'text_event_handler', label: 'imagen con manejador de eventos' },
  { pattern: /\son(error|load|click|mouseover)\s*=/i, code: 'text_event_handler', label: 'manejador de eventos inline' },
  { pattern: /javascript:/i,                code: 'text_js_scheme',     label: 'esquema javascript:' },
  { pattern: /<svg[^>]*\son\w+\s*=/i,       code: 'text_svg_handler',   label: 'SVG con manejador de eventos' },
  { pattern: /data:text\/html/i,            code: 'text_data_html',     label: 'data: URI con HTML' },
];

// Bidirectional override characters. They reorder how text renders without
// changing what it contains, so a label can be made to read backwards from
// what a moderator sees in the database.
const BIDI_OVERRIDE = new RegExp('[\\u202A-\\u202E\\u2066-\\u2069]');

// Zero-width characters, used to slip words past keyword filters.
const ZERO_WIDTH = new RegExp('[\\u200B-\\u200D\\uFEFF]');

function finding(severity, code, message, detail) {
  return { severity, code, message, detail };
}

/**
 * Analyses one free-text field. `fieldName` only decorates the message.
 */
function analyzeText(raw, fieldName) {
  const findings = [];
  const value = String(raw == null ? '' : raw);
  if (!value) return findings;

  for (const { pattern, code, label } of INJECTION_PATTERNS) {
    if (pattern.test(value)) {
      findings.push(finding('medium', code,
        `El campo "${fieldName}" contiene ${label}. Hoy se muestra escapado con textContent, pero queda guardado y sería explotable si ese texto llegara a renderizarse como HTML.`,
        value.slice(0, 160)));
    }
  }

  if (BIDI_OVERRIDE.test(value)) {
    findings.push(finding('medium', 'text_bidi_override',
      `El campo "${fieldName}" contiene caracteres de anulación bidireccional: el texto se ve en un orden distinto al que realmente tiene.`,
      JSON.stringify(value.slice(0, 80))));
  }

  if (ZERO_WIDTH.test(value)) {
    findings.push(finding('low', 'text_zero_width',
      `El campo "${fieldName}" contiene caracteres de ancho cero, usados para colar palabras a través de filtros.`,
      JSON.stringify(value.slice(0, 80))));
  }

  if (value.length > 5000) {
    findings.push(finding('low', 'text_oversized',
      `El campo "${fieldName}" tiene ${value.length} caracteres, muy por encima de lo que la interfaz espera.`));
  }

  return findings;
}

module.exports = { analyzeText };
