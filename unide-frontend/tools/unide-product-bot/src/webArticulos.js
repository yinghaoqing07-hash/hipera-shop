import fs from 'node:fs';
import path from 'node:path';
import { connectBrowser, findOrderPage } from './webBrowser.js';
import { setLive } from './liveStatus.js';

// =====================================================================
// Artículos Unide en la web (plan del dueño, 02/08): cuando un artículo
// con problemas NO está en la tabla del proveedor, sus datos se buscan
// directamente en la web de UnideGes (Consultas → Artículos Unide) y se
// copian para crear la ficha TIENDA en el escritorio. SOLO LECTURA aquí:
// este módulo navega, busca por EAN/código y raspa la ficha; escribir en
// Artículos lo hace el flujo de reparación de siempre, con confirmación.
// Lecciones aplicadas de webMensajeria: esperar a que el grid Blazor
// pinte filas de verdad, teclear y clicar con eventos REALES (los
// sintéticos ni marcan ni encuentran), y ante cualquier fallo volcar el
// HTML para calibrar con datos reales.
// =====================================================================

const LISTA_CANDIDATOS = [
  '/Article_ListView',
  '/ArticleUnide_ListView',
  '/Articulos_ListView',
  '/Articulo_ListView'
];

// Etiquetas EXACTAS de la ficha (captura del dueño, 02/08) → clave. El
// orden y la igualdad exacta importan: 'PVD' no debe tragarse 'PVD
// Promoción' ni 'PVP 1' a 'PVP 1x'. Se compara sin el ':' final.
const CAMPOS = [
  ['Código Central', 'codigoCentral'],
  ['Código Unide', 'codigoUnide'],
  ['Descripción', 'descripcion'],
  ['PVP 1', 'pvp1'],
  ['PVP 2', 'pvp2'],
  ['PVP 3', 'pvp3'],
  ['PVD Promoción', 'pvdPromocion'],
  ['PVD', 'pvd'],
  ['Último Coste', 'ultimoCoste'],
  ['Impuesto (%)', 'impuesto'],
  ['EAN Principal', 'eanPrincipal'],
  ['EANS', 'eans']
];

// --- parte pura (testeable sin navegador) -------------------------------

