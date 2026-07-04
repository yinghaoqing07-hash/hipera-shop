// =====================================================================
// Automatización de Pedidos por NAVEGADOR (DevExpress XAF web)
// =====================================================================
// Dos funciones:
//   1) inspectOrderPage()  → herramienta de diagnóstico. Se conecta,
//      localiza la pestaña de Pedidos y vuelca el HTML de la página a un
//      fichero para poder escribir/afinar los selectores. Es de SOLO
//      LECTURA: no pulsa nada.
//   2) applyOrderWeb(draft) → rellena un pedido nuevo conduciendo el DOM.
//      Reglas de seguridad (idénticas a la versión de escritorio):
//        - NUNCA pulsa Guardar / Enviar Pedido.
//        - Deja el borrador a la vista y hace captura para revisión.
//
// El grid de artículos de XAF es la parte delicada; sus selectores se
// completan a partir del volcado de inspectOrderPage(). Hasta entonces,
// applyOrderWeb rellena lo seguro (Nuevo + Nombre) y avisa.
import fs from 'node:fs';
import path from 'node:path';
import { connectBrowser, findOrderPage } from './webBrowser.js';

// Sube (o localiza) la pestaña de Pedidos y la trae al frente.
async function openOrderPage(config) {
  const browser = await connectBrowser(config);
  const page = await findOrderPage(browser, config);
  if (!page) {
    try { browser.disconnect(); } catch { /* noop */ }
    const err = new Error('连上了 Edge，但没找到 UnideGes 的标签页。请确认那个 Edge 窗口里打开了 Pedidos 页面（网址含 unideges）。');
    err.stage = 'findPage';
    throw err;
  }
  try { await page.bringToFront(); } catch { /* noop */ }
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

    const clicked = await clickActionByName(page, 'Nuevo');
    if (!clicked) {
      return { ok: false, stage: 'nuevo', error: '没找到 data-action-name="Nuevo" 的按钮。请确认页面是订单列表页。' };
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
    const betweenLinesMs = Number(w.betweenLinesMs) || 700;

    // Paso 1: "Nuevo" (abre el DetailView del pedido). Si un intento
    // anterior dejó un formulario abierto, volvemos a la lista y reintentamos.
    const openedNewOrder = await openNewOrderForm(page);
    if (!openedNewOrder.ok) {
      return { ok: false, stage: 'nuevo', error: openedNewOrder.error };
    }
    await sleep(Number(w.formRenderMs) || 2800);

    // Paso 2: Nombre del Pedido (input requerido, maxlength 150).
    if (!(await fillNombre(page, draft.orderName))) {
      return { ok: false, stage: 'nombre', error: '没找到订单名输入框（aria-required maxlength=150）。' };
    }
    await sleep(300);

    // Paso 3: líneas. Se procesan una a una; ante cualquier anomalía se
    // para y se avisa, sin adivinar.
    const results = [];
    let autoPicked = 0;
    for (let i = 0; i < draft.items.length; i++) {
      const item = draft.items[i];
      const code = String(item.code || '').trim();
      const qty = String(item.quantity ?? '').trim();
      if (!code) { results.push({ code, qty, ok: false, reason: 'sin código' }); continue; }

      const started = i === 0
        ? await startNewItemRow(page, autocompleteTimeoutMs)
        : await ensureArticleEditorReady(page, autocompleteTimeoutMs);
      if (!started) {
        const shot = await screenshot(page, config, 'newrow');
        const dom = await captureEditDom(page, config);
        return {
          ok: false, stage: 'newrow', screenshot: shot, domDump: dom,
          error: `第 ${i + 1} 行：没找到表格的“新增行”/“编辑行”。前面已填的不会保存。（已把当时页面结构发给 Claude）`,
          results
        };
      }
      await sleep(300);
      await page.keyboard.type(code, { delay: 25 });
      // Sondear hasta que el desplegable aparezca (la red/servidor pueden
      // tardar), en vez de una espera fija que a veces se queda corta.
      const opts = await waitForDropdownOptions(page, autocompleteTimeoutMs, autocompleteMs);
      if (opts === 0) {
        const shot = await screenshot(page, config, `code-${code}-nomatch`);
        const dom = await captureEditDom(page, config);
        return {
          ok: false, stage: 'autocomplete', screenshot: shot, domDump: dom,
          error: `código ${code} 没有出现自动补全选项（可能焦点不对或代码无效）。已停止，未保存。`,
          results
        };
      }
      if (opts === 1) {
        // Un único resultado → Enter selecciona (desplegable abierto).
        await page.keyboard.press('Enter');
      } else {
        // Varios resultados. Regla del usuario: elegir la fila cuyo Código
        // Unide coincide EXACTAMENTE con el código tecleado (misma
        // referencia, el resto suelen ser el mismo artículo sin Código
        // Unide). Se busca la fila con una celda == code y se pulsa.
        const picked = await selectDropdownRowByCode(page, code);
        if (!picked) {
          const shot = await screenshot(page, config, `code-${code}-multi`);
          const dom = await captureEditDom(page, config);
          results.push({ code, qty, ok: false, reason: `${opts} 个匹配，无法自动判断` });
          return {
            ok: false, stage: 'ambiguous', screenshot: shot, domDump: dom,
            error: `código ${code} 有 ${opts} 个匹配，且没有一行的 Código Unide 正好等于 ${code}，无法自动选。已停止在这一行，未保存。前面 ${i} 行已填好。`,
            results
          };
        }
        autoPicked += 1;
      }
      await sleep(300);
      // Tras seleccionar (sobre todo si fue por clic en una fila del
      // desplegable), el foco puede quedar en la opción, no en el editor.
      // Se devuelve el foco al editor de la fila para que el Tab siguiente
      // llegue a "Cajas" de forma fiable.
      await focusEditRowEditor(page);
      // Cajas: Tab desde el editor de artículo y escribir la cantidad.
      await page.keyboard.press('Tab');
      await sleep(200);
      if (qty) await page.keyboard.type(qty, { delay: 25 });
      // Ritmo real de UnideGes (método A): tras la cantidad, DOS Enter
      // confirman la línea y abren la siguiente fila de alta. Aquí el foco
      // está en la celda "Cajas" del grid, así que Enter confirma la fila,
      // no dispara Guardar (Guardar es un botón aparte del formulario).
      await page.keyboard.press('Enter');
      await sleep(150);
      await page.keyboard.press('Enter');
      await sleep(betweenLinesMs);
      results.push({ code, qty, ok: true });
    }

    const shot = await screenshot(page, config, 'done');
    const okCount = results.filter((r) => r.ok).length;
    logger?.info('web order filled', { name: draft.orderName, ok: okCount, total: draft.items.length, autoPicked });
    const autoNote = autoPicked > 0 ? `（其中 ${autoPicked} 行有多个匹配，已自动选 Código Unide 相符的那行）` : '';
    return {
      ok: true,
      screenshot: shot,
      message: `订单名「${draft.orderName}」+ ${okCount}/${draft.items.length} 行已填入${autoNote}。请看截图核对，然后人工点 Guardar。程序没有点 Guardar，也没有点 Enviar Pedido。`,
      results
    };
  } catch (error) {
    logger?.error('web order apply failed', { stage: error.stage, error: error.message });
    return { ok: false, stage: error.stage || 'apply', error: error.message };
  } finally {
    try { browser?.disconnect(); } catch { /* noop */ }
  }
}

