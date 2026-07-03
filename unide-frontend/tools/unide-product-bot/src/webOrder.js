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

// --- 2) Rellenar pedido (primera fase: Nuevo + Nombre, seguro) --------
export async function applyOrderWeb(draft, config, logger) {
  let browser;
  try {
    const opened = await openOrderPage(config);
    browser = opened.browser;
    const page = opened.page;

    // Paso 1: pulsar "Nuevo" por data-action-name (estable en XAF).
    const clickedNuevo = await clickActionByName(page, 'Nuevo');
    if (!clickedNuevo) {
      return { ok: false, stage: 'nuevo', error: '没有找到 "Nuevo" 按钮。请先发 /pedido_web_test，把页面结构发我。' };
    }
    await sleep(2800);

    // Paso 2: rellenar el nombre del pedido.
    const filledName = await fillFieldNearLabel(page, /^nombre\b/i, draft.orderName);
    if (!filledName) {
      return { ok: false, stage: 'nombre', error: '点了 Nuevo，但没找到 "Nombre" 输入框。请发 /pedido_web_test 让我看结构。' };
    }
    await sleep(400);

    // Paso 3 (grid de artículos): pendiente de selectores del volcado.
    // De momento NO tocamos el grid para no escribir en sitio equivocado.
    logger?.info('web order name filled; article grid pending selectors', { name: draft.orderName, lines: draft.items.length });
    return {
      ok: true,
      partial: true,
      message: `已点 Nuevo 并填入订单名「${draft.orderName}」。商品行（${draft.items.length} 行）还没接上——需要你先发一次 /pedido_web_test 让我拿到网页结构。程序没有点 Guardar，也没有点 Enviar Pedido。`
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

// Pulsa el primer elemento visible que coincida con el texto.
async function clickByText(page, selectors, regexSource) {
  const handle = await page.evaluateHandle((sels, reSrc, reFlags) => {
    const re = new RegExp(reSrc, reFlags);
    const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const isVisible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const els = Array.from(document.querySelectorAll(sels.join(',')));
    return els.find((el) => isVisible(el) && re.test(clean(el.innerText))) || null;
  }, selectors, regexSource.source, regexSource.flags);
  const el = handle.asElement();
  if (!el) { await handle.dispose(); return false; }
  await el.click();
  await handle.dispose();
  return true;
}

// Encuentra el input asociado a una etiqueta y escribe el valor.
async function fillFieldNearLabel(page, labelRegex, value) {
  const handle = await page.evaluateHandle((reSrc, reFlags) => {
    const re = new RegExp(reSrc, reFlags);
    const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const isVisible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    // 1) <label for=...>
    for (const label of document.querySelectorAll('label')) {
      if (!re.test(clean(label.innerText))) continue;
      const forId = label.getAttribute('for');
      if (forId) { const inp = document.getElementById(forId); if (inp) return inp; }
      const inScope = label.parentElement?.querySelector('input, textarea');
      if (inScope && isVisible(inScope)) return inScope;
    }
    // 2) etiqueta genérica + input hermano/cercano
    const labelish = Array.from(document.querySelectorAll('span, div, td')).find(
      (el) => isVisible(el) && re.test(clean(el.innerText)) && clean(el.innerText).length < 40
    );
    if (labelish) {
      const container = labelish.closest('tr, div');
      const inp = container?.querySelector('input, textarea');
      if (inp && isVisible(inp)) return inp;
    }
    return null;
  }, labelRegex.source, labelRegex.flags);
  const el = handle.asElement();
  if (!el) { await handle.dispose(); return false; }
  await el.click({ clickCount: 3 }); // seleccionar contenido existente
  await el.type(String(value ?? ''), { delay: 20 });
  await handle.dispose();
  return true;
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
