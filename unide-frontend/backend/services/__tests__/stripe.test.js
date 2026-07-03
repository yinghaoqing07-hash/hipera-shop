// Tests de la construcción de line_items de Stripe Checkout
// (services/stripe.js). Invariante crítico: la suma de los line_items
// debe coincidir EXACTAMENTE con el total del pedido, céntimo a céntimo.
import { describe, it, expect } from 'vitest';
import { buildCheckoutLineItems, resolveStripePaymentLabel } from '../stripe.js';

const sumCents = (lineItems) =>
  lineItems.reduce((a, li) => a + li.price_data.unit_amount * li.quantity, 0);

describe('buildCheckoutLineItems', () => {
  it('una línea por producto y el cargo cuadra con el total', () => {
    const items = [
      { name: 'Leche', price: 1.15, quantity: 2 },
      { name: 'Pan', price: 0.95, quantity: 1 },
    ];
    const { line_items, fallback } = buildCheckoutLineItems(items, 3.25);
    expect(fallback).toBe(false);
    expect(line_items).toHaveLength(2);
    expect(sumCents(line_items)).toBe(325);
  });

  it('el residuo positivo se añade como "Gastos de envío"', () => {
    const items = [{ name: 'Aceite', price: 10, quantity: 1 }];
    const { line_items, fallback } = buildCheckoutLineItems(items, 14.5);
    expect(fallback).toBe(false);
    const shipping = line_items[line_items.length - 1];
    expect(shipping.price_data.product_data.name).toBe('Gastos de envío');
    expect(shipping.price_data.unit_amount).toBe(450);
    expect(sumCents(line_items)).toBe(1450);
  });

  it('sin residuo no se añade línea de envío', () => {
    const items = [{ name: 'Aceite', price: 10, quantity: 1 }];
    const { line_items } = buildCheckoutLineItems(items, 10);
    expect(line_items).toHaveLength(1);
    expect(sumCents(line_items)).toBe(1000);
  });

  it('excluye regalos y líneas de importe 0', () => {
    const items = [
      { name: 'Compra', price: 20, quantity: 1 },
      { name: 'Regalo', price: 5, quantity: 1, isGift: true },
      { name: 'Muestra', price: 0, quantity: 3 },
    ];
    const { line_items } = buildCheckoutLineItems(items, 20);
    expect(line_items).toHaveLength(1);
    expect(sumCents(line_items)).toBe(2000);
  });

  it('residuo negativo (descuento a nivel pedido) → una sola línea con el total exacto', () => {
    const items = [{ name: 'Compra', price: 30, quantity: 1 }];
    const { line_items, fallback } = buildCheckoutLineItems(items, 27); // cupón -3 €
    expect(fallback).toBe(true);
    expect(line_items).toHaveLength(1);
    expect(line_items[0].price_data.product_data.name).toBe('Pedido HIPERA');
    expect(sumCents(line_items)).toBe(2700);
  });

  it('sin items facturables → línea única con el total', () => {
    const { line_items, fallback } = buildCheckoutLineItems([], 12.34);
    expect(fallback).toBe(true);
    expect(sumCents(line_items)).toBe(1234);
  });

  it('los céntimos de precios "difíciles" (0.1+0.2) no descuadran el cargo', () => {
    const items = [
      { name: 'A', price: 0.1, quantity: 1 },
      { name: 'B', price: 0.2, quantity: 1 },
    ];
    const { line_items, fallback } = buildCheckoutLineItems(items, 0.3);
    expect(fallback).toBe(false);
    expect(sumCents(line_items)).toBe(30);
  });

  it('recorta nombres de producto a 250 caracteres (límite de Stripe)', () => {
    const items = [{ name: 'X'.repeat(400), price: 1, quantity: 1 }];
    const { line_items } = buildCheckoutLineItems(items, 1);
    expect(line_items[0].price_data.product_data.name).toHaveLength(250);
  });
});

describe('resolveStripePaymentLabel', () => {
  it('traduce los tipos conocidos', () => {
    expect(resolveStripePaymentLabel('card')).toBe('Tarjeta (Stripe)');
    expect(resolveStripePaymentLabel('bizum')).toBe('Bizum (Stripe)');
    expect(resolveStripePaymentLabel('apple_pay')).toBe('Apple Pay');
    expect(resolveStripePaymentLabel('google_pay')).toBe('Google Pay');
  });

  it('tipos desconocidos y vacíos tienen fallback seguro', () => {
    expect(resolveStripePaymentLabel('sepa_debit')).toBe('Stripe (sepa_debit)');
    expect(resolveStripePaymentLabel('')).toBe('Stripe');
    expect(resolveStripePaymentLabel(undefined)).toBe('Stripe');
  });
});
