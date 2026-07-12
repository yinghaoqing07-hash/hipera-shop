// =====================================================================
// Conexión al Edge de la tienda vía CDP (Chrome DevTools Protocol)
// =====================================================================
// Pedidos es una página web de UnideGes (DevExpress XAF), no la app de
// escritorio. En lugar de clics por coordenadas (frágil), conducimos el
// DOM directamente con puppeteer-core conectándonos a un Edge que se
// lanzó con --remote-debugging-port (ver desktop/launch-edge-debug.cmd).
//
// No se descarga ningún navegador: puppeteer-core se ADJUNTA al Edge que
// ya está abierto y con la sesión de UnideGes iniciada. Y si NO está
// abierto, aquí lo abrimos nosotros: mismo ejecutable, mismo perfil y
// mismas banderas que launch-edge-debug.cmd — el perfil dedicado
// recuerda la sesión de UnideGes, así que normalmente basta.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const EDGE_URL_DEFECTO = 'https://unideges30.unide.es/OrderT_ListView';

async function tryConnect(config, debugUrl) {
  return puppeteer.connect({
    browserURL: debugUrl,
    defaultViewport: null,
    // Si una pestaña estaba dormida (Edge las "duerme" tras un rato de
    // inactividad), despertar su renderer puede tardar; margen amplio.
    protocolTimeout: Number(config.webOrder?.protocolTimeoutMs) || 90000
  });
}

function findEdgeExe() {
  const bases = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LocalAppData];
  for (const base of bases) {
    if (!base) continue;
    const exe = path.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe');
    if (fs.existsSync(exe)) return exe;
  }
  return null;
}

// Lanza el Edge de automatización igual que launch-edge-debug.cmd: perfil
// dedicado (la bandera del puerto solo funciona en una instancia NUEVA) y
// banderas anti-sueño de pestañas. Devuelve false si Edge no aparece.
export function launchDebugEdge(config, logger) {
  if (process.platform !== 'win32') return false;
  const exe = findEdgeExe();
  if (!exe) {
    logger?.warn('edge auto-launch: msedge.exe not found');
    return false;
  }
  const debugUrl = config.webOrder?.debugUrl || 'http://127.0.0.1:9222';
  const port = Number(new URL(debugUrl).port) || 9222;
  const perfil = config.webOrder?.edgeProfileDir
    || path.join(process.env.USERPROFILE || '.', 'edge-unide-automation');
  const url = config.webOrder?.pedidoListUrl || EDGE_URL_DEFECTO;
  try {
    const child = spawn(exe, [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${perfil}`,
      '--disable-features=msSleepingTabs,SleepingTabs',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      url
    ], { detached: true, stdio: 'ignore' });
    child.unref();
    logger?.info('edge auto-launched', { port, perfil });
    return true;
  } catch (error) {
    logger?.warn('edge auto-launch failed', { error: error.message });
    return false;
  }
}

async function waitForCdp(debugUrl, timeoutMs) {
  const limite = Date.now() + timeoutMs;
  while (Date.now() < limite) {
    try {
      const r = await fetch(`${debugUrl.replace(/\/+$/, '')}/json/version`);
      if (r.ok) return true;
    } catch { /* aún arrancando */ }
    await new Promise((r) => setTimeout(r, 600));
  }
  return false;
}

// Tras abrir Edge nosotros, la pestaña de UnideGes tarda unos segundos en
// cargar; esperar a verla evita un "no encuentro la página" inmediato.
async function waitForUnidePage(browser, config, timeoutMs) {
  const limite = Date.now() + timeoutMs;
  while (Date.now() < limite) {
    if (await findOrderPage(browser, config)) return;
    await new Promise((r) => setTimeout(r, 700));
  }
}

// Conecta al Edge de depuración; si no está abierto, lo abre él solo y
// reintenta. Lanza un error legible (para Telegram) si aun así no hay
// manera — p. ej. Edge no instalado o la sesión de UnideGes caducada se
// detectan más adelante, cada una con su propio mensaje.
export async function connectBrowser(config, logger) {
  const debugUrl = config.webOrder?.debugUrl || 'http://127.0.0.1:9222';
  let firstError;
  try {
    return await tryConnect(config, debugUrl);
  } catch (error) {
    firstError = error;
  }
  const autoLaunch = config.webOrder?.autoLaunchEdge !== false;
  const lanzado = autoLaunch && launchDebugEdge(config, logger);
  if (lanzado) {
    const listo = await waitForCdp(debugUrl, Number(config.webOrder?.edgeLaunchWaitMs) || 25000);
    if (listo) {
      try {
        const browser = await tryConnect(config, debugUrl);
        await waitForUnidePage(browser, config, 15000);
        logger?.info('edge auto-launch: connected');
        return browser;
      } catch (error) {
        firstError = error;
      }
    }
  }
  const hint = [
    `无法连接到 Edge 调试端口（${debugUrl}）。`,
    lanzado ? '已经尝试自动打开自动化 Edge，但还是连不上。' : '',
    '请双击 desktop\\launch-edge-debug.cmd 打开“自动化专用”的 Edge，',
    '并在那个窗口里登录 UnideGes、打开 Pedidos 页面，再重试。',
    `原始错误：${firstError.message}`
  ].filter(Boolean).join('\n');
  const wrapped = new Error(hint);
  wrapped.stage = 'connect';
  throw wrapped;
}

// Localiza la pestaña de UnideGes entre todas las abiertas en ese Edge.
// Empareja por subcadena de URL (config.webOrder.pageUrlIncludes).
export async function findOrderPage(browser, config) {
  const includes = (config.webOrder?.pageUrlIncludes || 'unideges').toLowerCase();
  const pages = await browser.pages();
  const matches = [];
  for (const page of pages) {
    let url = '';
    try { url = page.url(); } catch { /* pestaña cerrándose */ }
    if (url && url.toLowerCase().includes(includes)) matches.push({ page, url });
  }
  // Preferimos una pestaña de Pedidos si hay varias de UnideGes abiertas.
  matches.sort((a, b) => {
    const score = (u) => (/order|pedido/i.test(u) ? 0 : 1);
    return score(a.url) - score(b.url);
  });
  return matches[0]?.page || null;
}
