import fs from 'node:fs';
import path from 'node:path';
import { connectBrowser, findOrderPage } from './webBrowser.js';
import { setLive } from './liveStatus.js';

// =====================================================================
// Mensajería operativa (petición del dueño, idea #2 del 想法本, 24/07):
// entra en la página "Mensajería operativa" de la web de UnideGes, lee
// los mensajes de la ÚLTIMA SEMANA y descarga los adjuntos:
//   - albaranes  → siempre se descargan
//   - ficheros   → se descargan EXCEPTO los que mencionan "fruta"
// La descarga NO es por fila: se marcan las casillas de las filas elegidas
// y se pulsa el "Descargar" de la barra de la página (así es la Recepción
// Ficheros de esta instalación). Los archivos caen en
// descargas/mensajeria-<fecha>/ y bot.js los reenvía por Telegram.
// Solo lectura + descarga: no se edita nada en la web.
// =====================================================================

const DEFAULT_CANDIDATE_PATHS = [
  '/Mensajeria_ListView',
  '/MensajeriaOperativa_ListView',
  '/Mensajes_ListView',
  '/Mensaje_ListView',
  '/MensajeriaOperativa',
  '/Mensajeria'
];

export async function fetchMensajeriaOperativa(config, logger, opciones = {}) {
  let browser;
  const startedAt = Date.now();
  try {
    setLive('[mensajeria] 连接 Edge，打开 Mensajería operativa…');
    const opened = await openMensajeriaPage(config);
    browser = opened.browser;
    const page = opened.page;

    const hoyIso = todayIso(config);
    const dias = Number(config.mensajeria?.diasVentana) || 7;
    const maxDescargas = Number(config.mensajeria?.maxDescargas) || 30;
    // MODO PRUEBA (petición del dueño, 24/07): bajar de verdad cambia el
    // estado del mensaje en el servidor y luego en la tienda cuesta volver a
    // bajarlo. Por defecto SOLO se marcan las casillas y se dejan marcadas;
    // la descarga real se pide con /mensajeria bajar o con
    // mensajeria.soloMarcar=false en config.local.json.
    const soloMarcar = opciones.soloMarcar ?? (config.mensajeria?.soloMarcar !== false);
    const dir = path.resolve(config.__toolRoot || '.', config.mensajeria?.downloadDir || 'descargas', `mensajeria-${hoyIso}`);
    fs.mkdirSync(dir, { recursive: true });

    if (!soloMarcar) {
      // Las descargas del navegador caen en ESTA carpeta (no en la del perfil
      // de Edge): así cada ejecución deja su lote junto y ordenado.
      await prepararDescargas(page, dir);
    }

    // Recorre las páginas y, EN CADA UNA, marca las filas elegidas. En modo
    // prueba se queda ahí (casillas marcadas, sin tocar nada más); en modo
    // real pulsa además el "Descargar" de la BARRA de la página (visto en la
    // instalación del dueño, 24/07: la lista no tiene botón por fila).
    const r = await recorrerYDescargar(page, config, { hoyIso, dias, dir, maxDescargas, soloMarcar, logger });
    if (!r.total && r.vacioExplicito) {
      // El grid dijo EXPLÍCITAMENTE que no hay datos: eso no es un fallo de
      // identificación, es una lista vacía de verdad. Se reporta como éxito.
      const screenshotPath = await screenshot(page, config, 'vacia');
      setLive('[mensajeria] listo (lista vacía)');
      return {
        ok: true, dir, hoyIso, dias, soloMarcar,
        total: 0, descargados: [], omitidosFruta: [], sinFecha: 0,
        fueraDeVentana: 0, fallidos: [], excedente: 0,
        screenshot: screenshotPath, elapsedMs: Date.now() - startedAt
      };
    }
    if (!r.total) {
      const screenshotPath = await screenshot(page, config, 'vacia');
      const dumpFile = await dumpHtml(page, config, 'mensajeria-page-dump.html');
      return {
        ok: false,
        stage: 'scrape',
        error: 'Mensajería 页面打开了，但等了半分钟列表还是没加载出来（也没显示"空列表"）。已保存页面结构和截图，可能是网页当时特别慢，稍后再试一次 /mensajeria。',
        screenshot: screenshotPath,
        dumpFile
      };
    }

    const screenshotPath = await screenshot(page, config, 'fin');
    setLive('[mensajeria] listo');
    logger?.info('mensajeria fetched', {
      total: r.total,
      descargados: r.descargados.length,
      omitidosFruta: r.omitidosFruta.length,
      sinFecha: r.sinFecha,
      fallidos: r.fallidos.length,
      elapsedMs: Date.now() - startedAt
    });
    return {
      ok: true,
      dir,
      hoyIso,
      dias,
      soloMarcar,
      total: r.total,
      descargados: r.descargados,
      omitidosFruta: r.omitidosFruta,
      sinFecha: r.sinFecha,
      fueraDeVentana: r.fueraDeVentana,
      fallidos: r.fallidos,
      excedente: r.excedente,
      screenshot: screenshotPath,
      elapsedMs: Date.now() - startedAt
    };
  } catch (error) {
    setLive('[mensajeria] ERROR: ' + error.message);
    logger?.error('mensajeria fetch failed', { stage: error.stage, error: error.message });
    return { ok: false, stage: error.stage || 'mensajeria', error: error.message };
  } finally {
    try { browser?.disconnect(); } catch { /* noop */ }
  }
}

