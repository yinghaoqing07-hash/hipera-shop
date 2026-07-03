// Tests de la detección de categorías alcohólicas (services/alcohol.js).
// La parte con BD (orderContainsAlcohol) se prueba indirectamente; aquí
// se cubre el clasificador de nombres, que es donde viven los matices
// (acentos, falsos positivos tipo "vinagre"/"macarrones").
import { describe, it, expect } from 'vitest';
import { isAlcoholCategoryName } from '../alcohol.js';

describe('isAlcoholCategoryName', () => {
  it('detecta las categorías alcohólicas habituales', () => {
    for (const name of [
      'Alcohol',
      'Bebidas alcohólicas',
      'Cervezas',
      'Cerveza artesana',
      'Vinos',
      'Vino tinto',
      'Licores',
      'Whisky y destilados',
      'Vodka',
      'Ginebra',
      'Cava y champán',
      'Sangría',
      'Vermut',
      'Ron añejo',
      // Subcategorías reales de hipera.es (2026-07-03)
      'Bebidas alcohólicas',
      'Bebidas espirituosas',
      'Sidra',
      'Anís',
      'Licores',
    ]) {
      expect(isAlcoholCategoryName(name), name).toBe(true);
    }
  });

  it('no marca categorías inocentes (falsos positivos)', () => {
    for (const name of [
      'Vinagres y aliños',   // "vinagre" no contiene "vino"
      'Macarrones y pasta',  // contiene "ron" pero no como palabra
      'Refrescos',
      'Zumos',
      'Agua',
      'Panadería',
      'Limpieza del hogar',
      'Turrones',            // ídem "ron" interno
      '',
    ]) {
      expect(isAlcoholCategoryName(name), name).toBe(false);
    }
  });

  it('ignora mayúsculas y acentos', () => {
    expect(isAlcoholCategoryName('BEBIDAS ALCOHÓLICAS')).toBe(true);
    expect(isAlcoholCategoryName('CERVEZAS')).toBe(true);
    expect(isAlcoholCategoryName(null)).toBe(false);
    expect(isAlcoholCategoryName(undefined)).toBe(false);
  });
});
