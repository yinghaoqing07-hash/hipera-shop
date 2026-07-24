import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Bucle SEMI-automatico de diagnostico y reparacion (idea del dueño, 22/07):
// fallo → ① empaquetar evidencia → ② diagnostico del modelo → ③ propuesta a
// Telegram con botones → ④ el dueño confirma → aplicar + reintentar.
//
// TRES VALVULAS DE SEGURIDAD, innegociables:
// 1. Solo codigo, nunca datos: el unico archivo que se puede tocar es
//    desktop/unideges-menu.ps1 (lista blanca dura). Nada de config, precios
//    ni pedidos.
// 2. Copia antes de aplicar: el archivo actual se guarda con marca de
//    tiempo en logs/diagnosticos/ y se puede volver con un archivo.
// 3. Validacion antes de activar: el archivo propuesto tiene que pasar el
//    parser REAL de PowerShell de la maquina y unos chequeos de cordura;
//    si no, se rechaza y el original queda intacto.

const ARCHIVOS_PERMITIDOS = ['desktop/unideges-menu.ps1'];

// --- ① evidencia -------------------------------------------------------

// Guarda el log de una ejecucion EXITOSA como referencia del paso: la
// comparacion exito-vs-fallo es el camino mas corto al diagnostico.
export function guardarExitoPaso(config, step, lineas) {
  try {
    const file = rutaExito(config, step);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, (lineas || []).join('\n'), 'utf8');
  } catch { /* referencia opcional */ }
}

// Junta todo lo que el modelo necesita para diagnosticar un fallo:
// caja negra de ESTA ejecucion, capturas citadas en la traza, codigo
// fuente del script y el ultimo exito del mismo paso. Deja copia en
// logs/diagnosticos/<sello>/ para auditoria y devuelve el texto + fotos.
export function empaquetarEvidencia(config, { etiqueta, step, res }) {
  const sello = new Date().toISOString().replace(/[:.]/g, '-');
  const carpeta = path.resolve(config.logsDir || '.', 'diagnosticos', `diag-${sello}`);
  const partes = [`=== FALLO: ${etiqueta} (step=${step}) ===`, ''];

  const caja = leerSeguro(path.resolve(config.logsDir || '.', 'caja-negra.txt'), 12000);
  partes.push('=== CAJA NEGRA DE LA EJECUCION FALLIDA ===', caja || '(vacia)', '');

  const exito = leerSeguro(rutaExito(config, step), 8000);
  if (exito) partes.push('=== ULTIMA EJECUCION EXITOSA DEL MISMO PASO (comparar) ===', exito, '');
  else partes.push('=== SIN EJECUCION EXITOSA PREVIA DE ESTE PASO ===', '');

  const fuente = path.resolve(config.__toolRoot || '.', ARCHIVOS_PERMITIDOS[0]);
  const codigo = leerSeguro(fuente, 60000);
  partes.push(`=== CODIGO FUENTE (${ARCHIVOS_PERMITIDOS[0]}) ===`, codigo || '(ilegible)', '');

  // Capturas: las citadas en la traza ("captura <archivo>") + la del error.
  const imagenes = [];
  const dirShots = config.desktop?.screenshotDir || '';
  for (const linea of res?.trace || []) {
    const m = String(linea).match(/captura (\S+\.png)/);
    if (m && dirShots) {
      const ruta = path.join(dirShots, m[1]);
      if (fs.existsSync(ruta)) imagenes.push(ruta);
    }
  }
  if (res?.screenshot && fs.existsSync(res.screenshot)) imagenes.push(res.screenshot);
  const ultimas = imagenes.slice(-2); // las 2 mas recientes: el momento del fallo

  const texto = partes.join('\n');
  try {
    fs.mkdirSync(carpeta, { recursive: true });
    fs.writeFileSync(path.join(carpeta, 'evidencia.txt'), texto, 'utf8');
  } catch { /* la copia de auditoria es opcional */ }
  return { texto, imagenes: ultimas, carpeta };
}

// --- ③/④ propuesta de fix y aplicacion --------------------------------

// Extrae del texto del modelo el archivo corregido entre las marcas
// <<<ARCHIVO:nombre>>> ... <<<FIN>>>. null si no propone codigo.
export function extraerArchivoCorregido(respuesta) {
  const m = String(respuesta || '').match(/<<<ARCHIVO:([^>]+)>>>\r?\n([\s\S]*?)\r?\n?<<<FIN>>>/);
  if (!m) return null;
  const nombre = m[1].trim().replace(/\\/g, '/');
  const archivo = ARCHIVOS_PERMITIDOS.find((p) => p === nombre || p.endsWith('/' + nombre));
  if (!archivo) return { rechazo: `el modelo quiso tocar '${nombre}', que NO esta en la lista blanca` };
  const contenido = m[2].replace(/^```[a-z]*\r?\n?/i, '').replace(/\r?\n```\s*$/i, '');
  return { archivo, contenido };
}

