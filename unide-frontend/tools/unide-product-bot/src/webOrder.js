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
import { setLive } from './liveStatus.js';
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
export async function applyOrderWeb(draft, config, logger) {
  let browser;
  try {
    setLive('[pedido] 连接 Edge，打开 Pedidos…');
    const opened = await openOrderPage(config);
    browser = opened.browser;
    const page = opened.page;
    const w = config.webOrder || {};
    // autocompleteMs = cuánto se espera TRAS aparecer el desplegable, para
    // que carguen todas las opciones antes de contarlas (detección de
    // varios resultados). autocompleteTimeoutMs = espera MÁXIMA a que el
    // desplegable aparezca (sondeo). Subir ambos si la red va lenta.
    const autocompleteMs = Number(w.autocompleteMs) || 900;
    const autocompleteTimeoutMs = Number(w.autocompleteTimeoutMs) || 5000;
    const betweenLinesMs = Number(w.betweenLinesMs) || 400;

    // Paso 1: "Nuevo" (abre el DetailView del pedido). Si ya estamos en
    // un formulario abierto, se continúa ahí. No se pulsa Volver: UnideGes
    // puede mostrar una confirmación por cambios sin guardar.
    setLive('[pedido] 点 Nuevo，等表单渲染…');
    const openedNewOrder = await openNewOrderForm(page, Number(w.pageNavigationTimeoutMs) || 20000);
    if (!openedNewOrder.ok) {
      setLive('[pedido] ERROR: ' + openedNewOrder.error);
      return { ok: false, stage: 'nuevo', error: openedNewOrder.error };
    }
    await sleep(Number(w.formRenderMs) || 2800);
    setLive('[pedido] 填订单名「' + draft.orderName + '」…');

    // Paso 2: Nombre del Pedido (input requerido, maxlength 150).
    if (!(await fillNombre(page, draft.orderName))) {
      return { ok: false, stage: 'nombre', error: '没找到订单名输入框（aria-required maxlength=150）。' };
    }
    await sleep(300);

    // Paso 3: líneas. Se procesan una a una; ante cualquier anomalía se
    // para y se avisa, sin adivinar.
    const results = [];
    let autoPicked = 0;
    let namePicked = 0;
    let repairedCount = 0;
    let unrepairedBlanks = 0;
    const unrepairedCodes = [];
    for (let i = 0; i < draft.items.length; i++) {
      const item = draft.items[i];
      const code = String(item.code || '').trim();
      const qty = String(item.quantity ?? '').trim();
      const nombre = String(item.nombre || '').trim();
      // Término de búsqueda: el código/EAN si lo hay; si no (línea por nombre
      // resuelta cuya opción no traía código), el propio nombre exacto.
      const searchTerm = code || nombre || String(item.name || '').trim();
      // Si el código corto se convirtió a EAN, en los mensajes de error se
      // muestran ambos (original → EAN) para saber qué se buscó de verdad.
      const original = String(item.originalCode || '').trim();
      const codeLabel = original && original !== code ? `${original} → EAN ${code}` : (code || searchTerm);
      setLive(`[pedido] 第 ${i + 1}/${draft.items.length} 行：${nombre || codeLabel}`);
      if (!searchTerm) { results.push({ code, qty, ok: false, reason: 'sin código' }); continue; }

      const prepared = await prepareItemEditor(page, autocompleteTimeoutMs);
      if (!prepared) {
        const shot = await screenshot(page, config, 'newrow');
        const dom = await captureEditDom(page, config);
        return {
          ok: false, stage: 'newrow', screenshot: shot, domDump: dom,
          error: `第 ${i + 1} 行：没找到可输入的 artículo 编辑框，也没能打开“新增行”。前面已填的不会保存。（已保存页面结构）`,
          results
        };
      }
      await sleep(Number(w.nextLineReadyMs) || 120);

      // anchorCode = el Código Unide conocido, para elegir la fila exacta si
      // el autocompletado saca varias. La búsqueda se intenta en cadena hasta
      // que una funciona:
      //   1) término principal (EAN si se convirtió, o el código, o el nombre
      //      de una línea por nombre);
      //   2) el código corto ORIGINAL (p. ej. 3701) por si su EAN no está
      //      indexado en la web —el código sí es un identificador válido—;
      //   3) el nombre de la tabla local (limpio, sin el punto de truncado).
      // Todos anclados en anchorCode: nunca confirman "el primer parecido".
      const anchorCode = String(item.anchorCode || item.originalCode || code).trim();
      const attempts = [{ term: searchTerm, requireAnchor: false }];
      if (original && original !== searchTerm) attempts.push({ term: original, requireAnchor: false, via: 'code' });
      if (nombre && nombre !== searchTerm) attempts.push({ term: nombre, requireAnchor: true, via: 'name' });

      let sel = { status: 'nomatch' };
      let triedName = false;
      for (let t = 0; t < attempts.length; t += 1) {
        if (t > 0) await clearArticleEditor(page);
        const at = attempts[t];
        if (at.via === 'name') triedName = true;
        const r = await searchAndSelect(page, at.term, anchorCode, autocompleteTimeoutMs, autocompleteMs, at.requireAnchor);
        if (r.status === 'ok') { sel = { ...r, viaName: at.via === 'name' }; break; }
        sel = r;
      }
      if (sel.status !== 'ok' && triedName) sel.nameTried = true;

      if (sel.status !== 'ok') {
        const tag = sel.status === 'nomatch' ? 'nomatch' : 'multi';
        const shot = await screenshot(page, config, `code-${code}-${tag}`);
        const dom = await captureEditDom(page, config);
        const nameNote = sel.nameTried ? `（也试了按商品名「${nombre}」搜，仍无法确定）` : '';
        const detail = sel.status === 'nomatch'
          ? `código ${codeLabel} 没有出现自动补全选项（可能焦点不对或代码无效）${nameNote}。已停止，未保存。`
          : `código ${codeLabel} 有多个匹配，且没有一行的 Código Unide 正好等于 ${anchorCode}${nameNote}，无法自动选。已停止在这一行，未保存。前面 ${i} 行已填好。`;
        results.push({ code, qty, ok: false, reason: sel.status });
        return {
          ok: false, stage: sel.status === 'nomatch' ? 'autocomplete' : 'ambiguous',
          screenshot: shot, domDump: dom, error: detail, results
        };
      }
      if (sel.via === 'anchor') autoPicked += 1;
      if (sel.viaName) namePicked += 1;
      // Dejar que Blazor termine de ENLAZAR el artículo elegido antes de
      // seguir (confirmar demasiado pronto deja la fila "en blanco").
      await sleep(Number(w.selectSettleMs) || 500);
      // Tras seleccionar (sobre todo si fue por clic en una fila del
      // desplegable), el foco puede quedar en la opción, no en el editor.
      // Se devuelve el foco al editor de la fila para que el Tab siguiente
      // llegue a "Cajas" de forma fiable.
      await focusEditRowEditor(page);
      // Cajas: Tab desde el editor de artículo y escribir la cantidad.
      await page.keyboard.press('Tab');
      await sleep(Number(w.nextFieldMs) || 140);
      if (qty) await page.keyboard.type(qty, { delay: 25 });
      // Ritmo real de UnideGes (método A): tras la cantidad, DOS Enter
      // confirman la línea y abren la siguiente fila de alta. Aquí el foco
      // está en la celda "Cajas" del grid, así que Enter confirma la fila,
      // no dispara Guardar (Guardar es un botón aparte del formulario).
      await page.keyboard.press('Enter');
      await sleep(150);
      await page.keyboard.press('Enter');
      await sleep(betweenLinesMs);

      // Autocomprobación de la línea recién confirmada: si quedó "en
      // blanco" (C.Central sin Código Unide, un fallo de enlace de Blazor
      // al confirmar demasiado pronto), se repara con el gesto del
      // usuario: lápiz Editar → reescribir el código → Enter Enter.
      let repaired = false;
      if (w.repairBlankLines !== false) {
        const blanks = await countBlankRows(page);
        if (blanks > unrepairedBlanks) {
          repaired = await repairBlankLine(page, { searchTerm, nombre, anchorCode }, autocompleteTimeoutMs, autocompleteMs);
          if (repaired) repairedCount += 1;
          else { unrepairedBlanks += 1; unrepairedCodes.push(codeLabel); }
        }
      }
      results.push({ code, qty, ok: true, repaired });
    }

    setLive('[pedido] 行都填完了，截图核对…');
    const shot = await screenshot(page, config, 'done');
    const okCount = results.filter((r) => r.ok).length;
    logger?.info('web order filled', { name: draft.orderName, ok: okCount, total: draft.items.length, autoPicked, namePicked, repairedCount, unrepairedBlanks });
    const notes = [];
    if (autoPicked > 0) notes.push(`${autoPicked} 行有多个匹配，已自动选 Código Unide 相符的那行`);
    if (namePicked > 0) notes.push(`${namePicked} 行代码没搜到，已改用商品名搜到并按 Código Unide 选中`);
    if (repairedCount > 0) notes.push(`${repairedCount} 行提交后 Código Unide 显示空白，已自动重输修复`);
    if (unrepairedCodes.length > 0) notes.push(`⚠️ ${unrepairedCodes.join('、')} 提交后显示空白且自动修复失败，请人工点铅笔重输一遍这个代码`);
    const autoNote = notes.length ? `（${notes.join('；')}）` : '';
    setLive('[pedido] listo');
    return {
      ok: true,
      screenshot: shot,
      message: `订单名「${draft.orderName}」+ ${okCount}/${draft.items.length} 行已填入${autoNote}。请看截图核对。这一步还没有点 Guardar，也没有点 Enviar Pedido。`,
      results
    };
  } catch (error) {
    setLive('[pedido] ERROR: ' + error.message);
    logger?.error('web order apply failed', { stage: error.stage, error: error.message });
    return { ok: false, stage: error.stage || 'apply', error: error.message };
  } finally {
    try { browser?.disconnect(); } catch { /* noop */ }
  }
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
    const count = await waitForDropdownOptions(page, autocompleteTimeoutMs, autocompleteMs);
    const shot = await screenshot(page, config, `search-${name}`);
    if (count === 0) return { ok: true, options: [], screenshot: shot };

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
    const opened = await openOrderPage(config);
    browser = opened.browser;
    const page = opened.page;
    const w = config.webOrder || {};
    const timeout = Number(w.pageNavigationTimeoutMs) || 20000;
    const rows = await waitForListRows(page, timeout);
    if (!rows.length) return { ok: false, error: 'Pedidos 列表是空的' };
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
    const openedDetail = await openOrderDetailByRow(page, target, timeout);
    if (!openedDetail) return { ok: false, error: `打不开单子「${target.nombre}」` };
    await sleep(Number(w.formRenderMs) || 2800);
    const items = await scrapeAllOrderLines(page, config);
    logger?.info('order lines fetched', { nombre: target.nombre, lines: items.length });
    return { ok: true, orderName: target.nombre, orderDate: target.fechaIso, estado: target.estado, items, otherPda };
  } catch (error) {
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
  while (Date.now() - start < timeoutMs) {
    count = await dropdownOptionCount(page);
    if (count > 0) break;
    await sleep(120);
  }
  if (count === 0) return 0;
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
    if (next === prev) return next;
    prev = next;
  }
  return prev;
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
    const matches = opts.filter((o) => tokens(o.innerText).includes(c));
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

