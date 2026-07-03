// Tests de la lógica pura de cupones (services/coupons.js): el servidor
// recalcula SIEMPRE el descuento; nada de lo que mande el cliente se fía.
import { describe, it, expect } from 'vitest';
import {
  COUPONS,
  normalizeCouponCode,
  computeSubtotal,
  evaluateCoupon,
  couponErrorMessage,
} from '../coupons.js';

describe('normalizeCouponCode', () => {
  it('mayúsculas y sin espacios', () => {
    expect(normalizeCouponCode('  bienvenida10 ')).toBe('BIENVENIDA10');
    expect(normalizeCouponCode(null)).toBe('');
    expect(normalizeCouponCode(undefined)).toBe('');
  });
});

describe('computeSubtotal', () => {
  it('suma price*quantity y excluye regalos e inválidos', () => {
    expect(
      computeSubtotal([
        { price: 1.5, quantity: 2 },
        { price: 4, quantity: 1, isGift: true },
        { price: -3, quantity: 1 },
        { price: 2, quantity: 0 },
      ])
    ).toBe(3);
  });

  it('lista vacía o nula → 0', () => {
    expect(computeSubtotal([])).toBe(0);
    expect(computeSubtotal(null)).toBe(0);
  });
});

describe('evaluateCoupon', () => {
  // Fecha dentro de la campaña activa de los cupones del catálogo.
  const during = new Date('2026-07-01T12:00:00+02:00');
  const after = new Date('2026-09-15T12:00:00+02:00');

  it('código vacío → EMPTY', () => {
    expect(evaluateCoupon('', 100, during)).toEqual({ ok: false, reason: 'EMPTY' });
  });

  it('código inexistente → INVALID', () => {
    const r = evaluateCoupon('NOEXISTE', 100, during);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('INVALID');
  });

  it('BIENVENIDA10 aplica 10 % con mínimo cumplido', () => {
    const r = evaluateCoupon('bienvenida10', 50, during);
    expect(r.ok).toBe(true);
    expect(r.discount).toBe(5);
    expect(r.code).toBe('BIENVENIDA10');
  });

  it('subtotal por debajo del mínimo → MIN_NOT_MET con el umbral', () => {
    const r = evaluateCoupon('BIENVENIDA10', 29.99, during);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('MIN_NOT_MET');
    expect(r.minSubtotal).toBe(COUPONS.BIENVENIDA10.minSubtotal);
  });

  it('pasada la caducidad → EXPIRED', () => {
    const r = evaluateCoupon('BIENVENIDA10', 100, after);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('EXPIRED');
  });

  it('el descuento se redondea a céntimos', () => {
    // 10 % de 33.33 = 3.333 → 3.33
    const r = evaluateCoupon('BIENVENIDA10', 33.33, during);
    expect(r.discount).toBe(3.33);
  });

  it('el descuento nunca supera el subtotal', () => {
    const r = evaluateCoupon('BIENVENIDA5', 40, during);
    expect(r.ok).toBe(true);
    expect(r.discount).toBeLessThanOrEqual(40);
  });

  it('un cupón desactivado se rechaza como INVALID', () => {
    const backup = COUPONS.BIENVENIDA5.active;
    COUPONS.BIENVENIDA5.active = false;
    try {
      const r = evaluateCoupon('BIENVENIDA5', 100, during);
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('INVALID');
    } finally {
      COUPONS.BIENVENIDA5.active = backup;
    }
  });
});

describe('couponErrorMessage', () => {
  it('cada motivo tiene mensaje en español', () => {
    for (const reason of ['EXPIRED', 'MIN_NOT_MET', 'ALREADY_USED', 'LOGIN_REQUIRED', 'EMPTY', 'INVALID']) {
      expect(couponErrorMessage(reason)).toBeTruthy();
    }
  });

  it('MIN_NOT_MET incluye el importe mínimo', () => {
    expect(couponErrorMessage('MIN_NOT_MET', { minSubtotal: 30 })).toContain('30.00');
  });
});
