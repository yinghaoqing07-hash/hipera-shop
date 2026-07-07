import fs from 'node:fs';
import path from 'node:path';
import { connectBrowser, findOrderPage } from './webBrowser.js';

const DEFAULT_CANDIDATE_PATHS = [
  '/Promocion_ListView',
  '/Promociones_ListView',
  '/Promotion_ListView',
  '/PromocionT_ListView',
  '/PromotionT_ListView',
  '/Promo_ListView'
];

export async function fetchActivePromotions(config, referenceDateIso, logger) {
  let browser;
  const startedAt = Date.now();
  try {
    const opened = await openPromotionsPage(config);
    browser = opened.browser;
    const page = opened.page;
    const refIso = normalizeIsoDate(referenceDateIso) || todayIso(config);
    const listUrl = page.url();

    const pageInfo = await getPromotionPageState(page);
    const rows = await scrapeAllPromotionRows(page, config);
    // Volcado de la lista (por si el nº leído no cuadra con lo que se ve en
    // pantalla: paginación externa que no avanzó, grid virtualizado, etc.).
    const listDumpFile = await dumpHtml(page, config, 'promociones-lista-dump.html');
    if (!rows.length) {
      const screenshotPath = await screenshot(page, config, 'empty');
      const dumpFile = await dumpHtml(page, config, 'promociones-page-dump.html');
      return {
        ok: false,
        stage: 'scrape',
        error: 'Promociones 页面打开了，但没有识别到列表表格。已保存页面结构，方便继续调选择器。',
        screenshot: screenshotPath,
        dumpFile,
        pageInfo
      };
    }

    const enriched = rows.map((row, index) => enrichPromotionRow(row, index, refIso));
    const active = enriched.filter((row) => row.active);
    // Orden en que aparecen en la lista (página 1, luego 2, …). Los detalles
    // se abren EN ESTE ORDEN para que el grid recorra las páginas de forma
    // monótona (1→2→…) en vez de saltar 1↔2 en cada promoción. El orden por
    // fecha (comparePromotions) se reserva para el CSV y el resumen.
    const activeInListOrder = active.slice();
    active.sort(comparePromotions);

    const details = await scrapeActivePromotionDetails(page, config, activeInListOrder, listUrl, logger);
    const outputFile = writePromotionItemsCsv(config, details.items, active, refIso);
    const screenshotPath = await screenshot(page, config, 'items');
    // Si no salió ningún artículo, adjuntar un par de volcados de detalle
    // para poder afinar los selectores del grid de artículos.
    const detailDumpFiles = details.failures.map((f) => f.dumpFile).filter(Boolean).slice(0, 2);

    logger?.info('promotions fetched', {
      total: rows.length,
      active: active.length,
      items: details.items.length,
      failedDetails: details.failures.length,
      referenceDate: refIso,
      url: pageInfo.url
    });

    return {
      ok: true,
      referenceDate: refIso,
      totalRows: rows.length,
      active,
      items: details.items,
      failedDetails: details.failures,
      expired: enriched.length - active.length,
      unknownEndDate: enriched.filter((row) => !row.endIso).length,
      outputFile,
      detailDumpFiles,
      listDumpFile,
      // Señal de posible lista incompleta: total = múltiplo exacto del
      // tamaño de página (25) Y todo activo → huele a páginas sin leer.
      // (Antes bastaba "todo activo", pero hay semanas en que TODAS las
      // promociones están vigentes de verdad y el aviso era ruido.)
      listMaybeTruncated: rows.length > 0 && active.length === rows.length && rows.length % 25 === 0,
      elapsedMs: Date.now() - startedAt,
      detailStats: details.stats || null,
      screenshot: screenshotPath,
      pageInfo
    };
  } catch (error) {
    logger?.error('promotions fetch failed', { stage: error.stage, error: error.message });
    return { ok: false, stage: error.stage || 'promotions', error: error.message };
  } finally {
    try { browser?.disconnect(); } catch { /* noop */ }
  }
}

export function formatPromotionsSummary(result, config) {
  // Resumen CORTO: cuántas promociones y cuántas con detalle; el desglose
  // completo (todos los artículos) va en el CSV, no en el chat.
  const items = result.items || [];
  const withDetail = new Set(items.map((it) => it.promoCode)).size;
  const failed = result.failedDetails?.length || 0;
  const lines = [
    `Promociones（按 ${result.referenceDate} 判断）`,
    `· 外层读到：${result.totalRows} 个`,
    `· 未过期：${result.active.length} 个`,
    `· 已开详情页：${withDetail} 个${failed ? `（${failed} 个没抓完整）` : ''}`,
    `· 商品明细：${items.length} 行（完整在 CSV）`
  ];
  // Tiempos: total y cómo se llegó a cada detalle (flecha "registro
  // siguiente" = rápido; vía lista = dos navegaciones). Sirve para saber
  // dónde se va el tiempo sin tener que cronometrar a mano.
  if (result.elapsedMs) {
    const totalSec = Math.round(result.elapsedMs / 1000);
    const mm = Math.floor(totalSec / 60);
    const ss = totalSec % 60;
    const per = withDetail ? ` · 平均每张 ${(totalSec / withDetail).toFixed(1)} 秒` : '';
    const st = result.detailStats;
    const via = st ? `（直达 ${st.chained} 张 / 走列表 ${st.viaList} 张）` : '';
    lines.push(`· 用时：${mm ? `${mm} 分 ` : ''}${ss} 秒${per}${via}`);
  }
  if (result.unknownEndDate) lines.push(`· ${result.unknownEndDate} 个没识别到结束日期，已按未过期保留`);

  // Una línea por promoción no caducada: código · nombre — N 商品.
  if (result.active.length) {
    const countByPromo = items.reduce((acc, it) => { acc[it.promoCode] = (acc[it.promoCode] || 0) + 1; return acc; }, {});
    lines.push('');
    for (const p of result.active) {
      const n = countByPromo[p.code] || 0;
      const name = p.description ? ` ${p.description}` : '';
      lines.push(`[${p.code}]${name} — ${n} 商品`);
    }
  } else {
    lines.push('', '没有找到还没过期的 promociones。');
  }

  if (failed) {
    lines.push('', '没抓完整的：');
    for (const f of result.failedDetails.slice(0, 5)) {
      lines.push(`- ${f.promo?.code || ''} ${f.promo?.description || ''}: ${f.error || f.stage || '未知'}`);
    }
    if (failed > 5) lines.push(`- ... 还有 ${failed - 5} 个`);
  }

  return lines.join('\n');
}