// --- helpers ---------------------------------------------------------
// Pulsa un botón de acción de XAF por su data-action-name (estable),
// eligiendo el visible (ignora la copia __virtual del menú de overflow).
async function clickActionByName(page, actionName) {
  const handle = await page.evaluateHandle((name) => {
    const isVisible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const els = Array.from(document.querySelectorAll('[data-action-name="' + name + '"]'));
    return els.find((el) => isVisible(el)) || els[0] || null;
  }, actionName);
  const el = handle.asElement();
  if (!el) { await handle.dispose(); return false; }
  await el.click();
  await handle.dispose();
  return true;
}

async function openNewOrderForm(page) {
  if (await clickActionByName(page, 'Nuevo')) return { ok: true };

  if (await isOrderFormOpen(page)) {
    const wentBack = await clickActionByName(page, 'Volver');
    if (wentBack) {
      await sleep(1500);
      if (await clickActionByName(page, 'Nuevo')) return { ok: true };
    }

    return {
      ok: false,
      error: '没有找到 "Nuevo" 按钮。页面看起来停在一个已打开的订单表单上，但自动返回列表失败；请在自动化 Edge 里点 Volver 回到 Pedidos 列表页，再点“确认填入”。'
    };
  }

  return { ok: false, error: '没有找到 "Nuevo" 按钮。请确认自动化 Edge 里打开的是 Pedidos 列表页。' };
}

