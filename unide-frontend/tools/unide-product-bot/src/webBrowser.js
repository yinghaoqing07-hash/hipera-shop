// =====================================================================
// Conexión al Edge de la tienda vía CDP (Chrome DevTools Protocol)
// =====================================================================
// Pedidos es una página web de UnideGes (DevExpress XAF), no la app de
// escritorio. En lugar de clics por coordenadas (frágil), conducimos el
// DOM directamente con puppeteer-core conectándonos a un Edge que se
// lanzó con --remote-debugging-port (ver desktop/launch-edge-debug.cmd).
//
// No se descarga ningún navegador: puppeteer-core se ADJUNTA al Edge que
// ya está abierto y con la sesión de UnideGes iniciada.
import puppeteer from 'puppeteer-core';

// Conecta al Edge de depuración. Lanza un error legible (para Telegram)
// si el puerto no responde: casi siempre significa que no se abrió el
// Edge con launch-edge-debug.cmd.
export async function connectBrowser(config) {
  const debugUrl = config.webOrder?.debugUrl || 'http://127.0.0.1:9222';
  try {
    const browser = await puppeteer.connect({
      browserURL: debugUrl,
      defaultViewport: null,
      protocolTimeout: 60000
    });
    return browser;
  } catch (error) {
    const hint = [
      `无法连接到 Edge 调试端口（${debugUrl}）。`,
      '请先双击 desktop\\launch-edge-debug.cmd 打开“自动化专用”的 Edge，',
      '并在那个窗口里登录 UnideGes、打开 Pedidos 页面，再重试。',
      `原始错误：${error.message}`
    ].join('\n');
    const wrapped = new Error(hint);
    wrapped.stage = 'connect';
    throw wrapped;
  }
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