export function formatMensajeriaSummary(result) {
  const albaranes = result.descargados.filter((d) => d.tipo === 'albaran').length;
  const ficheros = result.descargados.length - albaranes;
  const prueba = result.soloMarcar;
  const lines = [
    `运营信息传递（Mensajería operativa，过去 ${result.dias} 天）${prueba ? '· 测试模式：只勾选不下载' : ''}`,
    `· 读到消息：${result.total} 条`,
    `· ${prueba ? '已勾选' : '下载'}：${result.descargados.length} 个（albarán ${albaranes} / fichero ${ficheros}）`
  ];
  if (result.omitidosFruta.length) lines.push(`· fruta 类 fichero 跳过：${result.omitidosFruta.length} 个`);
  if (result.sinFecha) lines.push(`· 没识别到日期跳过：${result.sinFecha} 条`);
  if (result.fueraDeVentana) lines.push(`· 超过 ${result.dias} 天的：${result.fueraDeVentana} 条`);
  if (result.fallidos.length) {
    lines.push(`· 没${prueba ? '勾' : '下'}成的：${result.fallidos.length} 个`);
    for (const f of result.fallidos.slice(0, 3)) lines.push(`  - ${f.msg.texto.slice(0, 40)}：${f.error}`);
  }
  if (result.excedente) lines.push(`· 还有 ${result.excedente} 个超出单次上限没处理（想要更多说一声）`);
  if (result.omitidosFruta.length) {
    lines.push('', '跳过的 fruta fichero：');
    for (const m of result.omitidosFruta.slice(0, 5)) lines.push(`- ${m.texto.slice(0, 60)}`);
  }
  if (prueba) {
    lines.push('', '勾上的就留在网页里，店里核实没问题再点 Descargar。想让 bot 直接下：发 /mensajeria bajar。');
  } else if (result.descargados.some((d) => d.file)) {
    lines.push('', `文件已逐个发上来；电脑里也存在：${result.dir}`);
  } else {
    lines.push('', '这一周没有可下载的 albarán / fichero。');
  }
  return lines.join('\n');
}

// --- filtrado puro (testeable sin navegador) ----------------------------

// ¿De qué tipo es el mensaje? Mira todo el texto de la fila. "fichero" es
// adjunto de cualquier clase; "albarán" es albarán de entrega del proveedor.
export function tipoMensaje(texto) {
  const t = String(texto || '').toLowerCase();
  if (/albar[aá]n/.test(t)) return 'albaran';
  if (/fichero|archivo|adjunto|file/.test(t)) return 'fichero';
  return 'otro';
}

// Regla del dueño (24/07): los ficheros que hablan de FRUTA no se bajan.
export function debeOmitirPorFruta(tipo, texto) {
  return tipo === 'fichero' && /fruta/i.test(String(texto || ''));
}

