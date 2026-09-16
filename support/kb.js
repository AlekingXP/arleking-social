'use strict';

// Base de conocimiento: almacenamiento y búsqueda.
//
// La búsqueda es BM25 escrito a mano sobre una tabla de veinticinco filas.
// Suena a poco, y lo es a propósito: con este tamaño, una búsqueda
// vectorial significaría un segundo proveedor, una clave más, una llamada
// de red por pregunta y un índice que mantener sincronizado, para ordenar
// veinticinco documentos. Un recorrido lineal tarda menos de un
// milisegundo y no depende de nada.
//
// Lo que sí importa es que entienda español: sin plegar acentos, "que es
// la insignia" no encuentra "¿Qué es la insignia?", y sin quitar palabras
// vacías, "como" y "de" dominan la puntuación de cualquier consulta.

const { ARTICLES } = require('./knowledge');

// Palabras que aparecen en casi toda pregunta y por tanto no distinguen
// ninguna. Se quitan antes de puntuar.
const VACIAS = new Set([
  'a', 'al', 'algo', 'alguien', 'ante', 'aqui', 'como', 'con', 'cual', 'cuales',
  'cuando', 'cuanto', 'de', 'del', 'desde', 'donde', 'dos', 'el', 'ella',
  'ellos', 'en', 'entre', 'era', 'eres', 'es', 'esa', 'ese', 'eso', 'esta',
  'estan', 'este', 'esto', 'estoy', 'ha', 'hace', 'hacer', 'hasta', 'hay',
  'la', 'las', 'le', 'lo', 'los', 'mas', 'me', 'mi', 'mis', 'muy', 'ni', 'no',
  'nos', 'para', 'pero', 'poder', 'por', 'porque', 'pues', 'que', 'quien',
  'se', 'segun', 'ser', 'si', 'sin', 'sobre', 'solo', 'son', 'soy', 'su',
  'sus', 'tan', 'te', 'tener', 'tengo', 'ti', 'tiene', 'tu', 'tus', 'un',
  'una', 'uno', 'unos', 'y', 'ya', 'yo', 'hola', 'gracias', 'favor', 'puedo',
  'quiero', 'necesito',
]);

// Siglas y palabras cortas que sí distinguen. Sin esta lista, el filtro de
// longitud mínima se comería justo los términos más específicos que hay.
const CORTAS_UTILES = new Set(['vip', '2fa', 'url', 'mfa', 'sms', 'iva', 'usd', 'ip']);

/** Minúsculas sin acentos ni signos: "¿Cómo?" y "como" deben coincidir. */
function normalizar(texto) {
  return String(texto == null ? '' : texto)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ+]+/g, ' ')
    .trim();
}

function tokenizar(texto, { conservarVacias = false } = {}) {
  return normalizar(texto)
    .split(' ')
    .filter(Boolean)
    .filter((t) => (t.length >= 4 || CORTAS_UTILES.has(t) || /\d/.test(t)))
    .filter((t) => conservarVacias || !VACIAS.has(t));
}

// Recorte por el final: "cancelar", "cancelo", "cancelacion" comparten
// raíz. Un lematizador de verdad sería mejor y también sería una
// dependencia; cortar a ocho caracteres acierta lo suficiente en español
// para una base de este tamaño.
function raiz(token) {
  return token.length > 8 ? token.slice(0, 8) : token;
}

const K1 = 1.2; // saturación: repetir un término diez veces no vale diez veces
const B = 0.6;  // cuánto penaliza la longitud del documento

