import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildProductDiagnosis,
  parseProductExport
} from './productDiagnostics.js';

test('CSV import finds the header, deduplicates EANs and keeps code-only rows', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unide-diagnostics-'));
  const file = path.join(dir, 'pedido.csv');
  fs.writeFileSync(file, [
    'Exportacion de pedido;;',
    'Codigo Unide;EAN;Articulo',
    '620475;8425779045021;ENSALADA CESAR',
    '620475;8425779045021;ENSALADA CESAR REPETIDA',
    '620006;;SOLOMILLO'
  ].join('\n'), 'utf8');

  const parsed = await parseProductExport(file, 'pedido.csv');
  assert.equal(parsed.meta.sourceRows, 3);
  assert.equal(parsed.meta.uniqueItems, 2);
  assert.equal(parsed.meta.duplicates, 1);
  assert.deepEqual(parsed.items[0].duplicateRows, [4]);
  assert.equal(parsed.items[1].codigo, '620006');
});

test('unsafe legacy and PDF exports are rejected', async () => {
  await assert.rejects(() => parseProductExport('pedido.xls', 'pedido.xls'), /\.xls/);
  await assert.rejects(() => parseProductExport('pedido.pdf', 'pedido.pdf'), /PDF/);
});

test('SDC diagnosis rounds supplier PVD and uses the second recommendation', () => {
  const result = buildProductDiagnosis({
    input: { codigo: '121658', ean: '8445291901247', sourceRow: 2 },
    desktop: { status: 'ok', values: { bancoDatos: 'SDC', codigoPantalla: '121658' } },
    supplier: { product: { pvd: '1,187', pvp1: '2,49', pvp2: '2,69' } }
  });

  assert.equal(result.outcome, 'repair');
  assert.equal(result.recommendation.pvd, 1.19);
  assert.equal(result.recommendation.pvp2, 2.69);
  assert.ok(result.plan.some((line) => line.includes('1,19')));
  assert.ok(result.plan.some((line) => line.includes('2,69')));
});

test('healthy existing TIENDA price is preserved even when supplier PVP2 differs', () => {
  const result = buildProductDiagnosis({
    input: { codigo: '620475', sourceRow: 2 },
    desktop: {
      status: 'ok',
      values: {
        bancoDatos: 'TIENDA', codigoPantalla: '620475', pcMedio: '2,00', pcUltimo: '2,00',
        pDefectoPrice: '2,50', pDefectoPct: '20', pTpvPrice: '2,50',
        supplierCode: '12074', supplierName: 'UNIDE SDAD.COOP', inventariable: 'No',
        bloqVentaChecked: false
      }
    },
    supplier: { product: { pvd: '2,00', pvp2: '3,99' } }
  });

  assert.equal(result.outcome, 'ok');
  assert.deepEqual(result.issues, []);
  assert.ok(!result.plan.some((line) => line.includes('3,99')));
  assert.ok(!result.plan.some((line) => line.includes('Inventariable = Si')));
});

test('non-positive P.defecto margin is reported for an existing price', () => {
  const result = buildProductDiagnosis({
    input: { codigo: '620475', sourceRow: 2 },
    desktop: {
      status: 'ok',
      values: {
        bancoDatos: 'TIENDA', codigoPantalla: '620475', pcMedio: '2,00', pcUltimo: '2,00',
        pDefectoPrice: '2,50', pDefectoPct: '-1', pTpvPrice: '2,50',
        supplierCode: '12074', inventariable: 'Si', bloqVentaChecked: false
      }
    },
    supplier: { product: { pvd: '2,00', pvp2: '2,69' } }
  });

  assert.equal(result.outcome, 'repair');
  assert.ok(result.issues.some((issue) => issue.includes('P.defecto')));
});

test('rebuilds Ref from codigo whenever Proveedor is missing', () => {
  const result = buildProductDiagnosis({
    input: { query: '620475', codigo: '620475' },
    desktop: {
      status: 'ok',
      values: {
        bancoDatos: 'TIENDA',
        codigoPantalla: '620475',
        pDefectoPrice: '3,49',
        pDefectoPct: '20',
        pTpvPrice: '3,49',
        supplierCode: '',
        supplierName: '',
        supplierRef: 'REFERENCIA ANTIGUA',
        inventariable: 'Si',
        bloqVentaChecked: false
      }
    },
    supplier: { pvd: '2,12', pvp2: '3,49' }
  });

  assert.match(result.plan.join(' '), /Proveedor = 12074/);
  assert.match(result.plan.join(' '), /Ref\. = 96204750/);
});