async function openPromotionsPage(config) {
  const attempts = Number(config.webOrder?.connectRetries) || 2;
  let browser = null;
  let page = null;
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      browser = await connectBrowser(config);
      page = await findOrderPage(browser, config);
      if (page) break;
      try { browser.disconnect(); } catch { /* noop */ }
      browser = null;
      const err = new Error('连上了 Edge，但没找到 UnideGes 的标签页。请确认自动化 Edge 里打开了 UnideGes。');
      err.stage = 'findPage';
      lastError = err;
    } catch (error) {
      lastError = error;
      try { browser?.disconnect(); } catch { /* noop */ }
      browser = null;
      page = null;
    }
    if (attempt < attempts) await sleep(2000);
  }
  if (!page) throw lastError || Object.assign(new Error('无法连接 Edge。'), { stage: 'connect' });
  try { await page.bringToFront(); } catch { /* noop */ }
  try {
    await ensurePromotionsPage(page, config, { forceFresh: true });
  } catch (error) {
    try { browser.disconnect(); } catch { /* noop */ }
    throw error;
  }
  return { browser, page };
}

async function ensurePromotionsPage(page, config, options = {}) {
  const timeout = Number(config.webOrder?.pageNavigationTimeoutMs) || 20000;
  let state = await getPromotionPageState(page);
  if (state.isPromotionsList && !options.forceFresh) return state;

  if (state.hasEditToolbar && !options.allowLeavingDetail) {
    const err = new Error(`当前页面像编辑表单（有 Guardar/Volver），为避免丢失未保存内容，不会自动跳转。请先保存或退出当前页面，再发 /promociones。当前：caption=${state.caption || '-'}, url=${state.url || '-'}`);
    err.stage = 'unsafePage';
    throw err;
  }

  const configured = config.promotions?.listUrl || config.webOrder?.promocionesListUrl || '';
  if (configured) {
    await gotoListUrl(page, absoluteListUrl(page, configured), timeout);
    state = await waitForPromotionsPage(page, timeout);
    if (state.isPromotionsList) return state;
  }

  if (!state.hasEditToolbar && !options.forceFresh && await clickPromotionsNav(page)) {
    state = await waitForPromotionsPage(page, timeout);
    if (state.isPromotionsList) return state;
  }

  const candidates = config.promotions?.candidatePaths?.length ? config.promotions.candidatePaths : DEFAULT_CANDIDATE_PATHS;
  for (const candidate of candidates) {
    await gotoListUrl(page, absoluteListUrl(page, candidate), timeout);
    state = await waitForPromotionsPage(page, Math.min(timeout, 8000));
    if (state.isPromotionsList) return state;
  }

  const err = new Error(`没有找到 Promociones 页面。已尝试左侧菜单和常见 URL。当前：caption=${state.caption || '-'}, url=${state.url || '-'}`);
  err.stage = 'promotionsPage';
  throw err;
}

async function gotoListUrl(page, url, timeout) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout }).catch(async () => {
    await page.goto(url, { waitUntil: 'load', timeout });
  });
}

function absoluteListUrl(page, value) {
  const raw = String(value || '').trim();
  if (/^https?:\/\//i.test(raw)) return raw;
  try { return new URL(raw || '/Promocion_ListView', page.url()).href; }
  catch { return `https://unideges30.unide.es${raw.startsWith('/') ? raw : `/${raw}`}`; }
}

async function clickPromotionsNav(page) {
  return page.evaluate(() => {
    const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const isVisible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const candidates = Array.from(document.querySelectorAll('a, button, [role="treeitem"], .xaf-nav-link, .dxbl-treeview-node'))
      .filter(isVisible)
      .map((el) => ({ el, text: clean(el.innerText || el.textContent) }))
      .filter((x) => /^promociones?$/i.test(x.text) || /\bpromociones?\b/i.test(x.text));
    const target = candidates[0]?.el;
    if (!target) return false;
    const clickable = target.closest('a, button, [role="treeitem"]') || target;
    clickable.click();
    return true;
  });
}

async function waitForPromotionsPage(page, timeoutMs) {
  const start = Date.now();
  let last = {};
  while (Date.now() - start < timeoutMs) {
    try {
      last = await getPromotionPageState(page);
      if (last.isPromotionsList) return last;
    } catch { /* page navigating */ }
    await sleep(250);
  }
  return last;
}

async function getPromotionPageState(page) {
  return page.evaluate(() => {
    const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const isVisible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const visible = (sel) => Array.from(document.querySelectorAll(sel)).filter(isVisible);
    const hasAction = (name) => visible(`[data-action-name="${name}"]`).length > 0;
    const caption = clean(visible('.xaf-view-caption-sm')[0]?.innerText);
    const title = document.title || '';
    const url = location.href || '';
    const bodyText = clean(document.body?.innerText || '');
    const active = visible('.xaf-nav-item.dxbl-active, a.dxbl-active, a[aria-current="true"]')[0];
    const activeNav = clean(active?.innerText || '');
    const hasPromoText = /promociones?|promoci[oó]n|promotion/i.test(`${caption} ${title} ${url} ${activeNav}`);
    const hasDateColumns = /hasta|fecha|fin|final|desde|inicio/i.test(bodyText);
    const hasTables = document.querySelectorAll('table, [role="grid"]').length > 0;
    const hasEditToolbar = hasAction('Guardar') || hasAction('Guardar y Nuevo') || hasAction('Volver');
    return {
      title,
      url,
      caption,
      activeNav,
      hasTables,
      hasDateColumns,
      hasEditToolbar,
      isPromotionsList: hasPromoText && hasTables && !hasEditToolbar && hasDateColumns
    };
  });
}

async function getPromotionDetailState(page) {
  return page.evaluate(() => {
    const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const isVisible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const visible = (sel) => Array.from(document.querySelectorAll(sel)).filter(isVisible);
    const hasAction = (name) => visible(`[data-action-name="${name}"]`).length > 0;
    const caption = clean(visible('.xaf-view-caption-sm')[0]?.innerText);
    const title = document.title || '';
    const url = location.href || '';
    const bodyText = clean(document.body?.innerText || '');
    const hasToolbar = hasAction('Volver') || hasAction('Guardar') || hasAction('Guardar y Nuevo');
    const hasItemWords = /art[ií]culo|c[oó]digo\s+art|ean|pvp|precio|oferta/i.test(bodyText);
    const hasPromoText = /promociones?|promoci[oó]n|promotion/i.test(`${caption} ${title} ${url} ${bodyText.slice(0, 500)}`);
    return {
      title,
      url,
      caption,
      hasToolbar,
      hasItemWords,
      isPromotionDetail: hasPromoText && hasToolbar && hasItemWords
    };
  });
}

async function scrapeAllPromotionRows(page, config) {
  const maxPages = Number(config.promotions?.maxPages) || 50;
  const settleTimeout = Number(config.promotions?.pageTurnTimeoutMs) || Number(config.promotions?.detailRowsTimeoutMs) || 9000;
  // El grid puede haberse quedado en una página posterior (p. ej. la 2ª):
  // rebobinar a la 1ª antes de leer para no saltarse filas.
  await goToFirstPromotionListPage(page, config);
  const all = [];
  const seen = new Set();
  let prevSig = '';

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    // Tras pasar de página, NO se re-lee "en cuanto haya filas" (la página
    // vieja sigue visible un instante y se colaría), sino en cuanto el
    // contenido CAMBIA respecto a la página anterior. Así la paginación es
    // estable entre ejecuciones (antes se perdían filas según el azar del
    // tiempo de render).
    const rows = pageIndex === 0
      ? await scrapePromotionRows(page)
      : await waitForGridPageChange(page, () => scrapePromotionRows(page), rowsSignature, prevSig, settleTimeout);
    const sig = rowsSignature(rows);
    if (pageIndex > 0 && (!rows.length || sig === prevSig)) break;
    prevSig = sig;
    for (const row of rows) {
      const key = promotionKey(row);
      if (!seen.has(key)) {
        seen.add(key);
        // Se anota en qué página de la lista está la fila: al abrir su
        // detalle se salta DIRECTAMENTE a esa página (un clic) en vez de
        // escanear página a página.
        all.push({ ...row, listPage: pageIndex + 1 });
      }
    }
    const moved = await clickNextPromotionPage(page);
    if (!moved) break;
  }

  return all;
}

