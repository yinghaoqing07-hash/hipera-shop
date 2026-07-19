// =====================================================================
// Automatización de Pedidos por NAVEGADOR (DevExpress XAF web)
// =====================================================================
// Dos funciones:
//   1) inspectOrderPage()  → herramienta de diagnóstico. Se conecta,
//      localiza la pestaña de Pedidos y vuelca el HTML de la página a un
//      fichero para poder escribir/afinar los selectores. No rellena ni
//      guarda nada; como mucho navega a Pedidos si UnideGes está en otra
//      lista segura.
//   2) applyOrderWeb(draft) → rellena un pedido nuevo conduciendo el DOM.
//      Reglas de seguridad (idénticas a la versión de escritorio):
//        - NUNCA pulsa Guardar / Enviar Pedido.
//        - Deja el borrador a la vista y hace captura para revisión.
//   3) saveOrderWeb() / sendOrderWeb() → los ÚNICOS puntos de todo el bot
//      que pulsan Guardar y Enviar Pedido. Solo se llega a ellos desde los
//      botones de confirmación de Telegram/panel (nunca desde tareas
//      programadas ni desde el enrutador de lenguaje natural), no navegan
//      (operan sobre el formulario YA abierto) y verifican que el nombre
//      del pedido en pantalla es el que se confirmó.
//
// El grid de artículos de XAF es la parte delicada; sus selectores se
// completan a partir del volcado de inspectOrderPage(). Hasta entonces,
// applyOrderWeb rellena lo seguro (Nuevo + Nombre) y avisa.
import fs from 'node:fs';
import path from 'node:path';
import { connectBrowser, findOrderPage } from './webBrowser.js';
import { liveShotDone, setLive, setLiveShot } from './liveStatus.js';
import { llmConfigured, llmDiagnoseScreenshot } from './llm.js';
import { gridActivePage, gridClickPageDelta, gridWaitForPageChange } from './webPromotions.js';
import { selectLatestOrderRows } from './recentOrders.js';

// Sube (o localiza) la pestaña de UnideGes, la trae al frente y se asegura
// de que estamos en Pedidos. Esto evita pulsar por error un "Nuevo" de otra
// sección que tenga botones parecidos.
async function openOrderPage(config) {
  // Conectar + localizar la pestaña, con REINTENTO: si la pestaña estaba
  // dormida (Edge la suspende tras un rato inactiva), el primer intento
  // puede fallar con "Network.enable timed out" mientras el renderer
  // despierta; a la segunda suele responder.
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
      const err = new Error('连上了 Edge，但没找到 UnideGes 的标签页。请确认那个 Edge 窗口里打开了 UnideGes（网址含 unideges）。');
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
    await ensurePedidoPage(page, config);
  } catch (error) {
    try { browser.disconnect(); } catch { /* noop */ }
    throw error;
  }
  return { browser, page };
}

// --- 1) Inspección de solo lectura -----------------------------------
export async function inspectOrderPage(config, logger) {
  let browser;
  try {
    const opened = await openOrderPage(config);
    browser = opened.browser;
    const page = opened.page;

    const info = await page.evaluate(() => {
      const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
      const isVisible = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      // Busca el botón/enlace "Nuevo" por texto visible.
      const clickables = Array.from(document.querySelectorAll('button, a, [role="button"], [role="menuitem"]'));
      const nuevo = clickables.find((el) => isVisible(el) && /^\s*nuevo\b/i.test(clean(el.innerText)));
      // Etiqueta "Nombre" (campo del nombre del pedido en el DetailView).
      const labels = Array.from(document.querySelectorAll('label, span, div'));
      const nombreLabel = labels.find((el) => isVisible(el) && /^nombre\b/i.test(clean(el.innerText)) && clean(el.innerText).length < 40);

      return {
        title: document.title,
        url: location.href,
        nuevoFound: Boolean(nuevo),
        nuevoText: nuevo ? clean(nuevo.innerText) : null,
        nuevoTag: nuevo ? nuevo.tagName.toLowerCase() : null,
        nombreLabelFound: Boolean(nombreLabel),
        inputCount: document.querySelectorAll('input').length,
        buttonCount: document.querySelectorAll('button').length,
        gridCount: document.querySelectorAll('table, [role="grid"]').length
      };
    });

    const html = await page.content();
    const dumpFile = path.resolve(config.__toolRoot || '.', config.webOrder?.dumpFile || 'order-page-dump.html');
    fs.writeFileSync(dumpFile, html, 'utf8');
    logger?.info('web inspect ok', { url: info.url, nuevoFound: info.nuevoFound, bytes: html.length });
    return { ok: true, info, dumpFile };
  } catch (error) {
    logger?.error('web inspect failed', { stage: error.stage, error: error.message });
    return { ok: false, stage: error.stage || 'inspect', error: error.message };
  } finally {
    try { browser?.disconnect(); } catch { /* noop */ }
  }
}

// --- 1b) Inspección del FORMULARIO (tras pulsar Nuevo) ---------------
// Pulsa "Nuevo" para abrir el DetailView del pedido y vuelca su HTML, que
// es donde viven el campo "Nombre del Pedido" y el grid de artículos.
// Es un borrador sin guardar; NO se pulsa Guardar ni Enviar.
export async function inspectFormPage(config, logger) {
  let browser;
  try {
    const opened = await openOrderPage(config);
    browser = opened.browser;
    const page = opened.page;

    const openedNewOrder = await openNewOrderForm(page, Number(config.webOrder?.pageNavigationTimeoutMs) || 20000);
    if (!openedNewOrder.ok) {
      return { ok: false, stage: 'nuevo', error: openedNewOrder.error };
    }
    await sleep(2800); // esperar a que Blazor renderice el DetailView

    const info = await page.evaluate(() => {
      const isVisible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const textInputs = Array.from(document.querySelectorAll('input[type="text"], input:not([type]), textarea')).filter(isVisible).length;
      const actionNames = Array.from(document.querySelectorAll('[data-action-name]'))
        .map((e) => e.getAttribute('data-action-name'))
        .filter((v, i, a) => v && a.indexOf(v) === i);
      return {
        title: document.title,
        url: location.href,
        textInputs,
        gridCount: document.querySelectorAll('.dxbl-grid, [role="grid"]').length,
        actionNames
      };
    });

    const html = await page.content();
    const dumpFile = path.resolve(config.__toolRoot || '.', 'order-form-dump.html');
    fs.writeFileSync(dumpFile, html, 'utf8');
    logger?.info('web form inspect ok', { url: info.url, bytes: html.length });
    return { ok: true, info, dumpFile };
  } catch (error) {
    logger?.error('web form inspect failed', { stage: error.stage, error: error.message });
    return { ok: false, stage: error.stage || 'inspectForm', error: error.message };
  } finally {
    try { browser?.disconnect(); } catch { /* noop */ }
  }
}

// --- 2) Rellenar pedido: Nuevo + Nombre + líneas de artículo ----------
// Flujo "método A": en la fila de alta del grid (dxbl-grid-edit-new-item-row)
// se escribe el Código Unide, el desplegable de autocompletado filtra, se
// selecciona con Enter, se pasa a Cajas con Tab y se escribe la cantidad.
// Reglas de seguridad:
//   - NUNCA pulsa Guardar ni Enviar Pedido.
//   - Enter SOLO se pulsa con el desplegable de autocompletado ABIERTO
//     (así no puede disparar el botón por defecto del formulario).
//   - Si un código no da resultados o da VARIOS, se detiene esa línea,
//     hace captura y lo reporta (no adivina cuál elegir).
export async function applyOrderWeb(draft, config, logger, hooks = {}) {
  let browser;
  try {
    setLive('[pedido] 连接 Edge，打开 Pedidos…');
    const opened = await openOrderPage(config);
    browser = opened.browser;
    const page = opened.page;
    const w = config.webOrder || {};
    const ctx = {
      page, config, logger, w, hooks,
      autocompleteMs: Number(w.autocompleteMs) || 900,
      autocompleteTimeoutMs: Number(w.autocompleteTimeoutMs) || 5000,
      betweenLinesMs: Number(w.betweenLinesMs) || 400,
      total: draft.items.length,
      autoPicked: 0, namePicked: 0, repairedCount: 0, qtyCorregidas: 0,
      unrepairedBlanks: 0, unrepairedCodes: [],
      diagnosticos: [], motivos: new Map(),
      sinDatosPrevios: leerCodigosSinDatos(config)
    };

    setLive('[pedido] 点 Nuevo，等表单渲染…');
    const openedNewOrder = await openNewOrderForm(page, Number(w.pageNavigationTimeoutMs) || 20000);
    if (!openedNewOrder.ok) {
      setLive('[pedido] ERROR: ' + openedNewOrder.error);
      return { ok: false, stage: 'nuevo', error: openedNewOrder.error };
    }
    await sleep(Number(w.formRenderMs) || 2800);
    setLive('[pedido] 填订单名「' + draft.orderName + '」…');
    if (!(await fillNombre(page, draft.orderName))) {
      return { ok: false, stage: 'nombre', error: '没找到订单名输入框（aria-required maxlength=150）。' };
    }
    await sleep(300);

    // Fase 1: rellenar todas las líneas.
    const results = [];
    for (let i = 0; i < draft.items.length; i++) {
      const r = await rellenarUnaLinea(ctx, draft.items[i], i + 1);
      if (r.abort) return { ok: false, stage: r.stage, screenshot: r.screenshot, domDump: r.domDump, error: r.error, results, diagnosticos: ctx.diagnosticos };
      results.push(r);
    }

    // Fase 2: AUDITORÍA contra el grid real + reparación (máx. 2 rondas).
    // Lección del pedido de 37 líneas: el resumen contaba lo que el bot
    // CREÍA haber hecho; ahora se lee la tabla entera (todas las páginas)
    // y solo cuenta lo que de verdad hay: faltantes, cajas mal, filas a
    // medias (C.Central sin código) y filas basura vacías.
    const reparaciones = { cajas: 0, medias: 0, vacias: 0, rellenadas: 0, duplicadas: 0 };
    // Solo cuentan como "por reparar" los problemas ACCIONABLES: un
    // faltante ya confirmado inexistente (motivo apuntado) no se puede
    // arreglar y no debe gastar una ronda entera en re-buscarlo.
    const accionables = (a) => a.problemas
      - a.faltantes.filter((it) => ctx.motivos.has(String(it.anchorCode || it.code || '').trim())).length;
    let auditoria = await auditarPedido(page, config, draft, ctx.motivos);
    for (let ronda = 1; ronda <= 2 && accionables(auditoria) > 0; ronda += 1) {
      setLive(`[pedido] 对账发现 ${auditoria.problemas} 处问题（可修 ${accionables(auditoria)}），第 ${ronda} 轮修复…`);
      await repararAuditoria(ctx, draft, auditoria, results, reparaciones);
      auditoria = await auditarPedido(page, config, draft, ctx.motivos);
    }

    setLive('[pedido] 最终核对和截图…');
    const shot = await screenshot(page, config, 'done');
    const notes = [];
    if (ctx.autoPicked > 0) notes.push(`${ctx.autoPicked} 行有多个匹配，已自动选 Código Unide 相符的那行`);
    if (ctx.namePicked > 0) notes.push(`${ctx.namePicked} 行代码没搜到，已改用商品名搜到并选中`);
    const arreglos = [];
    if (reparaciones.rellenadas) arreglos.push(`补填 ${reparaciones.rellenadas} 行`);
    if (reparaciones.cajas) arreglos.push(`补数量 ${reparaciones.cajas} 行`);
    if (reparaciones.medias) arreglos.push(`重输码 ${reparaciones.medias} 行`);
    if (reparaciones.vacias) arreglos.push(`删空行 ${reparaciones.vacias} 个`);
    if (reparaciones.duplicadas) arreglos.push(`删重复行 ${reparaciones.duplicadas} 行`);
    if (ctx.repairedCount) arreglos.push(`就地修复空白行 ${ctx.repairedCount} 次`);
    if (ctx.qtyCorregidas) arreglos.push(`数量当场改正 ${ctx.qtyCorregidas} 行`);
    if (arreglos.length) notes.push('自动修复：' + arreglos.join('、'));
    const autoNote = notes.length ? `（${notes.join('；')}）` : '';
    const pendientes = auditoria.pendientesNota;
    logger?.info('web order filled+audited', { name: draft.orderName, correctas: auditoria.correctas, total: draft.items.length, problemas: auditoria.problemas });
    setLive('[pedido] listo');
    return {
      ok: true,
      screenshot: shot,
      message: `订单名「${draft.orderName}」：全表对账后 ${auditoria.correctas}/${draft.items.length} 条正确${autoNote}。${pendientes}\n请看截图核对。这一步还没有点 Guardar，也没有点 Enviar Pedido。`,
      results,
      diagnosticos: ctx.diagnosticos,
      auditoria: { correctas: auditoria.correctas, total: draft.items.length, problemas: auditoria.problemas, detalle: auditoria.detalle },
      reparaciones
    };
  } catch (error) {
    setLive('[pedido] ERROR: ' + error.message);
    logger?.error('web order apply failed', { stage: error.stage, error: error.message });
    return { ok: false, stage: error.stage || 'apply', error: error.message };
  } finally {
    try { browser?.disconnect(); } catch { /* noop */ }
  }
}

