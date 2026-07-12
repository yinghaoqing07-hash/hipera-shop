import assert from 'node:assert/strict';
import test from 'node:test';
import { formatRecentOrdersSummary, parseRecentOrdersRequest, selectLatestOrderRows } from './recentOrders.js';

test('parses the natural Chinese request for the latest three orders', () => {
  assert.deepEqual(parseRecentOrdersRequest('去看最新的三个pedidos怎么样'), {
    requested: 3,
    limit: 3,
    capped: false
  });
});

test('parses commands, Spanish counts and caps expensive reads', () => {
  assert.equal(parseRecentOrdersRequest('/pedidos 2').limit, 2);
  assert.equal(parseRecentOrdersRequest('revisa los últimos tres pedidos').limit, 3);
  assert.deepEqual(parseRecentOrdersRequest('/pedidos 9'), { requested: 9, limit: 5, capped: true });
  assert.equal(parseRecentOrdersRequest('今天要叫肉吗'), null);
});

test('selects newest rows by creation date and then numeric id', () => {
  const selected = selectLatestOrderRows([
    { id: '17.100', nombre: 'A', fechaIso: '2026-07-10' },
    { id: '17.099', nombre: 'B', fechaIso: '2026-07-11' },
    { id: '17.101', nombre: 'C', fechaIso: '2026-07-11' },
    { id: '16.900', nombre: 'D', fechaIso: '2026-07-09' }
  ], 3);
  assert.deepEqual(selected.map((row) => row.nombre), ['C', 'B', 'A']);
});

test('summarizes facts and flags draft, zero quantity and duplicate codes', () => {
  const text = formatRecentOrdersSummary([{
    orderName: 'CARNE 1207',
    orderDate: '2026-07-12',
    estado: 'Alta',
    pesoTotal: '12,5',
    importeTotal: '45,600 €',
    items: [
      { code: '620006', quantity: '0', total: '0,00' },
      { code: '620006', quantity: '2', total: '45,60' }
    ]
  }], { requested: 1, limit: 1, capped: false });
  assert.match(text, /CARNE 1207/);
  assert.match(text, /45,6 EUR/);
  assert.match(text, /数量为 0/);
  assert.match(text, /重复代码：620006/);
  assert.match(text, /仍是 Alta/);
});