// Firma del contenido de una página del grid (para detectar el cambio de
// página): concatena las celdas de todas las filas.
function rowsSignature(rows) {
  return (rows || []).map((r) => (r.cells || Object.values(r.fields || {})).join('|')).join('||');
}

// Tras pulsar "siguiente", sondea hasta que la firma del grid CAMBIA (o se
// agota el tiempo). Devuelve las filas de la nueva página; si no cambia,
// devuelve lo último leído (el llamador corta al ver misma firma).
async function waitForGridPageChange(page, scrapeFn, sigFn, prevSig, timeoutMs) {
  const start = Date.now();
  let best = [];
  while (Date.now() - start < timeoutMs) {
    try {
      const rows = await scrapeFn();
      if (rows.length) {
        best = rows;
        if (sigFn(rows) !== prevSig) return rows;
      }
      await page.evaluate(() => { window.scrollTo(0, document.body.scrollHeight); }).catch(() => {});
    } catch { /* render en curso */ }
    await sleep(200);
  }
  return best;
}

async function scrapeActivePromotionDetails(page, config, promotions, listUrl, logger) {
  const maxDetails = Number(config.promotions?.maxDetailPromotions) || 500;
  const timeout = Number(config.webOrder?.pageNavigationTimeoutMs) || 20000;
  const items = [];
  const failures = [];
  // Cuántos detalles se alcanzaron encadenando (flecha "registro siguiente")
  // y cuántos por el camino clásico vía lista: sale en el resumen para poder
  // diagnosticar la lentitud con datos y no a ojo.
  const stats = { chained: 0, viaList: 0 };

  // scrapeAllPromotionRows dejó la lista en su ÚLTIMA página. Se rebobina a la
  // 1ª UNA sola vez; a partir de aquí las promociones se abren en el mismo
  // orden en que se leyeron (página 1, luego 2, …).
  {
    const st = await getPromotionPageState(page);
    if (!st.isPromotionsList) {
      await gotoListUrl(page, listUrl, timeout);
      await waitForPromotionsPage(page, timeout);
    }
    await goToFirstPromotionListPage(page, config);
  }

  // Cada promoción costaba DOS navegaciones Blazor completas: detalle →
  // (Volver) → lista → (clic en la fila) → detalle siguiente. En el PC de la
  // tienda cada navegación son varios segundos, así que entre promoción y
  // promoción se "quedaba parado" aunque no hubiera ninguna espera nuestra.
  // Ahora, estando ya en un detalle, se pulsa la flecha "registro siguiente"
  // de la barra del detalle y se pasa DIRECTO al siguiente (una navegación,
  // sin tocar la lista). Se verifica que el detalle alcanzado es la promoción
  // esperada; si no lo es (o la flecha no existe), se vuelve al camino
  // clásico por la lista para esa promoción. Es de solo lectura: la flecha
  // solo navega, jamás guarda.
  let onDetailOfPrevious = false;

  for (const promo of promotions.slice(0, maxDetails)) {
    try {
      let onDetail = false;
      if (onDetailOfPrevious) {
        onDetail = await advanceToNextPromotionDetail(page, promo, config);
        if (onDetail) stats.chained += 1;
      }
      if (!onDetail) {
        // Camino clásico: asegurar la lista (Volver es más ligero que
        // recargar la URL) y abrir la fila.
        const listState = await getPromotionPageState(page);
        if (!listState.isPromotionsList) {
          await returnToPromotionsList(page, config, listUrl);
        }
        onDetail = await openPromotionDetailByRow(page, promo, config);
        if (onDetail) stats.viaList += 1;
      }
      if (!onDetail) {
        onDetailOfPrevious = false;
        failures.push({ promo, stage: 'open', error: '没有在 Promociones 列表里找到/打开这一行' });
        continue;
      }
      await sleep(Number(config.promotions?.detailOpenMs) || 400); // gracia; el scrape que sigue ya sondea las filas
      const detailRows = await scrapeAllPromotionDetailItems(page, promo, config);
      if (!detailRows.length) {
        const dumpFile = await dumpHtml(page, config, `promocion-${safeFilePart(promo.code || promo.index)}-detail-dump.html`);
        failures.push({ promo, stage: 'detail', error: '打开了明细，但没有识别到商品表格', dumpFile });
      } else {
        items.push(...detailRows);
      }
      // Seguimos plantados en el detalle de esta promoción: la siguiente
      // vuelta intentará encadenar desde aquí.
      onDetailOfPrevious = true;
    } catch (error) {
      logger?.error('promotion detail failed', { code: promo.code, error: error.message });
      failures.push({ promo, stage: error.stage || 'detail', error: error.message });
      onDetailOfPrevious = false;
      try { await returnToPromotionsList(page, config, listUrl); } catch { /* keep going */ }
    }
  }

  // Dejar la app en la lista al terminar (una sola vez, no por promoción).
  // Solo si NO estamos ya en ella: returnToPromotionsList desde la lista
  // no encuentra "Volver" y acaba probando goBack/recarga para nada.
  try {
    const st = await getPromotionPageState(page);
    if (!st.isPromotionsList) await returnToPromotionsList(page, config, listUrl);
  } catch { /* noop */ }

  if (promotions.length > maxDetails) {
    failures.push({ promo: { code: '', description: 'detail limit' }, stage: 'limit', error: `超过 maxDetailPromotions=${maxDetails}，后面的 promoción 没逐个打开` });
  }

  return { items, failures, stats };
}

