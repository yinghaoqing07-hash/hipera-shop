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

// Hoja real de fruta y verdura contrastada con las tablas de artículos.
// MANZANA GRANEL usa el artículo activo 599651 y PIMIENTO VERDE 851086.
const FRUTA_DEFAULT = [
  { code: '851220', nombre: 'AGUACATE HASS' },
  { code: '613394', nombre: 'PERA CONFERENCIA' },
  { code: '599651', nombre: 'MANZANA GRANEL' },
  { code: '851850', nombre: 'LIMA GRANEL' },
  { code: '851170', nombre: 'LIMON MALLA 750G' },
  { code: '850963', nombre: 'PIMIENTO ROJO' },
  { code: '851086', nombre: 'PIMIENTO VERDE' },
  { code: '850544', nombre: 'PEPINO ESPAÑOL' },
  { code: '850965', nombre: 'CALABACIN' },
  { code: '852678', nombre: 'PLATANO CANARIO' },
  { code: '852460', nombre: 'MANZANA GOLDEN' },
  { code: '851755', nombre: 'MANZANA ROYAL GALA' },
  { code: '603568', nombre: 'UVA BLANCA SIN SEMILLA' },
  { code: '851125', nombre: 'KIWI GOLD' },
  { code: '851707', nombre: 'ESPARRAGO VERDE' },
  { code: '851223', nombre: 'MANGO' },
  { code: '851232', nombre: 'CALABAZA CACAHUETE' },
  { code: '852116', nombre: 'NARANJA MESA' },
  { code: '851849', nombre: 'NARANJA MESA ENCAJADA' },
  { code: '851040', nombre: 'LIMON GRANEL' },
  { code: '851877', nombre: 'TOMATE PERA' },
  { code: '850873', nombre: 'TOMATE RAMA' },
  { code: '850574', nombre: 'TOMATE ENSALADA' },
  { code: '852461', nombre: 'CHAMPIÑON 300G' },
  { code: '620207', nombre: 'CUATRO ESTACIONES' },
  { code: '620475', nombre: 'ENSALADA CESAR' },
  { code: '622353', nombre: 'AJO BUTI 250G' },
  { code: '852085', nombre: 'CEBOLLA MORADA' },
  { code: '851259', nombre: 'CEBOLLA DULCE' },
  { code: '622354', nombre: 'CEBOLLA BUTI 1KG' },
  { code: '850916', nombre: 'CEBOLLA GRANEL' },
  { code: '850799', nombre: 'PATATA CEPILLADA' },
  { code: '852465', nombre: 'PATATA LAVADA GRANEL' },
  { code: '620201', nombre: 'ICEBERG BOLSA' },
  { code: '620459', nombre: 'CILANTRO' },
  { code: '620246', nombre: 'PEREJIL' },
  { code: '850875', nombre: 'COGOLLO 3UD' },
  { code: '851645', nombre: 'LECHUGA ICEBERG' },
  { code: '850879', nombre: 'CEBOLLETA' },
  { code: '851230', nombre: 'REPOLLO LISO' },
  { code: '623294', nombre: 'PATATA 4+1' },
  { code: '851657', nombre: 'BROCOLI' },
  { code: '850881', nombre: 'ZANAHORIA 500G' },
  { code: '619699', nombre: 'JUDIA VERDE' },
  { code: '850959', nombre: 'PREPARADO COCIDO' },
  { code: '851229', nombre: 'APIO' },
  { code: '850867', nombre: 'TOMATE CHERRY' },
  { code: '608163', nombre: 'JENGIBRE' },
  { code: '851239', nombre: 'MAIZ MAZORCA' },
  { code: '851238', nombre: 'REMOLACHA COCIDA' },
  { code: '852419', nombre: 'TOMATE RALLADO' },
  { code: '851711', nombre: 'CLEMENTINA GRANEL' },
  { code: '851664', nombre: 'CLEMENTINA FONTESTAD' },
  { code: '852118', nombre: 'ARANDANO 125G' },
  { code: '850966', nombre: 'BERENJENA' },
  { code: '851067', nombre: 'MELOCOTON AMARILLO' },
  { code: '852318', nombre: 'MELON PIEL DE SAPO' },
  { code: '851896', nombre: 'ALBARICOQUE' },
  { code: '851247', nombre: 'PATATA 5KG' },
  { code: '852539', nombre: 'PLATANO CANARIO VERDE' }
];

const DEFAULTS = {
  carne: { label: 'CARNE', items: CARNE_DEFAULT },
  fruta: { label: 'FRUTA Y VERDURA', items: FRUTA_DEFAULT, pageSize: 10 }
};

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
      if (items.length) {
        const pageSize = Number(parsed?.pageSize || base?.pageSize) || 0;
        return { label: parsed?.label || base?.label || key.toUpperCase(), items, pageSize, source: 'archivo' };
      }
    }
  } catch { /* archivo roto → usar la lista por defecto */ }
  if (!base) return null;
  return { label: base.label, items: base.items, pageSize: Number(base.pageSize) || 0, source: 'defecto' };
}

export function cycleCount(current) {
  const value = Number(current) || 0;
  return value >= MAX_COUNT ? 0 : value + 1;
}

// Teclado del recuento: una fila por producto (tocar = +1) con la cantidad
// visible en el propio botón, y una fila de control al final.
export function buildTallyKeyboard(id, template, counts, requestedPage = 0) {
  const pageSize = Number(template?.pageSize) || template.items.length || 1;
  const pageCount = Math.max(1, Math.ceil(template.items.length / pageSize));
  const page = Math.max(0, Math.min(Number(requestedPage) || 0, pageCount - 1));
  const start = page * pageSize;
  const rows = template.items.slice(start, start + pageSize).map((item, offset) => {
    const index = start + offset;
    const count = Number(counts?.[index]) || 0;
    const mark = count > 0 ? ` ✅ ${count}` : '';
    return [{ text: `${item.nombre}${mark}`, callback_data: `tc:${id}:${index}` }];
  });
  if (pageCount > 1) rows.push([
    { text: page > 0 ? '‹ 上一页' : '·', callback_data: page > 0 ? `tcp:${id}:${page - 1}` : `tcnoop:${id}` },
    { text: `${page + 1}/${pageCount}`, callback_data: `tcnoop:${id}` },
    { text: page < pageCount - 1 ? '下一页 ›' : '·', callback_data: page < pageCount - 1 ? `tcp:${id}:${page + 1}` : `tcnoop:${id}` }
  ]);
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