// Texto del diagnostico SIN el bloque de codigo (para el mensaje del chat).
export function resumenSinCodigo(respuesta) {
  return String(respuesta || '').replace(/<<<ARCHIVO:[^>]+>>>[\s\S]*?<<<FIN>>>/g, '〔随附修改后的脚本文件〕').trim();
}

// Comprueba las valvulas SIN tocar nada: lista blanca, cordura de tamaño y
// estructura, y el parser REAL de PowerShell. Devuelve { ok, motivo, temp }
// (temp = archivo propuesto ya validado, con BOM). Lo usan aplicarFix (parche
// local) y el camino de PR.
export function validarPropuesta(config, fix, validar = validarConPowerShell) {
  if (!fix?.archivo || !fix?.contenido) return { ok: false, motivo: '没有可应用的文件内容' };
  if (!ARCHIVOS_PERMITIDOS.includes(fix.archivo)) return { ok: false, motivo: `文件不在白名单里：${fix.archivo}` };
  const destino = path.resolve(config.__toolRoot || '.', fix.archivo);
  let actual = '';
  try { actual = fs.readFileSync(destino, 'utf8'); } catch { return { ok: false, motivo: '找不到要修改的原文件' }; }

  const nuevo = String(fix.contenido);
  if (nuevo.length < actual.length * 0.4 || nuevo.length > actual.length * 2.5) {
    return { ok: false, motivo: `新文件大小可疑（原 ${actual.length} 字符，新 ${nuevo.length}），不采用` };
  }
  for (const requerido of ['param(', 'function Emit', 'ConvertTo-Json']) {
    if (!nuevo.includes(requerido)) return { ok: false, motivo: `新文件缺少关键结构（${requerido}），不采用` };
  }

  const sello = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.resolve(config.logsDir || '.', 'diagnosticos');
  fs.mkdirSync(dir, { recursive: true });
  const temp = path.join(dir, `propuesta-${sello}.ps1`);
  fs.writeFileSync(temp, '\uFEFF' + nuevo.replace(/^\uFEFF/, ''), 'utf8');
  const veredicto = validar(temp);
  if (!veredicto.ok) {
    return { ok: false, motivo: `新文件没通过 PowerShell 语法验证：${veredicto.detalle || '?'}`, temp };
  }
  return { ok: true, temp, destino };
}

// Aplica el archivo propuesto EN LOCAL (parche en la maquina): valida y, si
// pasa, hace backup con sello y reemplaza el original.
export function aplicarFix(config, fix, validar = validarConPowerShell) {
  const val = validarPropuesta(config, fix, validar);
  if (!val.ok) return { ok: false, motivo: `${val.motivo}（原文件未动）`, propuesta: val.temp };
  const sello = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.resolve(config.logsDir || '.', 'diagnosticos');
  const backup = path.join(dir, `backup-${sello}-${path.basename(val.destino)}`);
  fs.copyFileSync(val.destino, backup);
  fs.copyFileSync(val.temp, val.destino);
  return { ok: true, backup, destino: val.destino };
}

// Ruta del archivo del fix DENTRO del repo (para el PR): prefijo del repo
// hasta la carpeta del bot + la ruta de la lista blanca.
export function rutaEnRepo(config, archivoLista) {
  const prefijo = String(config?.github?.repoPathPrefix || 'unide-frontend/tools/unide-product-bot').replace(/\/+$/, '');
  return `${prefijo}/${archivoLista}`;
}

// Parser REAL de la maquina (en la tienda: Windows PowerShell 5.1 — el
// mismo que ejecutara el script, asi que su veredicto es el que cuenta).
export function validarConPowerShell(rutaArchivo) {
  if (process.platform !== 'win32') return { ok: true, detalle: 'sin PowerShell local (entorno de desarrollo)' };
  const cmd = "$errs=$null;[System.Management.Automation.Language.Parser]::ParseFile('" + rutaArchivo.replace(/'/g, "''") + "',[ref]$null,[ref]$errs)|Out-Null;if($errs){$errs|ForEach-Object{$_.Message};exit 1}else{'OK'}";
  const res = spawnSync('powershell.exe', ['-NoProfile', '-Command', cmd], { encoding: 'utf8', timeout: 30000, windowsHide: true });
  if (res.status === 0) return { ok: true };
  return { ok: false, detalle: String(res.stdout || res.stderr || 'parser fallo').trim().slice(0, 300) };
}

// --- helpers -----------------------------------------------------------

function rutaExito(config, step) {
  const limpio = String(step || 'paso').replace(/[^\w-]/g, '_').slice(0, 40);
  return path.resolve(config.logsDir || '.', 'diagnosticos', `exito-${limpio}.txt`);
}

function leerSeguro(ruta, tope) {
  try {
    const texto = fs.readFileSync(ruta, 'utf8').replace(/^\uFEFF/, '');
    return texto.length > tope ? texto.slice(-tope) : texto;
  } catch {
    return '';
  }
}