// Estando en el detalle de una promoción, salta al detalle de la SIGUIENTE
// con la flecha "registro siguiente" de la barra del detalle (una única
// navegación Blazor, sin pasar por la lista). Devuelve true solo si el
// detalle alcanzado corresponde a `promo`; en cualquier otro caso deja que
// el llamador use el camino clásico. Solo lectura: nunca guarda nada.
async function advanceToNextPromotionDetail(page, promo, config) {
  const state = await getPromotionDetailState(page).catch(() => ({}));
  if (!state.isPromotionDetail) return false;
  const beforeSig = `${state.caption}·${detailSignature(await scrapePromotionDetailItems(page, promo).catch(() => []))}`;

  if (!(await clickNextRecordArrow(page))) return false;

  const timeoutMs = Math.min(Number(config.webOrder?.pageNavigationTimeoutMs) || 20000, 10000);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const st = await getPromotionDetailState(page);
      if (st.isPromotionDetail) {
        const sig = `${st.caption}·${detailSignature(await scrapePromotionDetailItems(page, promo).catch(() => []))}`;
        if (sig !== beforeSig) {
          // Llegó OTRO detalle: ¿es la promoción esperada?
          return detailMatchesPromotion(page, promo);
        }
      } else {
        // Nos sacó del detalle (fin de registros u otra vista): fallback.
        return false;
      }
    } catch { /* render en curso */ }
    await sleep(250);
  }
  return false;
}

// ¿El detalle en pantalla es la promoción esperada? Se mira el código en la
// cabecera (los códigos son únicos) y, como refuerzo, la descripción en el
// caption o el arranque del cuerpo. Ante la duda devuelve false y se abre
// por la lista: preferimos lento a atribuir artículos a la promoción que no es.
async function detailMatchesPromotion(page, promo) {
  return page.evaluate(({ code, desc }) => {
    const clean = (s) => (s || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    const norm = (s) => clean(s).toLowerCase();
    const body = clean(document.body?.innerText || '');
    const head = body.slice(0, 2000);
    const capEl = document.querySelector('.xaf-view-caption-sm');
    const cap = norm(capEl ? capEl.innerText : '');
    const okCode = code ? head.includes(code) : false;
    const okDesc = desc ? (cap.includes(norm(desc)) || norm(head).includes(norm(desc))) : false;
    return okCode || okDesc;
  }, { code: promo.code || '', desc: promo.description || '' });
}

// Pulsa la flecha "registro siguiente" de la barra de herramientas del
// DETALLE. Exigente a propósito: solo acepta NextObject o un control cuyo
// texto/tooltip diga "siguiente" Y "registro/objeto", nunca botones del
// paginador ni un "Siguiente" suelto. Si no lo encuentra devuelve false y
// el llamador vuelve al camino clásico (degradación segura).
async function clickNextRecordArrow(page) {
  return page.evaluate(() => {
    const isVisible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const isDisabled = (el) => el.disabled || el.getAttribute('aria-disabled') === 'true'
      || /disabled|dx-state-disabled/i.test(String(el.className || ''))
      || !!el.closest('[aria-disabled="true"], .dxbl-disabled');
    const label = (el) => `${el.getAttribute('data-action-name') || ''} ${el.getAttribute('title') || ''} ${el.getAttribute('aria-label') || ''}`;
    const els = Array.from(document.querySelectorAll('[data-action-name], button[title], a[title], [role="button"][title], button[aria-label], a[aria-label]'))
      .filter(isVisible)
      .filter((el) => !el.closest('.dxbl-pager'));
    let best = null;
    let bestScore = 0;
    for (const el of els) {
      const t = label(el);
      if (/p[aá]gina|page/i.test(t)) continue;
      let s = 0;
      if (/nextobject/i.test(t)) s += 100;
      if (/siguiente|next/i.test(t)) s += 40;
      if (/registro|record|objeto|object/i.test(t)) s += 40;
      if (s > bestScore && !isDisabled(el)) { best = el; bestScore = s; }
    }
    if (!best || bestScore < 80) return false;
    best.click();
    return true;
  });
}

async function scrapeAllPromotionDetailItems(page, promo, config) {
  const maxPages = Number(config.promotions?.maxDetailPages) || Number(config.promotions?.maxPages) || 50;
  const settleTimeout = Number(config.promotions?.detailRowsTimeoutMs) || 9000;
  const all = [];
  const seen = new Set();
  let prevSig = '';

  // Rebobinar el grid de DETALLE a la página 1 antes de empezar. Al abrir el
  // detalle el grid puede recordar una página posterior (se veía p. ej. la 2);
  // entonces el bucle arrancaba ahí y NUNCA leía la 1, perdiendo justo 25
  // artículos (una página) en promociones largas — el usuario contó 189 en
  // OFERTA FOLLETO y el bot sacaba 164 (= páginas 2..8). Solo se pulsa si la
  // página activa no es ya la 1, para no meter una espera inútil (~4 s) en las
  // promociones de una sola página.
  try {
    const activePage = await promotionGridActivePage(page);
    if (activePage > 1) {
      const before = detailSignature(await scrapePromotionDetailItems(page, promo).catch(() => []));
      const clicked = await clickGridPageDelta(page, { toPage: 1 });
      if (clicked) {
        await waitForGridPageChange(page, () => scrapePromotionDetailItems(page, promo), detailSignature, before, Math.min(settleTimeout, 4000));
      }
    }
  } catch { /* si falla el rebobinado seguimos: mejor leer desde donde esté que nada */ }

  // La paginación del grid solo pulsa botones DENTRO del <dxbl-pager>
  // (números de página), nunca la flecha "siguiente registro" de la barra,
  // así que ya no puede encadenar otra promoción (antes hacía falta una
  // guardia de URL que, además, cortaba la paginación legítima cuando el
  // grid metía su estado en la URL).
  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    // Primera página: esperar a que aparezcan filas. Siguientes: esperar a
    // que el contenido CAMBIE respecto a la anterior (si no, se releería la
    // página vieja y el dedupe la descartaría → se perdían filas de las
    // promociones con varias páginas, p. ej. 190 → 71).
    const rows = pageIndex === 0
      ? await waitForPromotionDetailRows(page, promo, config)
      : await waitForGridPageChange(page, () => scrapePromotionDetailItems(page, promo), detailSignature, prevSig, settleTimeout);
    const sig = detailSignature(rows);
    if (pageIndex > 0 && (!rows.length || sig === prevSig)) break;
    prevSig = sig;

    for (const row of rows) {
      const key = `${row.promoCode}|${row.articleCode}|${row.ean}|${row.articleName}|${row.offer}|${row.pvp}|${row.endDisplay}`;
      if (!seen.has(key)) {
        seen.add(key);
        all.push(row);
      }
    }

    const moved = await clickNextPromotionDetailPage(page);
    if (!moved) break;
  }

  return all;
}

// Firma de una página del detalle: código de artículo + precios de cada
// fila (identifica la página sin depender del orden de render).
function detailSignature(items) {
  return (items || []).map((i) => `${i.articleCode}·${i.pvp}·${i.offer}`).join(',');
}