function createKb(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS support_articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      builtin INTEGER NOT NULL DEFAULT 0,
      hits INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const stmts = {
    insert: db.prepare(`
      INSERT INTO support_articles (slug, question, answer, tags, builtin)
      VALUES (@slug, @question, @answer, @tags, @builtin)
    `),
    all: db.prepare('SELECT * FROM support_articles ORDER BY question COLLATE NOCASE'),
    enabled: db.prepare('SELECT id, slug, question, answer, tags FROM support_articles WHERE enabled = 1'),
    byId: db.prepare('SELECT * FROM support_articles WHERE id = ?'),
    bySlug: db.prepare('SELECT * FROM support_articles WHERE slug = ?'),
    count: db.prepare('SELECT COUNT(*) AS n FROM support_articles'),
    bumpHits: db.prepare('UPDATE support_articles SET hits = hits + 1 WHERE id = ?'),
    remove: db.prepare('DELETE FROM support_articles WHERE id = ?'),
    update: db.prepare(`
      UPDATE support_articles
      SET question = @question, answer = @answer, tags = @tags,
          enabled = @enabled, updated_at = datetime('now')
      WHERE id = @id
    `),
  };

  // Siembra única. `INSERT OR IGNORE` por slug: si el dueño borró un
  // artículo de fábrica porque no le servía, un reinicio no debe
  // resucitarlo, así que sólo se siembra cuando la tabla está vacía.
  function seed() {
    if (stmts.count.get().n > 0) return 0;
    const sembrar = db.transaction((articulos) => {
      articulos.forEach((a) => stmts.insert.run({ ...a, builtin: 1 }));
    });
    sembrar(ARTICLES);
    return ARTICLES.length;
  }

  // El índice se reconstruye en memoria al arrancar y cada vez que se
  // toca un artículo. Con veinticinco filas cuesta nada, y evita el
  // problema clásico de un índice persistido que se queda desfasado.
  let indice = null;

  function reindexar() {
    const filas = stmts.enabled.all();
    const docs = filas.map((fila) => {
      // La pregunta pesa el triple y las etiquetas el doble porque son lo
      // que alguien escribe de verdad en el chat. El cuerpo del artículo
      // es largo y arrastraría términos de relleno.
      const campos = [
        ...tokenizar(fila.question).flatMap((t) => [t, t, t]),
        ...tokenizar(fila.tags).flatMap((t) => [t, t]),
        ...tokenizar(fila.answer),
      ].map(raiz);

      const frecuencias = new Map();
      campos.forEach((t) => frecuencias.set(t, (frecuencias.get(t) || 0) + 1));
      return { fila, frecuencias, longitud: campos.length };
    });

    const df = new Map();
    docs.forEach((d) => {
      new Set(d.frecuencias.keys()).forEach((t) => df.set(t, (df.get(t) || 0) + 1));
    });

    const longitudMedia = docs.length
      ? docs.reduce((suma, d) => suma + d.longitud, 0) / docs.length
      : 1;

    indice = { docs, df, longitudMedia, total: docs.length };
  }

  function asegurarIndice() {
    if (!indice) reindexar();
    return indice;
  }

  /**
   * Devuelve los artículos más parecidos a la consulta, con su puntuación.
   * `minScore` descarta los que sólo coinciden por casualidad: es mejor
   * devolver nada —y que el asistente lo admita— que devolver un artículo
   * irrelevante que se tomará por respuesta.
   */
  function search(consulta, { limit = 4, minScore = 1.2 } = {}) {
    const idx = asegurarIndice();
    if (!idx.total) return [];

    const terminos = [...new Set(tokenizar(consulta).map(raiz))];
    if (!terminos.length) return [];

    const resultados = idx.docs.map((doc) => {
      let score = 0;
      terminos.forEach((termino) => {
        const tf = doc.frecuencias.get(termino) || 0;
        if (!tf) return;
        const n = idx.df.get(termino) || 0;
        const idf = Math.log(1 + (idx.total - n + 0.5) / (n + 0.5));
        const norma = tf * (K1 + 1) / (tf + K1 * (1 - B + B * (doc.longitud / idx.longitudMedia)));
        score += idf * norma;
      });
      return { articulo: doc.fila, score };
    });

    return resultados
      .filter((r) => r.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /** Registra que un artículo se usó de verdad, para saber cuáles sobran. */
  function markUsed(ids) {
    const marcar = db.transaction((lista) => lista.forEach((id) => stmts.bumpHits.run(id)));
    try {
      marcar(ids);
    } catch {
      // Una estadística no puede tumbar una respuesta de soporte.
    }
  }

  function list() {
    return stmts.all.all();
  }

  function get(id) {
    return stmts.byId.get(id);
  }

  function create({ question, answer, tags }) {
    const base = normalizar(question).split(' ').filter(Boolean).slice(0, 6).join('-') || 'articulo';
    let slug = base;
    let n = 2;
    while (stmts.bySlug.get(slug)) slug = `${base}-${n++}`;
    const info = stmts.insert.run({ slug, question, answer, tags: tags || '', builtin: 0 });
    reindexar();
    return stmts.byId.get(info.lastInsertRowid);
  }

  function update(id, { question, answer, tags, enabled }) {
    const actual = stmts.byId.get(id);
    if (!actual) return null;
    stmts.update.run({
      id,
      question: question != null ? question : actual.question,
      answer: answer != null ? answer : actual.answer,
      tags: tags != null ? tags : actual.tags,
      enabled: enabled != null ? (enabled ? 1 : 0) : actual.enabled,
    });
    reindexar();
    return stmts.byId.get(id);
  }

  function remove(id) {
    const cambios = stmts.remove.run(id).changes;
    if (cambios) reindexar();
    return cambios > 0;
  }

  seed();
  reindexar();

  return { search, markUsed, list, get, create, update, remove, reindexar, seed, normalizar, tokenizar };
}

module.exports = { createKb, normalizar, tokenizar, raiz };
