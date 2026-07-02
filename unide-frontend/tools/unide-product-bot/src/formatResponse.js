import { suggestedPrice } from './supplierLookup.js';

export function formatProductResponse({ item, supplier, store, desktop, index, total }) {
  const lines = [];
  const title = total > 1 ? `商品 ${index + 1}/${total}` : '商品查询';
  lines.push(title);
  lines.push(`查询：${item.codigo || item.ean || item.nombre}`);

  if (item.precio.mode === 'manual') {
    lines.push(`你写的价格：${formatMoney(item.precio.value)}`);
  } else if (item.precio.mode === 'auto') {
    lines.push('你写的价格：auto');
  } else {
    lines.push('你写的价格：未填写');
  }

  if (item.desbloquear) lines.push('要求：解除 bloqueo para la venta');
  if (item.etiqueta) lines.push('要求：需要 etiqueta');
  if (item.nota) lines.push(`备注：${item.nota}`);

  lines.push('');
  lines.push(formatDesktop(desktop));
  lines.push('');
  lines.push(formatStore(store));
  lines.push('');
  lines.push(formatSupplier(supplier, item));
  lines.push('');
  lines.push('安全状态：不会自动写入；必须先点确认处理，再点确认写入。');
  return lines.join('\n');
}

function formatDesktop(desktop) {
  if (!desktop || desktop.status === 'disabled') {
    return '桌面查询：未开启。';
  }
  if (desktop.status === 'ok') {
    const warning = desktop.warnings?.length ? `\n提醒：${desktop.warnings.join('；')}` : '';
    const screenshotText = desktop.screenshot ? '请看截图确认 Artículos 结果。' : '已执行，但没有返回截图路径。';
    return `桌面查询：已执行，${screenshotText}${warning}`;
  }
  if (desktop.status === 'error') {
    return `桌面查询：失败。\n${desktop.error || '未知错误'}`;
  }
  return `桌面查询：${desktop.status}`;
}

function formatStore(store) {
  if (!store || store.status === 'disabled') return '店内缓存：未配置。';
  if (store.status === 'found') {
    const product = store.product;
    return [
      `店内缓存：找到（${store.matchType}）`,
      `${product.codigo_unide} ${product.articulo_tienda}`,
      `EAN: ${product.ean || '-'}`,
      `店内PVP: ${formatMaybeMoney(product.pvp_tienda)}`
    ].join('\n');
  }
  return '店内缓存：没找到。';
}

function formatSupplier(supplier, item) {
  if (!supplier || supplier.status === 'disabled') return '供应商表：未配置。';
  if (supplier.status === 'found') {
    const product = supplier.product;
    const autoPrice = suggestedPrice(product);
    const priceLine = item.precio.mode === 'auto'
      ? `建议采用：${autoPrice ? formatMoney(autoPrice) : '没有可用建议价'}`
      : `建议价参考：PVP1 ${formatMaybeMoney(product.pvp1)} / PVP2 ${formatMaybeMoney(product.pvp2)}`;
    return [
      `供应商表：找到（${supplier.matchType}）`,
      `${product.codigo_unide} ${product.articulo}`,
      `EAN: ${product.ean || '-'}`,
      priceLine,
      `PVD: ${formatMaybeMoney(product.pvd)}`
    ].join('\n');
  }
  if (supplier.status === 'candidates') {
    return [
      '供应商表：找到多个可能商品：',
      ...supplier.candidates.map((row) => `- ${row.codigo_unide} ${row.articulo} PVP1 ${formatMaybeMoney(row.pvp1)}`)
    ].join('\n');
  }
  return '供应商表：没找到。';
}

function formatMoney(value) {
  return `${Number(value).toFixed(2).replace('.', ',')} EUR`;
}

function formatMaybeMoney(value) {
  const number = Number.parseFloat(String(value || '').replace(',', '.'));
  if (!Number.isFinite(number)) return '-';
  return formatMoney(number);
}