async function waitForPromotionDetailRows(page, promo, config, timeoutOverrideMs = null) {
  const timeoutMs = timeoutOverrideMs || Number(config.promotions?.detailRowsTimeoutMs) || 9000;
  const start = Date.now();
  let best = [];
  while (Date.now() - start < timeoutMs) {
    try {
      const rows = await scrapePromotionDetailItems(page, promo);
      if (rows.length) return rows;
      best = rows;
      // Some XAF grids render below the fold or lazy-load after scrolling.
      await page.evaluate(() => { window.scrollTo(0, document.body.scrollHeight); }).catch(() => {});
    } catch { /* page still rendering */ }
    await sleep(350);
  }
  return best;
}
// Qué clic abre el detalle en ESTA instalación (1 = simple, 2 = doble). Se
// aprende con la primera promoción que abra y se prueba PRIMERO en las
// siguientes: si el grid necesita doble clic, solo la primera paga los ~3 s
// del clic simple fallido; el resto abre a la primera.
let learnedDetailClickCount = null;

async function openPromotionDetailByRow(page, promo, config) {
  // Salto DIRECTO a la página de la lista donde se leyó esta fila (un clic
  // al número de página del dxbl-pager), en vez de buscarla escaneando
  // página a página. Si el grid ya está en esa página, no se toca nada.
  if (promo.listPage) {
    const settle = Math.min(Number(config.promotions?.detailRowsTimeoutMs) || 9000, 4000);
    const current = await promotionGridActivePage(page).catch(() => null);
    if (current != null && current !== promo.listPage) {
      const before = rowsSignature(await scrapePromotionRows(page).catch(() => []));
      if (await clickGridPageDelta(page, { toPage: promo.listPage })) {
        await waitForGridPageChange(page, () => scrapePromotionRows(page), rowsSignature, before, settle);
      }
    }
  }
  if (await tryOpenPromotionFromCurrentPage(page, promo, config)) return true;
  // Respaldo raro (la lista retrocedió al volver del detalle, o la fila no
  // casó): rebobinar a la 1ª y recorrer todas las páginas una vez más.
  await goToFirstPromotionListPage(page, config);
  return tryOpenPromotionFromCurrentPage(page, promo, config);
}

async function tryOpenPromotionFromCurrentPage(page, promo, config) {
  const timeout = Number(config.webOrder?.pageNavigationTimeoutMs) || 20000;
  const maxPages = Number(config.promotions?.maxPages) || 50;
  const settle = Math.min(Number(config.promotions?.detailRowsTimeoutMs) || 9000, 4000);
  // Espera corta para el clic aún NO confirmado: si abriera el detalle, lo
  // hace en ~1 s (el sondeo es cada 250 ms); solo si no abre se prueba el
  // otro método con más margen. El método ya aprendido espera hasta 8 s
  // porque sabemos que funciona y solo puede estar tardando en renderizar.
  const unconfirmedWait = Math.min(timeout, Number(config.promotions?.detailOpenTimeoutMs) || 3000);
  const confirmedWait = Math.min(timeout, 8000);
  const rowWaitMs = Number(config.promotions?.rowWaitMs) || 3000;

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    // Esperar a que la fila aparezca en la página ACTUAL antes de decidir
    // pasar de página. Tras volver del detalle el grid tarda un instante en
    // re-renderizar; sin esta espera se daba por "no está" y se pulsaba
    // "siguiente" → saltaba a la 2ª, no la encontraba y acababa barriendo
    // toda la lista (lento y "dando tumbos"). Solo se agota rowWaitMs cuando
    // la fila de verdad no está en esta página.
    const present = await waitForPromotionRowHandle(page, promo, rowWaitMs);
    if (present) {
      const order = learnedDetailClickCount === 2 ? [2, 1] : [1, 2];
      for (const clickCount of order) {
        const handle = await findPromotionRowHandle(page, promo);
        const el = handle.asElement();
        if (!el) { await handle.dispose(); break; }
        await el.click({ clickCount });
        await handle.dispose();

        const wait = clickCount === learnedDetailClickCount ? confirmedWait : unconfirmedWait;
        const opened = await waitForPromotionDetailPage(page, wait);
        if (opened.isPromotionDetail) { learnedDetailClickCount = clickCount; return true; }
        await sleep(300);
      }
      // Si pulsamos y la fila "desapareció" a mitad, lo más probable es que
      // la navegación al detalle esté en curso: última comprobación corta.
      const opened = await waitForPromotionDetailPage(page, 2000);
      if (opened.isPromotionDetail) return true;
    }
    // Pasar de página esperando el CAMBIO real del contenido (vuelve en
    // cuanto cambia), en vez de una pausa fija de 1,2 s.
    const before = rowsSignature(await scrapePromotionRows(page).catch(() => []));
    const moved = await clickNextPromotionPage(page);
    if (!moved) break;
    await waitForGridPageChange(page, () => scrapePromotionRows(page), rowsSignature, before, settle);
  }

  return false;
}

// Sondea findPromotionRowHandle hasta que la fila exista en la página actual
// (o se agote el tiempo). Devuelve true si apareció.
async function waitForPromotionRowHandle(page, promo, timeoutMs) {
  const start = Date.now();
  for (;;) {
    const handle = await findPromotionRowHandle(page, promo);
    const exists = !!handle.asElement();
    await handle.dispose();
    if (exists) return true;
    if (Date.now() - start >= timeoutMs) return false;
    await sleep(200);
  }
}

