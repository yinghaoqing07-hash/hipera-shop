import fs from 'node:fs';
import path from 'node:path';

// Escritura/lectura SEGURA de los JSON de estado (historial de pedidos,
// códigos de fruta, estado de tareas...). Un corte de luz a mitad de un
// writeFileSync normal deja el archivo truncado y el bot arranca "amnésico".
// Aquí: se escribe a un temporal y se renombra (atómico en el mismo disco),
// guardando antes el archivo bueno como .bak; al leer, si el principal está
// corrupto se recupera del .bak. Mismo patrón que ya usaban memoryStore y
// scheduledTasks, centralizado para el resto.

export function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  const backup = `${file}.bak`;
  const body = JSON.stringify(data, null, 2);
  try {
    if (fs.existsSync(file)) fs.copyFileSync(file, backup);
    fs.writeFileSync(temp, body, 'utf8');
    fs.renameSync(temp, file);
  } catch (error) {
    try { if (fs.existsSync(temp)) fs.unlinkSync(temp); } catch { /* noop */ }
    throw error;
  }
}

// Devuelve el JSON parseado, o `fallback` si el archivo no existe. Si el
// principal está corrupto intenta el .bak; `logger` avisa de la
// recuperación para que quede rastro.
export function readJsonSafe(file, fallback, logger) {
  const intentar = (ruta) => JSON.parse(fs.readFileSync(ruta, 'utf8').replace(/^\uFEFF/, ''));
  try {
    return intentar(file);
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    try {
      const rescatado = intentar(`${file}.bak`);
      logger?.warn?.('state file corrupt, recovered from .bak', { file: path.basename(file) });
      return rescatado;
    } catch {
      logger?.warn?.('state file corrupt and no usable .bak, starting fresh', { file: path.basename(file), error: error.message });
      return fallback;
    }
  }
}
