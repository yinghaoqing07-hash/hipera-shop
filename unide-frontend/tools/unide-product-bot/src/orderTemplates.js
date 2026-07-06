import fs from 'node:fs';
import path from 'node:path';

// Plantilla de "recuento con el móvil" que sustituye a la hoja de papel
// del pedido de carne: la lista fija de productos (código + nombre corto,
// copiada de la hoja impresa de la tienda) se manda a Telegram como
// botones; en vez de marcar cantidades a boli mientras recorres la
// tienda, tocas el producto y el número sube (0→1→…→5→0). Al terminar,
// "生成订单" convierte el recuento en un borrador de /pedido_nuevo
// normal, con su confirmación y su 确认填入 de siempre.
//
// La lista por defecto vive aquí; si existe data/plantilla-<nombre>.json
// (p. ej. editado a mano en el PC de la tienda, sobrevive a update-bot),
// ese fichero manda.

const CARNE_DEFAULT = [
  { code: '617519', nombre: 'HAMB. ANGUS' },
  { code: '618496', nombre: 'HAMB NEWYORK' },
  { code: '616646', nombre: 'CARNE PIC AÑOJO' },
  { code: '616647', nombre: 'CARNE PIC MIXTA' },
  { code: '615958', nombre: 'FILETE PANCETA' },
  { code: '615960', nombre: 'CHULETA AGUJA' },
  { code: '609951', nombre: 'ESCALOPIN ADOB' },
  { code: '609950', nombre: 'ESCALOPIN TIERNO' },
  { code: '623040', nombre: 'SOLOMILLO LIMON' },
  { code: '623041', nombre: 'SOLOMILLO CHILI' },
  { code: '620000', nombre: 'FILETE FINO' },
  { code: '619866', nombre: 'POLLO ENTERO' },
  { code: '620002', nombre: 'JAMONCITOS' },
  { code: '620003', nombre: 'PECHUGA LIMPIA' },
  { code: '620004', nombre: 'CONTRAMUSLO' },
  { code: '620005', nombre: 'ALAS PARTIDAS' },
  { code: '620006', nombre: 'SOLOMILLO' },
  { code: '620007', nombre: 'CUARTO TRASERO' },
  { code: '620008', nombre: 'FILETE CONTRAM' },
  { code: '614883', nombre: 'BURGUER CRISPY' },
  { code: '898072', nombre: 'LOMO CAY ADOBAD' },
  { code: '898073', nombre: 'LOMO CAY AJILLO' },
  { code: '620254', nombre: '1/2 GALLINA' },
  { code: '616091', nombre: 'ESPINAZO' },
  { code: '609745', nombre: 'LONGANIZA' },
  { code: '983671', nombre: 'PINCHAZ ANDALUZ' },
  { code: '831212', nombre: 'PINCHAZ ROJO' },
  { code: '620259', nombre: 'ALAS ADOBADAS' }
];

const DEFAULTS = { carne: { label: 'CARNE', items: CARNE_DEFAULT } };

const MAX_COUNT = 5; // tocar más allá vuelve a 0

export function loadTemplate(config, name) {
  const key = String(name || '').toLowerCase();
  const base = DEFAULTS[key];
  const file = path.resolve(config.__toolRoot || '.', `data/plantilla-${key}.json`);
  try {
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
      const items = (Array.isArray(parsed) ? parsed : parsed?.items || [])
        .map((it) => ({ code: String(it.code || it.codigo || '').trim(), nombre: String(it.nombre || it.name || '').trim() }))
        .filter((it) => it.code);
      if (items.length) return { label: parsed?.label || base?.label || key.toUpperCase(), items, source: 'archivo' };
    }
  } catch { /* archivo roto → usar la lista por defecto */ }
  if (!base) return null;
  return { label: base.label, items: base.items, source: 'defecto' };
}

export function cycleCount(current) {
  const value = Number(current) || 0;
  return value >= MAX_COUNT ? 0 : value + 1;
}

// Teclado del recuento: una fila por producto (tocar = +1) con la cantidad
// visible en el propio botón, y una fila de control al final.
export function buildTallyKeyboard(id, template, counts) {
  const rows = template.items.map((item, index) => {
    const count = Number(counts?.[index]) || 0;
    const mark = count > 0 ? ` ✅ ${count}` : '';
    return [{ text: `${item.nombre}${mark}`, callback_data: `tc:${id}:${index}` }];
  });
  rows.push([
    { text: '✔ 生成订单', callback_data: `tcgo:${id}` },
    { text: '清零', callback_data: `tcclr:${id}` },
    { text: '取消', callback_data: `cancel:${id}` }
  ]);
  return { inline_keyboard: rows };
}

// Convierte el recuento en un borrador con la forma de parseOrderDraftMessage:
// solo las líneas con cantidad > 0, nombre de pedido "<LABEL> ddmm".
export function buildDraftFromTally(template, counts, now = new Date(), timeZone = 'Europe/Madrid') {
  const items = [];
  template.items.forEach((item, index) => {
    const count = Number(counts?.[index]) || 0;
    if (count <= 0) return;
    items.push({ code: item.code, quantity: String(count), raw: `${item.code} ${count}`, nombre: item.nombre });
  });
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone, day: '2-digit', month: '2-digit' });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const orderName = `${template.label} ${parts.day}${parts.month}`;
  return { raw: `tally ${template.label}`, orderName, items };
}
