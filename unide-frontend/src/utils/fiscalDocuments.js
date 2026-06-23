export function hasFiscalInvoice(order) {
  return Boolean(order?.invoice_full_number && order?.invoice_issued_at);
}

export function fiscalDocumentTitle(order, fallback = 'JUSTIFICANTE DE PEDIDO') {
  return hasFiscalInvoice(order) ? 'FACTURA SIMPLIFICADA' : fallback;
}

export function normalizeTaxBreakdown(order) {
  const raw = order?.tax_breakdown?.rates || order?.tax_breakdown?.breakdown || order?.taxBreakdown?.rates;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r) => ({
      rate: Number(r.rate),
      base: Number(r.base) || 0,
      cuota: Number(r.cuota ?? r.tax ?? r.amount) || 0,
      total: Number(r.total) || 0,
    }))
    .filter((r) => [4, 10, 21].includes(r.rate) && r.total > 0)
    .sort((a, b) => a.rate - b.rate);
}

export function itemTaxRate(item) {
  const n = Number(item?.tax_rate ?? item?.taxRate);
  if ([4, 10, 21].includes(n)) return n;
  return item?.isService ? 21 : null;
}

export function formatEuro(value) {
  return `€${(Number(value) || 0).toFixed(2)}`;
}

export function formatFiscalDate(value) {
  if (!value) return '';
  try {
    return new Date(value).toLocaleString('es-ES', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(value);
  }
}

export function fiscalFooterText(order) {
  if (!hasFiscalInvoice(order)) {
    return [
      'Documento no válido como factura fiscal.',
      'Si necesita factura oficial, solicítela con sus datos fiscales.',
    ];
  }
  return [
    'Factura simplificada. Precios con IVA incluido.',
    order?.verifactu_qr ? 'Factura verificable en la sede electrónica de la AEAT.' : 'Emitida por sistema interno de facturación HIPERA.',
  ];
}
