import fs from 'node:fs';
import path from 'node:path';

// Estado de ejecución de los nodos del panel de flujo: cada vez que corre
// un paso (web, escritorio, diagnóstico…) se guarda una fila con estado,
// duración, detalle y captura. Motor preferido: SQLite nativo de Node
// (node:sqlite, disponible sin flag desde Node 23.4); si esta versión de
// Node no lo trae, se cae SIN drama a un NDJSON en logs/ con la misma API.

const TOPE_FILAS = 5000; // histórico suficiente y el archivo/db no crece sin fin

export async function abrirFlujoEstado(config, logger, opciones = {}) {
  const dir = config.logsDir || '.';
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ya existe */ }
  let backend = null;
  if (opciones.motor !== 'ndjson') {
    try {
      const { DatabaseSync } = await import('node:sqlite');
      backend = backendSqlite(DatabaseSync, path.join(dir, 'flujo.db'));
    } catch { /* Node sin node:sqlite → NDJSON */ }
  }
  if (!backend) backend = backendNdjson(path.join(dir, 'flujo-ejecuciones.ndjson'));
  logger?.info('flujo estado abierto', { motor: backend.motor });

  // Nodos corriendo AHORA (solo en memoria: si el bot se reinicia a mitad,
  // no queda un "corriendo" fantasma para siempre).
  const corriendo = new Map();

  return {
    motor: backend.motor,
    iniciar(nodo) {
      if (nodo) corriendo.set(nodo, Date.now());
    },
    terminar(nodo, { ok = true, detalle = '', captura = '' } = {}) {
      if (!nodo) return;
      const inicio = corriendo.get(nodo);
      corriendo.delete(nodo);
      const fila = {
        nodo,
        estado: ok ? 'ok' : 'error',
        at: new Date().toISOString(),
        duracionMs: inicio ? Date.now() - inicio : 0,
        detalle: String(detalle || '').slice(0, 500),
        // basename a mano: las capturas llegan con rutas Windows (\) y este
        // código también corre en desarrollo sobre Linux.
        captura: captura ? String(captura).split(/[\\/]/).pop() : ''
      };
      try { backend.insertar(fila); } catch (error) { logger?.warn('flujo estado no pudo escribir', { error: error.message }); }
    },
    // Cancela el "corriendo" SIN escribir fila: para resultados 'disabled'
    // o 'skipped' que no son ejecuciones de verdad.
    abandonar(nodo) {
      corriendo.delete(nodo);
    },
    corriendo: () => [...corriendo.keys()],
    // resumen() → { [nodo]: { ultimoEstado, ultimaVez, total, exitos,
    // duracionMediaMs } } (media solo de ejecuciones OK: los fallos suelen
    // ser timeouts y ensuciarían el "耗时" que ve el dueño).
    resumen() {
      try { return backend.resumen(); } catch { return {}; }
    },
    historial(nodo, limite = 40) {
      try { return backend.historial(nodo, limite); } catch { return []; }
    },
    cerrar() {
      try { backend.cerrar?.(); } catch { /* ya cerrado */ }
    }
  };
}

function backendSqlite(DatabaseSync, ruta) {
  const db = new DatabaseSync(ruta);
  db.exec(`CREATE TABLE IF NOT EXISTS ejecuciones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nodo TEXT NOT NULL,
    estado TEXT NOT NULL,
    at TEXT NOT NULL,
    duracion_ms INTEGER NOT NULL DEFAULT 0,
    detalle TEXT NOT NULL DEFAULT '',
    captura TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_ejecuciones_nodo ON ejecuciones (nodo, id);`);
  db.exec(`DELETE FROM ejecuciones WHERE id <= (SELECT COALESCE(MAX(id), 0) - ${TOPE_FILAS} FROM ejecuciones)`);
  const insertar = db.prepare('INSERT INTO ejecuciones (nodo, estado, at, duracion_ms, detalle, captura) VALUES (?, ?, ?, ?, ?, ?)');
  return {
    motor: 'sqlite',
    insertar(f) { insertar.run(f.nodo, f.estado, f.at, f.duracionMs, f.detalle, f.captura); },
    resumen() {
      const out = {};
      for (const r of db.prepare(`SELECT nodo, COUNT(*) AS total,
          SUM(CASE WHEN estado = 'ok' THEN 1 ELSE 0 END) AS exitos,
          AVG(CASE WHEN estado = 'ok' AND duracion_ms > 0 THEN duracion_ms END) AS media
        FROM ejecuciones GROUP BY nodo`).all()) {
        out[r.nodo] = { total: Number(r.total), exitos: Number(r.exitos), duracionMediaMs: Math.round(Number(r.media) || 0), ultimoEstado: '', ultimaVez: '' };
      }
      for (const r of db.prepare(`SELECT e.nodo, e.estado, e.at FROM ejecuciones e
        JOIN (SELECT nodo, MAX(id) AS mid FROM ejecuciones GROUP BY nodo) u ON e.id = u.mid`).all()) {
        if (out[r.nodo]) { out[r.nodo].ultimoEstado = r.estado; out[r.nodo].ultimaVez = r.at; }
      }
      return out;
    },
    historial(nodo, limite) {
      return db.prepare('SELECT estado, at, duracion_ms AS duracionMs, detalle, captura FROM ejecuciones WHERE nodo = ? ORDER BY id DESC LIMIT ?').all(nodo, limite);
    },
    cerrar() { db.close(); }
  };
}

function backendNdjson(ruta) {
  let filas = [];
  try {
    filas = fs.readFileSync(ruta, 'utf8').split('\n').filter(Boolean).map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch { /* primera vez */ }
  if (filas.length > TOPE_FILAS) {
    filas = filas.slice(-Math.floor(TOPE_FILAS * 0.8));
    try { fs.writeFileSync(ruta, filas.map((f) => JSON.stringify(f)).join('\n') + '\n', 'utf8'); } catch { /* mejor esfuerzo */ }
  }
  return {
    motor: 'ndjson',
    insertar(f) {
      filas.push(f);
      fs.appendFileSync(ruta, JSON.stringify(f) + '\n', 'utf8');
      if (filas.length > TOPE_FILAS + 1000) {
        filas = filas.slice(-Math.floor(TOPE_FILAS * 0.8));
        try { fs.writeFileSync(ruta, filas.map((x) => JSON.stringify(x)).join('\n') + '\n', 'utf8'); } catch { /* mejor esfuerzo */ }
      }
    },
    resumen() {
      const out = {};
      for (const f of filas) {
        const s = out[f.nodo] || (out[f.nodo] = { total: 0, exitos: 0, duracionMediaMs: 0, ultimoEstado: '', ultimaVez: '', __sum: 0, __n: 0 });
        s.total += 1;
        if (f.estado === 'ok') {
          s.exitos += 1;
          if (f.duracionMs > 0) { s.__sum += f.duracionMs; s.__n += 1; }
        }
        s.ultimoEstado = f.estado;
        s.ultimaVez = f.at;
      }
      for (const s of Object.values(out)) {
        s.duracionMediaMs = s.__n ? Math.round(s.__sum / s.__n) : 0;
        delete s.__sum;
        delete s.__n;
      }
      return out;
    },
    historial(nodo, limite) {
      const propias = [];
      for (let i = filas.length - 1; i >= 0 && propias.length < limite; i -= 1) {
        if (filas[i].nodo === nodo) propias.push({ estado: filas[i].estado, at: filas[i].at, duracionMs: filas[i].duracionMs || 0, detalle: filas[i].detalle || '', captura: filas[i].captura || '' });
      }
      return propias;
    }
  };
}
