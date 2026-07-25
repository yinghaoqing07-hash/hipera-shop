import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// Menú principal de la app de escritorio UnideGes ("MadisaNet"): abrirla,
// traerla al frente y entrar a los módulos habituales con sus teclas F.
// Todo lo hace desktop/unideges-menu.ps1; aquí solo se parsea el comando,
// se lanza el PS y se interpreta su línea JSON. Inicio de día y Fin de día
// son operaciones de negocio de verdad: bot.js les pone confirmación.

export const MODULOS_UNIDEGES = {
  // El dueño pidió (20/07) que Inicio de día entre SIN confirmación: se usa
  // a diario sin riesgo. Fin de día sí la mantiene (cierre del negocio).
  inicio: { tecla: 'F1', nombre: 'Inicio de día', peligro: false },
  articulos: { tecla: 'F3', nombre: 'Artículos', peligro: false },
  utilidades: { tecla: 'F6', nombre: 'Utilidades', peligro: false },
  albaranes: { tecla: 'F7', nombre: 'Albaranes', peligro: false },
  fin: { tecla: 'F12', nombre: 'Fin de día', peligro: true },
  // Un escalón más adentro (24/07): lo que el dueño hace DESPUÉS de entrar
  // al módulo. Primera versión a ciegas — el PS entra al módulo, vuelca a
  // la caja negra todo lo que ve dentro y activa lo que case con el patrón;
  // la captura final dice si acertó. El patrón es configurable
  // (config.unideges.submenus.<id>) para poder afinarlo en la tienda sin
  // esperar a una versión nueva.
  albaran_electronico: {
    tecla: 'F7',
    nombre: 'Albarán electrónico',
    peligro: false,
    submenu: 'albar.n +electr.nico|electr.nico'
  },
  lmanma: {
    tecla: 'F6',
    nombre: 'LMANMA (procesar fichero)',
    peligro: false,
    // La prueba a ciegas del 25/07 enseñó que el botón real se llama
    // "LMMAMA" (no LMANMA, como los ficheros de la mensajería — UnideGes
    // no se pone de acuerdo consigo mismo). ANCLADO al nombre entero:
    // "Act. márgenes LMmama" también anda por ese menú y no es el objetivo.
    submenu: '^\\s*LM(AN|MA)MA\\s*$'
  }
};

const ALIAS = {
  abrir: 'abrir', open: 'abrir', 打开: 'abrir',
  inicio: 'inicio', inicio_dia: 'inicio', 开始营业: 'inicio', 开业: 'inicio',
  articulos: 'articulos', artículos: 'articulos', 商品: 'articulos',
  utilidades: 'utilidades', 工具: 'utilidades',
  albaranes: 'albaranes', 收货单: 'albaranes', 收货: 'albaranes',
  fin: 'fin', fin_dia: 'fin', 日结: 'fin', 关店: 'fin',
  albaran_electronico: 'albaran_electronico', electronico: 'albaran_electronico',
  电子货单: 'albaran_electronico', 电子单: 'albaran_electronico',
  lmanma: 'lmanma', fichero: 'lmanma', 文件处理: 'lmanma'
};

// '/unideges' → menú de botones; '/unideges abrir' → abrir; '/unideges
// articulos' → módulo. null si el texto no es un comando de UnideGes.
export function parseUnidegesCommand(text) {
  const m = String(text || '').trim().match(/^\/(?:unideges|ug)(?:@\w+)?(?:\s+(\S+))?\s*$/i);
  if (!m) return null;
  if (!m[1]) return { accion: 'menu' };
  const id = ALIAS[m[1].toLowerCase()];
  if (!id) return { accion: 'menu' };
  if (id === 'abrir') return { accion: 'abrir' };
  return { accion: 'modulo', modulo: id };
}

// Frases sueltas tipo "打开unideges" / "abre el unideges": ir directo a
// abrir, sin pasar por el enrutador LLM. Solo con mención EXPLÍCITA de la
// app, para no robar frases de otros flujos.
export function matchAbrirUnideges(text) {
  const t = String(text || '').trim();
  if (!/unide\s*ges|madisa/i.test(t)) return false;
  return /打开|开一下|启动|abre|abrir|arranca/i.test(t) || /^\s*(?:unide\s*ges|madisa)\s*$/i.test(t);
}

// ¿El nombre de fichero es de LMANMA? (los de la mensajería vienen como
// "LMANMA FRUTA S25...", "Lmanma%20%20Cambios%20de%20Precios..." según los
// bajara el bot o un navegador). Puro y exportado para /procesar_lmanma.
export function esFicheroLmanma(nombre) {
  return /lman?ma|lmman?ma/i.test(String(nombre || ''));
}