// Rellena UNA línea (misma lógica de siempre): nueva fila, búsqueda en
// cadena con ancla, rondas de reintento, rescate con diagnóstico visual, y
// cantidad + doble Enter. La usan el llenado inicial y la reparación de
// faltantes de la auditoría.
async function rellenarUnaLinea(ctx, item, etiqueta, reintento = false) {
  const { page, config, logger, w, hooks } = ctx;
  const code = String(item.code || '').trim();
  const qty = String(item.quantity ?? '').trim();
  const nombre = String(item.nombre || '').trim();
  const searchTerm = code || nombre || String(item.name || '').trim();
  const original = String(item.originalCode || '').trim();
  const codeLabel = original && original !== code ? `${original} → EAN ${code}` : (code || searchTerm);
  setLive(`[pedido] 第 ${etiqueta}/${ctx.total} 行：${nombre || codeLabel}`);
  if (!searchTerm) return { code, qty, ok: false, reason: 'sin código' };

  const anchorCode = String(item.anchorCode || item.originalCode || code).trim();
  // Código ya confirmado "sin datos" hace poco (lista persistente): ni se
  // busca. Borrar logs/codigos-sin-datos.json (o esperar a que caduque la
  // entrada) reactiva la búsqueda si el artículo vuelve al catálogo.
  const previo = ctx.sinDatosPrevios?.get(anchorCode) || ctx.sinDatosPrevios?.get(code);
  if (previo) {
    const motivoLinea = `${previo.fecha} 已确认目录里没有这个编号，本次自动跳过`;
    ctx.motivos.set(anchorCode || code, motivoLinea);
    setLive(`[pedido] 第 ${etiqueta}/${ctx.total} 行跳过（${previo.fecha} 已确认不存在）`);
    try { hooks?.avisar?.(`第 ${etiqueta} 行 ${nombre || codeLabel}：${previo.fecha} 已确认目录里没有，直接跳过没再搜。`); } catch { /* aviso no crítico */ }
    return { code, qty, ok: false, reason: 'nodata-previo', skipped: true, nota: `${codeLabel}${nombre ? '（' + nombre + '）' : ''}：${motivoLinea}` };
  }

  // Foto de las filas en blanco que YA existían antes de esta línea: solo
  // la fila en blanco NUEVA que aparezca tras confirmar es de esta línea y
  // puede repararse con SUS términos (las viejas son de otros artículos).
  const blancasAntes = await centralesFilasBlancas(page);

  await esperarGridLibre(page, config, `第${etiqueta}行开编辑`);
  const prepared = await prepareItemEditor(page, ctx.autocompleteTimeoutMs);
  if (!prepared) {
    const shot = await screenshot(page, config, 'newrow');
    const dom = await captureEditDom(page, config);
    return {
      abort: true, stage: 'newrow', screenshot: shot, domDump: dom,
      error: `第 ${etiqueta} 行：没找到可输入的 artículo 编辑框，也没能打开“新增行”。前面已填的不会保存。（已保存页面结构）`
    };
  }
  await sleep(Number(w.nextLineReadyMs) || 120);

  const attempts = [{ term: searchTerm, requireAnchor: false }];
  if (original && original !== searchTerm) attempts.push({ term: original, requireAnchor: false, via: 'code' });
  if (nombre && nombre !== searchTerm) attempts.push({ term: nombre, requireAnchor: true, via: 'name' });

  let sel = { status: 'nomatch' };
  let triedName = false;
  // "El desplegable dijo EXPLÍCITAMENTE que no hay datos" al buscar por
  // código ≠ "no salió nada": lo primero es respuesta firme del catálogo y
  // no merece ni segunda ronda ni rescate con IA (retrospectiva del 17/07).
  let nodataPorCodigo = false;
  for (let ronda = 0; ronda < 2 && sel.status !== 'ok'; ronda += 1) {
    if (ronda > 0) {
      if (sel.status !== 'nomatch' || nodataPorCodigo) break;
      setLive(`[pedido] 第 ${etiqueta}/${ctx.total} 行没出补全，重试一次…`);
      await clearArticleEditor(page);
      await sleep(1500);
    }
    const timeoutRonda = ronda > 0 ? ctx.autocompleteTimeoutMs * 2 : ctx.autocompleteTimeoutMs;
    for (let t = 0; t < attempts.length; t += 1) {
      if (t > 0) await clearArticleEditor(page);
      const at = attempts[t];
      if (at.via === 'name') triedName = true;
      const r = await searchAndSelect(page, at.term, anchorCode, timeoutRonda, ctx.autocompleteMs, at.requireAnchor);
      if (r.status === 'ok') { sel = { ...r, viaName: at.via === 'name' }; break; }
      if (r.status === 'nodata' && at.via !== 'name') nodataPorCodigo = true;
      sel = r;
    }
  }
  // Código con "sin datos" en firme y el nombre tampoco encontró nada: es
  // un artículo inexistente, no un fallo de la búsqueda.
  if ((sel.status === 'nomatch' || sel.status === 'nodata') && nodataPorCodigo) sel = { status: 'nodata' };
  if (sel.status !== 'ok' && triedName) sel.nameTried = true;

  // Última bala: el modelo MIRA la captura y decide si hay rescate.
  let diagnosticoIA = null;
  if (sel.status === 'nomatch' && llmConfigured(config)) {
    setLive(`[pedido] 第 ${etiqueta} 行卡住，AI 看图分析中…`);
    const fotoDiag = await screenshot(page, config, `line-${etiqueta}-diag`);
    if (fotoDiag) {
      setLiveShot(fotoDiag);
      diagnosticoIA = await llmDiagnoseScreenshot(fotoDiag, {
        tarea: `rellenar la línea ${etiqueta}/${ctx.total} del pedido web`,
        termino: searchTerm, nombre, fallo: sel.status
      }, config, logger).catch((error) => {
        logger?.warn('screenshot diagnosis failed', { error: error.message });
        return null;
      });
      liveShotDone();
    }
    if (diagnosticoIA?.recuperable) {
      setLive(`[pedido] AI：${String(diagnosticoIA.problema || '').slice(0, 60)}，自动补救中…`);
      try { await page.keyboard.press('Escape'); } catch { /* sin popup */ }
      await sleep(400);
      const listoDeNuevo = await prepareItemEditor(page, ctx.autocompleteTimeoutMs);
      if (listoDeNuevo) {
        await page.evaluate(() => {
          const el = document.activeElement;
          if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center' });
        }).catch(() => {});
        await sleep(600);
        for (let t = 0; t < attempts.length && sel.status !== 'ok'; t += 1) {
          if (t > 0) await clearArticleEditor(page);
          const at = attempts[t];
          const r = await searchAndSelect(page, at.term, anchorCode, ctx.autocompleteTimeoutMs * 2, ctx.autocompleteMs, at.requireAnchor);
          sel = r.status === 'ok' ? { ...r, viaName: at.via === 'name' } : r;
        }
        if (sel.status === 'ok') logger?.info('line rescued after AI diagnosis', { line: etiqueta, problema: diagnosticoIA.problema });
      }
    }
    if (diagnosticoIA) {
      const resultado = sel.status === 'ok' ? '已自救成功' : (diagnosticoIA.recuperable ? '补救没成' : '判定商品问题');
      ctx.diagnosticos.push({ linea: etiqueta, termino: searchTerm, nombre, problema: diagnosticoIA.problema, recuperable: diagnosticoIA.recuperable, pista: diagnosticoIA.pista, resultado });
      // Directo al chat, corto y sin IA de por medio (petición de la dueña).
      try { hooks?.avisar?.(`AI 看图（第 ${etiqueta} 行 ${nombre || codeLabel}）：${diagnosticoIA.problema} → ${resultado}`); } catch { /* aviso no crítico */ }
    }
  }

  if (sel.status !== 'ok') {
    const motivoLinea = sel.status === 'ambiguous'
      ? `有多个匹配、无法自动选（código ${anchorCode} 对不上任何一行）`
      : sel.status === 'nodata'
        ? '自动补全下拉明确显示「无数据」，目录里没有这个编号'
        : (diagnosticoIA?.problema || '搜索无结果');
    const saltable = sel.status === 'ambiguous' || sel.status === 'nodata' || diagnosticoIA?.recuperable === false;
    if (saltable) {
      const nota = `${codeLabel}${nombre ? '（' + nombre + '）' : ''}：${motivoLinea}`;
      ctx.motivos.set(anchorCode || code, motivoLinea);
      // SOLO el "sin datos" explícito del desplegable entra en la lista
      // persistente. El veredicto visual de la IA vale para ESTA ejecución
      // (ctx.motivos) pero NO se guarda: el 18/07 la IA marcó como
      // inexistentes productos reales (850799, 851657, 852539) cuando lo
      // roto era la interacción, y la lista los habría saltado un mes.
      if (sel.status === 'nodata') {
        anotarCodigoSinDatos(config, anchorCode || code, nombre, motivoLinea);
        ctx.sinDatosPrevios?.set(anchorCode || code, { fecha: new Date().toISOString().slice(0, 10), nombre, motivo: motivoLinea, firme: true });
        try { hooks?.avisar?.(`第 ${etiqueta} 行 ${nombre || codeLabel}：下拉明确显示「无数据」，已跳过并记入无效编号清单。`); } catch { /* aviso no crítico */ }
      }
      setLive(`[pedido] 第 ${etiqueta}/${ctx.total} 行跳过（${motivoLinea.slice(0, 40)}），继续下一行…`);
      await clearArticleEditor(page);
      return { code, qty, ok: false, reason: sel.status, skipped: true, nota };
    }
    // Sin veredicto FIRME (la IA caída, o simplemente nada tras agotar 2
    // rondas + nombre): también se SALTA, pero sin apuntar motivo — así la
    // auditoría final la reintenta una vez más. Antes esto abortaba el
    // pedido ENTERO: el 19/07 la línea 22/55 (con la API de visión caída)
    // tumbó las 33 líneas restantes.
    const aiCaida = llmConfigured(config) && !diagnosticoIA;
    const motivoSuave = diagnosticoIA?.problema
      || (aiCaida ? '代码和名字都搜不出补全（AI 看图这会儿也不可用，无法进一步判断）' : '代码和名字都搜不出补全');
    setLive(`[pedido] 第 ${etiqueta}/${ctx.total} 行搜不到，先跳过（最后对账会再试）…`);
    try { hooks?.avisar?.(`第 ${etiqueta} 行 ${nombre || codeLabel}：${motivoSuave}。先跳过继续，最后对账时会再试一次。`); } catch { /* aviso no crítico */ }
    await clearArticleEditor(page);
    return { code, qty, ok: false, reason: sel.status, skipped: true, nota: `${codeLabel}${nombre ? '（' + nombre + '）' : ''}：${motivoSuave}` };
  }
  if (sel.via === 'anchor') ctx.autoPicked += 1;
  if (sel.viaName) ctx.namePicked += 1;
  await sleep(Number(w.selectSettleMs) || 500);
  if (qty) {
    await escribirCajasEnEdicion(page, qty, Number(w.nextFieldMs) || 140);
  } else {
    await focusEditRowEditor(page);
    await page.keyboard.press('Tab');
    await sleep(Number(w.nextFieldMs) || 140);
  }
  await page.keyboard.press('Enter');
  await sleep(150);
  await page.keyboard.press('Enter');
  await sleep(ctx.betweenLinesMs);

  let repaired = false;
  if (w.repairBlankLines !== false) {
    // Solo se repara la fila en blanco NUEVA (la que no estaba en la foto
    // de antes): es la de ESTA línea. Reparar "cualquier blanca" con los
    // términos de la línea actual escribió un MANZANA donde iba un PERA
    // (18/07, v188). Las viejas las arregla la auditoría final con los
    // términos de SU artículo.
    const restantes = new Map();
    for (const c of blancasAntes) restantes.set(c, (restantes.get(c) || 0) + 1);
    const nuevas = (await centralesFilasBlancas(page)).filter((c) => {
      const n = restantes.get(c) || 0;
      if (n > 0) { restantes.set(c, n - 1); return false; }
      return true;
    });
    if (nuevas.length) {
      repaired = await repairBlankLine(page, { searchTerm, nombre, anchorCode }, ctx.autocompleteTimeoutMs, ctx.autocompleteMs, nuevas[0]);
      if (repaired) ctx.repairedCount += 1;
      else { ctx.unrepairedBlanks += 1; ctx.unrepairedCodes.push(codeLabel); }
    }
  }

  // --- Eco INMEDIATO de la línea (retro del 18/07): releer la fila recién
  // confirmada ANTES de pasar a la siguiente. La cascada de aquel pedido
  // (851040 se atascó → su editor quedó abierto con texto → 850574 y las
  // siguientes tecleaban en un sitio roto) se corta aquí, no en la
  // auditoría final.
  let codigoEnGrid = '';
  let cajasLeidas = null;
  for (const c of codigosDeItem(item)) {
    const v = await leerCajasDeFila(page, c, '');
    if (v !== null) { codigoEnGrid = c; cajasLeidas = v; break; }
  }
  if (cajasLeidas === null && !reintento && (await filaEdicionSucia(page))) {
    // Pinta de commit que no cuajó (fila no visible + editor con texto).
    // PERO antes de reintentar hay que mirar TODAS las páginas: el 18/07
    // (v187) la fila 620201 SÍ se había confirmado — quedó en la página
    // anterior al saltar el paginador — y el reintento la duplicó.
    await page.keyboard.press('Escape');
    await sleep(800);
    let confirmadaEnOtraPagina = false;
    for (const c of codigosDeItem(item)) {
      if (await irAPaginaDeFila(page, config, c, '')) { confirmadaEnOtraPagina = true; break; }
    }
    // La fila de alta ("haga clic…") vive en la última página: volver ahí
    // para que la línea siguiente pueda abrir su editor.
    await irAUltimaPagina(page);
    if (confirmadaEnOtraPagina) {
      setLive(`[pedido] 第 ${etiqueta} 行其实已提交（在前面的页里找到了），继续…`);
    } else {
      setLive(`[pedido] 第 ${etiqueta} 行提交没生效（全表都没有），清掉残留重来一次…`);
      return rellenarUnaLinea(ctx, item, etiqueta, true);
    }
  }
  if (cajasLeidas !== null && qty) {
    const leidoN = Number(String(cajasLeidas).replace(',', '.'));
    const esperadoN = Number(String(qty).replace(',', '.'));
    if (Number.isFinite(esperadoN) && esperadoN > 0 && leidoN !== esperadoN) {
      // Cantidad mal NADA más confirmarse (el "11" de 620201, el "0" de
      // 850881): arreglarla ahora que se sabe qué fila es.
      setLive(`[pedido] 第 ${etiqueta} 行数量回读是 ${cajasLeidas}，当场改回 ${qty}…`);
      if (await filaEnEdicion(page)) { await page.keyboard.press('Escape'); await sleep(500); }
      if (await corregirCajasFila(ctx, codigoEnGrid, '', qty)) ctx.qtyCorregidas += 1;
    }
  }
  return { code, qty, ok: true, repaired };
}

// ---- Auditoría del pedido contra el grid REAL (todas las páginas) ------
const centralACodigo = (central) => {
  const m = String(central || '').trim().match(/^9(\d+)0$/);
  return m ? m[1] : '';
};

function codigosDeItem(item) {
  return [item.anchorCode, item.originalCode, item.code]
    .map((c) => String(c || '').trim()).filter(Boolean);
}

// ---- Lista persistente de códigos "sin datos" --------------------------
// Códigos que el catálogo ya negó en firme (desplegable "sin datos" o IA
// confirmándolo): se apuntan en logs/codigos-sin-datos.json y los pedidos
// siguientes los saltan sin buscar. Caducan a los 30 días (los artículos
// de temporada vuelven); borrar el archivo también reactiva la búsqueda.
const SIN_DATOS_DIAS = 30;

function rutaCodigosSinDatos(config) {
  return path.resolve(config.__toolRoot || '.', 'logs', 'codigos-sin-datos.json');
}

function leerCodigosSinDatos(config) {
  const mapa = new Map();
  try {
    const ruta = rutaCodigosSinDatos(config);
    const raw = JSON.parse(fs.readFileSync(ruta, 'utf8'));
    const corte = Date.now() - SIN_DATOS_DIAS * 24 * 3600 * 1000;
    let habiaSucias = false;
    const limpio = {};
    for (const [codigo, entrada] of Object.entries(raw || {})) {
      // Solo valen las entradas FIRMES (el desplegable dijo "sin datos").
      // Las que apuntó v186 por veredicto de la IA (sin `firme`) se PURGAN
      // del archivo: el 18/07 marcaron productos reales como inexistentes.
      if (entrada?.firme !== true) { habiaSucias = true; continue; }
      limpio[codigo] = entrada;
      const t = Date.parse(entrada?.fecha || '');
      if (Number.isFinite(t) && t >= corte) mapa.set(codigo, entrada);
    }
    if (habiaSucias) fs.writeFileSync(ruta, JSON.stringify(limpio, null, 2), 'utf8');
  } catch { /* sin lista todavía */ }
  return mapa;
}

function anotarCodigoSinDatos(config, codigo, nombre, motivo) {
  try {
    const ruta = rutaCodigosSinDatos(config);
    fs.mkdirSync(path.dirname(ruta), { recursive: true });
    let raw = {};
    try { raw = JSON.parse(fs.readFileSync(ruta, 'utf8')) || {}; } catch { /* archivo nuevo */ }
    raw[String(codigo)] = {
      fecha: new Date().toISOString().slice(0, 10),
      nombre: String(nombre || '').slice(0, 60),
      motivo: String(motivo || '').slice(0, 120),
      firme: true
    };
    fs.writeFileSync(ruta, JSON.stringify(raw, null, 2), 'utf8');
  } catch { /* la lista es una mejora, no un requisito */ }
}