export function dentroDeVentana(fechaIso, hoyIso, dias) {
  if (!fechaIso) return false;
  return fechaIso >= addDaysIso(hoyIso, -Math.abs(dias)) && fechaIso <= addDaysIso(hoyIso, 1);
}

// Reparte las filas leídas en: seleccionados (a descargar), omitidosFruta,
// sinFecha, fueraDeVentana y (implícito) los que no son albarán ni fichero.
export function filtrarMensajes(rows, { hoyIso, dias = 7 } = {}) {
  const seleccionados = [];
  const omitidosFruta = [];
  const sinFecha = [];
  let fueraDeVentana = 0;
  const vistos = new Set();
  for (const row of rows || []) {
    const texto = [...(row.cells || []), ...Object.values(row.fields || {})].filter(Boolean).join(' ');
    const firma = texto || JSON.stringify(row);
    if (vistos.has(firma)) continue;
    vistos.add(firma);
    const tipo = tipoMensaje(texto);
    if (tipo === 'otro') continue;
    const msg = { ...row, tipo, texto, fechaIso: parseFechaMensaje(texto) };
    if (debeOmitirPorFruta(tipo, texto)) { omitidosFruta.push(msg); continue; }
    if (!msg.fechaIso) { sinFecha.push(msg); continue; }
    if (!dentroDeVentana(msg.fechaIso, hoyIso, dias)) { fueraDeVentana += 1; continue; }
    seleccionados.push(msg);
  }
  // Más recientes primero: si hay límite de descargas, se corta por lo nuevo.
  seleccionados.sort((a, b) => b.fechaIso.localeCompare(a.fechaIso));
  return { todos: [...vistos].length ? rows : [], seleccionados, omitidosFruta, sinFecha, fueraDeVentana };
}

// Fecha del mensaje: primera dd/mm/aaaa (o aaaa-mm-dd) del texto de la fila.
export function parseFechaMensaje(texto) {
  const text = String(texto || '');
  let m = text.match(/\b(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4})\b/);
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  m = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return '';
}

function addDaysIso(iso, dias) {
  const [y, m, d] = String(iso).split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + dias));
  const p = (x) => String(x).padStart(2, '0');
  return `${date.getUTCFullYear()}-${p(date.getUTCMonth() + 1)}-${p(date.getUTCDate())}`;
}

function todayIso(config) {
  const timeZone = config.ordering?.timezone || 'Europe/Madrid';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date()).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// --- navegación ----------------------------------------------------------

async function openMensajeriaPage(config) {
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
    await ensureMensajeriaPage(page, config);
  } catch (error) {
    try { browser.disconnect(); } catch { /* noop */ }
    throw error;
  }
  return { browser, page };
}

async function ensureMensajeriaPage(page, config) {
  const timeout = Number(config.webOrder?.pageNavigationTimeoutMs) || 20000;
  let state = await getMensajeriaState(page);
  if (state.isMensajeriaList) return state;

  const configured = config.mensajeria?.listUrl || '';
  if (configured) {
    await gotoUrl(page, absoluteUrl(page, configured), timeout);
    state = await waitForMensajeriaPage(page, timeout);
    if (state.isMensajeriaList) return state;
  }

  if (await clickMensajeriaNav(page)) {
    state = await waitForMensajeriaPage(page, timeout);
    if (state.isMensajeriaList) return state;
  }

  const candidates = config.mensajeria?.candidatePaths?.length ? config.mensajeria.candidatePaths : DEFAULT_CANDIDATE_PATHS;
  for (const candidate of candidates) {
    await gotoUrl(page, absoluteUrl(page, candidate), timeout);
    state = await waitForMensajeriaPage(page, Math.min(timeout, 8000));
    if (state.isMensajeriaList) return state;
  }

  const err = new Error(`没有找到 Mensajería operativa 页面。已尝试左侧菜单和常见 URL。当前：caption=${state.caption || '-'}, url=${state.url || '-'}`);
  err.stage = 'mensajeriaPage';
  throw err;
}

