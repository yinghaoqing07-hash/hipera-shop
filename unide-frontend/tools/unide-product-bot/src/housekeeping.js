import fs from 'node:fs';
import path from 'node:path';

// Limpieza de mantenimiento: logs, capturas, subidas del panel y zips de
// updates viejos se borran pasada su vida útil, para que el disco del PC
// de la tienda no se llene en silencio (disco lleno = ningún estado se
// puede guardar y todo falla con síntomas raros). Corre al arrancar y una
// vez al día; solo borra ARCHIVOS (nunca recorre subcarpetas, así
// updates/backup-prev queda intacta) y siempre conserva el más reciente
// de cada carpeta.

const DIA_MS = 24 * 3600 * 1000;

export function limpiarArchivosViejos(config, logger, now = Date.now()) {
  const raiz = config.__toolRoot || '.';
  const objetivos = [
    { dir: config.logsDir, dias: 30 },
    { dir: config.desktop?.screenshotDir, dias: 14 },
    { dir: path.resolve(raiz, 'panel-uploads'), dias: 30 },
    { dir: path.resolve(raiz, config.promotions?.outputDir || 'promotions'), dias: 60 },
    { dir: path.resolve(raiz, 'updates'), dias: 30 }
  ];
  let borrados = 0;
  const detalle = {};
  for (const { dir, dias } of objetivos) {
    if (!dir) continue;
    const n = limpiarDir(dir, now - dias * DIA_MS, logger);
    if (n > 0) { borrados += n; detalle[path.basename(dir)] = n; }
  }
  return { borrados, detalle };
}

function limpiarDir(dir, corte, logger) {
  let entradas;
  try {
    entradas = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile());
  } catch {
    return 0; // la carpeta no existe: nada que limpiar
  }
  // El archivo más reciente se conserva SIEMPRE (p. ej. el último CSV de
  // promociones sigue siendo útil aunque tenga meses).
  const conMtime = entradas.map((e) => {
    try { return { nombre: e.name, mtime: fs.statSync(path.join(dir, e.name)).mtimeMs }; }
    catch { return null; }
  }).filter(Boolean).sort((a, b) => b.mtime - a.mtime);
  let borrados = 0;
  for (const { nombre, mtime } of conMtime.slice(1)) {
    if (mtime >= corte) continue;
    try {
      fs.unlinkSync(path.join(dir, nombre));
      borrados += 1;
    } catch (error) {
      logger?.warn?.('housekeeping could not delete file', { file: nombre, error: error.message });
    }
  }
  return borrados;
}
