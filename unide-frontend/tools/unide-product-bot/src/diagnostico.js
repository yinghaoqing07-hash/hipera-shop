import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

// Bucle SEMI-automatico de diagnostico y reparacion (idea del dueño, 22/07):
// fallo → ① empaquetar evidencia → ② diagnostico del modelo → ③ propuesta a
// Telegram con botones → ④ el dueño confirma → aplicar + reintentar.
//
// TRES VALVULAS DE SEGURIDAD, innegociables:
// 1. Solo codigo, nunca datos: solo los archivos de la lista blanca dura.
//    Nada de config, precios ni pedidos.
// 2. Copia antes de aplicar: el archivo actual se guarda con marca de
//    tiempo en logs/diagnosticos/ y se puede volver con un archivo.
// 3. Validacion antes de activar: ps1 pasa el parser REAL de PowerShell;
//    js pasa node --check + import real en subproceso + lista de exports
//    intacta. Si no, se rechaza y el original queda intacto.
// Ademas, por archivo: webBrowser.js es solo-PR (nunca parche local) y el
// parche local de CUALQUIER .js depende de diagnostico.permitirFixJsLocal.

const ARCHIVOS_PERMITIDOS = [
  'desktop/unideges-menu.ps1',
  'desktop/unideges-search.ps1',
  'src/webMensajeria.js',
  'src/webPromotions.js',
  'src/webOrder.js',
  'src/webBrowser.js'
];

// Ficha por archivo: tipo de validación, estructura exigible y si el parche
// local está vedado (soloPr: webBrowser.js lo importan TODOS los flujos web;
// un mal parche local tumbaba el bot entero — por ahí solo va PR revisable).
const FICHA_ARCHIVO = {
  'desktop/unideges-menu.ps1': { tipo: 'ps1', estructura: ['param(', 'function Emit', 'ConvertTo-Json'] },
  'desktop/unideges-search.ps1': { tipo: 'ps1', estructura: ['param('] },
  'src/webMensajeria.js': { tipo: 'js' },
  'src/webPromotions.js': { tipo: 'js' },
  'src/webOrder.js': { tipo: 'js' },
  'src/webBrowser.js': { tipo: 'js', soloPr: true }
};

export function esSoloPr(archivo) {
  return Boolean(FICHA_ARCHIVO[archivo]?.soloPr);
}