async function gotoUrl(page, url, timeout) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout }).catch(async () => {
    await page.goto(url, { waitUntil: 'load', timeout });
  });
}

function absoluteUrl(page, value) {
  const raw = String(value || '').trim();
  if (/^https?:\/\//i.test(raw)) return raw;
  try { return new URL(raw, page.url()).href; } catch { return `https://unideges30.unide.es${raw.startsWith('/') ? raw : `/${raw}`}`; }
}

async function clickMensajeriaNav(page) {
  return page.evaluate(() => {
    const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const isVisible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const candidates = Array.from(document.querySelectorAll('a, button, [role="treeitem"], .xaf-nav-link, .dxbl-treeview-node'))
      .filter(isVisible)
      .map((el) => ({ el, text: clean(el.innerText || el.textContent) }))
      .filter((x) => /mensajer/i.test(x.text));
    const target = candidates[0]?.el;
    if (!target) return false;
    const clickable = target.closest('a, button, [role="treeitem"]') || target;
    clickable.click();
    return true;
  });
}

async function waitForMensajeriaPage(page, timeoutMs) {
  const start = Date.now();
  let last = {};
  while (Date.now() - start < timeoutMs) {
    try {
      last = await getMensajeriaState(page);
      if (last.isMensajeriaList) return last;
    } catch { /* page navigating */ }
    await sleep(250);
  }
  return last;
}

async function getMensajeriaState(page) {
  return page.evaluate(() => {
    const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const isVisible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const visible = (sel) => Array.from(document.querySelectorAll(sel)).filter(isVisible);
    const caption = clean(visible('.xaf-view-caption-sm')[0]?.innerText);
    const title = document.title || '';
    const url = location.href || '';
    const active = visible('.xaf-nav-item.dxbl-active, a.dxbl-active, a[aria-current="true"]')[0];
    const activeNav = clean(active?.innerText || '');
    const hasMensajeriaText = /mensajer/i.test(`${caption} ${title} ${url} ${activeNav}`);
    const hasTables = document.querySelectorAll('table, [role="grid"]').length > 0;
    return { title, url, caption, activeNav, hasTables, isMensajeriaList: hasMensajeriaText && hasTables };
  });
}

// El "¿ya está la página?" de arriba (getMensajeriaState) solo comprueba que
// EXISTE una tabla, porque tiene que valer también para detectar la página
// antes de navegar. Pero para LEER hace falta más: filas con celdas con
// texto. Esta espera sondea hasta que las haya, o hasta que el grid diga
// explícitamente que no hay datos (área de vacío de DevExpress o su texto).
async function esperarFilasGrid(page, timeoutMs) {
  const start = Date.now();
  let last = { filas: 0, vacioExplicito: false, esperaMs: 0 };
  while (Date.now() - start < timeoutMs) {
    try {
      const estado = await page.evaluate(() => {
        const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
        const isVisible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
        const filas = Array.from(document.querySelectorAll('table tr'))
          .filter(isVisible)
          .filter((tr) => Array.from(tr.querySelectorAll('td')).some((td) => clean(td.innerText || td.textContent)))
          .length;
        const vacioExplicito = document.querySelector('.dxbl-grid-empty-data-area, .dxbl-grid-empty, .dx-empty') != null
          || /no hay datos|sin datos que mostrar|no data to display/i.test(clean(document.body?.innerText || '').slice(0, 4000));
        return { filas, vacioExplicito };
      });
      last = { ...estado, esperaMs: Date.now() - start };
      if (estado.filas > 0 || estado.vacioExplicito) return last;
    } catch { /* Blazor re-renderizando: reintentar */ }
    await sleep(400);
  }
  return last;
}

// Tras pasar de página, Blazor tarda un poco en repintar: si se lee muy
// pronto se ven las filas VIEJAS (misma firma) y el bucle cortaría creyendo
// que no hay más páginas. Esperar a que la firma cambie o rendirse y seguir.
async function esperarPaginaNueva(page, firmaAnterior, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await sleep(500);
    try {
      const rows = await scrapeMensajesPage(page);
      const sig = rows.map((r) => (r.cells || []).join('|')).join('||');
      if (rows.length && sig !== firmaAnterior) return;
    } catch { /* re-render en curso */ }
  }
}

