// Tests del desglose de IVA y la numeración de facturas (services/invoicing.js).
// Regla de oro que se verifica en casi todos los casos: la suma de
// (base + cuota) de todas las líneas cuadra AL CÉNTIMO con el total cobrado.
import { describe, it, expect } from 'vitest';
import {
  computeTaxBreakdown,
  formatInvoiceNumber,
  buildVerifactuPayload,
  IVA_RATES,
  DEFAULT_SHIPPING_TAX_RATE,
} from '../invoicing.js';

const item = (price, quantity, tax_rate, extra = {}) => ({ price, quantity, tax_rate, ...extra });

// Comprueba la reconciliación base+cuota == total por línea y en totales.
function expectReconciled(result) {
  for (const line of result.breakdown) {
    expect(line.base + line.cuota).toBeCloseTo(line.total, 2);
  }
  const sumTotals = result.breakdown.reduce((a, l) => a + l.total, 0) + result.unclassifiedTotal;
  expect(sumTotals).toBeCloseTo(result.totals.total, 2);
}

describe('computeTaxBreakdown', () => {
  it('desglosa un pedido de un solo tipo (21 %)', () => {
    const r = computeTaxBreakdown({ items: [item(12.1, 1, 21)] });
    expect(r.breakdown).toHaveLength(1);
    expect(r.breakdown[0]).toEqual({ rate: 21, base: 10, cuota: 2.1, total: 12.1 });
    expect(r.totals).toEqual({ base: 10, cuota: 2.1, total: 12.1 });
    expect(r.hasUnclassified).toBe(false);
    expectReconciled(r);
  });

  it('agrupa varios items del mismo tipo y multiplica por cantidad', () => {
    const r = computeTaxBreakdown({ items: [item(1.04, 3, 4), item(2.08, 1, 4)] });
    expect(r.breakdown).toHaveLength(1);
    expect(r.breakdown[0].rate).toBe(4);
    expect(r.breakdown[0].total).toBeCloseTo(5.2, 2);
    expect(r.breakdown[0].base).toBeCloseTo(5.0, 2);
    expectReconciled(r);
  });

  it('separa por tipo con la cesta mixta típica (4/10/21)', () => {
    const r = computeTaxBreakdown({
      items: [item(1.04, 1, 4), item(2.2, 1, 10), item(12.1, 1, 21)],
    });
    expect(r.breakdown.map((l) => l.rate)).toEqual([4, 10, 21]);
    expect(r.totals.total).toBeCloseTo(15.34, 2);
    expectReconciled(r);
  });

  it('excluye regalos y líneas inválidas', () => {
    const r = computeTaxBreakdown({
      items: [
        item(12.1, 1, 21),
        item(5, 1, 21, { isGift: true }),
        item(0, 2, 21),
        item(3, 0, 21),
        item('abc', 1, 21),
      ],
    });
    expect(r.totals.total).toBeCloseTo(12.1, 2);
  });

  it('acumula en "sin clasificar" los items sin tax_rate válido', () => {
    const r = computeTaxBreakdown({ items: [item(10, 1, null), item(12.1, 1, 21)] });
    expect(r.hasUnclassified).toBe(true);
    expect(r.unclassifiedTotal).toBeCloseTo(10, 2);
    // El importe sin clasificar suma al total pero no reparte base/cuota.
    expect(r.totals.total).toBeCloseTo(22.1, 2);
    expect(r.totals.base + r.totals.cuota).toBeCloseTo(12.1, 2);
  });

  it('añade el envío al tipo por defecto (21 %)', () => {
    expect(DEFAULT_SHIPPING_TAX_RATE).toBe(21);
    const r = computeTaxBreakdown({ items: [item(2.2, 1, 10)], shipping: 4.84 });
    const line21 = r.breakdown.find((l) => l.rate === 21);
    expect(line21.total).toBeCloseTo(4.84, 2);
    expect(line21.base).toBeCloseTo(4, 2);
    expect(r.totals.total).toBeCloseTo(7.04, 2);
    expectReconciled(r);
  });

  it('el envío con un tipo no válido cae en "sin clasificar"', () => {
    const r = computeTaxBreakdown({ items: [item(2.2, 1, 10)], shipping: 3 }, { shippingTaxRate: 7 });
    expect(r.hasUnclassified).toBe(true);
    expect(r.unclassifiedTotal).toBeCloseTo(3, 2);
  });

  it('prorratea el descuento entre tipos y cuadra al céntimo', () => {
    // 10 € al 4 % + 20 € al 21 %, cupón de 3 €. Neto = 27 €.
    const r = computeTaxBreakdown({
      items: [item(10, 1, 4), item(20, 1, 21)],
      discount: 3,
    });
    expect(r.totals.total).toBeCloseTo(27, 2);
    // Reparto proporcional: 10*27/30 = 9 y 20*27/30 = 18.
    expect(r.breakdown.find((l) => l.rate === 4).total).toBeCloseTo(9, 2);
    expect(r.breakdown.find((l) => l.rate === 21).total).toBeCloseTo(18, 2);
    expectReconciled(r);
  });

  it('descuento con céntimos: el remanente de redondeo no rompe el cuadre', () => {
    const r = computeTaxBreakdown({
      items: [item(3.33, 1, 4), item(3.33, 1, 10), item(3.33, 1, 21)],
      discount: 1.01,
    });
    expect(r.totals.total).toBeCloseTo(9.99 - 1.01, 2);
    expectReconciled(r);
  });

  it('un descuento mayor que el subtotal se recorta (total nunca negativo)', () => {
    const r = computeTaxBreakdown({ items: [item(5, 1, 21)], discount: 50 });
    expect(r.totals.total).toBeCloseTo(0, 2);
  });

  it('pedido vacío devuelve todo a cero', () => {
    const r = computeTaxBreakdown({ items: [] });
    expect(r.breakdown).toEqual([]);
    expect(r.totals).toEqual({ base: 0, cuota: 0, total: 0 });
    expect(r.hasUnclassified).toBe(false);
  });

  it('solo admite los tipos españoles 4/10/21', () => {
    expect(IVA_RATES).toEqual([4, 10, 21]);
  });
});