async function auditarPedido(page, config, draft, motivos) {
  const filas = await scrapeFilasAuditoria(page, config);
  const porCodigo = new Map();
  for (const f of filas) {
    const clave = f.codigo || centralACodigo(f.central);
    if (clave) {
      if (!porCodigo.has(clave)) porCodigo.set(clave, []);
      porCodigo.get(clave).push(f);
    }
  }
  const faltantes = [];
  const cajasMal = [];
  const mediasFilas = [];
  const duplicadas = [];
  let correctas = 0;
  for (const item of draft.items) {
    const codigos = codigosDeItem(item);
    let cand = null;
    let codigoEnGrid = '';
    for (const c of codigos) {
      const x = porCodigo.get(c);
      if (x && x.length) { cand = x; codigoEnGrid = c; break; }
    }
    const qtyEsperada = Number(String(item.quantity ?? '').replace(',', '.'));
    if (!cand) { faltantes.push(item); continue; }
    // La MISMA línea repetida (la duplicó un reintento, como el 620201 del
    // 18/07): es un problema aunque cada copia esté "bien" por separado.
    if (cand.length > 1) { duplicadas.push({ item, codigo: codigoEnGrid, veces: cand.length, qtyEsperada }); continue; }
    const fila = cand[0];
    if (fila.media) { mediasFilas.push({ item, fila }); continue; }
    const cajas = Number(String(fila.cajas || '').replace(',', '.'));
    if (Number.isFinite(qtyEsperada) && qtyEsperada > 0 && cajas !== qtyEsperada) {
      cajasMal.push({ item, fila, cajas, qtyEsperada });
      continue;
    }
    correctas += 1;
  }
  const vacias = filas.filter((f) => f.vacia).length;
  const problemas = faltantes.length + cajasMal.length + mediasFilas.length + duplicadas.length + vacias;
  const etiquetaDe = (item) => {
    const cod = codigosDeItem(item)[0] || item.code || '';
    return `${cod}${item.nombre ? '（' + String(item.nombre).slice(0, 26) + '）' : ''}`;
  };
  const lineasNota = [];
  for (const item of faltantes) {
    const motivo = motivos.get(String(item.anchorCode || item.code || '').trim()) || '表里没有这一行';
    lineasNota.push(`- ${etiquetaDe(item)}：${motivo}`);
  }
  for (const x of cajasMal) lineasNota.push(`- ${etiquetaDe(x.item)}：数量是 ${x.cajas}，应为 ${x.qtyEsperada}`);
  for (const x of mediasFilas) lineasNota.push(`- ${etiquetaDe(x.item)}：这行只有 C.Central、Código Unide 空着`);
  for (const x of duplicadas) lineasNota.push(`- ${etiquetaDe(x.item)}：表里重复出现 ${x.veces} 次`);
  if (vacias) lineasNota.push(`- 表里还有 ${vacias} 个空行`);
  const pendientesNota = lineasNota.length
    ? `\n对账后仍有问题（需要人工）：\n${lineasNota.join('\n')}`
    : '';
  return { filas, faltantes, cajasMal, mediasFilas, duplicadas, vacias, correctas, problemas, pendientesNota, detalle: lineasNota };
}

async function repararAuditoria(ctx, draft, auditoria, results, reparaciones) {
  const { page, config } = ctx;
  // 1) filas basura vacías fuera (bloquean el Guardar y ensucian el pedido)
  if (auditoria.vacias > 0) {
    const borradas = await eliminarFilasVacias(page, config);
    reparaciones.vacias += borradas;
  }
  // 1b) líneas duplicadas: borrar las copias que sobran (checkbox +
  // Eliminar). Si las copias tienen cantidades distintas se intenta borrar
  // la que NO coincide con la esperada; la que quede, si está mal, la
  // arregla el paso de cantidades en la siguiente ronda.
  for (const x of auditoria.duplicadas || []) {
    setLive(`[pedido] 删除重复行 ${x.codigo}（多了 ${x.veces - 1} 行）…`);
    reparaciones.duplicadas += await eliminarFilaDuplicada(page, config, x.codigo, x.qtyEsperada, x.veces - 1);
  }
  // 2) medias filas: mismo gesto que el usuario, lápiz + reescribir el código
  for (const x of auditoria.mediasFilas) {
    const item = x.item;
    const code = String(item.code || '').trim();
    const nombre = String(item.nombre || '').trim();
    const anchorCode = String(item.anchorCode || item.originalCode || code).trim();
    setLive(`[pedido] 修复半空行 ${anchorCode}…`);
    await esperarGridLibre(page, config, `修半空行${anchorCode}`);
    if (await irAPaginaDeFila(page, config, '', x.fila.central)) {
      const ok = await repairBlankLine(page, { searchTerm: code || nombre, nombre, anchorCode }, ctx.autocompleteTimeoutMs, ctx.autocompleteMs, x.fila.central);
      if (ok) reparaciones.medias += 1;
    }
  }
  // 3) cantidades mal: lápiz + Tab a Cajas + reescribir
  for (const x of auditoria.cajasMal) {
    setLive(`[pedido] 补数量 ${x.fila.codigo || x.fila.central} → ${x.qtyEsperada}…`);
    if (await irAPaginaDeFila(page, config, x.fila.codigo, x.fila.central)) {
      const ok = await corregirCajasFila(ctx, x.fila.codigo, x.fila.central, x.qtyEsperada);
      if (ok) reparaciones.cajas += 1;
    }
  }
  // 4) faltantes: volver a rellenar la línea entera (misma rutina). Los
  // pasos anteriores dejan el grid en cualquier página; la fila de alta
  // vive en la última.
  if (auditoria.faltantes.length) await irAUltimaPagina(page);
  for (const item of auditoria.faltantes) {
    const clave = String(item.anchorCode || item.code || '').trim();
    // Un artículo que la IA confirmó inexistente no se reintenta: sería
    // repetir el mismo "sin datos" y gastar otra pasada.
    if (ctx.motivos.has(clave)) continue;
    setLive(`[pedido] 补填 ${clave}…`);
    const r = await rellenarUnaLinea(ctx, item, `补${clave}`);
    if (r.ok) reparaciones.rellenadas += 1;
    else if (r.nota) ctx.motivos.set(clave, r.nota);
  }
}

// Filas del grid de líneas tal cual están, INCLUYENDO medias y vacías
// (el lector normal las salta). Pagina igual que scrapeAllOrderLines.
async function scrapeFilasAuditoria(page, config) {
  await esperarGridLibre(page, config, '对账读表');
  const maxPages = 30;
  const settle = Number(config?.webOrder?.pageNavigationTimeoutMs) ? Math.min(Number(config.webOrder.pageNavigationTimeoutMs), 8000) : 8000;
  const leer = () => page.evaluate(() => {
    const clean = (s) => (s || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    const isVisible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const tables = Array.from(document.querySelectorAll('table')).filter(isVisible);
    for (const table of tables) {
      const headers = Array.from(table.querySelectorAll('th')).map((th) => clean(th.innerText));
      const idxCodigo = headers.findIndex((h) => /c[oó]digo unide/i.test(h));
      if (idxCodigo === -1) continue;
      const idxCentral = headers.findIndex((h) => /c\.?\s*central/i.test(h));
      const idxArticulo = headers.findIndex((h) => /^art[ií]culo$/i.test(h));
      const idxCajas = headers.findIndex((h) => /^cajas$/i.test(h));
      const out = [];
      for (const tr of Array.from(table.querySelectorAll('tr[role="row"]'))) {
        if (!isVisible(tr)) continue;
        if (tr.querySelector('input[type="text"]')) continue; // fila en edición
        const cells = Array.from(tr.querySelectorAll('td')).map((td) => clean(td.innerText));
        if (!cells.length) continue;
        if (cells.some((c) => /^suma:/i.test(c) || /haga clic/i.test(c))) continue;
        const central = idxCentral >= 0 ? (cells[idxCentral] || '') : '';
        const codigo = cells[idxCodigo] || '';
        const articulo = idxArticulo >= 0 ? (cells[idxArticulo] || '') : '';
        const cajas = idxCajas >= 0 ? (cells[idxCajas] || '') : '';
        const vacia = !central && !codigo && !articulo;
        const media = Boolean(central && !codigo);
        out.push({ central, codigo, articulo, cajas, vacia, media });
      }
      return out;
    }
    return [];
  });
  const sig = (fs) => (fs || []).map((f) => `${f.central}|${f.codigo}|${f.cajas}`).join('||');
  try {
    const active = await gridActivePage(page);
    if (active > 1) {
      const before = sig(await leer().catch(() => []));
      if (await gridClickPageDelta(page, { toPage: 1 })) {
        await gridWaitForPageChange(page, leer, sig, before, Math.min(settle, 4000));
      }
    }
  } catch { /* sin paginador */ }
  const all = [];
  let prevSig = '';
  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const filas = pageIndex === 0 ? await leer() : await gridWaitForPageChange(page, leer, sig, prevSig, settle);
    const s2 = sig(filas);
    if (pageIndex > 0 && (!filas.length || s2 === prevSig)) break;
    prevSig = s2;
    all.push(...filas);
    if (!(await gridClickPageDelta(page, +1))) break;
  }
  return all;
}