// Recorre las páginas del grid (leer, firmar, pasar de página, parar cuando
// la firma se repite) y, EN CADA PÁGINA, marca lo seleccionado; en modo real
// además lo descarga. Las etiquetas data-mensajeria-idx solo existen en la
// página visible, así que "leer todo y bajar al final" no funcionaría con
// más de una página.
async function recorrerYDescargar(page, config, { hoyIso, dias, dir, maxDescargas, soloMarcar, logger }) {
  const maxPages = Number(config.mensajeria?.maxPages) || 20;
  const out = { total: 0, descargados: [], omitidosFruta: [], sinFecha: 0, fueraDeVentana: 0, fallidos: [], excedente: 0, vacioExplicito: false };
  // El grid es Blazor: la <table> existe ANTES de que lleguen sus filas
  // (fallo real en tienda, 25/07 — el dump del dueño tenía las 12 filas
  // perfectamente legibles, pero el scrape corrió antes de que se pintaran
  // y reportó "no reconozco la lista"). Esperar filas con datos, o a que el
  // grid diga explícitamente que está vacío, antes de leer nada.
  setLive('[mensajeria] 等消息列表加载出来…');
  const espera = await esperarFilasGrid(page, Number(config.mensajeria?.gridTimeoutMs) || 25000);
  out.vacioExplicito = espera.vacioExplicito && !espera.filas;
  logger?.info('mensajeria grid wait', { filas: espera.filas, vacioExplicito: espera.vacioExplicito, esperaMs: espera.esperaMs });
  let prevSig = '';
  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    setLive('[mensajeria] 读消息列表第 ' + (pageIndex + 1) + ' 页…');
    const rows = await scrapeMensajesPage(page);
    const sig = rows.map((r) => (r.cells || []).join('|')).join('||');
    if (pageIndex > 0 && (!rows.length || sig === prevSig)) break;
    prevSig = sig;
    out.total += rows.length;

    const f = filtrarMensajes(rows, { hoyIso, dias });
    out.omitidosFruta.push(...f.omitidosFruta);
    out.sinFecha += f.sinFecha.length;
    out.fueraDeVentana += f.fueraDeVentana;

    let aBajar = f.seleccionados;
    const cupo = maxDescargas - out.descargados.length;
    if (aBajar.length > cupo) {
      out.excedente += aBajar.length - Math.max(0, cupo);
      aBajar = aBajar.slice(0, Math.max(0, cupo));
    }
    if (!aBajar.length) {
      const moved = await clickNextPage(page);
      if (!moved) break;
      await esperarPaginaNueva(page, sig, 8000);
      continue;
    }

    if (soloMarcar) {
      // MODO PRUEBA: marcar y DEJAR MARCADO (nada de Descargar ni de
      // desmarcar), para que en la tienda se revisen esas mismas líneas.
      setLive(`[mensajeria] 测试模式：勾选 ${aBajar.length} 条（不下载）…`);
      const { marcados, sinEntrada } = await marcarFilas(page, aBajar);
      for (const msg of marcados) out.descargados.push({ ...msg, marcado: true });
      for (const msg of sinEntrada) out.fallidos.push({ msg, error: '没勾上' });
    } else {
      setLive(`[mensajeria] 勾选 ${aBajar.length} 条，点工具栏 Descargar…`);
      const { files, sinEntrada } = await descargarSeleccion(page, aBajar, dir, config);
      if (files.length === aBajar.length) {
        aBajar.forEach((msg, i) => out.descargados.push({ ...msg, file: files[i], bytes: fs.statSync(files[i]).size }));
      } else if (files.length === 1 && aBajar.length > 1) {
        // Un solo archivo para varios mensajes: la web los ha empaquetado (zip).
        out.descargados.push({ tipo: 'lote', texto: `${aBajar.length} 个打包`, fechaIso: hoyIso, caption: `打包下载 · ${aBajar.length} 个文件`, file: files[0], bytes: fs.statSync(files[0]).size });
      } else {
        files.forEach((file, i) => out.descargados.push({ ...aBajar[i], file, bytes: fs.statSync(file).size }));
        for (const msg of aBajar.slice(files.length)) out.fallidos.push({ msg, error: '工具栏 Descargar 没产出它的文件' });
      }
      for (const msg of sinEntrada) out.fallidos.push({ msg, error: '没勾上或页面没有工具栏 Descargar 按钮' });
    }

    const moved = await clickNextPage(page);
    if (!moved) break;
    await esperarPaginaNueva(page, sig, 8000);
  }
  logger?.info('mensajeria rows read', { filas: out.total });
  return out;
}