export function esArchivoJs(archivo) {
  return FICHA_ARCHIVO[archivo]?.tipo === 'js';
}

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
// fuente del archivo que conduce el paso (archivoFuente, del mapa
// DIAG_PASO de bot.js) y el ultimo exito del mismo paso. Deja copia en
// logs/diagnosticos/<sello>/ para auditoria y devuelve el texto + fotos.
export function empaquetarEvidencia(config, { etiqueta, step, res, archivoFuente }) {
  const sello = new Date().toISOString().replace(/[:.]/g, '-');
  const carpeta = path.resolve(config.logsDir || '.', 'diagnosticos', `diag-${sello}`);
  const partes = [`=== FALLO: ${etiqueta} (step=${step}) ===`, ''];

  const caja = leerSeguro(path.resolve(config.logsDir || '.', 'caja-negra.txt'), 12000);
  partes.push('=== CAJA NEGRA DE LA EJECUCION FALLIDA ===', caja || '(vacia)', '');

  const exito = leerSeguro(rutaExito(config, step), 8000);
  if (exito) partes.push('=== ULTIMA EJECUCION EXITOSA DEL MISMO PASO (comparar) ===', exito, '');
  else partes.push('=== SIN EJECUCION EXITOSA PREVIA DE ESTE PASO ===', '');

  const fuenteRel = archivoFuente || ARCHIVOS_PERMITIDOS[0];
  const fuente = path.resolve(config.__toolRoot || '.', fuenteRel);
  const codigo = leerSeguro(fuente, 60000);
  partes.push(`=== CODIGO FUENTE (${fuenteRel}) ===`, codigo || '(ilegible)', '');

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
// estructura, y la validación propia del tipo (ps1: parser REAL de
// PowerShell; js: node --check + import en subproceso + exports intactos).
// Devuelve { ok, motivo, temp } (temp = archivo propuesto ya validado).
export function validarPropuesta(config, fix, validar = validarConPowerShell) {
  if (!fix?.archivo || !fix?.contenido) return { ok: false, motivo: '没有可应用的文件内容' };
  const ficha = FICHA_ARCHIVO[fix.archivo];
  if (!ficha) return { ok: false, motivo: `文件不在白名单里：${fix.archivo}` };
  const destino = path.resolve(config.__toolRoot || '.', fix.archivo);
  let actual = '';
  try { actual = fs.readFileSync(destino, 'utf8'); } catch { return { ok: false, motivo: '找不到要修改的原文件' }; }

  const nuevo = String(fix.contenido);
  if (nuevo.length < actual.length * 0.4 || nuevo.length > actual.length * 2.5) {
    return { ok: false, motivo: `新文件大小可疑（原 ${actual.length} 字符，新 ${nuevo.length}），不采用` };
  }
  for (const requerido of ficha.estructura || []) {
    if (!nuevo.includes(requerido)) return { ok: false, motivo: `新文件缺少关键结构（${requerido}），不采用` };
  }

  const sello = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.resolve(config.logsDir || '.', 'diagnosticos');
  fs.mkdirSync(dir, { recursive: true });
  const temp = path.join(dir, `propuesta-${sello}${ficha.tipo === 'js' ? '.js' : '.ps1'}`);
  fs.writeFileSync(temp, '\uFEFF' + nuevo.replace(/^\uFEFF/, ''), 'utf8');

  if (ficha.tipo === 'js') {
    const v = validarJs(temp, destino);
    if (!v.ok) return { ok: false, motivo: v.motivo, temp };
  } else {
    const veredicto = validar(temp);
    if (!veredicto.ok) {
      return { ok: false, motivo: `新文件没通过 PowerShell 语法验证：${veredicto.detalle || '?'}`, temp };
    }
  }
  return { ok: true, temp, destino };
}

// Candados del parche JS: importarlo de verdad en un subproceso limpio —
// falla por sintaxis, por imports rotos o por top-level que lanza — y la
// lista de exports del archivo actual intacta (solo puede crecer: quitar
// uno rompe a los importadores sin que nada lo delate).
// NOTA: `node --check` NO sirve aquí (Node 24 con detección de módulo deja
// pasar sintaxis ESM rota — comprobado 24/07); el import real sí la detecta.
export function validarJs(temp, destino) {
  const nuevos = exportsDe(temp);
  if (!nuevos) return { ok: false, motivo: '新文件在子进程里 import 失败（语法错误或顶层代码有问题），不采用' };
  const actuales = exportsDe(destino);
  if (actuales) {
    const faltan = actuales.filter((e) => !nuevos.includes(e));
    if (faltan.length) return { ok: false, motivo: `新文件删掉了现有 export（${faltan.join(', ')}），不采用` };
  }
  return { ok: true };
}

// Exports de un módulo importándolo en un subproceso limpio. null si la
// importación falla (esa es precisamente la señal que busca validarJs).
// OJO: en la plantilla, '\\n' son DOS caracteres (\n) para el script -e;
// con uno solo se rompería la línea dentro de su string y no parsearía.
function exportsDe(archivo) {
  const url = pathToFileURL(archivo).href;
  const res = spawnSync(process.execPath, [
    '--input-type=module', '-e',
    `await import(${JSON.stringify(url)}).then((m) => console.log(Object.keys(m).join('\\n')))`
  ], { encoding: 'utf8', timeout: 30000 });
  if (res.status !== 0) return null;
  return String(res.stdout || '').split('\n').map((s) => s.trim()).filter(Boolean);
}

// Aplica el archivo propuesto EN LOCAL (parche en la maquina): valida y, si
// pasa, hace backup con sello y reemplaza el original. Devuelve esJs para que
// el llamador avise de que un .js necesita REINICIAR el bot para surtir
// efecto (los .ps1 se releen en cada llamada y no hace falta).
export function aplicarFix(config, fix, validar = validarConPowerShell) {
  const val = validarPropuesta(config, fix, validar);
  if (!val.ok) return { ok: false, motivo: `${val.motivo}（原文件未动）`, propuesta: val.temp };
  const sello = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.resolve(config.logsDir || '.', 'diagnosticos');
  const backup = path.join(dir, `backup-${sello}-${path.basename(val.destino)}`);
  fs.copyFileSync(val.destino, backup);
  fs.copyFileSync(val.temp, val.destino);
  return { ok: true, backup, destino: val.destino, esJs: esArchivoJs(fix.archivo) };
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