async function isOrderFormOpen(page) {
  return page.evaluate(() => {
    const isVisible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const nameInput = Array.from(document.querySelectorAll('input[aria-required="true"][maxlength="150"], input.dxbl-text-edit-input[maxlength="150"]')).find(isVisible);
    const lineGrid = Array.from(document.querySelectorAll('.dxbl-grid, [role="grid"]')).find(isVisible);
    return Boolean(nameInput && lineGrid);
  });
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
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.keyboard.type(String(name ?? ''), { delay: 20 });
  await page.keyboard.press('Tab');
  return true;
}

// Entra en edición en la fila de alta del grid de líneas. Sondea hasta
// timeoutMs porque, tras confirmar una línea (Enter Enter), la nueva fila
// tarda un poco en renderizarse en el servidor real. Acepta tanto la fila
// de alta (dxbl-grid-edit-new-item-row) como una fila que ya esté en modo
// edición (dxbl-grid-edit-row), y hace clic en su primera celda de datos
// editable (la del artículo; salta comando/checkbox).
async function startNewItemRow(page, timeoutMs = 4000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const handle = await page.evaluateHandle(() => {
      const isVisible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const row = Array.from(document.querySelectorAll(
        '.dxbl-grid-edit-new-item-row, .dxbl-grid-edit-row'
      )).find(isVisible);
      if (!row) return null;
      const cells = Array.from(row.querySelectorAll('td[role="gridcell"], .dxbl-grid-cell'));
      const target = cells.find((c) => !c.classList.contains('dxbl-grid-command-cell')
        && !c.querySelector('input[type="checkbox"]')) || cells[0] || row;
      return target;
    });
    const el = handle.asElement();
    if (el) { await el.click(); await handle.dispose(); return true; }
    await handle.dispose();
    await sleep(200);
  }
  return false;
}

// Después de confirmar una línea con Enter Enter, UnideGes suele dejar el
// foco ya dentro del artículo de la siguiente línea. En ese caso NO se debe
// clicar otra vez: el clic extra puede romper el editor/autocompletado.
// Solo si el foco no está en la primera celda editable se usa el clic como
// recuperación.
async function ensureArticleEditorReady(page, timeoutMs = 4000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isArticleEditorFocused(page)) return true;
    await sleep(150);
  }
  return startNewItemRow(page, timeoutMs);
}

async function isArticleEditorFocused(page) {
  return page.evaluate(() => {
    const active = document.activeElement;
    if (!active) return false;
    const row = active.closest('.dxbl-grid-edit-new-item-row, .dxbl-grid-edit-row');
    if (!row) return false;

    const isVisible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    if (!isVisible(row)) return false;

    const cells = Array.from(row.querySelectorAll('td[role="gridcell"], .dxbl-grid-cell'));
    const articleCell = cells.find((c) => !c.classList.contains('dxbl-grid-command-cell')
      && !c.querySelector('input[type="checkbox"]'));
    if (!articleCell || !articleCell.contains(active)) return false;

    const editor = active.matches('input, textarea, [contenteditable="true"]')
      ? active
      : active.closest('input, textarea, [contenteditable="true"]');
    return Boolean(editor);
  });
}

// Espera (sondeando) a que aparezca el desplegable de autocompletado.
// Devuelve el número de opciones una vez estabilizado. Poll cada 150 ms
// hasta timeoutMs; en cuanto hay ≥1 opción, espera settleMs para que
// terminen de cargar todas (así se detecta bien el caso de varias) y
// vuelve a contar.
async function waitForDropdownOptions(page, timeoutMs, settleMs) {
  const start = Date.now();
  let count = 0;
  while (Date.now() - start < timeoutMs) {
    count = await dropdownOptionCount(page);
    if (count > 0) break;
    await sleep(150);
  }
  if (count === 0) return 0;
  await sleep(settleMs);
  return dropdownOptionCount(page);
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

// Captura de pantalla del navegador (mejor que la de PowerShell). Devuelve
// la ruta del PNG o null.
async function screenshot(page, config, tag) {
  try {
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