// Marca las casillas de las filas indicadas y VERIFICA que el estado ha
// cambiado de verdad (contar clics sin más mentía: el 24/07 reportaba
// "已勾选 4 个" con la lista vacía de marcas). DevExpress Blazor <dxbl-check>:
// el estado vive en la CLASE del contenedor ('unchecked' contiene la
// subcadena 'checked': classList siempre). Se intenta primero el input y, a
// las que fallen, el contenedor; lo que no cambie de clase va a sinEntrada.
async function marcarFilas(page, msgs) {
  const idxs = msgs.map((m) => m.idx);
  const clicInput = (idxList) => page.evaluate((lista) => {
    for (const idx of lista) {
      const tr = document.querySelector(`[data-mensajeria-idx="${idx}"]`);
      if (!tr) continue;
      const wrap = tr.querySelector('dxbl-check');
      const input = wrap ? wrap.querySelector('input[type="checkbox"]') : tr.querySelector('input[type="checkbox"]');
      if (wrap && input) { if (!wrap.classList.contains('dxbl-checkbox-checked')) input.click(); continue; }
      if (input) { if (!input.checked) input.click(); continue; }
      const celda = tr.querySelector('td');
      if (celda) celda.click();
    }
  }, idxList);
  const clicContenedor = (idxList) => page.evaluate((lista) => {
    for (const idx of lista) {
      const tr = document.querySelector(`[data-mensajeria-idx="${idx}"]`);
      const wrap = tr?.querySelector('dxbl-check');
      if (wrap && !wrap.classList.contains('dxbl-checkbox-checked')) {
        (wrap.querySelector('.dxbl-checkbox-check-element') || wrap).click();
      }
    }
  }, idxList);
  const verificados = (idxList) => page.evaluate((lista) => {
    const ok = [];
    for (const idx of lista) {
      const tr = document.querySelector(`[data-mensajeria-idx="${idx}"]`);
      const wrap = tr?.querySelector('dxbl-check');
      const input = wrap ? wrap.querySelector('input[type="checkbox"]') : tr?.querySelector('input[type="checkbox"]');
      if (wrap?.classList.contains('dxbl-checkbox-checked') || input?.checked) ok.push(idx);
    }
    return ok;
  }, idxList);

  await clicInput(idxs);
  await sleep(600);
  let marcados = await verificados(idxs);
  const faltan = idxs.filter((i) => !marcados.includes(i));
  if (faltan.length) {
    await clicContenedor(faltan);
    await sleep(600);
    marcados = await verificados(idxs);
  }
  return {
    marcados: msgs.filter((m) => marcados.includes(m.idx)),
    sinEntrada: msgs.filter((m) => !marcados.includes(m.idx))
  };
}