export function numeroWeb(valor) {
  const n = Number.parseFloat(String(valor ?? '').replace(/[€\s]/g, '').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}

// Resume los datos raspados en lo que necesita la reparación y VERIFICA
// que el artículo abierto es el consultado (EAN o código coinciden).
// El coste sigue la misma regla que la tabla del proveedor: PVD Promoción
// si es > 0, si no el PVD normal.
export function resumenArticuloWeb(datos, consulta = {}) {
  const d = datos || {};
  const eanBuscado = String(consulta.ean || '').replace(/\D/g, '');
  const codigoBuscado = String(consulta.codigo || '').replace(/\D/g, '');
  const eanFicha = String(d.eanPrincipal || '').replace(/\D/g, '');
  const eansFicha = String(d.eans || '').replace(/[^\d,;\s]/g, '');
  const codigoFicha = String(d.codigoUnide || '').replace(/\D/g, '');
  const coincideEan = Boolean(eanBuscado) && (eanFicha === eanBuscado || eansFicha.includes(eanBuscado));
  const coincideCodigo = Boolean(codigoBuscado) && codigoFicha === codigoBuscado;
  if (!coincideEan && !coincideCodigo) {
    return { ok: false, error: `网页上打开的商品对不上：ficha EAN=${eanFicha || '-'} código=${codigoFicha || '-'}，查的是 ${eanBuscado || codigoBuscado}` };
  }
  const promocion = numeroWeb(d.pvdPromocion);
  const pvdNormal = numeroWeb(d.pvd);
  const pvd = promocion > 0 ? promocion : pvdNormal;
  const pvp2 = numeroWeb(d.pvp2);
  const impuesto = numeroWeb(d.impuesto);
  if (!(pvd > 0)) return { ok: false, error: `网页上这件的 PVD 也是空的（PVD=${d.pvd || '-'}, promoción=${d.pvdPromocion || '-'}），没法定成本` };
  if (!(pvp2 > 0)) return { ok: false, error: `网页上这件没有 PVP 2（=${d.pvp2 || '-'}），没法定售价` };
  if (!codigoFicha) return { ok: false, error: '网页上读不到 Código Unide' };
  return {
    ok: true,
    codigo: codigoFicha,
    descripcion: String(d.descripcion || '').trim(),
    pvd,
    pvdOrigen: promocion > 0 ? 'PVD Promoción' : 'PVD',
    pvp2,
    impuesto: Number.isFinite(impuesto) && impuesto > 0 ? impuesto : null,
    ean: eanFicha
  };
}

// --- navegación y raspado ------------------------------------------------

export async function fetchArticuloWeb(config, logger, consulta = {}) {
  const buscar = String(consulta.ean || consulta.codigo || '').trim();
  if (!buscar) return { ok: false, stage: 'input', error: '没有可查询的 EAN 或 código' };
  let browser;
  try {
    setLive('[articulo-web] 连接 Edge，打开 Artículos Unide…');
    browser = await connectBrowser(config);
    const page = await findOrderPage(browser, config);
    if (!page) {
      const err = new Error('连上了 Edge，但没找到 UnideGes 的标签页。');
      err.stage = 'findPage';
      throw err;
    }
    try { await page.bringToFront(); } catch { /* noop */ }

    if (!(await irAListaArticulos(page, config))) {
      const dumpFile = await dumpHtml(page, config, 'articulo-web-dump.html');
      return { ok: false, stage: 'nav', error: '没找到 Artículos Unide 列表页（左侧菜单和常见 URL 都试过了）。', dumpFile, screenshot: await shot(page, config, 'nav') };
    }

    setLive(`[articulo-web] 搜 ${buscar}…`);
    const abierto = await buscarYAbrir(page, config, buscar);
    if (!abierto.ok) {
      const dumpFile = await dumpHtml(page, config, 'articulo-web-dump.html');
      return { ok: false, stage: 'buscar', error: abierto.error, dumpFile, screenshot: await shot(page, config, 'buscar') };
    }

    setLive('[articulo-web] 读取商品资料…');
    const datos = await rasparDetalle(page);
    const campos = Object.values(datos).filter((v) => String(v || '').trim()).length;
    if (campos < 3) {
      const dumpFile = await dumpHtml(page, config, 'articulo-web-dump.html');
      return { ok: false, stage: 'raspar', error: `打开了页面但字段没读出来（只有 ${campos} 个有值）。`, dumpFile, screenshot: await shot(page, config, 'raspar') };
    }
    logger?.info('articulo web raspado', { buscar, codigoUnide: datos.codigoUnide, pvd: datos.pvd, pvp2: datos.pvp2 });
    setLive('[articulo-web] listo');
    return { ok: true, datos, url: page.url(), screenshot: await shot(page, config, 'ficha') };
  } catch (error) {
    setLive('[articulo-web] ERROR: ' + error.message);
    logger?.error('articulo web failed', { stage: error.stage, error: error.message });
    return { ok: false, stage: error.stage || 'articuloWeb', error: error.message };
  } finally {
    try { browser?.disconnect(); } catch { /* noop */ }
  }
}

async function irAListaArticulos(page, config) {
  const timeout = Number(config.webOrder?.pageNavigationTimeoutMs) || 20000;
  if (await esListaArticulos(page)) return true;
  const clicado = await page.evaluate(() => {
    const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const isVisible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const candidatos = Array.from(document.querySelectorAll('a, button, [role="treeitem"], .xaf-nav-link, .dxbl-treeview-node'))
      .filter(isVisible)
      .map((el) => ({ el, texto: clean(el.innerText || el.textContent) }))
      .filter((x) => /art.culos\s+unide/i.test(x.texto));
    const objetivo = candidatos[0]?.el;
    if (!objetivo) return false;
    (objetivo.closest('a, button, [role="treeitem"]') || objetivo).click();
    return true;
  });
  if (clicado && (await esperarListaArticulos(page, timeout))) return true;
  for (const candidato of LISTA_CANDIDATOS) {
    await gotoUrl(page, absoluteUrl(page, candidato), timeout);
    if (await esperarListaArticulos(page, 8000)) return true;
  }
  return false;
}

async function esListaArticulos(page) {
  try {
    return await page.evaluate(() => {
      const url = location.href || '';
      const texto = (document.body?.innerText || '').slice(0, 3000);
      const esArticulos = /Article_ListView/i.test(url) || /Art.culos\s+Unide/i.test(texto);
      const hayTabla = document.querySelectorAll('table, [role="grid"]').length > 0;
      return esArticulos && hayTabla;
    });
  } catch { return false; }
}

async function esperarListaArticulos(page, timeoutMs) {
  const inicio = Date.now();
  while (Date.now() - inicio < timeoutMs) {
    if (await esListaArticulos(page)) return true;
    await sleep(300);
  }
  return false;
}

// Teclear la consulta en el buscador de la lista y abrir la fila que la
// contiene. Eventos REALES (keyboard/mouse): la lección de las casillas
// de la mensajería — lo sintético no dispara los manejadores de Blazor.
async function buscarYAbrir(page, config, consulta) {
  const punto = await page.evaluate(() => {
    const isVisible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const inputs = Array.from(document.querySelectorAll('input[type="text"], input[type="search"], input:not([type])')).filter(isVisible);
    const etiqueta = (i) => `${i.placeholder || ''} ${i.getAttribute('aria-label') || ''} ${String(i.className || '')}`;
    const buscador = inputs.find((i) => /buscar|search|filtrar/i.test(etiqueta(i))) || inputs[0] || null;
    if (!buscador) return null;
    buscador.scrollIntoView({ block: 'center' });
    const r = buscador.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (!punto) return { ok: false, error: '列表页上没找到搜索框' };
  await page.mouse.click(punto.x, punto.y);
  await sleep(300);
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.keyboard.type(String(consulta), { delay: 35 });
  await page.keyboard.press('Enter');

  // Esperar a que el grid enseñe una fila CON la consulta (el filtrado es
  // un viaje al servidor; el tope generoso es barato).
  const tope = Date.now() + 20000;
  let fila = null;
  while (Date.now() < tope) {
    await sleep(500);
    fila = await page.evaluate((q) => {
      const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
      const isVisible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const filas = Array.from(document.querySelectorAll('tr[role="row"], tbody tr')).filter(isVisible);
      const objetivo = filas.find((tr) => clean(tr.innerText).includes(q));
      if (!objetivo) return null;
      objetivo.scrollIntoView({ block: 'center' });
      const r = objetivo.getBoundingClientRect();
      return { x: r.x + Math.min(r.width / 2, 200), y: r.y + r.height / 2 };
    }, String(consulta));
    if (fila) break;
  }
  if (!fila) return { ok: false, error: `搜了 ${consulta}，列表里没出现包含它的行` };

  // Clic de ratón real en la fila (cursor-pointer → abre la ficha).
  await page.mouse.click(fila.x, fila.y);
  const topeDetalle = Date.now() + 15000;
  while (Date.now() < topeDetalle) {
    await sleep(400);
    const esDetalle = await page.evaluate(() => {
      const url = location.href || '';
      const texto = (document.body?.innerText || '').slice(0, 4000);
      return /_DetailView/i.test(url) || (/C.digo\s+Unide/i.test(texto) && /PVD/i.test(texto));
    }).catch(() => false);
    if (esDetalle) return { ok: true };
  }
  return { ok: false, error: '点了行但商品详情页没打开（15 秒）' };
}

// Raspar la ficha por ETIQUETAS: para cada etiqueta exacta, el input más
// cercano dentro del mismo contenedor de campo. Igualdad exacta tras
// quitar el ':' final, y prioridad por orden de CAMPOS (PVD Promoción
// antes que PVD).
async function rasparDetalle(page) {
  return page.evaluate((campos) => {
    const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const out = {};
    const etiquetas = Array.from(document.querySelectorAll('label, span, div'))
      .map((el) => ({ el, texto: clean(el.childElementCount === 0 ? (el.innerText || el.textContent) : '') }))
      .filter((x) => x.texto && x.texto.length < 40);
    for (const [etiqueta, clave] of campos) {
      if (out[clave]) continue;
      const objetivo = etiquetas.find((x) => x.texto === etiqueta || x.texto === etiqueta + ':' || x.texto === etiqueta + ' :');
      if (!objetivo) continue;
      let nodo = objetivo.el;
      for (let salto = 0; salto < 4 && nodo; salto += 1) {
        nodo = nodo.parentElement;
        if (!nodo) break;
        const input = nodo.querySelector('input, textarea');
        if (input && input.value !== undefined) { out[clave] = String(input.value); break; }
      }
    }
    return out;
  }, CAMPOS);
}

async function gotoUrl(page, url, timeout) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout }).catch(async () => {
    await page.goto(url, { waitUntil: 'load', timeout }).catch(() => { /* la espera decide */ });
  });
}

function absoluteUrl(page, valor) {
  const raw = String(valor || '').trim();
  if (/^https?:\/\//i.test(raw)) return raw;
  try { return new URL(raw, page.url()).href; } catch { return `https://unideges30.unide.es${raw.startsWith('/') ? raw : `/${raw}`}`; }
}

async function shot(page, config, tag) {
  try {
    const dir = path.resolve(config.__toolRoot || '.', 'screenshots');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `articulo-web-${String(tag).replace(/[^\w.-]+/g, '_')}-${Date.now()}.png`);
    await page.screenshot({ path: file });
    return file;
  } catch { return null; }
}

async function dumpHtml(page, config, name) {
  try {
    const html = await page.content();
    const file = path.resolve(config.__toolRoot || '.', name);
    fs.writeFileSync(file, html, 'utf8');
    return file;
  } catch { return null; }
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
