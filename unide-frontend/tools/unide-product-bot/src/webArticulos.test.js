import test from 'node:test';
import assert from 'node:assert/strict';
import { numeroWeb, resumenArticuloWeb } from './webArticulos.js';

test('numeroWeb entiende el formato español de la web (coma decimal, €)', () => {
  assert.equal(numeroWeb('6,119 €'), 6.119);
  assert.equal(numeroWeb('9,250'), 9.25);
  assert.equal(numeroWeb('0,000'), 0);
  assert.equal(numeroWeb('1.234,50'), 1234.5); // punto de miles
  assert.ok(Number.isNaN(numeroWeb('')));
  assert.ok(Number.isNaN(numeroWeb(null)));
});

test('resumenArticuloWeb: la ficha real del gato Purina (captura 02/08)', () => {
  const datos = {
    codigoCentral: '91236560', codigoUnide: '123656',
    descripcion: 'COMIDA GATO HUMEDO  PURINA FONDANT 12X85G',
    pvp1: '8,790', pvp2: '9,250', pvp3: '0,000',
    pvdPromocion: '0,000', pvd: '6,119 €', ultimoCoste: '1,20 €',
    impuesto: '', eanPrincipal: '7613036412018', eans: '7613036412018'
  };
  const r = resumenArticuloWeb(datos, { ean: '7613036412018' });
  assert.equal(r.ok, true);
  assert.equal(r.codigo, '123656');
  assert.equal(r.pvd, 6.119);
  assert.equal(r.pvdOrigen, 'PVD');
  assert.equal(r.pvp2, 9.25);
  assert.equal(r.impuesto, null); // vacío en la ficha → lo pondrá el caché/默认
  // con promoción > 0 gana la promoción (misma regla que la tabla)
  const r2 = resumenArticuloWeb({ ...datos, pvdPromocion: '5,90' }, { ean: '7613036412018' });
  assert.equal(r2.pvd, 5.9);
  assert.equal(r2.pvdOrigen, 'PVD Promoción');
});

test('resumenArticuloWeb: verificación de identidad y datos incompletos', () => {
  const base = { codigoUnide: '123656', pvp2: '9,250', pvd: '6,119', eanPrincipal: '7613036412018' };
  // EAN que no casa → se niega (no vaya a copiar los datos de OTRO artículo)
  assert.equal(resumenArticuloWeb(base, { ean: '8480012040454' }).ok, false);
  // por código también vale
  assert.equal(resumenArticuloWeb(base, { codigo: '123656' }).ok, true);
  // sin PVD o sin PVP2 no hay con qué
  assert.equal(resumenArticuloWeb({ ...base, pvd: '0,000', pvdPromocion: '' }, { codigo: '123656' }).ok, false);
  assert.equal(resumenArticuloWeb({ ...base, pvp2: '' }, { codigo: '123656' }).ok, false);
});