// Lee la tabla principal de la página y ETIQUETA cada fila con
// data-mensajeria-idx para que la descarga pueda localizarla después.
function scrapeMensajesPage(page) {
  return page.evaluate(() => {
    const clean = (s) => (s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
    const isVisible = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    };
    const tables = Array.from(document.querySelectorAll('table')).filter(isVisible);
    let best = null;
    let bestScore = 0;
    for (const table of tables) {
      const headers = Array.from(table.querySelectorAll('th')).map((th) => clean(th.innerText || th.textContent));
      const rowCount = table.querySelectorAll('tr[role="row"], tbody tr').length;
      if (!rowCount) continue;
      let score = rowCount;
      for (const h of headers) {
        if (/fecha|date/i.test(h)) score += 8;
        if (/asunto|subject|mensaje|descrip|nombre/i.test(h)) score += 5;
        if (/tipo|clase|remitente|adjunto|fichero/i.test(h)) score += 4;
      }
      if (score > bestScore) { best = table; bestScore = score; }
    }
    if (!best) return [];
    const headers = Array.from(best.querySelectorAll('th')).map((th, i) => clean(th.innerText || th.textContent) || `col${i + 1}`);
    const rows = [];
    let idx = 0;
    for (const tr of Array.from(best.querySelectorAll('tr[role="row"], tbody tr'))) {
      if (!isVisible(tr)) continue;
      const cells = Array.from(tr.querySelectorAll('td')).map((td) => clean(td.innerText || td.textContent));
      if (!cells.length || !cells.some(Boolean)) continue;
      if (cells.some((c) => /^suma:/i.test(c))) continue;
      tr.setAttribute('data-mensajeria-idx', String(idx));
      idx += 1;
      const offset = Math.max(0, cells.length - headers.length);
      const fields = {};
      headers.forEach((h, i) => { fields[h] = cells[i + offset] ?? cells[i] ?? ''; });
      rows.push({ idx: idx - 1, fields, cells });
    }
    return rows;
  });
}

async function clickNextPage(page) {
  return page.evaluate(() => {
    const isVisible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const pageNum = (el) => {
      const aria = el.getAttribute('aria-label') || '';
      const m = aria.match(/(?:page|p[aá]gina)\s+(\d+)/i);
      if (m) return Number(m[1]);
      const t = (el.textContent || '').trim();
      return /^\d+$/.test(t) ? Number(t) : null;
    };
    const pagers = Array.from(document.querySelectorAll('.dxbl-pager, [class*="pager" i][role="navigation"], nav[class*="pager" i]')).filter(isVisible);
    for (const pager of pagers) {
      const btns = Array.from(pager.querySelectorAll('button, a, [role="button"]')).filter(isVisible)
        .map((el) => ({
          el,
          n: pageNum(el),
          active: el.getAttribute('aria-current') === 'page' || /active-page/i.test(String(el.className || '')),
          disabled: el.disabled || el.getAttribute('aria-disabled') === 'true' || /disabled/i.test(String(el.className || ''))
        }))
        .filter((x) => x.n != null);
      if (!btns.length) continue;
      const activeN = (btns.find((x) => x.active) || {}).n ?? Math.min(...btns.map((x) => x.n));
      const target = btns.find((x) => x.n === activeN + 1 && !x.disabled);
      if (target) { target.el.click(); return true; }
      return false;
    }
    return false;
  });
}

// --- descarga --------------------------------------------------------------

async function prepararDescargas(page, dir) {
  // Page.setDownloadBehavior (deprecated pero vigente) y, si no cuela,
  // Browser.setDownloadBehavior a nivel navegador. Sin esto las descargas
  // caerían en la carpeta por defecto del perfil de Edge.
  try {
    const client = await page.createCDPSession();
    await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dir });
    return;
  } catch { /* probar a nivel browser */ }
  try {
    const client = await page.createCDPSession();
    await client.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dir });
  } catch { /* mejor esfuerzo: el poll de carpeta seguirá funcionando si Edge obedece */ }
}