// Botón "Editar" (lápiz) de la primera fila en blanco visible.
async function blankRowEditButton(page) {
  const handle = await page.evaluateHandle(() => {
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
        if (central && !codigo) {
          const btn = tr.querySelector('button[title="Editar"], button[aria-label="Editar"]');
          if (btn) return btn;
        }
      }
    }
    return null;
  });
  const el = handle.asElement();
  if (!el) { await handle.dispose(); return null; }
  return { el, handle };
}

// Repara la primera fila en blanco reescribiendo su artículo (el mismo
// gesto que el usuario hace a mano). Devuelve true si tras el reintento
// hay una fila en blanco menos.
async function repairBlankLine(page, terms, autocompleteTimeoutMs, autocompleteMs) {
  const before = await countBlankRows(page);
  if (before === 0) return true;
  const btn = await blankRowEditButton(page);
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
// Devuelve { status: 'ok'|'nomatch'|'ambiguous', via }.
async function searchAndSelect(page, term, anchorCode, timeoutMs, settleMs, requireAnchor) {
  await page.keyboard.type(String(term), { delay: 25 });
  const count = await waitForDropdownOptions(page, timeoutMs, settleMs);
  if (count === 0) return { status: 'nomatch' };
  if (count === 1 && !requireAnchor) {
    await page.keyboard.press('Enter');
    return { status: 'ok', via: 'single' };
  }
  const picked = anchorCode ? await selectDropdownRowByCode(page, anchorCode) : false;
  if (picked) return { status: 'ok', via: 'anchor' };
  return { status: 'ambiguous' };
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
