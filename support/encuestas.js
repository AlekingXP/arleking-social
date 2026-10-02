'use strict';

// Encuestas: quien lleva la plataforma pregunta algo, y a todo el que entra
// al panel le llega.
//
// A quién le llega, que es la decisión que lo define todo: NO se guarda una
// fila por usuario al crearla. Una encuesta está abierta o cerrada, y la ve
// cualquiera con cuenta que todavía no la haya respondido. Guardar los
// destinatarios de antemano habría dejado fuera a quien se registre mañana
// —justo la gente a la que más interesa preguntar— y habría llenado la base
// de filas vacías por cada encuesta y cada cuenta.
//
// Quien la escribe no la recibe: ya sabe lo que preguntó.
//
// Una respuesta por persona y por encuesta, y lo garantiza la base de datos
// con un índice único, no el código: dos pestañas abiertas a la vez son dos
// peticiones a la vez.

const crypto = require('crypto');

const MAX_PREGUNTA = 300;
const MAX_DETALLE = 600;
const MAX_COMENTARIO = 1000;

const RESPUESTAS = ['si', 'no'];

function crearEncuestas(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS encuestas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      public_id TEXT NOT NULL UNIQUE,
      pregunta TEXT NOT NULL,
      detalle TEXT,
      estado TEXT NOT NULL DEFAULT 'abierta',
      creada_por TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      cerrada_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_encuestas_estado
      ON encuestas(estado, id DESC);

    CREATE TABLE IF NOT EXISTS encuesta_respuestas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      encuesta_id INTEGER NOT NULL REFERENCES encuestas(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      username TEXT,
      respuesta TEXT NOT NULL,
      comentario TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Una por persona y encuesta. En la base, no en un if: dos pestañas
    -- abiertas mandan dos peticiones y la comprobación previa no basta.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_encuesta_respuesta_unica
      ON encuesta_respuestas(encuesta_id, user_id);

    CREATE INDEX IF NOT EXISTS idx_encuesta_respuestas_encuesta
      ON encuesta_respuestas(encuesta_id, id DESC);
  `);

  const q = {
    crear: db.prepare(`
      INSERT INTO encuestas (public_id, pregunta, detalle, creada_por)
      VALUES (?, ?, ?, ?)
    `),
    porId: db.prepare('SELECT * FROM encuestas WHERE id = ?'),
    porPublicId: db.prepare('SELECT * FROM encuestas WHERE public_id = ?'),
    listar: db.prepare('SELECT * FROM encuestas ORDER BY id DESC LIMIT 50'),
    cerrar: db.prepare(`
      UPDATE encuestas SET estado = 'cerrada', cerrada_at = datetime('now')
      WHERE id = ? AND estado = 'abierta'
    `),
    reabrir: db.prepare(`
      UPDATE encuestas SET estado = 'abierta', cerrada_at = NULL WHERE id = ?
    `),
    borrar: db.prepare('DELETE FROM encuestas WHERE id = ?'),

    // La primera encuesta abierta que esta persona no haya contestado. Por
    // orden de creación: se responden en el orden en que se preguntaron.
    pendiente: db.prepare(`
      SELECT e.* FROM encuestas e
      WHERE e.estado = 'abierta'
        AND NOT EXISTS (
          SELECT 1 FROM encuesta_respuestas r
          WHERE r.encuesta_id = e.id AND r.user_id = ?
        )
      ORDER BY e.id ASC
      LIMIT 1
    `),
    responder: db.prepare(`
      INSERT INTO encuesta_respuestas (encuesta_id, user_id, username, respuesta, comentario)
      VALUES (?, ?, ?, ?, ?)
    `),
    respuestasDe: db.prepare(`
      SELECT username, respuesta, comentario, created_at
      FROM encuesta_respuestas WHERE encuesta_id = ? ORDER BY id DESC
    `),
    recuentoDe: db.prepare(`
      SELECT respuesta, COUNT(*) AS n FROM encuesta_respuestas
      WHERE encuesta_id = ? GROUP BY respuesta
    `),
    conComentario: db.prepare(`
      SELECT COUNT(*) AS n FROM encuesta_respuestas
      WHERE encuesta_id = ? AND comentario IS NOT NULL AND comentario <> ''
    `),
  };

  function porPublicId(publicId) {
    return q.porPublicId.get(String(publicId || ''));
  }

  function recorta(valor, max) {
    return String(valor == null ? '' : valor).trim().slice(0, max);
  }

  /** Lo que ve quien la responde: nada de recuentos ni de quién contestó. */
  function aParticipante(fila) {
    return {
      id: fila.public_id,
      pregunta: fila.pregunta,
      detalle: fila.detalle || null,
      creada: fila.created_at,
    };
  }

  /** Lo que ve quien la creó: la pregunta y lo que ha contestado la gente. */
  function aDueno(fila) {
    const recuento = { si: 0, no: 0 };
    q.recuentoDe.all(fila.id).forEach((r) => {
      if (Object.prototype.hasOwnProperty.call(recuento, r.respuesta)) recuento[r.respuesta] = r.n;
    });
    return {
      id: fila.public_id,
      pregunta: fila.pregunta,
      detalle: fila.detalle || null,
      estado: fila.estado,
      creada: fila.created_at,
      cerrada: fila.cerrada_at,
      recuento,
      total: recuento.si + recuento.no,
      comentarios: q.conComentario.get(fila.id).n,
    };
  }

  return {
    MAX_PREGUNTA,
    MAX_DETALLE,
    MAX_COMENTARIO,
    RESPUESTAS,

    crear({ pregunta, detalle, autor }) {
      const texto = recorta(pregunta, MAX_PREGUNTA);
      if (!texto) return { error: 'Escribe la pregunta.' };
      const info = q.crear.run(
        crypto.randomBytes(8).toString('hex'),
        texto,
        recorta(detalle, MAX_DETALLE) || null,
        recorta(autor, 60) || null,
      );
      return { encuesta: aDueno(q.porId.get(info.lastInsertRowid)) };
    },

    listar() {
      return q.listar.all().map(aDueno);
    },

    /** El detalle con las respuestas, para leerlas una a una. */
    detalle(publicId) {
      const fila = porPublicId(publicId);
      if (!fila) return null;
      return {
        ...aDueno(fila),
        respuestas: q.respuestasDe.all(fila.id).map((r) => ({
          usuario: r.username || '(cuenta borrada)',
          respuesta: r.respuesta,
          comentario: r.comentario || null,
          cuando: r.created_at,
        })),
      };
    },

    cerrar(publicId) {
      const fila = porPublicId(publicId);
      if (!fila) return null;
      q.cerrar.run(fila.id);
      return aDueno(q.porId.get(fila.id));
    },

    reabrir(publicId) {
      const fila = porPublicId(publicId);
      if (!fila) return null;
      q.reabrir.run(fila.id);
      return aDueno(q.porId.get(fila.id));
    },

    borrar(publicId) {
      const fila = porPublicId(publicId);
      if (!fila) return false;
      q.borrar.run(fila.id);
      return true;
    },

    pendientePara(userId) {
      const fila = q.pendiente.get(userId);
      return fila ? aParticipante(fila) : null;
    },

    /**
     * Guarda una respuesta. Devuelve `{ error }` si la encuesta no existe,
     * está cerrada o esta persona ya contestó.
     */
    responder({ publicId, userId, username, respuesta, comentario }) {
      const fila = porPublicId(publicId);
      if (!fila) return { error: 'Esa encuesta ya no existe.' };
      if (fila.estado !== 'abierta') return { error: 'Esa encuesta ya está cerrada.' };
      if (!RESPUESTAS.includes(respuesta)) return { error: 'Elige una de las dos opciones.' };

      try {
        q.responder.run(
          fila.id, userId, recorta(username, 60) || null,
          respuesta, recorta(comentario, MAX_COMENTARIO) || null,
        );
      } catch (err) {
        // El índice único es quien decide: si dos pestañas mandan a la vez,
        // la segunda llega aquí en vez de duplicar la respuesta.
        if (String(err.message).includes('UNIQUE')) return { error: 'Ya respondiste esta encuesta.' };
        throw err;
      }
      return { ok: true };
    },
  };
}

module.exports = { crearEncuestas, MAX_PREGUNTA, MAX_DETALLE, MAX_COMENTARIO, RESPUESTAS };
