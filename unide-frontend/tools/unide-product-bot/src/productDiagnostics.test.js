import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildProductDiagnosis,
  parseDiagnosticoCodigos,
  planAutoReparacion,
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

test('parseDiagnosticoCodigos: codigos escritos a mano, sin robar otras frases', () => {
  assert.deepEqual(parseDiagnosticoCodigos('/diagnostico_productos 129174 612025'), ['129174', '612025']);
  assert.deepEqual(parseDiagnosticoCodigos('/diagnostico 129174, 612025'), ['129174', '612025']);
  assert.deepEqual(parseDiagnosticoCodigos('/revisar 102852'), ['102852']);
  assert.deepEqual(parseDiagnosticoCodigos('检查商品 129174 612025'), ['129174', '612025']);
  assert.deepEqual(parseDiagnosticoCodigos('查一下商品 102852'), ['102852']);
  // duplicados fuera, orden respetado
  assert.deepEqual(parseDiagnosticoCodigos('/diagnostico 129174 129174 612025'), ['129174', '612025']);
  // sin codigos = flujo de fichero de siempre
  assert.deepEqual(parseDiagnosticoCodigos('/diagnostico_productos'), []);
  // no le roba frases a nadie
  assert.deepEqual(parseDiagnosticoCodigos('129174'), []);
  assert.deepEqual(parseDiagnosticoCodigos('把851040改成一箱'), []);
  assert.deepEqual(parseDiagnosticoCodigos('/pedido 3'), []);
  assert.deepEqual(parseDiagnosticoCodigos(''), []);
});

test('planAutoReparacion: separa lo que el bot sabe arreglar de lo manual', () => {
  // bloq + precio con PVP2 → dos acciones automáticas
  const r1 = { issues: ['Bloq.Venta 已勾选', '没有售价'], recommendation: { pvp2: 2.05 } };
  const p1 = planAutoReparacion(r1);
  assert.deepEqual(p1.acciones, [{ tipo: 'bloq' }, { tipo: 'precio', valor: 2.05 }]);
  assert.deepEqual(p1.manual, []);

  // margen anómalo también dispara el precio, y no se duplica
  const r2 = { issues: ['没有售价', '价格毛利异常（P.defecto ≤ 0 或实际售价低于成本）'], recommendation: { pvp2: 3.1 } };
  assert.deepEqual(planAutoReparacion(r2).acciones, [{ tipo: 'precio', valor: 3.1 }]);

  // sin PVP2 el precio se queda manual
  const r3 = { issues: ['没有售价'], recommendation: { pvp2: 0 } };
  const p3 = planAutoReparacion(r3);
  assert.deepEqual(p3.acciones, []);
  assert.equal(p3.manual.length, 1);
  assert.match(p3.manual[0], /定价得你来/);

  // Proveedor / Inventariable: aún sin cablear → manual
  const r4 = { issues: ['Proveedor 为空', 'Inventariable 为空'], recommendation: { pvp2: 2 } };
  const p4 = planAutoReparacion(r4);
  assert.deepEqual(p4.acciones, []);
  assert.equal(p4.manual.length, 2);

  // sin ficha TIENDA: TODO manual aunque hubiera precio
  const r5 = { issues: ['没有 TIENDA 商品资料'], recommendation: { pvp2: 2 } };
  const p5 = planAutoReparacion(r5);
  assert.deepEqual(p5.acciones, []);
  assert.deepEqual(p5.manual, ['没有 TIENDA 商品资料']);

  assert.deepEqual(planAutoReparacion({}), { acciones: [], manual: [] });
});