// Navega las páginas del grid hasta que la fila (por código o C.Central)
// esté a la vista. Devuelve false si no aparece en ninguna página.
async function irAPaginaDeFila(page, config, codigo, central) {
  const busca = () => page.evaluate((cod, cen) => {
    const clean = (s) => (s || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    const isVisible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const tables = Array.from(document.querySelectorAll('table')).filter(isVisible);
    for (const table of tables) {
      const headers = Array.from(table.querySelectorAll('th')).map((th) => clean(th.innerText));
      const idxCodigo = headers.findIndex((h) => /c[oó]digo unide/i.test(h));
      if (idxCodigo === -1) continue;
      const idxCentral = headers.findIndex((h) => /c\.?\s*central/i.test(h));
      for (const tr of Array.from(table.querySelectorAll('tr[role="row"]'))) {
        if (!isVisible(tr)) continue;
        const cells = Array.from(tr.querySelectorAll('td')).map((td) => clean(td.innerText));
        if (!cells.length) continue;
        const c = cells[idxCodigo] || '';
        const ce = idxCentral >= 0 ? (cells[idxCentral] || '') : '';
        if ((cod && c === cod) || (cen && ce === cen)) return true;
      }
    }
    return false;
  }, codigo || '', central || '');
  try {
    if (await gridActivePage(page) > 1) await gridClickPageDelta(page, { toPage: 1 });
  } catch { /* sin paginador */ }
  for (let i = 0; i < 30; i += 1) {
    await sleep(500);
    if (await busca()) return true;
    if (!(await gridClickPageDelta(page, +1))) return false;
  }
  return false;
}

// Guardia + CHIVATO de grid colgado: antes de cada gesto sobre el grid
// (abrir editor, lápiz, checkbox, scrape) espera a que el panel
// "Loading..." desaparezca. Si a los 8 s sigue, deja en el registro EN QUÉ
// operación pasó, guarda captura (sale en la columna derecha del panel) y
// distingue el caso "Blazor perdió la conexión y está reconectando" — ese
// no se cura esperando y es la pista clave para el diagnóstico.
async function esperarGridLibre(page, config, etiqueta) {
  const start = Date.now();
  let avisadoReconexion = false;
  while (Date.now() - start < 8000) {
    const est = await page.evaluate(() => {
      const isVisible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const cargando = Array.from(document.querySelectorAll('[class*="load" i]'))
        .some((el) => isVisible(el) && /loading|cargando/i.test(el.textContent || ''));
      const rec = document.querySelector('#components-reconnect-modal, [id*="reconnect" i], [class*="reconnect" i]');
      return { cargando, reconectando: Boolean(rec && isVisible(rec)) };
    }).catch(() => ({ cargando: false, reconectando: false }));
    if (est.reconectando) {
      if (!avisadoReconexion) { avisadoReconexion = true; setLive(`[pedido] ⚠ 页面掉线正在重连（${etiqueta}）…`); }
      await sleep(1000);
      continue;
    }
    if (!est.cargando) return true;
    await sleep(200);
  }
  const foto = await screenshot(page, config, `grid-colgado-${etiqueta}`);
  if (foto) { setLiveShot(foto); liveShotDone(); }
  // Rescate 1: Escape — cierra un popup invisible que retenga el grid.
  try { await page.keyboard.press('Escape'); } catch { /* sin foco */ }
  await sleep(1500);
  const trasEscape = await page.evaluate(() => {
    const isVisible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    return Array.from(document.querySelectorAll('[class*="load" i]'))
      .some((el) => isVisible(el) && /loading|cargando/i.test(el.textContent || ''));
  }).catch(() => false);
  if (!trasEscape) {
    setLive(`[pedido] ⚠ 表格卡了一下（卡点：${etiqueta}），按 Esc 后恢复，继续…`);
    return true;
  }
  // Rescate 2: el overlay "Loading..." a veces queda HUÉRFANO con el grid
  // vivo debajo — se oculta a mano (solo el velo pequeño, nunca un
  // contenedor grande) y se sigue; si el grid está muerto de verdad, el
  // siguiente gesto fallará y quedará reportado con su propio motivo.
  await page.evaluate(() => {
    const isVisible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    for (const el of document.querySelectorAll('[class*="load" i]')) {
      const t = (el.textContent || '').trim();
      if (isVisible(el) && /loading|cargando/i.test(t) && t.length < 40) el.style.display = 'none';
    }
  }).catch(() => {});
  setLive(`[pedido] ⚠ 表格卡在 Loading 超 8 秒（卡点：${etiqueta}），已拍照并揭掉卡死的遮罩，继续尝试…`);
  return false;
}

// Avanza el paginador hasta la última página (donde vive la fila de alta
// "Haga clic aquí para agregar…"). En un grid de una sola página no hace nada.
async function irAUltimaPagina(page) {
  for (let i = 0; i < 30; i += 1) {
    if (!(await gridClickPageDelta(page, +1))) return;
    await sleep(400);
  }
}

// Corrige la CANTIDAD de una fila existente: lápiz Editar → foco en el
// editor de artículo → Tab a Cajas → seleccionar todo → cantidad →
// Enter Enter (el mismo gesto que hace la dueña a mano). Tras el gesto se
// RELEE la celda Cajas para confirmar que cuajó; si no, un segundo intento
// aquí mismo (el 17/07 la primera pasada de 620207 no cuajó y solo la
// segunda ronda de auditoría lo pescó).
async function corregirCajasFila(ctx, codigo, central, qty) {
  const { page } = ctx;
  const esperado = Number(String(qty).replace(',', '.'));
  for (let intento = 0; intento < 2; intento += 1) {
    if (intento > 0) {
      try { await page.keyboard.press('Escape'); } catch { /* sin edición abierta */ }
      await sleep(500);
    }
    await esperarGridLibre(page, ctx.config, `改数量${codigo || central}`);
    const hecho = await gestoCorregirCajas(page, codigo, central, qty);
    if (!hecho) return false;
    let cajas = null;
    for (let espera = 0; espera < 3000; espera += 300) {
      cajas = await leerCajasDeFila(page, codigo, central);
      if (cajas !== null) break;
      await sleep(300);
    }
    if (cajas !== null && Number(String(cajas).replace(',', '.')) === esperado) return true;
  }
  return false;
}

// Lee la celda Cajas de la fila (por código o C.Central) tal cual está en
// el grid, saltando filas en edición. null = fila no localizable aún.
async function leerCajasDeFila(page, codigo, central) {
  return page.evaluate((cod, cen) => {
    const clean = (s) => (s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
    const isVisible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const tables = Array.from(document.querySelectorAll('table')).filter(isVisible);
    for (const table of tables) {
      const headers = Array.from(table.querySelectorAll('th')).map((th) => clean(th.innerText));
      const idxCodigo = headers.findIndex((h) => /c[oó]digo unide/i.test(h));
      const idxCajas = headers.findIndex((h) => /^cajas$/i.test(h));
      if (idxCodigo === -1 || idxCajas === -1) continue;
      const idxCentral = headers.findIndex((h) => /c\.?\s*central/i.test(h));
      for (const tr of Array.from(table.querySelectorAll('tr[role="row"]'))) {
        if (!isVisible(tr)) continue;
        if (tr.querySelector('input[type="text"]')) continue;
        const cells = Array.from(tr.querySelectorAll('td')).map((td) => clean(td.innerText));
        if (!cells.length) continue;
        const c = cells[idxCodigo] || '';
        const ce = idxCentral >= 0 ? (cells[idxCentral] || '') : '';
        if ((cod && c === cod) || (cen && ce === cen)) return cells[idxCajas] || '';
      }
    }
    return null;
  }, codigo || '', central || '');
}

async function gestoCorregirCajas(page, codigo, central, qty) {
  const handle = await page.evaluateHandle((cod, cen) => {
    const clean = (s) => (s || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    const isVisible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const tables = Array.from(document.querySelectorAll('table')).filter(isVisible);
    for (const table of tables) {
      const headers = Array.from(table.querySelectorAll('th')).map((th) => clean(th.innerText));
      const idxCodigo = headers.findIndex((h) => /c[oó]digo unide/i.test(h));
      if (idxCodigo === -1) continue;
      const idxCentral = headers.findIndex((h) => /c\.?\s*central/i.test(h));
      for (const tr of Array.from(table.querySelectorAll('tr[role="row"]'))) {
        if (!isVisible(tr)) continue;
        const cells = Array.from(tr.querySelectorAll('td')).map((td) => clean(td.innerText));
        if (!cells.length) continue;
        const c = cells[idxCodigo] || '';
        const ce = idxCentral >= 0 ? (cells[idxCentral] || '') : '';
        if ((cod && c === cod) || (cen && ce === cen)) {
          const b = tr.querySelector('button[title="Editar"], button[aria-label="Editar"]');
          if (b) return b;
        }
      }
    }
    return null;
  }, codigo || '', central || '');
  const el = handle.asElement();
  if (!el) { await handle.dispose(); return false; }
  await el.click();
  await handle.dispose();
  const listo = await waitForArticleEditor(page, 4000);
  if (!listo) return false;
  await escribirCajasEnEdicion(page, qty, 180);
  await page.keyboard.press('Enter');
  await sleep(250);
  await page.keyboard.press('Enter');
  await sleep(400);
  return true;
}

// Click REAL de ratón sobre el checkbox de una fila + verificación de que
// quedó marcado (.checked). El .click() de DOM desde evaluate no le
// llegaba a Blazor: la selección no existía y Eliminar ni abría su
// confirmación (19/07). Si el input está tapado, se prueba con su celda.
async function clickRealYVerificarCheckbox(page, chk) {
  try { await chk.click(); } catch { /* tapado por overlay */ }
  await sleep(350);
  if (await page.evaluate((el) => Boolean(el && el.checked), chk).catch(() => false)) return true;
  try {
    const celda = await page.evaluateHandle((el) => el.closest('td') || el.parentElement, chk);
    const c = celda.asElement();
    if (c) await c.click();
    await celda.dispose();
  } catch { /* sin celda */ }
  await sleep(350);
  return page.evaluate((el) => Boolean(el && el.checked), chk).catch(() => false);
}

// Borra `sobran` copias de una línea duplicada: navega hasta una página
// con la fila, marca su checkbox y pulsa Eliminar (con confirmación).
// Prefiere borrar una copia cuya cantidad NO coincide con la esperada.
async function eliminarFilaDuplicada(page, config, codigo, qtyEsperada, sobran) {
  let borradas = 0;
  for (let i = 0; i < sobran; i += 1) {
    await esperarGridLibre(page, config, `删行${codigo}`);
    if (!(await irAPaginaDeFila(page, config, codigo, ''))) break;
    const handle = await page.evaluateHandle((cod, qe) => {
      const clean = (s) => (s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
      const isVisible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const tables = Array.from(document.querySelectorAll('table')).filter(isVisible);
      for (const table of tables) {
        const headers = Array.from(table.querySelectorAll('th')).map((th) => clean(th.innerText));
        const idxCodigo = headers.findIndex((h) => /c[oó]digo unide/i.test(h));
        if (idxCodigo === -1) continue;
        const idxCajas = headers.findIndex((h) => /^cajas$/i.test(h));
        const candidatas = [];
        for (const tr of Array.from(table.querySelectorAll('tr[role="row"]'))) {
          if (!isVisible(tr)) continue;
          if (tr.querySelector('input[type="text"]')) continue;
          const cells = Array.from(tr.querySelectorAll('td')).map((td) => clean(td.innerText));
          if (!cells.length) continue;
          if ((cells[idxCodigo] || '') !== cod) continue;
          const chk = tr.querySelector('input[type="checkbox"]');
          if (!chk) continue;
          const cajas = idxCajas >= 0 ? (cells[idxCajas] || '') : '';
          candidatas.push({ chk, cajasMal: qe !== '' && cajas !== qe });
        }
        if (!candidatas.length) continue;
        return (candidatas.find((c) => c.cajasMal) || candidatas[0]).chk;
      }
      return null;
    }, codigo, qtyEsperada > 0 ? String(qtyEsperada) : '');
    const chk = handle.asElement();
    if (!chk) { await handle.dispose(); break; }
    const marcada = await clickRealYVerificarCheckbox(page, chk);
    await handle.dispose();
    if (!marcada) {
      setLive(`[pedido] ⚠ 勾不上 ${codigo} 的选择框（点了但没选中）`);
      break;
    }
    const clicado = await clickActionMatching(page, 'eliminar', 3000);
    if (!clicado.ok) break;
    // La confirmación tarda en pintarse: sondear hasta 4 s a que aparezca
    // y aceptarla. Sin confirmación visible NO se cuenta nada como borrado.
    let confirmado = false;
    for (let e = 0; e < 16 && !confirmado; e += 1) {
      await sleep(250);
      confirmado = await confirmBlazorPopup(page);
    }
    if (!confirmado) {
      setLive(`[pedido] ⚠ 点了 Eliminar 但确认框没出现（${codigo}）`);
      break;
    }
    await sleep(700);
    // El borrado dispara un refresco del grid: esperar a que termine (con
    // rescate si se cuelga) ANTES de dar la fila por borrada — el 19/07 el
    // refresco se quedó colgado y la fila seguía allí.
    await esperarGridLibre(page, config, `删行${codigo}后刷新`);
    borradas += 1;
  }
  return borradas;
}

// Elimina las filas totalmente vacías (basura de rescates fallidos):
// marca su checkbox y pulsa Eliminar, aceptando la confirmación. Barre
// página a página; tras cada borrado vuelve a empezar (el grid refluye).
async function eliminarFilasVacias(page, config) {
  let borradas = 0;
  for (let intento = 0; intento < 5; intento += 1) {
    await esperarGridLibre(page, config, '删空行');
    try {
      if (await gridActivePage(page) > 1) await gridClickPageDelta(page, { toPage: 1 });
    } catch { /* sin paginador */ }
    let marcada = false;
    for (let pg = 0; pg < 30 && !marcada; pg += 1) {
      await sleep(400);
      const handleVacia = await page.evaluateHandle(() => {
        const clean = (s) => (s || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
        const isVisible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
        const tables = Array.from(document.querySelectorAll('table')).filter(isVisible);
        for (const table of tables) {
          const headers = Array.from(table.querySelectorAll('th')).map((th) => clean(th.innerText));
          const idxCodigo = headers.findIndex((h) => /c[oó]digo unide/i.test(h));
          if (idxCodigo === -1) continue;
          const idxCentral = headers.findIndex((h) => /c\.?\s*central/i.test(h));
          const idxArticulo = headers.findIndex((h) => /^art[ií]culo$/i.test(h));
          for (const tr of Array.from(table.querySelectorAll('tr[role="row"]'))) {
            if (!isVisible(tr)) continue;
            if (tr.querySelector('input[type="text"]')) continue;
            const cells = Array.from(tr.querySelectorAll('td')).map((td) => clean(td.innerText));
            if (!cells.length) continue;
            if (cells.some((c) => /^suma:/i.test(c) || /haga clic/i.test(c))) continue;
            const central = idxCentral >= 0 ? (cells[idxCentral] || '') : '';
            const codigo = cells[idxCodigo] || '';
            const articulo = idxArticulo >= 0 ? (cells[idxArticulo] || '') : '';
            if (central || codigo || articulo) continue;
            const chk = tr.querySelector('input[type="checkbox"]');
            if (chk) return chk;
          }
        }
        return null;
      });
      const chkVacia = handleVacia.asElement();
      if (chkVacia) {
        marcada = await clickRealYVerificarCheckbox(page, chkVacia);
        await handleVacia.dispose();
        if (!marcada) { setLive('[pedido] ⚠ 勾不上空行的选择框（点了但没选中）'); return borradas; }
      } else {
        await handleVacia.dispose();
      }
      if (!marcada && !(await gridClickPageDelta(page, +1))) break;
    }
    if (!marcada) return borradas;
    const clicado = await clickActionMatching(page, 'eliminar', 3000);
    if (!clicado.ok) return borradas;
    let confirmado = false;
    for (let e = 0; e < 16 && !confirmado; e += 1) {
      await sleep(250);
      confirmado = await confirmBlazorPopup(page);
    }
    if (!confirmado) { setLive('[pedido] ⚠ 点了 Eliminar 但确认框没出现（空行）'); return borradas; }
    await sleep(700);
    await esperarGridLibre(page, config, '删空行后刷新');
    borradas += 1;
  }
  return borradas;
}

// --- 2b) Guardar y Enviar Pedido (SOLO bajo confirmación explícita) ---
// A diferencia de openOrderPage, aquí NO se navega (nada de page.goto a la
// lista): eso descartaría el borrador recién rellenado. Se localiza la
// pestaña, se exige que el DetailView del pedido siga abierto y se
// comprueba que el "Nombre del Pedido" en pantalla es el confirmado.
async function openPedidoDetail(config, expectName) {
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
      lastError = Object.assign(new Error('连上了 Edge，但没找到 UnideGes 的标签页。'), { stage: 'findPage' });
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
  const state = await getPedidoPageState(page);
  if (!state.isPedidoDetail) {
    try { browser.disconnect(); } catch { /* noop */ }
    const err = new Error(`当前页面不是打开中的订单表单（caption=${state.caption || '-'}, url=${state.url || '-'}）。订单可能已被关掉；请重新填单或手动操作。`);
    err.stage = 'notDetail';
    throw err;
  }
  const nameOnScreen = await page.evaluate(() => {
    const isVisible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const inp = Array.from(document.querySelectorAll('input[aria-required="true"][maxlength="150"], input.dxbl-text-edit-input[maxlength="150"]')).find(isVisible);
    return inp ? String(inp.value || '').trim() : '';
  });
  if (expectName && nameOnScreen && nameOnScreen !== String(expectName).trim()) {
    try { browser.disconnect(); } catch { /* noop */ }
    const err = new Error(`屏幕上的订单名是「${nameOnScreen}」，不是「${expectName}」——为安全不动。`);
    err.stage = 'nameMismatch';
    throw err;
  }
  return { browser, page, nameOnScreen };
}

// Texto del primer popup/diálogo visible de Blazor (validaciones de XAF),
// para reportarlo en Telegram junto a la captura. '' si no hay ninguno.
async function readBlockingPopup(page) {
  try {
    return await page.evaluate(() => {
      const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
      const isVisible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const pops = Array.from(document.querySelectorAll('.dxbl-popup, .dxbl-modal, [role="dialog"], [role="alertdialog"]')).filter(isVisible);
      for (const p of pops) {
        const text = clean(p.innerText);
        if (text) return text.slice(0, 400);
      }
      return '';
    });
  } catch {
    return '';
  }
}

export async function saveOrderWeb(config, logger, expectName) {
  let browser;
  try {
    setLive('[pedido] 找到打开的订单，准备点 Guardar…');
    const opened = await openPedidoDetail(config, expectName);
    browser = opened.browser;
    const page = opened.page;
    setLive('[pedido] 点 Guardar，等保存…');
    if (!(await clickActionByName(page, 'Guardar', 5000))) {
      const shot = await screenshot(page, config, 'guardar-missing');
      return { ok: false, stage: 'guardar', screenshot: shot, error: '页面上没找到可点的 Guardar 按钮。' };
    }
    await sleep(Number(config.webOrder?.saveSettleMs) || 3000);
    const popup = await readBlockingPopup(page);
    const shot = await screenshot(page, config, 'guardar');
    if (popup && /validaci|obligatori|requerid|error|problema/i.test(popup)) {
      return { ok: false, stage: 'validation', screenshot: shot, error: `点了 Guardar，但页面弹出了提示：「${popup}」。可能没保存成功，请看截图处理。` };
    }
    logger?.info('web order saved', { name: expectName });
    setLive('[pedido] listo');
    return { ok: true, screenshot: shot, message: `已点 Guardar 保存「${expectName}」。看截图确认；没问题就可以发送。` };
  } catch (error) {
    setLive('[pedido] ERROR: ' + error.message);
    logger?.error('web order save failed', { stage: error.stage, error: error.message });
    return { ok: false, stage: error.stage || 'save', error: error.message };
  } finally {
    try { browser?.disconnect(); } catch { /* noop */ }
  }
}

// --- 2c) EDITAR el pedido abierto: retoques tras el repaso a ojo --------
// El dueño revisa la tabla rellenada y pide cambios sueltos ("把620201改成
// 2", "加一个851220", "删掉850574") sin rehacer la orden entera. Opera
// sobre el DetailView ABIERTO (sin navegar) y NUNCA pulsa Guardar/Enviar.
// cambios: [{ tipo:'cantidad', codigo, qty } | { tipo:'quitar', codigo }
//          | { tipo:'agregar', item:{ code|nombre, quantity } }]
export async function editOrderWeb(config, logger, expectName, cambios, hooks = {}) {
  let browser;
  try {
    setLive('[pedido] 找到打开的订单，准备改动…');
    const opened = await openPedidoDetail(config, expectName || '');
    browser = opened.browser;
    const page = opened.page;
    const w = config.webOrder || {};
    const ctx = {
      page, config, logger, w, hooks,
      autocompleteMs: Number(w.autocompleteMs) || 900,
      autocompleteTimeoutMs: Number(w.autocompleteTimeoutMs) || 5000,
      betweenLinesMs: Number(w.betweenLinesMs) || 400,
      total: cambios.length,
      autoPicked: 0, namePicked: 0, repairedCount: 0, qtyCorregidas: 0,
      unrepairedBlanks: 0, unrepairedCodes: [],
      diagnosticos: [], motivos: new Map(),
      sinDatosPrevios: leerCodigosSinDatos(config)
    };
    const hechos = [];
    let n = 0;
    for (const c of cambios) {
      n += 1;
      if (c.tipo === 'cantidad') {
        setLive(`[pedido] 改数量 ${c.codigo} → ${c.qty}…`);
        let ok = false;
        if (await irAPaginaDeFila(page, config, c.codigo, '')) {
          ok = await corregirCajasFila(ctx, c.codigo, '', c.qty);
        }
        hechos.push(ok ? `✔ ${c.codigo} 数量改成 ${c.qty}` : `✘ ${c.codigo} 数量没改成（表里没找到这行，或改写没生效）`);
      } else if (c.tipo === 'quitar') {
        setLive(`[pedido] 删掉 ${c.codigo} 这行…`);
        let borradas = 0;
        // borra TODAS las filas con ese código (si estaba duplicada, fuera
        // todas: quitar es quitar).
        for (let i = 0; i < 6; i += 1) {
          const b = await eliminarFilaDuplicada(page, config, c.codigo, 0, 1);
          if (!b) break;
          borradas += b;
        }
        // Verificación REAL: releer el grid. "Pulsé Eliminar" no es "se
        // borró" — el 19/07 el refresco se colgó y la fila seguía allí
        // aunque el bot había contado 1 borrada.
        const sigueAhi = await irAPaginaDeFila(page, config, c.codigo, '');
        if (sigueAhi) hechos.push(`✘ ${c.codigo} 点了删除但这行还在表里（表格卡住或页面报错），请手动勾选删一下`);
        else if (borradas) hechos.push(`✔ ${c.codigo} 已删除（${borradas} 行），已确认表里没有了`);
        else hechos.push(`✔ ${c.codigo} 表里本来就没有这行`);
      } else if (c.tipo === 'agregar') {
        const label = c.item.code || c.item.nombre || '';
        setLive(`[pedido] 新增 ${label}…`);
        await irAUltimaPagina(page);
        const r = await rellenarUnaLinea(ctx, c.item, `改${n}`);
        if (r.ok) hechos.push(`✔ 已新增 ${label} ×${c.item.quantity || 1}`);
        else hechos.push(`✘ 新增 ${label} 没成功：${r.nota || r.error || r.reason || '未知原因'}`);
      }
    }
    setLive('[pedido] 改动完成，截图…');
    const shot = await screenshot(page, config, 'edit');
    setLive('[pedido] listo');
    const nombre = opened.nameOnScreen || expectName || '';
    logger?.info('web order edited', { name: nombre, cambios: cambios.length });
    return {
      ok: true,
      screenshot: shot,
      orderName: nombre,
      message: `订单「${nombre}」的改动：\n${hechos.join('\n')}\n请看截图核对。这一步没有点 Guardar，也没有点 Enviar Pedido。`,
      detalles: hechos
    };
  } catch (error) {
    setLive('[pedido] ERROR: ' + error.message);
    logger?.error('web order edit failed', { stage: error.stage, error: error.message });
    return { ok: false, stage: error.stage || 'edit', error: error.message };
  } finally {
    try { browser?.disconnect(); } catch { /* noop */ }
  }
}

export async function sendOrderWeb(config, logger, expectName) {
  let browser;
  try {
    const opened = await openPedidoDetail(config, expectName);
    browser = opened.browser;
    const page = opened.page;
    // El nombre exacto de la acción varía ("Enviar Pedido", "EnviarPedido"…):
    // se busca entre las acciones VISIBLES una cuyo data-action-name o texto
    // contenga "enviar".
    setLive('[pedido] 点 Enviar Pedido，等确认框…');
    const clicked = await clickActionMatching(page, 'enviar', 5000);
    if (!clicked.ok) {
      const shot = await screenshot(page, config, 'enviar-missing');
      return { ok: false, stage: 'enviar', screenshot: shot, error: `没找到 Enviar Pedido 按钮（页面上可见的操作：${clicked.seen.join('、') || '无'}）。可能要先 Guardar，或这个订单状态不能发送。` };
    }
    // XAF puede pedir confirmación: se acepta el confirm nativo si sale y,
    // si es un popup de Blazor con Sí/Aceptar, se pulsa el afirmativo.
    const onDialog = (d) => { d.accept().catch(() => {}); };
    page.on('dialog', onDialog);
    try {
      await sleep(1200);
      await confirmBlazorPopup(page);
      await sleep(Number(config.webOrder?.sendSettleMs) || 3500);
    } finally {
      page.off('dialog', onDialog);
    }
    const popup = await readBlockingPopup(page);
    const shot = await screenshot(page, config, 'enviar');
    if (popup && /validaci|obligatori|requerid|error|problema/i.test(popup)) {
      return { ok: false, stage: 'validation', screenshot: shot, error: `点了发送，但页面弹出了提示：「${popup}」。请看截图处理。` };
    }
    const sentHint = await page.evaluate(() => /enviado/i.test(document.body?.innerText || '')).catch(() => false);
    logger?.info('web order sent', { name: expectName, sentHint });
    setLive('[pedido] listo');
    return { ok: true, screenshot: shot, message: `已点 Enviar Pedido 发送「${expectName}」${sentHint ? '，页面上已出现 Enviado 字样' : ''}。看截图做最终确认。` };
  } catch (error) {
    setLive('[pedido] ERROR: ' + error.message);
    logger?.error('web order send failed', { stage: error.stage, error: error.message });
    return { ok: false, stage: error.stage || 'send', error: error.message };
  } finally {
    try { browser?.disconnect(); } catch { /* noop */ }
  }
}

// Pulsa la primera acción de XAF visible cuyo data-action-name o texto
// contenga la subcadena (sin distinguir mayúsculas). Si no aparece dentro
// del plazo, devuelve además la lista de acciones visibles para el mensaje
// de error.
async function clickActionMatching(page, needle, timeoutMs = 0) {
  const start = Date.now();
  for (;;) {
    const handle = await page.evaluateHandle((sub) => {
      const clean = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const isVisible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const els = Array.from(document.querySelectorAll('[data-action-name]')).filter(isVisible);
      return els.find((el) => clean(el.getAttribute('data-action-name')).includes(sub) || clean(el.innerText).includes(sub)) || null;
    }, String(needle).toLowerCase());
    const el = handle.asElement();
    if (el) { await el.click(); await handle.dispose(); return { ok: true }; }
    await handle.dispose();
    if (Date.now() - start >= timeoutMs) {
      const seen = await page.evaluate(() => Array.from(document.querySelectorAll('[data-action-name]'))
        .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
        .map((el) => el.getAttribute('data-action-name'))
        .filter((v, i, a) => v && a.indexOf(v) === i)).catch(() => []);
      return { ok: false, seen };
    }
    await sleep(200);
  }
}

// Si hay un popup de confirmación de Blazor con botón Sí/Aceptar/OK, lo
// pulsa. Sin popup no hace nada.
async function confirmBlazorPopup(page) {
  try {
    const handle = await page.evaluateHandle(() => {
      const clean = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const isVisible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const pops = Array.from(document.querySelectorAll('.dxbl-popup, .dxbl-modal, [role="dialog"], [role="alertdialog"]')).filter(isVisible);
      for (const p of pops) {
        const btns = Array.from(p.querySelectorAll('button, [role="button"], a')).filter(isVisible);
        const yes = btns.find((b) => /^(sí|si|aceptar|ok|yes|confirmar)$/.test(clean(b.innerText)));
        if (yes) return yes;
      }
      return null;
    });
    const el = handle.asElement();
    if (el) { await el.click(); await handle.dispose(); return true; }
    await handle.dispose();
  } catch { /* sin popup de confirmación */ }
  return false;
}

// --- 3) Búsqueda por NOMBRE: devolver TODAS las opciones -------------
// Cuando no se sabe el Código Unide de un producto, se escribe su nombre y
// esto abre un formulario de PRUEBA (Nuevo), teclea el nombre en el editor
// de artículo y CAPTURA todas las opciones del desplegable (con su Código
// Unide) para que el usuario elija en Telegram. No selecciona ni guarda
// nada; el borrador de prueba se descarta en la siguiente navegación (cada
// openOrderPage hace un page.goto que lo tira).
export async function searchArticleOptions(config, name, logger) {
  let browser;
  try {
    const opened = await openOrderPage(config);
    browser = opened.browser;
    const page = opened.page;
    const w = config.webOrder || {};
    const autocompleteMs = Number(w.autocompleteMs) || 900;
    const autocompleteTimeoutMs = Number(w.autocompleteTimeoutMs) || 5000;

    const openedNew = await openNewOrderForm(page, Number(w.pageNavigationTimeoutMs) || 20000);
    if (!openedNew.ok) return { ok: false, stage: 'nuevo', error: openedNew.error };
    await sleep(Number(w.formRenderMs) || 2800);

    const prepared = await prepareItemEditor(page, autocompleteTimeoutMs);
    if (!prepared) return { ok: false, stage: 'newrow', error: '没找到可输入的 artículo 编辑框。' };

    await page.keyboard.type(String(name), { delay: 25 });
    const dd = await waitForDropdownOptions(page, autocompleteTimeoutMs, autocompleteMs);
    const shot = await screenshot(page, config, `search-${name}`);
    if (dd.count === 0) return { ok: true, options: [], screenshot: shot };

    const options = await captureDropdownOptions(page, Number(w.maxSearchOptions) || 20);
    logger?.info('web search options', { name, count: options.length });
    return { ok: true, options, screenshot: shot };
  } catch (error) {
    logger?.error('web search failed', { stage: error.stage, error: error.message });
    return { ok: false, stage: error.stage || 'search', error: error.message };
  } finally {
    try { browser?.disconnect(); } catch { /* noop */ }
  }
}

// --- 4) LLEGADA: leer pedidos de la lista y sus líneas (solo lectura) --
// Para la lista de comprobación del día de llegada se leen los pedidos
// REALES de la web (así entran también los hechos a mano o importados
// desde la PDA, no solo los que rellenó el bot). Todo es de solo lectura:
// se abre cada pedido con un clic en su fila, se copian las líneas y se
// vuelve a la lista con page.goto. No se pulsa Nuevo/Guardar/Enviar.
//   creationDate: 'YYYY-MM-DD' — se buscan pedidos CREADOS ese día (los
//   que llegan hoy = creados hace offsetDays).
export async function fetchArrivingOrders(config, creationDate, logger) {
  let browser;
  try {
    const opened = await openOrderPage(config);
    browser = opened.browser;
    const page = opened.page;
    const w = config.webOrder || {};
    const timeout = Number(w.pageNavigationTimeoutMs) || 20000;

    const rows = await waitForListRows(page, timeout);
    if (!rows.length) {
      return { ok: true, orders: [], totalListed: 0, matched: 0 };
    }

    const excludeStates = (config.arrival?.excludeStates || ['Alta']).map((s) => String(s).toLowerCase());
    const matches = rows.filter((r) => r.fechaIso === creationDate
      && !excludeStates.includes(String(r.estado || '').toLowerCase()));
    const cap = Number(config.arrival?.maxOrders) || 8;
    const selected = matches.slice(0, cap);

    const orders = [];
    for (const target of selected) {
      const openedDetail = await openOrderDetailByRow(page, target, timeout);
      if (!openedDetail) {
        logger?.warn('could not open order detail', { id: target.id, nombre: target.nombre });
        await ensurePedidoPage(page, config);
        continue;
      }
      await sleep(Number(w.formRenderMs) || 2800);
      const items = await scrapeAllOrderLines(page, config);
      orders.push({ orderName: target.nombre, orderDate: target.fechaIso, estado: target.estado, items });
      // Volver a la lista (recarga dura; no hay nada que guardar).
      await ensurePedidoPage(page, config);
    }
    logger?.info('arriving orders fetched', { creationDate, listed: rows.length, matched: matches.length, scraped: orders.length });
    return { ok: true, orders, totalListed: rows.length, matched: matches.length };
  } catch (error) {
    logger?.error('fetch arriving orders failed', { stage: error.stage, error: error.message });
    return { ok: false, stage: error.stage || 'fetchLlegada', error: error.message };
  } finally {
    try { browser?.disconnect(); } catch { /* noop */ }
  }
}

// Lista los pedidos visibles en la página de Pedidos (nombre, fecha, estado),
// sin abrir ninguno. Lo usa la tarea diaria automática para detectar pedidos
// PDA nuevos que aún no se han analizado.
export async function listOrders(config, logger) {
  let browser;
  try {
    const opened = await openOrderPage(config);
    browser = opened.browser;
    const page = opened.page;
    const timeout = Number(config.webOrder?.pageNavigationTimeoutMs) || 20000;
    const rows = await waitForListRows(page, timeout);
    return { ok: true, rows: rows.map((r) => ({ id: r.id, nombre: r.nombre, fechaIso: r.fechaIso, estado: r.estado, pesoTotal: r.pesoTotal, importeTotal: r.importeTotal })) };
  } catch (error) {
    logger?.error('list orders failed', { error: error.message });
    return { ok: false, error: error.message };
  } finally {
    try { browser?.disconnect(); } catch { /* noop */ }
  }
}

// Abre los N pedidos más recientes y lee todas las páginas de sus líneas.
// Es estrictamente de solo lectura: no pulsa Guardar ni Enviar Pedido.
export async function fetchLatestOrders(config, limit = 3, logger) {
  let browser;
  try {
    const opened = await openOrderPage(config);
    browser = opened.browser;
    const page = opened.page;
    const timeout = Number(config.webOrder?.pageNavigationTimeoutMs) || 20000;
    let rows = await waitForListRows(page, timeout);
    rows = await rewindOrderListToFirst(page, rows, timeout);
    const selected = selectLatestOrderRows(rows, limit);
    const orders = [];

    for (const target of selected) {
      let items = [];
      let detailError = '';
      try {
        const openedDetail = await openOrderDetailByRow(page, target, timeout);
        if (!openedDetail) {
          detailError = '没有打开这张订单的明细页';
        } else {
          await sleep(Number(config.webOrder?.detailRenderMs) || Number(config.webOrder?.formRenderMs) || 2800);
          items = await scrapeAllOrderLines(page, config);
          if (!items.length) detailError = '明细页打开了，但没有读到商品行';
        }
      } catch (error) {
        detailError = error.message;
        logger?.warn('latest order detail failed', { order: target.nombre, error: error.message });
      }

      orders.push({
        id: target.id,
        orderName: target.nombre,
        orderDate: target.fechaIso || target.fecha,
        estado: target.estado,
        pesoTotal: target.pesoTotal,
        importeTotal: target.importeTotal,
        items,
        ...(detailError ? { detailError } : {})
      });

      // Volver de forma determinista a la lista antes del siguiente pedido.
      // Como esta función nunca escribe, no hay cambios que guardar.
      await ensurePedidoPage(page, config);
      await waitForListRows(page, timeout);
    }

    return { ok: true, orders, totalListed: rows.length, requested: selected.length };
  } catch (error) {
    logger?.error('fetch latest orders failed', { error: error.message });
    return { ok: false, error: error.message };
  } finally {
    try { browser?.disconnect(); } catch { /* noop */ }
  }
}

// Elige filas de la lista de Pedidos según lo que escribió el usuario
// ("/llegada 152 153", "/llegada carne 0807"). Reglas:
//   1. Primero se prueba TODO el texto como UNA consulta (todas las palabras
//      en el mismo nombre) → el pedido más reciente que las tenga todas.
//      Cubre "carne 0807" cuando es un único pedido.
//   2. Si no, cada palabra es un selector: un número suelto casa como número
//      entero del nombre ("152" → "Nro. 152" pero no "1520"), el texto como
//      substring; de cada selector se coge el pedido MÁS RECIENTE.
// Exportada aparte para poder probarla sin navegador.
export function selectOrderRows(rows, argText) {
  const tokens = String(argText || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return { selected: [], notFound: [] };
  const matchesToken = (nombre, t) => (/^\d+$/.test(t)
    ? new RegExp(`(^|\\D)${t}(\\D|$)`).test(nombre)
    : String(nombre).toLowerCase().includes(t));
  const newest = (list) => [...list].sort((a, b) => String(b.fechaIso).localeCompare(String(a.fechaIso)))[0];

  if (tokens.length > 1) {
    const all = rows.filter((r) => tokens.every((t) => matchesToken(r.nombre, t)));
    if (all.length) return { selected: [newest(all)], notFound: [] };
  }

  const selected = [];
  const notFound = [];
  const seen = new Set();
  for (const t of tokens) {
    const hits = rows.filter((r) => matchesToken(r.nombre, t));
    if (!hits.length) { notFound.push(t); continue; }
    const pick = newest(hits);
    const key = `${pick.nombre}|${pick.fechaIso}`;
    if (!seen.has(key)) { seen.add(key); selected.push(pick); }
  }
  return { selected, notFound };
}

// Abre los pedidos elegidos por selectOrderRows y devuelve sus líneas
// completas — mismo bucle de lectura que fetchArrivingOrders, pero la
// selección es por nombre/número en vez de por fecha de creación.
export async function fetchOrdersBySelectors(config, argText, logger) {
  let browser;
  try {
    const opened = await openOrderPage(config);
    browser = opened.browser;
    const page = opened.page;
    const w = config.webOrder || {};
    const timeout = Number(w.pageNavigationTimeoutMs) || 20000;

    const rows = await waitForListRows(page, timeout);
    if (!rows.length) return { ok: true, orders: [], notFound: [], names: [] };

    const { selected, notFound } = selectOrderRows(rows, argText);
    const orders = [];
    for (const target of selected) {
      const openedDetail = await openOrderDetailByRow(page, target, timeout);
      if (!openedDetail) {
        logger?.warn('could not open order detail', { id: target.id, nombre: target.nombre });
        await ensurePedidoPage(page, config);
        continue;
      }
      await sleep(Number(w.formRenderMs) || 2800);
      const items = await scrapeAllOrderLines(page, config);
      orders.push({ orderName: target.nombre, orderDate: target.fechaIso, estado: target.estado, items });
      await ensurePedidoPage(page, config);
    }
    logger?.info('orders by selectors fetched', { arg: argText, selected: selected.length, scraped: orders.length, notFound });
    return { ok: true, orders, notFound, names: rows.slice(0, 10).map((r) => r.nombre) };
  } catch (error) {
    logger?.error('fetch orders by selectors failed', { stage: error.stage, error: error.message });
    return { ok: false, stage: error.stage || 'fetchLlegada', error: error.message };
  } finally {
    try { browser?.disconnect(); } catch { /* noop */ }
  }
}

// Espera (sondeando) a que la lista de Pedidos tenga filas y las devuelve
// como { index, id, nombre, fecha, fechaIso, estado }. Se localiza la
// tabla por sus CABECERAS (no por posición), así aguanta cambios de orden
// de columnas.
async function waitForListRows(page, timeoutMs) {
  const start = Date.now();
  for (;;) {
    const rows = await page.evaluate(() => {
      const clean = (s) => (s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
      const isVisible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const tables = Array.from(document.querySelectorAll('table')).filter(isVisible);
      for (const table of tables) {
        const headers = Array.from(table.querySelectorAll('th')).map((th) => clean(th.innerText));
        const idxNombre = headers.findIndex((h) => /^nombre del pedido$/i.test(h));
        if (idxNombre === -1) continue;
        const idxId = headers.findIndex((h) => /^id$/i.test(h));
        const idxFecha = headers.findIndex((h) => /fecha de creaci/i.test(h));
        const idxEstado = headers.findIndex((h) => /estado de pedido/i.test(h));
        const idxPeso = headers.findIndex((h) => /peso total/i.test(h));
        const idxImporte = headers.findIndex((h) => /importe total/i.test(h));
        const out = [];
        const trs = Array.from(table.querySelectorAll('tr[role="row"]'));
        for (let i = 0; i < trs.length; i += 1) {
          const cells = Array.from(trs[i].querySelectorAll('td')).map((td) => clean(td.innerText));
          if (!cells.length || !cells.some(Boolean)) continue;
          const nombre = cells[idxNombre] || '';
          if (!nombre) continue;
          out.push({
            index: i,
            id: idxId >= 0 ? (cells[idxId] || '') : '',
            nombre,
            fecha: idxFecha >= 0 ? (cells[idxFecha] || '') : '',
            estado: idxEstado >= 0 ? (cells[idxEstado] || '') : '',
            pesoTotal: idxPeso >= 0 ? (cells[idxPeso] || '') : '',
            importeTotal: idxImporte >= 0 ? (cells[idxImporte] || '') : ''
          });
        }
        return out;
      }
      return [];
    });
    if (rows.length) {
      for (const row of rows) row.fechaIso = spanishDateToIso(row.fecha);
      return rows;
    }
    if (Date.now() - start >= timeoutMs) return [];
    await sleep(300);
  }
}

async function rewindOrderListToFirst(page, rows, timeoutMs) {
  try {
    const active = await gridActivePage(page);
    if (active <= 1) return rows;
    const before = orderListSignature(rows);
    if (!(await gridClickPageDelta(page, { toPage: 1 }))) return rows;

    const deadline = Date.now() + Math.min(Number(timeoutMs) || 5000, 5000);
    while (Date.now() < deadline) {
      await sleep(250);
      const next = await waitForListRows(page, 600);
      if (next.length && orderListSignature(next) !== before) return next;
    }
  } catch { /* sin paginador o ya en la primera página */ }
  return rows;
}

function orderListSignature(rows) {
  return (rows || []).map((row) => `${row.id}|${row.nombre}|${row.fechaIso}`).join('||');
}

// '24/6/2026' (con o sin hora detrás) → '2026-06-24'.
function spanishDateToIso(value) {
  const match = String(value || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!match) return '';
  const [, d, m, y] = match;
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

// Abre el detalle de un pedido pulsando la celda de su nombre en la fila
// que coincide en nombre (y, si hay, en Id). XAF abre el DetailView con un
// clic simple en la celda; si no navega, se reintenta con doble clic.
async function openOrderDetailByRow(page, target, timeoutMs) {
  for (const clickCount of [1, 2]) {
    const handle = await page.evaluateHandle((wanted) => {
      const clean = (s) => (s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
      const isVisible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const trs = Array.from(document.querySelectorAll('tr[role="row"]')).filter(isVisible);
      for (const tr of trs) {
        const texts = Array.from(tr.querySelectorAll('td')).map((td) => clean(td.innerText));
        if (!texts.includes(wanted.nombre)) continue;
        if (wanted.id && !texts.includes(wanted.id)) continue;
        // La celda del nombre (evitando el enlace de la tienda, que
        // navegaría a Store_DetailView).
        const cell = Array.from(tr.querySelectorAll('td')).find((td) => clean(td.innerText) === wanted.nombre && !td.querySelector('a'));
        return cell || tr;
      }
      return null;
    }, { nombre: target.nombre, id: target.id });
    const el = handle.asElement();
    if (!el) { await handle.dispose(); return false; }
    await el.click({ clickCount });
    await handle.dispose();

    const deadline = Date.now() + Math.min(6000, timeoutMs);
    while (Date.now() < deadline) {
      try {
        const state = await getPedidoPageState(page);
        if (state.isPedidoDetail) return true;
      } catch { /* navegación en curso */ }
      await sleep(250);
    }
  }
  return false;
}

// Lee TODAS las páginas de las líneas del pedido: el grid pagina de 25 en
// 25 (mismo dxbl-pager que Promociones) y antes solo se leía la primera —
// un PDA de dos páginas salía con la mitad de las líneas. Reutiliza los
// helpers de paginación ya probados en webPromotions: rebobinar a la 1ª,
// leer, pasar página esperando el CAMBIO real del contenido, dedupe.
async function scrapeAllOrderLines(page, config) {
  const maxPages = 30;
  const settle = Number(config?.webOrder?.pageNavigationTimeoutMs) ? Math.min(Number(config.webOrder.pageNavigationTimeoutMs), 8000) : 8000;
  const sig = (items) => (items || []).map((i) => `${i.code}|${i.nombre}|${i.quantity}`).join('||');

  // Rebobinar si el grid quedó en una página posterior.
  try {
    const active = await gridActivePage(page);
    if (active > 1) {
      const before = sig(await scrapeOrderLines(page).catch(() => []));
      if (await gridClickPageDelta(page, { toPage: 1 })) {
        await gridWaitForPageChange(page, () => scrapeOrderLines(page), sig, before, Math.min(settle, 4000));
      }
    }
  } catch { /* sin paginador o render en curso: leer desde donde esté */ }

  const all = [];
  const seen = new Set();
  let prevSig = '';
  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    setLive(`[pedido] 读明细第 ${pageIndex + 1} 页…`);
    const rows = pageIndex === 0
      ? await scrapeOrderLines(page)
      : await gridWaitForPageChange(page, () => scrapeOrderLines(page), sig, prevSig, settle);
    const s = sig(rows);
    if (pageIndex > 0 && (!rows.length || s === prevSig)) break;
    prevSig = s;
    for (const row of rows) {
      const key = `${row.code}|${row.nombre}|${row.quantity}`;
      if (!seen.has(key)) { seen.add(key); all.push(row); }
    }
    if (!(await gridClickPageDelta(page, +1))) break;
  }
  return all;
}

// Copia las líneas del pedido abierto (grid con cabecera "Código Unide").
// Devuelve [{ code, nombre, quantity }] con quantity = Cajas.
async function scrapeOrderLines(page) {
  return page.evaluate(() => {
    const clean = (s) => (s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
    const isVisible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const tables = Array.from(document.querySelectorAll('table')).filter(isVisible);
    for (const table of tables) {
      const headers = Array.from(table.querySelectorAll('th')).map((th) => clean(th.innerText));
      const idxCodigo = headers.findIndex((h) => /c[oó]digo unide/i.test(h));
      if (idxCodigo === -1) continue;
      const idxArticulo = headers.findIndex((h) => /^art[ií]culo$/i.test(h));
      const idxCajas = headers.findIndex((h) => /^cajas$/i.test(h));
      // Columnas extra para la lista de comprobación imprimible; si el grid
      // no las tiene quedan '' y todo lo demás sigue igual.
      const idxCentral = headers.findIndex((h) => /c\.?\s*central/i.test(h));
      const idxPvd = headers.findIndex((h) => /^pvd\b/i.test(h));
      const idxOferta = headers.findIndex((h) => /^oferta\b/i.test(h));
      const idxTotal = headers.findIndex((h) => /^total\b/i.test(h));
      const out = [];
      for (const tr of Array.from(table.querySelectorAll('tr[role="row"]'))) {
        const cells = Array.from(tr.querySelectorAll('td')).map((td) => clean(td.innerText));
        if (!cells.length) continue;
        const code = cells[idxCodigo] || '';
        const nombre = idxArticulo >= 0 ? (cells[idxArticulo] || '') : '';
        if (!code && !nombre) continue;
        if (cells.some((c) => /^suma:/i.test(c))) continue; // fila de totales
        out.push({
          code,
          nombre,
          quantity: idxCajas >= 0 ? (cells[idxCajas] || '') : '',
          central: idxCentral >= 0 ? (cells[idxCentral] || '') : '',
          pvd: idxPvd >= 0 ? (cells[idxPvd] || '') : '',
          oferta: idxOferta >= 0 ? (cells[idxOferta] || '') : '',
          total: idxTotal >= 0 ? (cells[idxTotal] || '') : ''
        });
      }
      return out;
    }
    return [];
  });
}

// Abre UN pedido por nombre (o el PDA más reciente si no se da nombre) y
// devuelve sus líneas. Solo lectura: mismo camino que /llegada. Lo usa
// /ahorro_pedido para cruzar el contenido del pedido con las promociones.
export async function fetchOrderLinesByName(config, nameQuery, logger) {
  let browser;
  try {
    setLive('[pedido] 连接 Edge，打开 Pedidos 列表…');
    const opened = await openOrderPage(config);
    browser = opened.browser;
    const page = opened.page;
    const w = config.webOrder || {};
    const timeout = Number(w.pageNavigationTimeoutMs) || 20000;
    setLive('[pedido] 等列表出行…');
    const rows = await waitForListRows(page, timeout);
    if (!rows.length) return { ok: false, error: 'Pedidos 列表是空的' };
    setLive(`[pedido] 列表 ${rows.length} 行，找目标单子…`);
    const q = String(nameQuery || '').trim().toLowerCase();
    // Un número a secas se interpreta como el "Nro." del pedido PDA
    // (p. ej. /ahorro_pedido 153 → "Pedido importado desde PDA Nro. 153"),
    // para poder elegir el pedido cuando hay varios PDA seguidos.
    const asNumber = /^\d+$/.test(q) ? new RegExp(`(^|\\D)${q}(\\D|$)`) : null;
    const candidates = rows.filter((r) => {
      if (asNumber) return asNumber.test(r.nombre);
      return q ? r.nombre.toLowerCase().includes(q) : /pda/i.test(r.nombre);
    });
    if (!candidates.length) {
      return {
        ok: false,
        error: q ? `没找到${asNumber ? `编号 ${q}` : `名字包含「${nameQuery}」`}的单子` : '没找到 PDA 单（名字里带 PDA 的）',
        names: rows.slice(0, 10).map((r) => r.nombre)
      };
    }
    candidates.sort((a, b) => String(b.fechaIso).localeCompare(String(a.fechaIso)));
    const target = candidates[0];
    // Otros pedidos PDA de la lista (sin el elegido), para que el bot pueda
    // decir "también están estos" y el usuario elija por número.
    const otherPda = rows
      .filter((r) => /pda/i.test(r.nombre) && r !== target)
      .map((r) => ({ nombre: r.nombre, fecha: r.fechaIso, estado: r.estado }))
      .slice(0, 6);
    setLive(`[pedido] 打开「${String(target.nombre).slice(0, 30)}」明细…`);
    const openedDetail = await openOrderDetailByRow(page, target, timeout);
    if (!openedDetail) return { ok: false, error: `打不开单子「${target.nombre}」` };
    await sleep(Number(w.formRenderMs) || 2800);
    const items = await scrapeAllOrderLines(page, config);
    logger?.info('order lines fetched', { nombre: target.nombre, lines: items.length });
    setLive(`[pedido] 读到 ${items.length} 行，listo`);
    return { ok: true, orderName: target.nombre, orderDate: target.fechaIso, estado: target.estado, items, otherPda };
  } catch (error) {
    setLive('[pedido] ERROR: ' + error.message);
    logger?.error('fetch order lines failed', { error: error.message });
    return { ok: false, error: error.message };
  } finally {
    try { browser?.disconnect(); } catch { /* noop */ }
  }
}

// Lee las opciones VISIBLES del desplegable abierto y las DESGLOSA para que
// la lista que ve el usuario sea legible:
//   name → el nombre del producto (lo que va antes del primer número largo).
//   ean  → el primer EAN (12-14 díg): identificador ÚNICO para rellenar.
//   code → el Código Unide (se prefiere el de 6 díg): ancla de respaldo.
// El texto crudo trae muchos números (referencia interna, Código Unide y
// varios EAN) que no hace falta mostrar.
async function captureDropdownOptions(page, max) {
  return page.evaluate((limit) => {
    const isVisible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const opts = [...new Set(Array.from(document.querySelectorAll(
      '[role="option"], .dxbl-listbox-item, .dxbl-list-box-item, .dxbl-grid-dropdown-item'
    )))].filter(isVisible);
    const seen = new Set();
    const out = [];
    for (const o of opts) {
      const text = (o.innerText || '').replace(/\s+/g, ' ').trim();
      if (!text || seen.has(text)) continue;
      seen.add(text);
      // Nombre = lo que va antes del primer bloque de 4+ dígitos (código/EAN).
      const firstNum = text.search(/\d{4,}/);
      const name = (firstNum > 0 ? text.slice(0, firstNum) : text).replace(/[;·|,\s]+$/, '').trim();
      const nums = text.match(/\d{4,}/g) || [];
      const eans = nums.filter((n) => n.length >= 12 && n.length <= 14);
      const codes = nums.filter((n) => n.length >= 5 && n.length <= 8);
      const code = codes.find((n) => n.length === 6) || codes[0] || '';
      out.push({ name: name || text, code, ean: eans[0] || '', text });
      if (out.length >= limit) break;
    }
    return out;
  }, max);
}

// --- helpers ---------------------------------------------------------
// Pulsa un botón de acción de XAF por su data-action-name (estable),
// eligiendo el visible (ignora la copia __virtual del menú de overflow).
// Pulsa un botón de acción de XAF por su data-action-name. Si timeoutMs>0,
// SONDEA hasta que el botón esté VISIBLE (tras un page.goto, la barra de
// herramientas de Blazor tarda en renderizarse, así que "Nuevo" no existe
// todavía cuando la URL ya es la de la lista).
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

async function ensurePedidoPage(page, config) {
  // Navegación DETERMINISTA por URL (page.goto), SIEMPRE — incluso si ya
  // parece que estamos en Pedidos. Así cada ejecución empieza en un estado
  // fresco y consistente (la barra con "Nuevo" se vuelve a renderizar),
  // sin depender de restos de un formulario anterior ni de un DOM "ya
  // cargado" que a veces no tenía el botón clicable. Antes había un atajo
  // ("si ya es la lista, no navego") que hacía fallar el caso de estar ya
  // en Pedidos. Como nunca guardamos, cualquier borrador abierto se
  // descarta sin problema.
  const listUrl = pedidoListUrl(page, config);
  const timeout = Number(config.webOrder?.pageNavigationTimeoutMs) || 20000;
  const onDialog = (d) => { d.accept().catch(() => {}); };
  page.on('dialog', onDialog);
  try {
    // Quitar el aviso de "cambios sin guardar" para que el goto no se quede
    // esperando un diálogo del navegador.
    try { await page.evaluate(() => { window.onbeforeunload = null; }); } catch { /* noop */ }
    await page.goto(listUrl, { waitUntil: 'domcontentloaded', timeout });
  } catch {
    // Blazor puede reportar la navegación como fallida aunque cargue; se
    // comprueba el estado real a continuación.
  } finally {
    page.off('dialog', onDialog);
  }

  const state = await waitForPedidoPage(page, timeout);
  if (state.isPedidosList || state.isPedidoDetail) return state;

  const err = new Error(
    `没能进入 Pedidos 列表页（已直接跳转到 ${listUrl}）。请确认自动化 Edge 已登录 UnideGes。当前：caption=${state.caption || '-'}, url=${state.url || '-'}`
  );
  err.stage = 'pedidoPage';
  throw err;
}

// URL de la lista de Pedidos. Se deriva del origen de la pestaña actual
// (robusto ante cambios de dominio) y se puede fijar en config.webOrder.pedidoListUrl.
function pedidoListUrl(page, config) {
  const configured = config.webOrder?.pedidoListUrl;
  if (configured) return configured;
  try {
    return new URL(page.url()).origin + '/OrderT_ListView';
  } catch {
    return 'https://unideges30.unide.es/OrderT_ListView';
  }
}

async function waitForPedidoPage(page, timeoutMs) {
  const start = Date.now();
  let last = {};
  while (Date.now() - start < timeoutMs) {
    try {
      last = await getPedidoPageState(page);
      if (last.isPedidoDetail || last.isPedidosList) return last;
    } catch {
      // Durante la navegación XAF puede destruir el contexto JS; se reintenta.
    }
    await sleep(250);
  }
  return last;
}

async function getPedidoPageState(page) {
  return page.evaluate(() => {
    const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const isVisible = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const visible = (sel) => Array.from(document.querySelectorAll(sel)).filter(isVisible);
    const hasAction = (name) => visible(`[data-action-name="${name}"]`).length > 0;

    const caption = clean(visible('.xaf-view-caption-sm')[0]?.innerText);
    const title = document.title || '';
    const url = location.href || '';

    const activeNav = (() => {
      const active = visible('.xaf-nav-item.dxbl-active, a.dxbl-active, a[aria-current="true"]')[0];
      if (!active) return '';
      const label = Array.from(active.querySelectorAll('.xaf-nav-link span, span')).find(isVisible);
      return clean(label?.innerText);
    })();

    const itemNames = Array.from(document.querySelectorAll('[data-item-name]'))
      .map((el) => clean(el.getAttribute('data-item-name')));
    const frameNames = Array.from(document.querySelectorAll('[data-frame-name]'))
      .map((el) => clean(el.getAttribute('data-frame-name')));
    const bodyText = clean(document.body?.innerText || '');

    const hasPedidoNameField = itemNames.includes('Nombre del Pedido')
      || /Nombre del Pedido:\*/i.test(bodyText);
    const hasPedidoLinesGrid = itemNames.includes('Líneas del Pedido')
      || frameNames.includes('Líneas del Pedido')
      || /Líneas del Pedido/i.test(bodyText);
    const hasPedidoListColumns = /Nombre del Pedido/i.test(bodyText)
      && /Estado de Pedido/i.test(bodyText)
      && /Fecha de Creaci/i.test(bodyText);

    const isPedidoDetail = /^Pedido$/i.test(caption)
      || /^Pedido\s+-/i.test(title)
      || (hasPedidoNameField && hasPedidoLinesGrid && hasAction('Guardar'));
    const isPedidosList = /^Pedidos$/i.test(caption)
      || /OrderT_ListView|Pedidos?_ListView|Pedido.*ListView/i.test(url)
      || (activeNav === 'Pedidos' && hasAction('Nuevo') && hasPedidoListColumns && !isPedidoDetail);

    return {
      title,
      url,
      caption,
      activeNav,
      hasNuevo: hasAction('Nuevo'),
      hasGuardar: hasAction('Guardar'),
      hasVolver: hasAction('Volver'),
      hasEditToolbar: hasAction('Guardar') || hasAction('Guardar y Nuevo') || hasAction('Volver'),
      isPedidoDetail,
      isPedidosList
    };
  });
}

async function openNewOrderForm(page, nuevoWaitMs = 15000) {
  const state = await getPedidoPageState(page);

  if (state.isPedidoDetail) {
    return { ok: true, mode: 'existingForm' };
  }

  if (!state.isPedidosList) {
    return {
      ok: false,
      error: `当前没有识别为 Pedidos 列表页，所以不会点 Nuevo，避免点到其他页面的 Nuevo。当前识别：caption=${state.caption || '-'}, nav=${state.activeNav || '-'}, url=${state.url || '-'}`
    };
  }

  // Sondear a que aparezca "Nuevo": tras el page.goto, la barra de XAF
  // (Blazor) tarda en renderizar aunque la URL ya sea la de la lista.
  if (await clickActionByName(page, 'Nuevo', nuevoWaitMs)) return { ok: true, mode: 'clickedNuevo' };

  if (await isOrderFormOpen(page)) return { ok: true, mode: 'existingForm' };

  return { ok: false, error: '已经识别为 Pedidos 列表页，但等了很久也没出现 "Nuevo" 按钮。请确认页面加载完成，或手动刷新后重试。' };
}

async function isOrderFormOpen(page) {
  const state = await getPedidoPageState(page);
  return state.isPedidoDetail;
}

// Rellena el "Nombre del Pedido": input requerido de 150 chars. Se
// escribe por teclado (no set .value) para que el binding de Blazor -que
// es OnLostFocus- registre el cambio; el Tab final provoca el commit.
async function fillNombre(page, name) {
  const focused = await page.evaluate(() => {
    const isVisible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const inp = Array.from(document.querySelectorAll('input[aria-required="true"][maxlength="150"]')).find(isVisible)
      || Array.from(document.querySelectorAll('input.dxbl-text-edit-input[maxlength="150"]')).find(isVisible);
    if (!inp) return false;
    inp.focus();
    return true;
  });
  if (!focused) return false;
  if (!(await focoEnCampo(page))) return false;
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.keyboard.type(String(name ?? ''), { delay: 20 });
  await page.keyboard.press('Tab');
  return true;
}

// Prepara la celda de artículo antes de escribir un código. Si el doble
// Enter anterior ya dejó abierta una fila en edición, solo enfoca ese
// editor. Si en cambio el grid volvió a la fila "Haga clic aquí para
// agregar...", se pulsa esa fila para abrir una nueva línea. La clave es
// no clicar sobre una fila que ya está editándose.
async function prepareItemEditor(page, timeoutMs = 4000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await focusArticleEditor(page)) return true;

    const opened = await openAddNewItemRow(page);
    if (opened) {
      const ready = await waitForArticleEditor(page, Math.min(1800, timeoutMs));
      if (ready) return true;
    }

    await sleep(150);
  }
  return false;
}

async function waitForArticleEditor(page, timeoutMs = 1800) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await focusArticleEditor(page)) return true;
    await sleep(100);
  }
  return false;
}

async function focusArticleEditor(page) {
  return page.evaluate(() => {
    const isVisible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const rows = Array.from(document.querySelectorAll('.dxbl-grid-edit-row, .dxbl-grid-edit-new-item-row')).filter(isVisible);
    for (const row of rows) {
      const inputs = Array.from(row.querySelectorAll('input[role="combobox"], input[type="text"], input:not([type]), textarea'));
      const input = inputs.find((el) => isVisible(el) && !el.disabled && !el.closest('.dxbl-pager-page-size-selector'));
      if (input) {
        input.focus();
        return true;
      }
    }
    return false;
  });
}

async function openAddNewItemRow(page) {
  const handle = await page.evaluateHandle(() => {
    const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const isVisible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const rows = Array.from(document.querySelectorAll('.dxbl-grid-edit-new-item-row')).filter(isVisible);
    return rows.find((row) => !row.querySelector('input, textarea') && /agregar una nueva fila/i.test(clean(row.innerText))) || null;
  });
  const el = handle.asElement();
  if (!el) { await handle.dispose(); return false; }
  await el.click();
  await handle.dispose();
  return true;
}

// Espera (sondeando) a que aparezca el desplegable de autocompletado.
// Devuelve el número de opciones una vez estabilizado. Poll cada 150 ms
// hasta timeoutMs; en cuanto hay ≥1 opción, espera settleMs para que
// terminen de cargar todas (así se detecta bien el caso de varias) y
// vuelve a contar.
async function waitForDropdownOptions(page, timeoutMs, settleMs, floorMs = 300) {
  const start = Date.now();
  let count = 0;
  while (true) {
    const est = await dropdownEstado(page);
    count = est.opciones;
    if (count > 0) break;
    // "Sin datos" YA pintado y sin carga en curso: respuesta firme del
    // catálogo, distinta de "aún no salió nada" (que sí merece reintento).
    if (est.sinDatos && !est.cargando) return { count: 0, sinDatos: true };
    // Con el panel de carga a la vista se espera un poco MÁS allá del
    // timeout: "todavía cargando" no es "no hay resultados".
    const limite = est.cargando ? timeoutMs + 4000 : timeoutMs;
    if (Date.now() - start >= limite) return { count: 0, sinDatos: false };
    await sleep(120);
  }
  // Estabilización ADAPTATIVA con SUELO: se espera un mínimo (floor) para no
  // salir antes de que lleguen opciones que aparecen con un pelín de retraso
  // (si no, se podría contar "1" cuando en realidad hay varias → elección
  // equivocada). Pasado el suelo, se sondea hasta que el número deja de
  // cambiar (dos lecturas iguales), con settleMs como tope. En el caso
  // normal (opciones que cargan rápido) se sale en ~floor+120 ms en vez de
  // pagar los 900 ms completos, sin perder la detección de varios resultados.
  const floor = Math.min(settleMs, Math.max(0, Number(floorMs) || 0));
  await sleep(floor);
  const settleDeadline = Date.now() + Math.max(0, settleMs - floor);
  let prev = await dropdownOptionCount(page);
  while (Date.now() < settleDeadline) {
    await sleep(120);
    const next = await dropdownOptionCount(page);
    if (next === prev) return { count: next, sinDatos: false };
    prev = next;
  }
  return { count: prev, sinDatos: false };
}

// Radiografía del desplegable: opciones visibles + ¿hay panel de carga? +
// ¿el popup dice explícitamente que no hay datos? Permite distinguir
// "sin datos" (respuesta firme) de "aún cargando" y de "no salió nada".
async function dropdownEstado(page) {
  return page.evaluate(() => {
    const isVisible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const sel = '[role="option"], .dxbl-listbox-item, .dxbl-dropdown-item, .dxbl-grid-dropdown-item';
    const opciones = Array.from(document.querySelectorAll(sel)).filter(isVisible).length;
    const cargando = Array.from(document.querySelectorAll(
      '.dxbl-loading-panel, .dxbl-loading, [class*="load-panel"], [class*="loading-indicator"]'
    )).some(isVisible);
    const pops = Array.from(document.querySelectorAll(
      '.dxbl-dropdown-body, .dxbl-dropdown, .dxbl-popup, .dxbl-listbox, [role="listbox"]'
    )).filter(isVisible);
    const sinDatos = opciones === 0 && pops.some((p) => /sin datos|no hay datos|no data|ning[uú]n dato/i.test(p.innerText || ''));
    return { opciones, cargando, sinDatos };
  });
}

// Cuenta las opciones VISIBLES del desplegable de autocompletado abierto.
// Sirve para (a) no pulsar Enter si no hay desplegable y (b) detectar el
// caso de varios artículos que exige elección manual.
async function dropdownOptionCount(page) {
  return page.evaluate(() => {
    const isVisible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const sel = '[role="option"], .dxbl-listbox-item, .dxbl-dropdown-item, .dxbl-grid-dropdown-item';
    return Array.from(document.querySelectorAll(sel)).filter(isVisible).length;
  });
}

// Devuelve el foco al editor (artículo) de la fila que se está editando,
// para que el Tab siguiente vaya a "Cajas". Devuelve true si lo logró.
async function focusEditRowEditor(page) {
  return page.evaluate(() => {
    const isVisible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const row = Array.from(document.querySelectorAll('.dxbl-grid-edit-new-item-row, .dxbl-grid-edit-row')).find(isVisible);
    if (!row) return false;
    const inp = Array.from(row.querySelectorAll('input[type="text"], input[role="combobox"]')).find(isVisible);
    if (!inp) return false;
    inp.focus();
    return true;
  });
}

// Escribe la CANTIDAD en la fila en edición apuntando al input de la
// columna Cajas por su cabecera, en vez de fiarlo todo a un Tab a ciegas.
// Limpia el valor entero antes de teclear y VERIFICA el input.value al
// terminar (con una reescritura si no coincide): el 18/07 un Tab desviado
// dejó 620201 en "11" (1 añadido al 1 por defecto) y 850881 en 0 (tecleo
// perdido). Si no localiza el input por columna, cae al gesto clásico.
async function escribirCajasEnEdicion(page, qty, nextFieldMs = 140) {
  const objetivo = String(qty).trim();
  for (let intento = 0; intento < 2; intento += 1) {
    const enfocado = await page.evaluate(() => {
      const clean = (s) => (s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
      const isVisible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const tables = Array.from(document.querySelectorAll('table')).filter(isVisible);
      for (const table of tables) {
        const headers = Array.from(table.querySelectorAll('th')).map((th) => clean(th.innerText));
        const idxCajas = headers.findIndex((h) => /^cajas$/i.test(h));
        if (idxCajas === -1) continue;
        const row = Array.from(table.querySelectorAll('.dxbl-grid-edit-row, .dxbl-grid-edit-new-item-row')).find(isVisible);
        if (!row) continue;
        const celda = Array.from(row.querySelectorAll('td'))[idxCajas];
        const inp = celda && Array.from(celda.querySelectorAll('input')).find(isVisible);
        if (inp) { inp.focus(); return true; }
      }
      return false;
    }).catch(() => false);
    if (!enfocado) {
      await focusEditRowEditor(page);
      await page.keyboard.press('Tab');
      await sleep(nextFieldMs);
    }
    if (!(await focoEnCampo(page))) continue;
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyA');
    await page.keyboard.up('Control');
    await page.keyboard.press('Delete');
    await page.keyboard.type(objetivo, { delay: 25 });
    const valor = await page.evaluate(() => {
      const el = document.activeElement;
      return el && el.tagName === 'INPUT' ? String(el.value ?? '') : null;
    }).catch(() => null);
    if (valor === null || valor.trim() === objetivo) return true;
  }
  return false;
}

// ¿Hay alguna fila del grid en modo edición (con inputs a la vista)?
async function filaEnEdicion(page) {
  return page.evaluate(() => {
    const isVisible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    return Array.from(document.querySelectorAll('.dxbl-grid-edit-row, .dxbl-grid-edit-new-item-row'))
      .filter(isVisible)
      .some((row) => Array.from(row.querySelectorAll('input[type="text"], input[role="combobox"]')).some(isVisible));
  }).catch(() => false);
}

// ¿Quedó una fila en edición con TEXTO en el editor de ARTÍCULO? Es la
// firma del commit que no cuajó. Se mira SOLO el combobox del artículo: un
// editor recién abierto para la línea siguiente lo tiene vacío, pero su
// Cajas puede traer un "1" por defecto y no debe contar como suciedad
// (contarlo dispararía un reintento y la línea saldría duplicada).
async function filaEdicionSucia(page) {
  return page.evaluate(() => {
    const isVisible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const rows = Array.from(document.querySelectorAll('.dxbl-grid-edit-row, .dxbl-grid-edit-new-item-row')).filter(isVisible);
    return rows.some((row) => Array.from(row.querySelectorAll('input[role="combobox"]'))
      .some((inp) => isVisible(inp) && String(inp.value || '').trim() !== ''));
  }).catch(() => false);
}

// Ante VARIOS resultados en el autocompletado, selecciona la fila cuya
// celda coincide EXACTAMENTE con el código tecleado (el Código Unide).
// Devuelve true si encontró y pulsó exactamente UNA fila así; false si
// hay 0 o >1 (entonces el llamador se detiene y pide elección manual).
// Se busca dentro de los contenedores emergentes visibles para no tocar
// por error las filas del grid principal.
async function selectDropdownRowByCode(page, code) {
  const handle = await page.evaluateHandle((c) => {
    const isVisible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    // separadores: espacios normales, nbsp, tab y salto de línea (así las
    // celdas de la fila del desplegable se separan en tokens).
    const tokens = (s) => (s || '').split(/[\s ]+/).map((t) => t.trim()).filter(Boolean);
    // Las opciones del desplegable tienen role="option" (exclusivo del
    // popup: las filas del grid principal son role="row"). Se deduplica
    // por referencia con Set para que la anidación de contenedores de XAF
    // no cuente la misma fila varias veces.
    const opts = [...new Set(Array.from(document.querySelectorAll(
      '[role="option"], .dxbl-listbox-item, .dxbl-list-box-item, .dxbl-grid-dropdown-item'
    )))].filter(isVisible);
    // 1º: CELDA exacta. El Código Unide va en su propia celda, así que la
    // igualdad de celda lo identifica sin ambigüedad; la celda EANS lleva
    // la lista entera ("... ; 851707 ; ...") y nunca IGUALA al código —
    // con tokens de toda la fila, un código que también aparecía en los
    // EANs de OTRA fila hacía el match "múltiple" y se abortaba.
    const celdas = (o) => Array.from(o.querySelectorAll('td, [role="gridcell"]'))
      .map((x) => (x.innerText || '').replace(/\u00a0/g, ' ').trim());
    let matches = opts.filter((o) => celdas(o).some((t) => t === c));
    // 2º: sin estructura de celdas (opciones planas), tokens como antes.
    if (!matches.length) matches = opts.filter((o) => tokens(o.innerText).includes(c));
    return matches.length === 1 ? matches[0] : null;
  }, code);
  const el = handle.asElement();
  if (!el) { await handle.dispose(); return false; }
  await el.click();
  await handle.dispose();
  return true;
}

// --- Reparación de líneas "en blanco" ---------------------------------
// A veces la fila se confirma antes de que Blazor termine de enlazar el
// artículo: la línea queda con C.Central, peso e importe correctos pero
// con Código Unide y Artículo VACÍOS en el grid. El arreglo manual del
// usuario (lápiz "Editar" → reescribir el código → Enter Enter) funciona
// siempre, así que el bot lo replica solo, línea a línea, justo después
// de confirmar cada una (así sabe QUÉ código va en la fila en blanco).

// Tras rellenar: filas del grid VISIBLE con Cajas a 0 — pasa cuando el
// tecleo de la cantidad no llegó (la fila queda creada pero sin cajas) y a
// simple vista se escapa. Solo revisa la página del grid a la vista.
async function scanCajasCero(page) {
  return page.evaluate(() => {
    const clean = (s) => (s || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    const isVisible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const tables = Array.from(document.querySelectorAll('table')).filter(isVisible);
    for (const table of tables) {
      const headers = Array.from(table.querySelectorAll('th')).map((th) => clean(th.innerText));
      const idxCodigo = headers.findIndex((h) => /c[oó]digo unide/i.test(h));
      const idxCajas = headers.findIndex((h) => /^cajas$/i.test(h));
      const idxArt = headers.findIndex((h) => /art[ií]culo/i.test(h));
      if (idxCodigo === -1 || idxCajas === -1) continue;
      const ceros = [];
      for (const tr of Array.from(table.querySelectorAll('tr[role="row"]'))) {
        if (!isVisible(tr)) continue;
        const cells = Array.from(tr.querySelectorAll('td')).map((td) => clean(td.innerText));
        if (!cells.length) continue;
        const codigo = cells[idxCodigo] || '';
        if (!codigo) continue;
        const n = Number((cells[idxCajas] || '').replace(',', '.'));
        if (Number.isFinite(n) && n === 0) ceros.push({ codigo, articulo: idxArt >= 0 ? (cells[idxArt] || '') : '' });
      }
      return ceros;
    }
    return [];
  });
}

// Cuenta las filas confirmadas visibles con C.Central pero sin Código
// Unide (las "en blanco").
async function countBlankRows(page) {
  return page.evaluate(() => {
    const clean = (s) => (s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
    const isVisible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const tables = Array.from(document.querySelectorAll('table')).filter(isVisible);
    for (const table of tables) {
      const headers = Array.from(table.querySelectorAll('th')).map((th) => clean(th.innerText));
      const idxCodigo = headers.findIndex((h) => /c[oó]digo unide/i.test(h));
      if (idxCodigo === -1) continue;
      const idxCentral = headers.findIndex((h) => /c\.?\s*central/i.test(h));
      let count = 0;
      for (const tr of Array.from(table.querySelectorAll('tr[role="row"]'))) {
        if (!isVisible(tr)) continue;
        const cells = Array.from(tr.querySelectorAll('td')).map((td) => clean(td.innerText));
        if (!cells.length) continue;
        const central = idxCentral >= 0 ? (cells[idxCentral] || '') : '';
        const codigo = cells[idxCodigo] || '';
        if (central && !codigo && tr.querySelector('button[title="Editar"], button[aria-label="Editar"]')) count += 1;
      }
      return count;
    }
    return 0;
  });
}

// C.Central de cada fila en blanco visible (para saber cuáles son NUEVAS
// tras confirmar una línea y cuáles vienen de líneas anteriores).
async function centralesFilasBlancas(page) {
  return page.evaluate(() => {
    const clean = (s) => (s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
    const isVisible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const tables = Array.from(document.querySelectorAll('table')).filter(isVisible);
    for (const table of tables) {
      const headers = Array.from(table.querySelectorAll('th')).map((th) => clean(th.innerText));
      const idxCodigo = headers.findIndex((h) => /c[oó]digo unide/i.test(h));
      if (idxCodigo === -1) continue;
      const idxCentral = headers.findIndex((h) => /c\.?\s*central/i.test(h));
      const out = [];
      for (const tr of Array.from(table.querySelectorAll('tr[role="row"]'))) {
        if (!isVisible(tr)) continue;
        const cells = Array.from(tr.querySelectorAll('td')).map((td) => clean(td.innerText));
        if (!cells.length) continue;
        const central = idxCentral >= 0 ? (cells[idxCentral] || '') : '';
        const codigo = cells[idxCodigo] || '';
        if (central && !codigo && tr.querySelector('button[title="Editar"], button[aria-label="Editar"]')) out.push(central);
      }
      return out;
    }
    return [];
  }).catch(() => []);
}

// Botón "Editar" (lápiz) de una fila en blanco visible. Con `central` se
// exige ESA fila concreta; sin él, la primera que haya.
async function blankRowEditButton(page, central = '') {
  const handle = await page.evaluateHandle((cen) => {
    const clean = (s) => (s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
    const isVisible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const tables = Array.from(document.querySelectorAll('table')).filter(isVisible);
    for (const table of tables) {
      const headers = Array.from(table.querySelectorAll('th')).map((th) => clean(th.innerText));
      const idxCodigo = headers.findIndex((h) => /c[oó]digo unide/i.test(h));
      if (idxCodigo === -1) continue;
      const idxCentral = headers.findIndex((h) => /c\.?\s*central/i.test(h));
      for (const tr of Array.from(table.querySelectorAll('tr[role="row"]'))) {
        if (!isVisible(tr)) continue;
        const cells = Array.from(tr.querySelectorAll('td')).map((td) => clean(td.innerText));
        if (!cells.length) continue;
        const central = idxCentral >= 0 ? (cells[idxCentral] || '') : '';
        const codigo = cells[idxCodigo] || '';
        if (central && !codigo && (!cen || central === cen)) {
          const btn = tr.querySelector('button[title="Editar"], button[aria-label="Editar"]');
          if (btn) return btn;
        }
      }
    }
    return null;
  }, central || '');
  const el = handle.asElement();
  if (!el) { await handle.dispose(); return null; }
  return { el, handle };
}

// Repara UNA fila en blanco reescribiendo su artículo (el mismo gesto que
// el usuario hace a mano). Con `central` solo toca esa fila concreta —
// reparar "la primera que haya" con los términos de la línea actual
// escribió un MANZANA donde iba un PERA (18/07). Devuelve true si tras el
// reintento hay una fila en blanco menos.
async function repairBlankLine(page, terms, autocompleteTimeoutMs, autocompleteMs, central = '') {
  const before = await countBlankRows(page);
  if (before === 0) return true;
  const btn = await blankRowEditButton(page, central);
  if (!btn) return false;
  await btn.el.click();
  await btn.handle.dispose();
  const editorReady = await waitForArticleEditor(page, 4000);
  if (!editorReady) return false;
  await clearArticleEditor(page);
  let sel = await searchAndSelect(page, terms.searchTerm, terms.anchorCode, autocompleteTimeoutMs, autocompleteMs, false);
  if (sel.status !== 'ok' && terms.nombre && terms.nombre !== terms.searchTerm) {
    await clearArticleEditor(page);
    sel = await searchAndSelect(page, terms.nombre, terms.anchorCode, autocompleteTimeoutMs, autocompleteMs, true);
  }
  if (sel.status !== 'ok') return false;
  await sleep(300);
  await focusEditRowEditor(page);
  // El gesto del usuario: Enter Enter para confirmar la fila reeditada
  // (la cantidad ya estaba puesta y se conserva).
  await page.keyboard.press('Enter');
  await sleep(250);
  await page.keyboard.press('Enter');
  await sleep(400);
  return (await countBlankRows(page)) < before;
}

// Teclea `term` en el editor de artículo, espera el desplegable y selecciona.
//   - requireAnchor=false (búsqueda por código/EAN): un único resultado se
//     acepta con Enter; con varios, se elige la fila cuyo Código Unide ==
//     anchorCode.
//   - requireAnchor=true (búsqueda por NOMBRE): NUNCA se acepta a ciegas; se
//     exige que UNA fila tenga el Código Unide == anchorCode. Así el respaldo
//     por nombre jamás confirma "el primer nombre parecido".
// Devuelve { status: 'ok'|'nomatch'|'nodata'|'ambiguous', via } — 'nodata'
// significa que el desplegable dijo EXPLÍCITAMENTE que no hay datos.
async function searchAndSelect(page, term, anchorCode, timeoutMs, settleMs, requireAnchor) {
  await escribirTerminoVerificado(page, String(term));
  const dd = await waitForDropdownOptions(page, timeoutMs, settleMs);
  if (dd.sinDatos) return { status: 'nodata' };
  const count = dd.count;
  if (count === 0) return { status: 'nomatch' };
  if (count === 1 && !requireAnchor) {
    await page.keyboard.press('Enter');
    return { status: 'ok', via: 'single' };
  }
  const picked = anchorCode ? await selectDropdownRowByCode(page, anchorCode) : false;
  if (picked) return { status: 'ok', via: 'anchor' };
  return { status: 'ambiguous' };
}

// Teclea el término y VERIFICA que llegó al campo (input.value del elemento
// enfocado). Si el valor no coincide — el tecleo empezó antes de que el
// combo cogiera el foco, o quedó un resto de la búsqueda anterior —, limpia
// y reescribe UNA vez. La línea 850873 del 17/07 tecleó al vacío y el
// desplegable nunca llegó; esto lo corta de raíz en vez de fiarlo al retry.
async function escribirTerminoVerificado(page, term) {
  const esperado = String(term).trim();
  for (let intento = 0; intento < 2; intento += 1) {
    if (intento > 0) {
      await clearArticleEditor(page);
      await sleep(200);
    }
    await page.keyboard.type(String(term), { delay: 25 });
    const valor = await page.evaluate(() => {
      const el = document.activeElement;
      return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') ? String(el.value ?? '') : null;
    }).catch(() => null);
    if (valor !== null && valor.trim() === esperado) return true;
    if (valor === null && intento > 0) return false; // el foco no es un campo: reescribir más no ayuda
  }
  return false;
}

// Limpia el editor de artículo (borra el código que no encontró) para poder
// reintentar la búsqueda por nombre. Reenfoca el input y hace Ctrl+A +
// Backspace; volver a teclear reemplaza cualquier desplegable abierto.
async function clearArticleEditor(page) {
  await focusArticleEditor(page);
  // Ctrl+A SOLO con el foco de verdad dentro de un campo: suelto sobre la
  // página selecciona el documento ENTERO (la página "toda azul" que vio
  // el dueño). Si el editor no cogió el foco, no hay nada que limpiar.
  if (!(await focoEnCampo(page))) return;
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  await sleep(150);
}

// ¿El foco está en un campo de texto editable?
async function focoEnCampo(page) {
  try {
    return await page.evaluate(() => {
      const el = document.activeElement;
      return Boolean(el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable));
    });
  } catch {
    return false;
  }
}

// Captura de pantalla del navegador (mejor que la de PowerShell). Devuelve
// la ruta del PNG o null.
async function screenshot(page, config, tag) {
  try {
    // Deshacer cualquier selección colgada (un Ctrl+A desviado dejaba la
    // página entera en azul, también en la captura y para el usuario).
    try { await page.evaluate(() => { const s = window.getSelection(); if (s) s.removeAllRanges(); }); } catch { /* noop */ }
    const dir = path.resolve(config.__toolRoot || '.', 'screenshots');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `weborder-${String(tag).replace(/[^\w.-]+/g, '_')}-${Date.now()}.png`);
    await page.screenshot({ path: file });
    return file;
  } catch {
    return null;
  }
}

// Vuelca el HTML actual (útil cuando una línea falla en modo edición: así
// se ve el editor real del artículo / el desplegable).
async function captureEditDom(page, config) {
  try {
    const html = await page.content();
    const file = path.resolve(config.__toolRoot || '.', 'order-edit-dump.html');
    fs.writeFileSync(file, html, 'utf8');
    return file;
  } catch {
    return null;
  }
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

// Solo para pruebas: helpers internos del rellenado por navegador.
export const __test = {
  searchAndSelect, clearArticleEditor, selectDropdownRowByCode, focusArticleEditor,
  waitForListRows, scrapeOrderLines, openOrderDetailByRow, spanishDateToIso,
  countBlankRows, repairBlankLine
};
