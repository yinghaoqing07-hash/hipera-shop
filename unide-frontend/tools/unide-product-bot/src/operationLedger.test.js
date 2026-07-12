import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  OperationLedger,
  extractLegacyPriceEvents,
  formatOperationHistory,
  parseOperationHistoryRequest
} from './operationLedger.js';

function makeLedger(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unide-operations-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'operation-ledger.json');
  return { dir, file, ledger: new OperationLedger({ path: file, timeZone: 'Europe/Madrid' }) };
}

function priceEvent(overrides = {}) {
  return {
    type: 'price_change',
    status: 'success',
    code: '620475',
    name: 'LIMON',
    previousPrice: 3.2,
    newPrice: 3.5,
    source: 'fruit_single',
    groupId: 'single-1',
    occurredAt: '2026-07-12T18:00:00.000Z',
    ...overrides
  };
}

test('persists operations across restart and deduplicates imported events', (t) => {
  const { file, ledger } = makeLedger(t);
  assert.equal(ledger.record(priceEvent({ dedupeKey: 'one' })).status, 'added');
  assert.equal(ledger.record(priceEvent({ dedupeKey: 'one' })).status, 'duplicate');
  const reloaded = new OperationLedger({ path: file, timeZone: 'Europe/Madrid' });
  assert.equal(reloaded.count, 1);
  assert.equal(reloaded.successfulPriceChanges, 1);
  assert.equal(reloaded.summarize({ scope: 'all' }).entries[0].name, 'LIMON');
});

test('recovers a corrupt primary ledger from backup without destroying the backup', (t) => {
  const { file, ledger } = makeLedger(t);
  ledger.record(priceEvent({ dedupeKey: 'first' }));
  ledger.record(priceEvent({ code: '2', name: 'UVA', dedupeKey: 'second' }));
  const backup = `${file}.bak`;
  const validBackup = fs.readFileSync(backup, 'utf8');
  fs.writeFileSync(file, '{ broken ledger', 'utf8');

  const recovered = new OperationLedger({ path: file, timeZone: 'Europe/Madrid' });
  assert.equal(recovered.count, 1);
  recovered.record(priceEvent({ code: '3', name: 'MANGO', dedupeKey: 'third' }));

  assert.equal(fs.readFileSync(backup, 'utf8'), validBackup);
  const reloaded = new OperationLedger({ path: file, timeZone: 'Europe/Madrid' });
  assert.equal(reloaded.count, 2);
});

test('summarizes today, week, latest group and unique products', (t) => {
  const { ledger } = makeLedger(t);
  ledger.record(priceEvent({ groupId: 'old', occurredAt: '2026-07-05T10:00:00Z' }));
  ledger.record(priceEvent({ code: '1', name: 'UVA', newPrice: 2.8, groupId: 'batch-1', occurredAt: '2026-07-12T18:10:00Z' }));
  ledger.record(priceEvent({ code: '2', name: 'MANGO', newPrice: 3.49, groupId: 'batch-1', occurredAt: '2026-07-12T18:11:00Z' }));
  ledger.record(priceEvent({ code: '2', name: 'MANGO', status: 'failed', groupId: 'batch-1', stage: 'apply', error: 'fallo', occurredAt: '2026-07-12T18:12:00Z' }));

  const now = new Date('2026-07-12T20:00:00Z');
  const today = ledger.summarize({ scope: 'today' }, now);
  assert.equal(today.successCount, 2);
  assert.equal(today.failureCount, 1);
  assert.equal(today.uniqueProductCount, 2);
  const group = ledger.summarize({ scope: 'latest_group' }, now);
  assert.equal(group.entries.length, 3);
  const week = ledger.summarize({ scope: 'week' }, now);
  assert.equal(week.successCount, 2);
});

test('counts inclusively from the first matching product and target price', (t) => {
  const { ledger } = makeLedger(t);
  ledger.record(priceEvent({ code: '10', name: 'LIMON PRIMOFIORI', newPrice: 3.5, occurredAt: '2026-07-12T18:00:00Z' }));
  ledger.record(priceEvent({ code: '11', name: 'UVA BLANCA GRANEL', newPrice: 2.8, occurredAt: '2026-07-12T18:10:00Z' }));
  ledger.record(priceEvent({ code: '12', name: 'MANGO MANTO', newPrice: 3.49, occurredAt: '2026-07-12T18:20:00Z' }));
  const summary = ledger.summarize({ scope: 'since', occurrence: 'first', anchor: 'limon', targetPrice: 3.5 });
  assert.equal(summary.successCount, 3);
  assert.equal(summary.anchorEntry.name, 'LIMON PRIMOFIORI');
});

test('parses direct commands and natural Chinese history questions', () => {
  assert.deepEqual(parseOperationHistoryRequest('/price_history'), { scope: 'today' });
  assert.deepEqual(parseOperationHistoryRequest('/price_history last 20'), { scope: 'last', limit: 20 });
  assert.deepEqual(parseOperationHistoryRequest('刚刚批量改了几个'), { scope: 'latest_group' });
  assert.deepEqual(parseOperationHistoryRequest('今天一共改价多少个'), { scope: 'today' });
  assert.deepEqual(parseOperationHistoryRequest('这周改价记录'), { scope: 'week' });
  assert.deepEqual(parseOperationHistoryRequest('总共改了几个价格'), { scope: 'all' });
  assert.deepEqual(parseOperationHistoryRequest('从第一个limon改成3.5后到现在总共几个'), {
    scope: 'since', occurrence: 'first', anchor: 'limon', targetPrice: 3.5
  });
  assert.equal(parseOperationHistoryRequest('今天有几个促销'), null);
});

test('imports only clear legacy success messages and is idempotent', (t) => {
  const messages = [
    { id: 1, seq: 1, at: '2026-07-12T18:00:00Z', from: 'bot', text: '✅ 已改：LIMON → 3,50 €（P.defecto 20%）' },
    { id: 2, seq: 2, at: '2026-07-12T18:10:00Z', from: 'bot', text: '1/2 ✅ UVA BLANCA → 2,80 €（P.defecto 30%）' },
    { id: 3, seq: 3, at: '2026-07-12T18:11:00Z', from: 'bot', text: '2/2 ✅ MANGO → 3,49 €（P.defecto 30%）' },
    { id: 4, seq: 4, at: '2026-07-12T18:12:00Z', from: 'user', text: '我改了 TOMATE 1,99' }
  ];
  const extracted = extractLegacyPriceEvents(messages);
  assert.equal(extracted.length, 3);
  assert.equal(extracted[1].groupId, extracted[2].groupId);
  const { ledger } = makeLedger(t);
  assert.equal(ledger.importLegacyChat(messages).imported, 3);
  assert.equal(ledger.importLegacyChat(messages).imported, 0);
  assert.equal(ledger.summarize({ scope: 'all' }).successCount, 3);
});

test('formats an auditable report and context with real totals', (t) => {
  const { ledger } = makeLedger(t);
  ledger.record(priceEvent());
  const summary = ledger.summarize({ scope: 'all' });
  const report = formatOperationHistory(summary);
  assert.match(report, /成功 1 次，涉及 1 个商品/);
  assert.match(report, /LIMON/);
  assert.match(report, /3,20 € → 3,50 €/);
  assert.match(ledger.buildContext(), /HISTORIAL REAL DE CAMBIOS DE PRECIO/);
});
