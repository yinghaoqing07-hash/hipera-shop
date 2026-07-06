const CATALOGS = {
  meat: {
    title: '肉类叫货单',
    orderPrefix: 'CARNE',
    pageSize: 7,
    items: [
      { code: '617519', name: 'HAMB. ANGUS' },
      { code: '618496', name: 'HAMB NEWYORK' },
      { code: '616646', name: 'CARNE PIC ANOJO' },
      { code: '616647', name: 'CARNE PIC MIXTA' },
      { code: '615958', name: 'FILETE PANCETA' },
      { code: '615960', name: 'CHULETA AGUJA' },
      { code: '609951', name: 'ESCALOPIN ADOB' },
      { code: '609950', name: 'ESCALOPIN TIERNO' },
      { code: '623040', name: 'SOLOMILLO LIMON' },
      { code: '623041', name: 'SOLOMILLO CHILI' },
      { code: '620000', name: 'FILETE FINO' },
      { code: '619866', name: 'POLLO ENTERO' },
      { code: '620002', name: 'JAMONCITOS' },
      { code: '620003', name: 'PECHUGA LIMPIA' },
      { code: '620004', name: 'CONTRAMUSLO' },
      { code: '620005', name: 'ALAS PARTIDAS' },
      { code: '620006', name: 'SOLOMILLO' },
      { code: '620007', name: 'CUARTO TRASERO' },
      { code: '620008', name: 'FILETE CONTRAMUSLO' },
      { code: '614883', name: 'BURGUER CRISPY' },
      { code: '898072', name: 'LOMO CAY ADOBADO' },
      { code: '898073', name: 'LOMO CAY AJILLO' },
      { code: '620254', name: '1/2 GALLINA' },
      { code: '616091', name: 'ESPINAZO' },
      { code: '609745', name: 'LONGANIZA' },
      { code: '983671', name: 'PINCHAZ ANDALUZ' },
      { code: '831212', name: 'PINCHAZ ROJO' },
      { code: '620259', name: 'ALAS ADOBADAS' }
    ]
  }
};

export function isOrderPickerCommand(text) {
  const value = String(text || '').trim().toLowerCase();
  return value === '/pedido_carne'
    || value === '/carne'
    || value === '肉类叫货单'
    || value === '肉类点选';
}

export function createOrderPicker(type = 'meat', now = new Date(), config = {}) {
  const catalog = CATALOGS[type] || CATALOGS.meat;
  const ddmm = formatDdMm(now, config.ordering?.timezone || 'Europe/Madrid');
  return {
    type,
    title: catalog.title,
    orderName: `${catalog.orderPrefix} ${ddmm}`,
    page: 0,
    pageSize: catalog.pageSize,
    items: catalog.items.map((item) => ({ ...item, quantity: 0 }))
  };
}

export function applyOrderPickerAction(picker, action, rawIndex) {
  if (!picker) return picker;
  const output = {
    ...picker,
    items: picker.items.map((item) => ({ ...item }))
  };
  const pageCount = getPageCount(output);
  if (action === 'next') output.page = Math.min(pageCount - 1, Number(output.page || 0) + 1);
  if (action === 'prev') output.page = Math.max(0, Number(output.page || 0) - 1);
  if (action === 'clear') output.items.forEach((item) => { item.quantity = 0; });

  const index = Number(rawIndex);
  if (Number.isInteger(index) && output.items[index]) {
    if (action === 'add') output.items[index].quantity = Math.min(99, Number(output.items[index].quantity || 0) + 1);
    if (action === 'sub') output.items[index].quantity = Math.max(0, Number(output.items[index].quantity || 0) - 1);
  }
  return output;
}

export function formatOrderPicker(picker) {
  const selected = picker.items.filter((item) => Number(item.quantity) > 0);
  const totalQty = selected.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const page = Number(picker.page || 0);
  const pageCount = getPageCount(picker);
  const visible = getVisibleItems(picker);
  return [
    `${picker.title}`,
    `订单名：${picker.orderName}`,
    `已选：${selected.length} 个商品 / ${totalQty} 件`,
    `第 ${page + 1}/${pageCount} 页`,
    '',
    ...visible.map(({ item }, offset) => `${offset + 1}. ${item.code}  ${item.name}  x${item.quantity || 0}`),
    '',
    '按钮按上面的编号加减；点左边编号也会 +1。最后点“生成订单”。'
  ].join('\n');
}

export function makeOrderPickerButtons(id, picker) {
  const rows = getVisibleItems(picker).map(({ item, index }, offset) => [
    { text: `${offset + 1}. ${item.code}  x${item.quantity || 0}`, callback_data: `pick:${id}:add:${index}` },
    { text: '-', callback_data: `pick:${id}:sub:${index}` },
    { text: '+', callback_data: `pick:${id}:add:${index}` }
  ]);

  const nav = [];
  if (Number(picker.page || 0) > 0) nav.push({ text: '上一页', callback_data: `pick:${id}:prev` });
  if (Number(picker.page || 0) < getPageCount(picker) - 1) nav.push({ text: '下一页', callback_data: `pick:${id}:next` });
  if (nav.length) rows.push(nav);

  rows.push([
    { text: '生成订单', callback_data: `pick:${id}:build` },
    { text: '清空', callback_data: `pick:${id}:clear` },
    { text: '取消', callback_data: `pick:${id}:cancel` }
  ]);

  return { reply_markup: { inline_keyboard: rows } };
}

export function orderPickerToDraft(picker) {
  return {
    raw: '',
    orderName: picker.orderName,
    items: picker.items
      .filter((item) => Number(item.quantity) > 0)
      .map((item) => ({
        code: item.code,
        quantity: String(item.quantity),
        raw: `${item.code} ${item.quantity}`
      }))
  };
}

function getVisibleItems(picker) {
  const pageSize = Number(picker.pageSize || 7);
  const start = Number(picker.page || 0) * pageSize;
  return picker.items.slice(start, start + pageSize).map((item, offset) => ({
    item,
    index: start + offset
  }));
}

function getPageCount(picker) {
  return Math.max(1, Math.ceil(picker.items.length / Number(picker.pageSize || 7)));
}

function formatDdMm(date, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: '2-digit',
    month: '2-digit'
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.day}${parts.month}`;
}
