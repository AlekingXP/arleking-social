'use strict';

// CLI: node security/scan.js [--json] [--fail-on <severity>]
//
// Opens the database READONLY and reports. It never writes, never deletes
// and never touches the running server -- the worst a run can do is print.

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { scanAll, SEVERITY_ORDER } = require('./scanner');

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const failOnIndex = args.indexOf('--fail-on');
const failOn = failOnIndex !== -1 ? args[failOnIndex + 1] : null;

const ROOT = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..');
const dbPath = path.join(ROOT, 'data', 'app.db');
const uploadsDir = path.join(ROOT, 'uploads');

if (!fs.existsSync(dbPath)) {
  console.error(`No se encontró la base de datos en ${dbPath}`);
  console.error('Usa DATA_DIR=/ruta node security/scan.js si está en otro sitio.');
  process.exit(2);
}

const db = new Database(dbPath, { readonly: true });
const report = scanAll(db, uploadsDir);
db.close();

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const COLORS = {
    critical: '\x1b[41m\x1b[97m', high: '\x1b[31m', medium: '\x1b[33m',
    low: '\x1b[36m', info: '\x1b[90m',
  };
  const RESET = '\x1b[0m';
  const BOLD = '\x1b[1m';

  console.log(`\n${BOLD}Análisis de seguridad — ArleKing Social${RESET}`);
  console.log(`Base de datos: ${dbPath}`);
  console.log(
    `Revisados: ${report.stats.links} enlaces, ${report.stats.profiles} perfiles, ` +
    `${report.stats.uploads} archivos subidos\n`
  );

  if (!report.findings.length) {
    console.log('\x1b[32mSin hallazgos.\x1b[0m\n');
  } else {
    let lastSeverity = null;
    for (const f of report.findings) {
      if (f.severity !== lastSeverity) {
        console.log(`\n${COLORS[f.severity]} ${f.severity.toUpperCase()} ${RESET}`);
        lastSeverity = f.severity;
      }
      console.log(`  ${BOLD}${f.subject}${RESET}`);
      console.log(`    ${f.message}`);
      if (f.detail) console.log(`    \x1b[90m${f.detail}${RESET}`);
    }

    console.log(`\n${BOLD}Resumen${RESET}`);
    for (const s of SEVERITY_ORDER) {
      if (report.counts[s]) console.log(`  ${COLORS[s]} ${s} ${RESET} ${report.counts[s]}`);
    }
    console.log('');
  }
}

// Exit code lets CI gate on this without any extra glue.
if (failOn) {
  const threshold = SEVERITY_ORDER.indexOf(failOn);
  if (threshold === -1) {
    console.error(`Severidad desconocida "${failOn}". Usa una de: ${SEVERITY_ORDER.join(', ')}`);
    process.exit(2);
  }
  const breached = report.findings.some((f) => SEVERITY_ORDER.indexOf(f.severity) <= threshold);
  process.exit(breached ? 1 : 0);
}
