'use strict';

// The scanning engine.
//
// Deliberately decoupled: this module knows nothing about Express, sessions
// or the running server. It takes plain data in and returns findings out, so
// it can be run against a copy of the database, in CI, or from the CLI
// without any chance of affecting a live request. Nothing under security/
// is required by server.js.

const path = require('path');
const fs = require('fs');
const { analyzeUrl } = require('./rules/urls');
const { analyzeFile } = require('./rules/files');
const { analyzeText } = require('./rules/text');

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'];

// Free-text profile columns worth inspecting.
const PROFILE_TEXT_FIELDS = [
  'name', 'tagline', 'footer_text',
  'age_gate_title', 'age_gate_subtitle', 'age_gate_confirm',
];

const LINK_TEXT_FIELDS = ['label', 'subtitle', 'badge_left', 'badge_right', 'platform', 'icon'];

function withSubject(findings, subject) {
  return findings.map((f) => ({ ...f, subject }));
}

/**
 * Scans every stored link: the destination URL and its visible text.
 */
function scanLinks(db) {
  const findings = [];
  const links = db
    .prepare('SELECT l.*, p.slug FROM links l LEFT JOIN profile p ON p.user_id = l.user_id')
    .all();

  for (const link of links) {
    const where = `enlace #${link.id} ("${link.label}") de /${link.slug || '?'}`;
    findings.push(...withSubject(analyzeUrl(link.url), where));
    for (const field of LINK_TEXT_FIELDS) {
      findings.push(...withSubject(analyzeText(link[field], field), where));
    }
  }
  return { findings, scanned: links.length };
}

/**
 * Scans profile text fields.
 */
function scanProfiles(db) {
  const findings = [];
  const profiles = db.prepare('SELECT * FROM profile').all();

  for (const profile of profiles) {
    const where = `perfil /${profile.slug}`;
    for (const field of PROFILE_TEXT_FIELDS) {
      findings.push(...withSubject(analyzeText(profile[field], field), where));
    }
  }
  return { findings, scanned: profiles.length };
}

/**
 * Scans every file in the uploads directory by content, and cross-checks it
 * against what the database references.
 */
function scanUploads(db, uploadsDir) {
  const findings = [];
  if (!fs.existsSync(uploadsDir)) {
    return { findings: [], scanned: 0, orphans: 0, missing: 0 };
  }

  const onDisk = fs.readdirSync(uploadsDir).filter((name) => {
    // .gitkeep and friends are repository plumbing, not user uploads.
    if (name.startsWith('.')) return false;
    try {
      return fs.statSync(path.join(uploadsDir, name)).isFile();
    } catch {
      return false;
    }
  });

  const referenced = new Set();
  for (const row of db.prepare('SELECT avatar_path, background_path FROM profile').all()) {
    if (row.avatar_path) referenced.add(path.basename(row.avatar_path));
    if (row.background_path) referenced.add(path.basename(row.background_path));
  }
  for (const row of db.prepare('SELECT image_path FROM links WHERE image_path IS NOT NULL').all()) {
    if (row.image_path) referenced.add(path.basename(row.image_path));
  }

  for (const name of onDisk) {
    const ext = path.extname(name).toLowerCase();
    findings.push(...withSubject(analyzeFile(path.join(uploadsDir, name), ext), `archivo ${name}`));
  }

  // A file nobody points at is not a vulnerability, but it is a file the
  // server keeps serving to anyone who knows the URL.
  const orphans = onDisk.filter((name) => !referenced.has(name));
  for (const name of orphans) {
    findings.push(withSubject([{
      severity: 'low',
      code: 'file_orphan',
      message: 'Archivo huérfano: ya no lo referencia ningún perfil ni enlace, pero se sigue sirviendo públicamente.',
      detail: `/uploads/${name}`,
    }], `archivo ${name}`)[0]);
  }

  const diskSet = new Set(onDisk);
  const missing = [...referenced].filter((name) => !diskSet.has(name));
  for (const name of missing) {
    findings.push(withSubject([{
      severity: 'low',
      code: 'file_missing',
      message: 'La base de datos referencia un archivo que ya no está en disco: se verá como imagen rota.',
      detail: `/uploads/${name}`,
    }], `archivo ${name}`)[0]);
  }

  return { findings, scanned: onDisk.length, orphans: orphans.length, missing: missing.length };
}

/**
 * Runs everything. `db` is an open better-sqlite3 handle, opened readonly by
 * the CLI so a scan can never write to the database it is inspecting.
 */
function scanAll(db, uploadsDir) {
  const links = scanLinks(db);
  const profiles = scanProfiles(db);
  const uploads = scanUploads(db, uploadsDir);

  const findings = [...links.findings, ...profiles.findings, ...uploads.findings];
  findings.sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));

  const counts = SEVERITY_ORDER.reduce((acc, s) => {
    acc[s] = findings.filter((f) => f.severity === s).length;
    return acc;
  }, {});

  return {
    findings,
    counts,
    stats: {
      links: links.scanned,
      profiles: profiles.scanned,
      uploads: uploads.scanned,
      orphans: uploads.orphans,
      missing: uploads.missing,
    },
  };
}

module.exports = { scanAll, scanLinks, scanProfiles, scanUploads, SEVERITY_ORDER };
