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

    // A DÓNDE bajar (dato del dueño, 25/07): UnideGes recoge los ficheros
    // de C:\Autocomm\entradas — lo que cae ahí aparece solo en la ventana
    // de "Albarán electrónico" y es lo que LMMAMA deja elegir. Si esa
    // carpeta existe (o sea, en el PC de la tienda), se baja DIRECTO ahí;
    // si no (PC de casa, pruebas), a la carpeta de siempre.
    const entradas = String(config.mensajeria?.entradasDir ?? 'C:\\Autocomm\\entradas');
    const usarEntradas = !soloMarcar && entradas !== '' && fs.existsSync(entradas);
    const dirDescargas = usarEntradas ? entradas : dir;

    if (!soloMarcar) {
      // Las descargas del navegador caen en ESTA carpeta (no en la del perfil
      // de Edge): así cada ejecución deja su lote junto y ordenado.
      await prepararDescargas(page, dirDescargas);
    }

    // Recorre las páginas y, EN CADA UNA, marca las filas elegidas. En modo
    // prueba se queda ahí (casillas marcadas, sin tocar nada más); en modo
    // real pulsa además el "Descargar" de la BARRA de la página (visto en la
    // instalación del dueño, 24/07: la lista no tiene botón por fila).
    const r = await recorrerYDescargar(page, config, { hoyIso, dias, dir: dirDescargas, maxDescargas, soloMarcar, logger });
    if (usarEntradas) {
      // Para reenviar por Telegram y dejar registro se COPIA cada fichero a
      // la carpeta fechada del bot; el ORIGINAL se queda en entradas para
      // que UnideGes lo procese (si la copia falla, se manda el original).
      for (const d of r.descargados) {
        if (!d.file) continue;
        try {
          const destino = path.join(dir, path.basename(d.file));
          fs.copyFileSync(d.file, destino);
          d.enEntradas = d.file;
          d.file = destino;
        } catch { d.enEntradas = d.file; }
      }
    }
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
      entradasDir: usarEntradas ? entradas : '',
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
    if (result.entradasDir) {
      lines.push('', `文件已直接下到 ${result.entradasDir}——UnideGes 那边能直接看到。接着可以发 /procesar_albaranes 处理货单、/procesar_lmanma 处理文件。`);
    } else {
      lines.push('', `文件已逐个发上来；电脑里也存在：${result.dir}`);
    }
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
  // AUTOCURACIÓN (fallo real 25/07 por la tarde): en esta instalación la
  // fila entera es clicable (abre la ficha del mensaje) y el circuito Blazor
  // puede refrescar la página él solo. Si la página salta a mitad de una
  // pasada, se deshacen los contadores de ESA pasada, se vuelve a la lista y
  // se reintenta, en vez de reventar el flujo entero. Lo ya conseguido
  // (descargados) se conserva y yaProcesadas evita repetirlo.
  let recuperaciones = 0;
  const yaProcesadas = new Set();
  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    setLive('[mensajeria] 读消息列表第 ' + (pageIndex + 1) + ' 页…');
    const foto = {
      total: out.total, sinFecha: out.sinFecha, fueraDeVentana: out.fueraDeVentana,
      omitidos: out.omitidosFruta.length, fallidos: out.fallidos.length,
      excedente: out.excedente, prevSig
    };
    try {
      const rows = await scrapeMensajesPage(page);
      const sig = rows.map((r) => (r.cells || []).join('|')).join('||');
      if (pageIndex > 0 && (!rows.length || sig === prevSig)) break;
      prevSig = sig;
      out.total += rows.length;

      const f = filtrarMensajes(rows, { hoyIso, dias });
      out.omitidosFruta.push(...f.omitidosFruta);
      out.sinFecha += f.sinFecha.length;
      out.fueraDeVentana += f.fueraDeVentana;

      let aBajar = f.seleccionados.filter((m) => !yaProcesadas.has(m.texto));
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
        for (const msg of marcados) { out.descargados.push({ ...msg, marcado: true }); yaProcesadas.add(msg.texto); }
        for (const msg of sinEntrada) out.fallidos.push({ msg, error: '没勾上' });
      } else {
        setLive(`[mensajeria] 勾选 ${aBajar.length} 条，点工具栏 Descargar…`);
        const { files, sinEntrada } = await descargarSeleccion(page, aBajar, dir, config);
        if (files.length === aBajar.length) {
          aBajar.forEach((msg, i) => { out.descargados.push({ ...msg, file: files[i], bytes: fs.statSync(files[i]).size }); yaProcesadas.add(msg.texto); });
        } else if (files.length === 1 && aBajar.length > 1) {
          // Un solo archivo para varios mensajes: la web los ha empaquetado (zip).
          out.descargados.push({ tipo: 'lote', texto: `${aBajar.length} 个打包`, fechaIso: hoyIso, caption: `打包下载 · ${aBajar.length} 个文件`, file: files[0], bytes: fs.statSync(files[0]).size });
          for (const msg of aBajar) yaProcesadas.add(msg.texto);
        } else {
          files.forEach((file, i) => { out.descargados.push({ ...aBajar[i], file, bytes: fs.statSync(file).size }); yaProcesadas.add(aBajar[i].texto); });
          for (const msg of aBajar.slice(files.length)) out.fallidos.push({ msg, error: '工具栏 Descargar 没产出它的文件' });
        }
        for (const msg of sinEntrada) out.fallidos.push({ msg, error: '没勾上或页面没有工具栏 Descargar 按钮' });
      }

      const moved = await clickNextPage(page);
      if (!moved) break;
      await esperarPaginaNueva(page, sig, 8000);
    } catch (error) {
      if (!esErrorDeNavegacion(error) || recuperaciones >= 3) {
        if (esErrorDeNavegacion(error)) {
          error.message = `Mensajería 列表页反复自己跳走/刷新，回去重试了 ${recuperaciones} 次都没稳住：${error.message}`;
        }
        throw error;
      }
      recuperaciones += 1;
      out.total = foto.total;
      out.sinFecha = foto.sinFecha;
      out.fueraDeVentana = foto.fueraDeVentana;
      out.omitidosFruta.length = foto.omitidos;
      out.fallidos.length = foto.fallidos;
      out.excedente = foto.excedente;
      prevSig = foto.prevSig;
      setLive('[mensajeria] 页面中途跳走了，回列表重试（第 ' + recuperaciones + ' 次）…');
      logger?.warn?.('mensajeria pagina salto, recuperando', { intento: recuperaciones, error: String(error.message).slice(0, 200) });
      await recuperarLista(page, config);
      pageIndex -= 1;
      continue;
    }
  }
  logger?.info('mensajeria rows read', { filas: out.total, recuperaciones });
  return out;
}