// Construye los argumentos del PS (puro, testeable). Devuelve { error } si
// la petición no es válida. Las acciones de PROCESADO de v261:
//  - albaran + fase 'leer'      → abre la ventana y cuenta filas (solo mirar)
//  - albaran + fase 'procesar'  → Marcar todos + Procesar (escritura real)
//  - lmanma  + archivo          → fecha de hoy + elegir ese fichero (escritura)
export function argumentosUnideges(config, accion, moduloId, extra = {}) {
  const ug = config.unideges || {};
  const args = [
    '-Accion', accion === 'modulo' ? 'modulo' : accion,
    '-OutDir', config.desktop?.screenshotDir || 'screenshots',
    '-ExePath', String(ug.exePath || ''),
    '-TitleRegex', String(ug.menuTitleRegex || '^MadisaNet'),
    '-ShortcutRegex', String(ug.shortcutRegex || 'madisa|unide'),
    // Diálogo de acceso al arrancar: usuario + Enter x2 (receta del dueño,
    // 20/07). loginUser '' en config = no intentar el auto-login.
    '-LoginUser', String(ug.loginUser ?? '1'),
    // Caja negra: el PS escribe su paso actual en logs/desktop-estado.txt
    // (línea viva del panel) y devuelve la traza completa en el JSON.
    '-LogsDir', String(config.logsDir || '')
  ];
  if (accion === 'modulo') {
    const modulo = MODULOS_UNIDEGES[moduloId];
    if (!modulo) return { error: `没有这个模块：${moduloId}` };
    args.push('-Tecla', modulo.tecla);
    // El patrón del submenú se puede afinar desde config sin tocar código.
    const patron = ug.submenus?.[moduloId] || modulo.submenu; // '' en config = usar el del código
    if (patron) args.push('-Submenu', String(patron));
  }
  if (accion === 'albaran') {
    const patron = ug.submenus?.albaran_electronico || MODULOS_UNIDEGES.albaran_electronico.submenu;
    args.push('-Tecla', 'F7', '-Submenu', String(patron), '-Fase', extra.fase === 'procesar' ? 'procesar' : 'leer');
  }
  if (accion === 'lmanma') {
    if (!extra.archivo) return { error: '没有指定要处理的 LMANMA 文件' };
    const patron = ug.submenus?.lmanma || MODULOS_UNIDEGES.lmanma.submenu;
    args.push('-Tecla', 'F6', '-Submenu', String(patron), '-Archivo', String(extra.archivo));
  }
  return { args };
}

export async function accionUnideges(config, logger, accion, moduloId, extra = {}) {
  const ug = config.unideges || {};
  const script = ug.script || '';
  if (!fs.existsSync(script)) {
    return { status: 'error', mensaje: `没找到脚本 ${path.basename(script || 'unideges-menu.ps1')}，先更新 BOT` };
  }
  const construidos = argumentosUnideges(config, accion, moduloId, extra);
  if (construidos.error) return { status: 'error', mensaje: construidos.error };
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...construidos.args];
  logger?.info('unideges menu action', { accion, modulo: moduloId || '', fase: extra.fase || '', archivo: extra.archivo ? path.basename(String(extra.archivo)) : '' });
  // El PS puede esperar hasta 90 s a que aparezca la ventana al abrir la
  // app: el tope de Node tiene que ser mayor para no matarlo a mitad. Las
  // acciones de procesado además vigilan diálogos: tope aún más ancho.
  const timeoutMs = (accion === 'albaran' || accion === 'lmanma') ? 240000 : 150000;
  const res = await run('powershell.exe', args, { timeoutMs });
  const parsed = parseLastJson(res.stdout);
  if (!parsed) {
    const crudo = `${res.stderr || ''}\n${res.stdout || ''}`.trim().slice(0, 600);
    return { status: 'error', mensaje: `PowerShell 没返回结果（退出码 ${res.exitCode}）${crudo ? '：\n' + crudo : ''}`, trace: [] };
  }
  if (!Array.isArray(parsed.trace)) parsed.trace = [];
  if (parsed.screenshot) parsed.screenshot = path.resolve(parsed.screenshot);
  // Los warnings del PS ("Abriendo: <ruta>", ventanas vistas...) son ORO
  // para diagnosticar a distancia un fallo de apertura: van en el mensaje.
  if (parsed.status !== 'ok' && Array.isArray(parsed.warnings) && parsed.warnings.length) {
    parsed.mensaje = `${parsed.mensaje || ''}\n${parsed.warnings.join('\n')}`.trim();
  }
  return parsed;
}

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      resolve({ exitCode: -1, stdout, stderr: `${stderr}\nTimeout`.trim() });
    }, options.timeoutMs ?? 90000);
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('close', (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr });
    });
  });
}

function parseLastJson(stdout) {
  const lines = String(stdout || '').trim().split(/\r?\n/).reverse();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) continue;
    try { return JSON.parse(trimmed); } catch { /* seguir buscando */ }
  }
  return null;
}