describe('formatInvoiceNumber', () => {
  it('formatea serie-año-número con 6 dígitos', () => {
    expect(formatInvoiceNumber('A', 2026, 123)).toBe('A-2026-000123');
    expect(formatInvoiceNumber('WEB', 2026, 1)).toBe('WEB-2026-000001');
  });

  it('no recorta números de más de 6 dígitos', () => {
    expect(formatInvoiceNumber('A', 2026, 1234567)).toBe('A-2026-1234567');
  });
});

describe('buildVerifactuPayload', () => {
  const baseOrder = {
    items: [item(12.1, 1, 21)],
    invoice_number: 7,
    invoice_series: 'A',
    invoice_issued_at: '2026-03-01T10:00:00Z',
  };

  it('ticket sin NIF → factura simplificada F2 sin destinatario', () => {
    const { payload, missing } = buildVerifactuPayload(baseOrder);
    expect(payload.invoice.type).toBe('F2');
    expect(payload.recipient).toBeNull();
    expect(payload.invoice.fullNumber).toBe('A-2026-000007');
    expect(missing).toEqual([]);
  });

  it('con billing_nif → factura completa F1 y exige datos del destinatario', () => {
    const { payload, missing } = buildVerifactuPayload({
      ...baseOrder,
      billing_nif: 'B86126638',
      billing_name: 'ACME SL',
    });
    expect(payload.invoice.type).toBe('F1');
    expect(payload.recipient.nif).toBe('B86126638');
    expect(missing).toEqual([]);
  });

  it('detecta datos que faltan: número, tax_rate y datos fiscales', () => {
    const { missing } = buildVerifactuPayload({
      items: [item(10, 1, null)],
      billing_nif: 'B86126638',
      // sin billing_name, sin invoice_number
    });
    expect(missing).toContain('invoice.number');
    expect(missing).toContain('billing_name');
    expect(missing.some((m) => m.includes('tax_rate'))).toBe(true);
  });
});