// Baja TODOS los mensajes elegidos de la página actual de una vez: marca sus
// casillas y pulsa el "Descargar" de la BARRA de la página (así funciona la
// Recepción Ficheros del dueño, 24/07: no hay descarga por fila). Devuelve
// los archivos nuevos aparecidos en dir y los mensajes que no se pudieron
// ni marcar (para reportarlos como fallidos).
async function descargarSeleccion(page, msgs, dir, config) {
  const timeoutMs = Number(config.mensajeria?.downloadTimeoutMs) || 30000;
  const conocidos = new Set(fs.readdirSync(dir));

  // 1) Marcar las casillas de las filas elegidas.
  const { marcados, sinEntrada: noMarcados } = await marcarFilas(page, msgs);
  if (!marcados.length) return { files: [], sinEntrada: noMarcados };
  await sleep(500);

  // 2) "Descargar" de la barra: nunca dentro de una fila ni un "exportar a
  //    Excel/CSV" del grid. Al marcar casillas Blazor tarda un instante en
  //    habilitarlo (viene con clase dxbl-disabled): sondear unos segundos.
  const pulsado = await (async () => {
    const limite = Date.now() + 6000;
    for (;;) {
      const ok = await page.evaluate(() => {
        const isVisible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
        const etiqueta = (el) => `${el.getAttribute('data-action-name') || ''} ${el.getAttribute('title') || ''} ${el.getAttribute('aria-label') || ''} ${el.innerText || ''}`;
        const disabled = (el) => el.disabled || el.getAttribute('aria-disabled') === 'true' || /disabled|dx-state-disabled/i.test(String(el.className || ''));
        const candidatos = Array.from(document.querySelectorAll('button, a, [data-action-name], [role="button"]'))
          .filter(isVisible)
          .filter((el) => !el.closest('tr[role="row"], tbody tr'))
          .filter((el) => /descargar|download/i.test(etiqueta(el)))
          .filter((el) => !/exportar|excel|csv|informe|plantilla/i.test(etiqueta(el)));
        const util = candidatos.find((el) => !disabled(el)) || null;
        if (!util) return false;
        util.click();
        return true;
      });
      if (ok) return true;
      if (Date.now() > limite) return false;
      await sleep(400);
    }
  })();
  if (!pulsado) {
    await desmarcarTodo(page);
    return { files: [], sinEntrada: msgs };
  }

  const files = await waitForDownloads(dir, conocidos, marcados.length, timeoutMs);
  await desmarcarTodo(page);
  return { files, sinEntrada: files.length ? noMarcados : msgs };
}

// Deja las casillas como estaban: la selección persiste entre páginas en
// algunos grids y ensuciaría el lote de la página siguiente. Mismo cuidado
// con 'unchecked'/'checked': classList, no substring; y no tocar dos veces
// la misma casilla (el input vive dentro del dxbl-check).
async function desmarcarTodo(page) {
  try {
    await page.evaluate(() => {
      for (const wrap of Array.from(document.querySelectorAll('dxbl-check.dxbl-checkbox-checked'))) {
        (wrap.querySelector('.dxbl-checkbox-check-element') || wrap).click();
      }
      for (const box of Array.from(document.querySelectorAll('tr[role="row"] input[type="checkbox"]:checked, tbody tr input[type="checkbox"]:checked'))) {
        if (!box.closest('dxbl-check')) box.click();
      }
    });
  } catch { /* noop */ }
}

// Espera archivos NUEVOS en dir hasta tener `esperados`, o hasta que el
// conteo se estabiliza unos sondeos sin ningún .crdownload en vuelo (la web
// puede soltar un zip único en vez de N archivos). Devuelve rutas.
async function waitForDownloads(dir, conocidos, esperados, timeoutMs) {
  const start = Date.now();
  let quiet = 0;
  for (;;) {
    const nuevos = fs.readdirSync(dir).filter((f) => !conocidos.has(f) && !/\.(crdownload|tmp|part)$/i.test(f));
    const enCurso = fs.readdirSync(dir).some((f) => /\.(crdownload|tmp|part)$/i.test(f));
    if (!enCurso && (nuevos.length >= esperados || (nuevos.length > 0 && quiet >= 4))) {
      return nuevos.map((f) => path.join(dir, f));
    }
    if (Date.now() - start > timeoutMs) return nuevos.map((f) => path.join(dir, f));
    quiet = nuevos.length > 0 ? quiet + 1 : 0;
    await sleep(600);
  }
}

// --- utilidades -----------------------------------------------------------

async function screenshot(page, config, tag) {
  try {
    const dir = path.resolve(config.__toolRoot || '.', 'screenshots');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `mensajeria-${String(tag).replace(/[^\w.-]+/g, '_')}-${Date.now()}.png`);
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

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
