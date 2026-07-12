const MAX_RECENT_ORDERS = 5;

const COUNT_WORDS = new Map([
  ['一', 1], ['二', 2], ['两', 2], ['三', 3], ['四', 4], ['五', 5],
  ['六', 6], ['七', 7], ['八', 8], ['九', 9], ['十', 10],
  ['uno', 1], ['un', 1], ['dos', 2], ['tres', 3], ['cuatro', 4], ['cinco', 5]
]);

export function parseRecentOrdersRequest(input) {
  const text = String(input || '').trim();
  if (!text) return null;
  const command = text.match(/^\/(?:pedidos|pedidos_recientes|ultimos_pedidos)(?:@\w+)?(?:\s+(.+))?$/i);
  const mentionsOrder = /\bpedidos?\b|订单|单子|叫货单/i.test(text);
  const mentionsRecent = /最新|最近|近几|前\s*[一二两三四五六七八九十\d]|[uú]ltim|recientes?/i.test(text);
  if (!command && !(mentionsOrder && mentionsRecent)) return null;

  const countSource = command?.[1] || text;
  let requested = numberNearRecent(countSource);
  if (!requested) requested = /\bpedido\b/i.test(text) && !/\bpedidos\b/i.test(text) ? 1 : 3;
  requested = Math.max(1, Math.trunc(requested));
  return {
    requested,
    limit: Math.min(requested, MAX_RECENT_ORDERS),
    capped: requested > MAX_RECENT_ORDERS
  };
}

function numberNearRecent(text) {
  const source = String(text || '').toLowerCase();
  const arabic = source.match(/(?:最新|最近|近几|前|[uú]ltim(?:o|a|os|as)?|recientes?)\D{0,10}(\d{1,2})/i)
    || source.match(/^\s*(\d{1,2})\s*$/);
  if (arabic) return Number(arabic[1]);

  const word = source.match(/(?:最新|最近|近几|前|[uú]ltim(?:o|a|os|as)?|recientes?)\s*(?:的\s*)?([一二两三四五六七八九十]|uno|un|dos|tres|cuatro|cinco)/i)
    || source.match(/^\s*([一二两三四五六七八九十]|uno|un|dos|tres|cuatro|cinco)\s*$/i);
  return word ? COUNT_WORDS.get(word[1].toLowerCase()) || 0 : 0;
}

export function selectLatestOrderRows(rows, limit = 3) {
  const safeLimit = Math.max(1, Math.min(MAX_RECENT_ORDERS, Math.trunc(Number(limit) || 3)));
  return (Array.isArray(rows) ? rows : [])
    .map((row, position) => ({ ...row, __position: position }))
    .filter((row) => row.nombre)
    .sort((a, b) => {
      const byDate = String(b.fechaIso || '').localeCompare(String(a.fechaIso || ''));
      if (byDate) return byDate;
      const aId = numericId(a.id);
      const bId = numericId(b.id);
      if (aId !== bId) return bId - aId;
      return a.__position - b.__position;
    })
    .slice(0, safeLimit)
    .map(({ __position, ...row }) => row);
}

function numericId(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits ? Number(digits) : 0;
}

export function formatRecentOrdersSummary(orders, request = {}) {
  const list = Array.isArray(orders) ? orders : [];
  const requested = Number(request.requested || request.limit || list.length || 3);
  const lines = [`最近 ${list.length}/${requested} 张 Pedidos（只读检查）：`];
  const alerts = [];

  list.forEach((order, index) => {
    const items = Array.isArray(order.items) ? order.items : [];
    const quantities = items.map((item) => parseSpanishNumber(item.quantity)).filter(Number.isFinite);
    const boxes = quantities.length ? quantities.reduce((sum, value) => sum + value, 0) : NaN;
    const amount = firstFinite(
      parseSpanishNumber(order.importeTotal),
      sumWhenComplete(items.map((item) => parseSpanishNumber(item.total)))
    );
    const metrics = [`${items.length} 行`];
    if (Number.isFinite(boxes)) metrics.push(`${formatNumber(boxes)} 箱`);
    if (String(order.pesoTotal || '').trim()) metrics.push(`${cleanMetric(order.pesoTotal)} kg`);
    if (Number.isFinite(amount)) metrics.push(`${formatNumber(amount, 3)} EUR`);

    lines.push(`${index + 1}. ${order.orderName || order.nombre || '未命名订单'}`);
    lines.push(`   ${formatDate(order.orderDate || order.fechaIso)} · ${order.estado || '状态未知'} · ${metrics.join(' · ')}`);

    if (order.detailError) alerts.push(`「${order.orderName || order.nombre}」明细没读全：${order.detailError}`);
    else if (!items.length) alerts.push(`「${order.orderName || order.nombre}」是空单或明细没有加载出来`);

    const blankQty = items.filter((item) => String(item.quantity ?? '').trim() === '').length;
    const zeroQty = quantities.filter((value) => value <= 0).length;
    if (blankQty) alerts.push(`「${order.orderName || order.nombre}」有 ${blankQty} 行没填箱数`);
    if (zeroQty) alerts.push(`「${order.orderName || order.nombre}」有 ${zeroQty} 行数量为 0`);

    const duplicates = duplicateCodes(items);
    if (duplicates.length) alerts.push(`「${order.orderName || order.nombre}」有重复代码：${duplicates.join('、')}`);
    if (/^alta$/i.test(String(order.estado || '').trim())) alerts.push(`「${order.orderName || order.nombre}」仍是 Alta，通常还没发送`);
    if (/incid|anulad|eliminad/i.test(String(order.estado || ''))) alerts.push(`「${order.orderName || order.nombre}」状态是 ${order.estado}`);
  });

  lines.push('', '检查结果：');
  if (request.capped) lines.push(`· 一次最多精读 ${MAX_RECENT_ORDERS} 张，本次已按最新 ${MAX_RECENT_ORDERS} 张检查。`);
  if (alerts.length) alerts.forEach((alert) => lines.push(`⚠️ ${alert}`));
  else lines.push('✅ 没发现空单、0 数量、重复代码或异常状态。');
  lines.push('说明：这里检查的是订单页面数据，还没有结合实时库存和销量。');
  return lines.join('\n');
}

function duplicateCodes(items) {
  const counts = new Map();
  for (const item of items) {
    const code = String(item.code || '').trim();
    if (code) counts.set(code, (counts.get(code) || 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([code]) => code);
}

function cleanMetric(value) {
  return String(value ?? '').replace(/[€\s]/g, '').replace(/\s+/g, '');
}

function parseSpanishNumber(value) {
  const source = cleanMetric(value);
  if (!source) return NaN;
  const normalized = source.includes(',') ? source.replace(/\./g, '').replace(',', '.') : source;
  const parsed = Number.parseFloat(normalized.replace(/[^\d.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : NaN;
}

function sumWhenComplete(values) {
  if (!values.length || values.some((value) => !Number.isFinite(value))) return NaN;
  return values.reduce((sum, value) => sum + value, 0);
}

function firstFinite(...values) {
  return values.find(Number.isFinite) ?? NaN;
}

function formatNumber(value, maximumFractionDigits = 2) {
  return new Intl.NumberFormat('es-ES', { maximumFractionDigits }).format(value);
}

function formatDate(value) {
  const source = String(value || '').trim();
  const iso = source.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return iso ? `${iso[3]}/${iso[2]}/${iso[1]}` : (source || '日期未知');
}