// ¿El error huele a "la página saltó/se refrescó a mitad de la operación"?
// Solo esos se reintentan con recuperación; cualquier otro sube tal cual.
// (Es puro y exportado para poder testearlo sin navegador.)
export function esErrorDeNavegacion(error) {
  return /context was destroyed|cannot find context|execution context|frame got detached|detached frame|node is detached|most likely because of a navigation/i
    .test(String(error?.message || error || ''));
}

// Vuelve a la lista tras un salto inesperado: si la página actual ya no es
// la lista (p.ej. se abrió la ficha de un mensaje), primero atrás en el
// historial; luego la maquinaria normal de ensureMensajeriaPage (menú
// lateral / URLs candidatas) y la espera de filas de siempre.
async function recuperarLista(page, config) {
  try {
    const st = await getMensajeriaState(page);
    if (!st.isMensajeriaList) await page.goBack({ waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => {});
  } catch { await sleep(1500); }
  try { await ensureMensajeriaPage(page, config); } catch { /* la pasada siguiente decidirá */ }
  await esperarFilasGrid(page, Number(config.mensajeria?.gridTimeoutMs) || 25000);
}

// Marca las casillas de las filas indicadas y VERIFICA que el estado ha
// cambiado de verdad (contar clics sin más mentía: el 24/07 reportaba
// "已勾选 4 个" con la lista vacía de marcas).
//
// CLIC DE RATÓN REAL, no click() sintético (fallo real 25/07 por la tarde):
// input.click() solo dispara el evento 'click' — sin eventos de puntero, el
// manejador de DevExpress no corre (la casilla no se marca, el 24/07) y el
// 'click' burbujea hasta la FILA, que en esta instalación es clicable entera
// (cursor-pointer) y abre la ficha del mensaje: la página salta a mitad de
// marcado (el 25/07). Un clic de ratón de verdad hace lo mismo que el dueño:
// pointerdown → DevExpress lo captura, marca la casilla y frena el clic de
// fila. Estado en la CLASE del contenedor <dxbl-check> ('unchecked' contiene
// 'checked': classList siempre, nunca substring).
async function marcarFilas(page, msgs) {
  // Posición y estado de la casilla de UNA fila (centrándola en pantalla
  // para que las coordenadas sirvan para el clic de ratón).
  const estadoCasilla = (idx) => page.evaluate((i) => {
    const tr = document.querySelector(`[data-mensajeria-idx="${i}"]`);
    if (!tr) return null;
    const wrap = tr.querySelector('dxbl-check');
    const input = wrap ? wrap.querySelector('input[type="checkbox"]') : tr.querySelector('input[type="checkbox"]');
    const el = wrap || input;
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return {
      x: r.x + r.width / 2,
      y: r.y + r.height / 2,
      marcado: Boolean(wrap?.classList.contains('dxbl-checkbox-checked') || input?.checked)
    };
  }, idx);

  const marcados = [];
  const sinEntrada = [];
  for (const msg of msgs) {
    let ok = false;
    for (let intento = 0; intento < 3 && !ok; intento += 1) {
      const antes = await estadoCasilla(msg.idx);
      if (!antes) break;
      if (antes.marcado) { ok = true; break; }
      await page.mouse.click(antes.x, antes.y);
      await sleep(500); // ida y vuelta al servidor Blazor
      const despues = await estadoCasilla(msg.idx);
      ok = Boolean(despues?.marcado);
    }
    (ok ? marcados : sinEntrada).push(msg);
  }
  return { marcados, sinEntrada };
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
// que en marcarFilas: clic de RATÓN, no click() sintético (el sintético
// burbujea a la fila clicable y abre la ficha). Una casilla por vuelta,
// re-consultando el DOM: tras cada clic Blazor repinta el grid.
async function desmarcarTodo(page) {
  try {
    for (let i = 0; i < 60; i += 1) {
      const punto = await page.evaluate(() => {
        const el = document.querySelector('tr[role="row"] dxbl-check.dxbl-checkbox-checked, tbody tr dxbl-check.dxbl-checkbox-checked')
          || Array.from(document.querySelectorAll('tr[role="row"] input[type="checkbox"]:checked, tbody tr input[type="checkbox"]:checked'))
            .find((b) => !b.closest('dxbl-check'))
          || null;
        if (!el) return null;
        el.scrollIntoView({ block: 'center' });
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      if (!punto) return;
      await page.mouse.click(punto.x, punto.y);
      await sleep(400);
    }
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