async function findPromotionRowHandle(page, promo) {
  return page.evaluateHandle((wanted) => {
    const clean = (s) => (s || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    const norm = (s) => clean(s).toLowerCase();
    const isVisible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const code = clean(wanted.code);
    const desc = norm(wanted.description);
    const start = clean(wanted.startDisplay || wanted.startIso);
    const end = clean(wanted.endDisplay || wanted.endIso);
    let best = null;
    let bestScore = 0;

    const rows = Array.from(document.querySelectorAll('tr[role="row"], tbody tr')).filter(isVisible);
    for (const tr of rows) {
      const cells = Array.from(tr.querySelectorAll('td')).filter(isVisible);
      const texts = cells.map((td) => clean(td.innerText || td.textContent));
      if (!texts.some(Boolean)) continue;
      const rowText = clean(texts.join(' '));
      const rowNorm = norm(rowText);
      let score = 0;
      if (code && texts.includes(code)) score += 100;
      else if (code && rowText.includes(code)) score += 60;
      if (desc && rowNorm.includes(desc)) score += 30;
      if (start && rowText.includes(start)) score += 10;
      if (end && rowText.includes(end)) score += 10;
      if (score > bestScore) {
        const exactCell = code ? cells.find((td) => clean(td.innerText || td.textContent) === code) : null;
        const textCell = cells.find((td) => clean(td.innerText || td.textContent) && !td.querySelector('input[type="checkbox"]'));
        const action = tr.querySelector('a[href*="DetailView"], [data-action-name="Edit"], button[title*="Editar" i], button[aria-label*="Editar" i]');
        best = action || exactCell || textCell || tr;
        bestScore = score;
      }
    }
    return bestScore >= 50 ? best : null;
  }, {
    code: promo.code || '',
    description: promo.description || '',
    startDisplay: promo.startDisplay || '',
    startIso: promo.startIso || '',
    endDisplay: promo.endDisplay || '',
    endIso: promo.endIso || ''
  });
}

async function waitForPromotionDetailPage(page, timeoutMs) {
  const start = Date.now();
  let last = {};
  while (Date.now() - start < timeoutMs) {
    try {
      last = await getPromotionDetailState(page);
      if (last.isPromotionDetail) return last;
    } catch { /* navigating */ }
    await sleep(250);
  }
  return last;
}

async function returnToPromotionsList(page, config, listUrl) {
  const timeout = Number(config.webOrder?.pageNavigationTimeoutMs) || 20000;
  if (await clickActionByName(page, 'Volver', 1200)) {
    const state = await waitForPromotionsPage(page, Math.min(timeout, 8000));
    if (state.isPromotionsList) return state;
  }
  try { await page.goBack({ waitUntil: 'domcontentloaded', timeout: Math.min(timeout, 8000) }); } catch { /* noop */ }
  let state = await waitForPromotionsPage(page, Math.min(timeout, 8000));
  if (state.isPromotionsList) return state;
  await gotoListUrl(page, listUrl, timeout);
  state = await waitForPromotionsPage(page, timeout);
  if (state.isPromotionsList) return state;
  return ensurePromotionsPage(page, config, { forceFresh: true, allowLeavingDetail: true });
}

async function clickActionByName(page, actionName, timeoutMs = 0) {
  const start = Date.now();
  for (;;) {
    const handle = await page.evaluateHandle((name) => {
      const isVisible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const els = Array.from(document.querySelectorAll('[data-action-name="' + name + '"]'));
      return els.find((el) => isVisible(el)) || null;
    }, actionName);
    const el = handle.asElement();
    if (el) { await el.click(); await handle.dispose(); return true; }
    await handle.dispose();
    if (Date.now() - start >= timeoutMs) return false;
    await sleep(200);
  }
}

async function clickNextPromotionPage(page) {
  return clickGridPageDelta(page, +1);
}

async function clickNextPromotionDetailPage(page) {
  return clickGridPageDelta(page, +1);
}

// Paginador REAL de DevExpress: <dxbl-pager> con botones numerados cuyo
// aria-label es "Go to page N" y la pagina activa lleva la clase
// dxbl-pager-active-page-btn / aria-current="page". Se opera SOLO sobre esos
// botones (nunca sobre flechas de la barra de XAF, que saltarian a otro
// registro). d = +1 (siguiente) o { toPage: N } para ir a una pagina
// concreta. Devuelve true si pulso una pagina que existe.
async function clickGridPageDelta(page, d) {
  return page.evaluate((delta) => {
    const isVisible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const pageNum = (el) => {
      const aria = el.getAttribute('aria-label') || '';
      const m = aria.match(/(?:page|p[aá]gina)\s+(\d+)/i);
      if (m) return Number(m[1]);
      if (/pager-page-btn/i.test(String(el.className || ''))) {
        const t = (el.textContent || '').trim();
        if (/^\d+$/.test(t)) return Number(t);
      }
      return null;
    };
    const pagers = Array.from(document.querySelectorAll('.dxbl-pager, [class*="pager" i][role="navigation"], nav[class*="pager" i]')).filter(isVisible);
    for (const pager of pagers) {
      const btns = Array.from(pager.querySelectorAll('button, a, [role="button"]')).filter(isVisible)
        .map((el) => ({
          el,
          n: pageNum(el),
          active: el.getAttribute('aria-current') === 'page' || /active-page/i.test(String(el.className || '')),
          disabled: el.disabled || el.getAttribute('aria-disabled') === 'true' || /disabled|dx-state-disabled/i.test(String(el.className || ''))
        }))
        .filter((x) => x.n != null);
      if (!btns.length) continue;
      const activeN = (btns.find((x) => x.active) || {}).n != null
        ? btns.find((x) => x.active).n
        : Math.min.apply(null, btns.map((x) => x.n));
      const targetN = (delta && typeof delta === 'object') ? delta.toPage : activeN + delta;
      const target = btns.find((x) => x.n === targetN && !x.disabled);
      if (target) { target.el.click(); return true; }
      return false;
    }
    return false;
  }, d);
}

// Numero de pagina activa del primer <dxbl-pager> visible (1 si no hay
// paginador). Se usa para decidir si hace falta rebobinar el grid.
async function promotionGridActivePage(page) {
  return page.evaluate(() => {
    const isVisible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const pageNum = (el) => {
      const aria = el.getAttribute('aria-label') || '';
      const m = aria.match(/(?:page|p[aá]gina)\s+(\d+)/i);
      if (m) return Number(m[1]);
      if (/pager-page-btn/i.test(String(el.className || ''))) {
        const t = (el.textContent || '').trim();
        if (/^\d+$/.test(t)) return Number(t);
      }
      return null;
    };
    const pagers = Array.from(document.querySelectorAll('.dxbl-pager, [class*="pager" i][role="navigation"], nav[class*="pager" i]')).filter(isVisible);
    for (const pager of pagers) {
      const btns = Array.from(pager.querySelectorAll('button, a, [role="button"]')).filter(isVisible)
        .map((el) => ({
          n: pageNum(el),
          active: el.getAttribute('aria-current') === 'page' || /active-page/i.test(String(el.className || ''))
        }))
        .filter((x) => x.n != null);
      if (!btns.length) continue;
      const act = btns.find((x) => x.active);
      return act ? act.n : Math.min.apply(null, btns.map((x) => x.n));
    }
    return 1;
  });
}

// Va a la 1a pagina de la lista. El grid recuerda la ultima pagina vista;
// sin rebobinar, al abrir detalles solo se alcanzaban las promociones de la
// pagina en la que quedo. Se pulsa directamente el boton "pagina 1".
async function goToFirstPromotionListPage(page, config) {
  const settle = Math.min(Number(config.promotions?.detailRowsTimeoutMs) || 9000, 4000);
  const before = rowsSignature(await scrapePromotionRows(page).catch(() => []));
  const clicked = await clickGridPageDelta(page, { toPage: 1 });
  if (clicked) await waitForGridPageChange(page, () => scrapePromotionRows(page), rowsSignature, before, settle);
}


async function scrapePromotionRows(page) {
  return page.evaluate(tableRowsByScore, { mode: 'promotions' });
}

async function scrapePromotionDetailItems(page, promo) {
  const rows = await page.evaluate(tableRowsByScore, { mode: 'items' });
  const out = [];
  const seen = new Set();
  for (const row of rows) {
    const item = enrichPromotionItem(row, promo);
    if (!item) continue;
    const key = `${item.promoCode}|${item.articleCode}|${item.ean}|${item.articleName}|${item.offer}|${item.pvp}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function enrichPromotionRow(row, index, referenceDateIso) {
  // scrapePromotionRows devuelve { fields, cells }; antes esta función usaba
  // el objeto entero como si fuese "fields", así que la descripción salía
  // como "[object Object]" en el CSV. Se toma fields (o el objeto si ya lo es).
  const fields = row?.fields || row || {};
  const entries = Object.entries(fields);
  const pick = picker(entries);
  const code = pick([/c[oó]digo\s*promoc/i, /c[oó]digo/i, /^id$/i, /referencia/i]);
  // OJO: no usar /promoc/i suelto — casaría con "Fecha Inicio Promocion"
  // (una fecha) antes que con "Descripcion". Se busca la descripción real y,
  // como respaldo, el primer valor que NO sea fecha/código/selección.
  const description = pick([/descripci/i, /descrip/i, /nombre/i, /^promoci[oó]n$/i])
    || firstNonEmpty(...entries.filter(([k]) => !/fecha|c[oó]digo|identificador|selecci|^id$/i.test(k)).map(([, v]) => v));
  const offer = pick([/^oferta$/i, /precio.*oferta/i, /p\.?\s*oferta/i, /dto|descuento/i]);
  const status = pick([/estado/i, /situaci/i]);

  const startDisplay = pick([/desde/i, /inicio/i, /^de fecha$/i, /fecha.*inicio/i]);
  const endDisplay = pick([/hasta/i, /fin/i, /final/i, /fecha.*fin/i, /fecha.*final/i, /caduc/i, /^a fecha$/i]);
  const allDates = entries.flatMap(([key, value]) => parseDates(String(value || '')).map((iso) => ({ key, iso })));
  const startIso = parseDateValue(startDisplay) || allDates.map((d) => d.iso).sort()[0] || '';
  const endIso = parseDateValue(endDisplay) || allDates.map((d) => d.iso).sort().at(-1) || '';
  const statusText = `${status} ${Object.values(fields).join(' ')}`.toLowerCase();
  const disabled = /caduc|finaliz|anulad|cancel|baja|inactiv/.test(statusText);
  const active = !disabled && (!endIso || endIso >= referenceDateIso);

  return {
    index,
    active,
    code,
    description,
    offer,
    status,
    startDisplay: startDisplay || displayDate(startIso),
    endDisplay: endDisplay || displayDate(endIso),
    startIso,
    endIso,
    listPage: row?.listPage || null,
    fields
  };
}

function enrichPromotionItem(row, promo) {
  const fields = row.fields || {};
  const entries = Object.entries(fields);
  const pick = picker(entries);
  const cells = row.cells || [];

  const articleCode = pick([
    /c[oó]d\.?\s*art/i,
    /c[oó]digo.*art/i,
    /c[oó]digo\s+unide/i,
    /^art[ií]culo\s*$/i,
    /^c[oó]digo$/i
  ]) || firstCodeLike(cells, promo.code);

  const articleName = pick([
    /descrip.*art/i,
    /nombre.*art/i,
    /^art[ií]culo$/i,
    /^descrip/i,
    /^nombre/i,
    /producto/i
  ]) || firstNameLike(cells, articleCode);

  const ean = pick([/^ean$/i, /c[oó]digo\s+barra/i, /barcode/i]) || firstEanLike(cells);
  // En este UnideGes las columnas de precio del detalle son "PVD" (precio
  // normal) y "PVD Promoción" (precio de oferta), no "PVP"/"Oferta". El
  // orden importa: "PVD Promoción" aparece ANTES que "PVD", así que las
  // patrones de pvp son EXACTAS para no capturar la de promoción.
  const pvp = pick([/^pvd$/i, /^pvp$/i, /^p\.?\s*v\.?\s*p$/i, /^precio$/i, /precio\s+actual/i]);
  const offer = pick([/pvd\s*promoc/i, /^oferta$/i, /precio.*oferta/i, /p\.?\s*oferta/i, /pvp.*propuesto/i, /precio.*promo/i]);
  const offerText = pick([/^texto/i, /condicion/i, /^obs/i]);
  const previousPrice = pick([/anterior/i, /precio.*normal/i, /pvp.*normal/i]);
  const status = pick([/estado/i, /situaci/i]);
  const startDisplay = pick([/desde/i, /inicio/i, /^de fecha$/i, /fecha.*inicio/i]) || promo.startDisplay || '';
  const endDisplay = pick([/hasta/i, /fin/i, /final/i, /fecha.*fin/i, /fecha.*final/i, /^a fecha$/i]) || promo.endDisplay || '';
  const allText = cells.join(' ');

  if (/^suma:/i.test(allText) || /haga\s+clic\s+aqu/i.test(allText)) return null;
  if (!articleCode && !articleName && !ean && !pvp && !offer) return null;
  if (articleCode && promo.code && articleCode === promo.code && !articleName) return null;

  return {
    promoCode: promo.code || '',
    promoDescription: promo.description || '',
    promoStart: promo.startDisplay || displayDate(promo.startIso),
    promoEnd: promo.endDisplay || displayDate(promo.endIso),
    promoStartIso: promo.startIso || '',
    promoEndIso: promo.endIso || '',
    articleCode,
    articleName,
    ean,
    pvp,
    offer,
    offerText,
    previousPrice,
    status,
    startDisplay,
    endDisplay,
    startIso: parseDateValue(startDisplay) || promo.startIso || '',
    endIso: parseDateValue(endDisplay) || promo.endIso || '',
    fields
  };
}

function picker(entries) {
  return (patterns) => {
    for (const [key, value] of entries) {
      if (patterns.some((pattern) => pattern.test(key))) return String(value || '').trim();
    }
    return '';
  };
}

function firstCodeLike(cells, promoCode) {
  for (const cell of cells) {
    const text = String(cell || '').trim();
    if (!/^\d{4,8}$/.test(text)) continue;
    if (promoCode && text === String(promoCode)) continue;
    return text;
  }
  return '';
}

function firstEanLike(cells) {
  for (const cell of cells) {
    const match = String(cell || '').match(/\b\d{12,14}\b/);
    if (match) return match[0];
  }
  return '';
}

function firstNameLike(cells, articleCode) {
  for (const cell of cells) {
    const text = String(cell || '').replace(/\s+/g, ' ').trim();
    if (!text || text === articleCode) continue;
    if (/^\d+[,.]?\d*$/.test(text)) continue;
    if (/^\d{1,2}[\/.]\d{1,2}[\/.]\d{2,4}$/.test(text)) continue;
    if (/[a-záéíóúñü]{3,}/i.test(text)) return text;
  }
  return '';
}

function promotionKey(row) {
  const fields = row || {};
  const text = Object.values(fields).map((v) => String(v || '').trim()).filter(Boolean).join('|');
  return text || JSON.stringify(fields);
}

function comparePromotions(a, b) {
  const endA = a.endIso || '9999-12-31';
  const endB = b.endIso || '9999-12-31';
  if (endA !== endB) return endA.localeCompare(endB);
  return String(a.description || '').localeCompare(String(b.description || ''), 'es');
}

function parseDates(value) {
  const out = [];
  const text = String(value || '');
  const dmy = text.matchAll(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})\b/g);
  for (const m of dmy) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    out.push(`${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`);
  }
  const ymd = text.matchAll(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/g);
  for (const m of ymd) out.push(`${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`);
  return [...new Set(out)].filter(isValidIsoDate);
}

function parseDateValue(value) {
  return parseDates(value)[0] || '';
}

function normalizeIsoDate(value) {
  const text = String(value || '').trim();
  if (isValidIsoDate(text)) return text;
  return parseDateValue(text);
}

function isValidIsoDate(value) {
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() + 1 === m && date.getUTCDate() === d;
}

function displayDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function todayIso(config) {
  const timeZone = config.ordering?.timezone || 'Europe/Madrid';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date()).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

function writePromotionItemsCsv(config, items, promotions, referenceDateIso) {
  const dir = path.resolve(config.__toolRoot || '.', config.promotions?.outputDir || 'promotions');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `promociones-productos-activos-${referenceDateIso}.csv`);
  const header = [
    'codigo_promocion',
    'promocion',
    'desde_promocion',
    'hasta_promocion',
    'codigo_articulo',
    'descripcion_articulo',
    'ean',
    'pvp',
    'oferta',
    'texto_oferta',
    'precio_anterior',
    'estado',
    'desde_articulo',
    'hasta_articulo',
    'campos_articulo',
    'campos_promocion'
  ];
  const lines = [header.join(';')];

  if (items.length) {
    for (const row of items) {
      lines.push([
        row.promoCode,
        row.promoDescription,
        row.promoStart,
        row.promoEnd,
        row.articleCode,
        row.articleName,
        row.ean,
        row.pvp,
        row.offer,
        row.offerText,
        row.previousPrice,
        row.status,
        row.startDisplay,
        row.endDisplay,
        JSON.stringify(row.fields || {}),
        JSON.stringify(promotions.find((p) => p.code === row.promoCode)?.fields || {})
      ].map(csvCell).join(';'));
    }
  } else {
    for (const promo of promotions) {
      lines.push([
        promo.code,
        promo.description,
        promo.startDisplay,
        promo.endDisplay,
        '',
        '',
        '',
        '',
        promo.offer,
        '',
        '',
        promo.status,
        '',
        '',
        '',
        JSON.stringify(promo.fields || {})
      ].map(csvCell).join(';'));
    }
  }

  fs.writeFileSync(file, `\uFEFF${lines.join('\r\n')}`, 'utf8');
  return file;
}

function csvCell(value) {
  const text = String(value ?? '');
  if (/[";\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

async function screenshot(page, config, tag) {
  try {
    const dir = path.resolve(config.__toolRoot || '.', 'screenshots');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `promociones-${String(tag).replace(/[^\w.-]+/g, '_')}-${Date.now()}.png`);
    await page.screenshot({ path: file });
    return file;
  } catch {
    return null;
  }
}

async function dumpHtml(page, config, name) {
  try {
    const html = await page.content();
    const file = path.resolve(config.__toolRoot || '.', name);
    fs.writeFileSync(file, html, 'utf8');
    return file;
  } catch {
    return null;
  }
}

function safeFilePart(value) {
  return String(value || 'promo').replace(/[^a-z0-9_.-]+/gi, '_').slice(0, 80) || 'promo';
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

// Runs inside the browser context. Kept as a function declaration so
// page.evaluate can serialize it with its helper logic.
function tableRowsByScore(options = {}) {
  const clean = (s) => (s || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  const isVisible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  };
  const mode = options.mode || 'items';
  const tables = Array.from(document.querySelectorAll('table')).filter(isVisible);
  const candidates = [];

  for (const table of tables) {
    const headers = Array.from(table.querySelectorAll('th')).map((th, i) => clean(th.innerText || th.textContent) || `col${i + 1}`);
    if (headers.length < 2) continue;
    let score = 0;
    for (const h of headers) {
      if (/c[oó]digo\s+art|c[oó]d\.?\s*art|c[oó]digo\s+unide|art[ií]culo/i.test(h)) score += 5;
      if (/descrip|nombre|producto/i.test(h)) score += 4;
      if (/ean|barra/i.test(h)) score += 4;
      if (/p\.?\s*v\.?\s*p|precio|oferta|dto|descuento/i.test(h)) score += 4;
      if (/fecha|desde|hasta|inicio|fin|final/i.test(h)) score += 2;
      if (/promoc|estado|situaci/i.test(h)) score += 2;
      if (/selecci[oó]n|checkbox/i.test(h)) score -= 1;
    }
    if (mode === 'promotions') {
      if (!headers.some((h) => /fecha|desde|hasta|inicio|fin|final/i.test(h))) score -= 5;
      if (!headers.some((h) => /promoc|oferta|descrip|nombre|c[oó]digo|estado/i.test(h))) score -= 5;
    } else {
      if (!headers.some((h) => /art[ií]culo|c[oó]digo\s+art|c[oó]digo\s+unide|descrip|nombre|ean|precio|oferta|p\.?\s*v\.?\s*p/i.test(h))) score -= 8;
    }
    if (score < 4) continue;

    const rows = [];
    for (const tr of Array.from(table.querySelectorAll('tr[role="row"], tbody tr'))) {
      if (!isVisible(tr)) continue;
      const cells = Array.from(tr.querySelectorAll('td')).map((td) => clean(td.innerText || td.textContent));
      if (!cells.length || !cells.some(Boolean)) continue;
      if (cells.some((cell) => /^suma:/i.test(cell))) continue;
      const offset = Math.max(0, cells.length - headers.length);
      const fields = {};
      headers.forEach((header, i) => {
        fields[header] = cells[i + offset] ?? cells[i] ?? '';
      });
      rows.push({ fields, cells });
    }
    if (!rows.length) continue;
    candidates.push({ score, rows, headers });
  }

  candidates.sort((a, b) => (b.score * 100 + b.rows.length) - (a.score * 100 + a.rows.length));
  return (candidates[0]?.rows || []).map((row) => ({ fields: row.fields, cells: row.cells }));
}
// Solo para pruebas.
export const __test = {
  scrapeAllPromotionDetailItems, waitForGridPageChange, detailSignature, rowsSignature,
  scrapeAllPromotionRowsForTest: (page, config) => scrapeAllPromotionRows(page, config),
  goToFirstPromotionListPage, promotionGridActivePage, clickGridPageDelta,
  clickNextRecordArrow, detailMatchesPromotion
};
