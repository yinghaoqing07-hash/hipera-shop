import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { buildDraftFromTally, buildTallyKeyboard, loadTemplate } from './orderTemplates.js';

const config = { __toolRoot: path.join(os.tmpdir(), 'unide-template-tests-missing') };

test('produce template uses the validated 60-item store list', () => {
  const template = loadTemplate(config, 'fruta');
  assert.equal(template.label, 'FRUTA Y VERDURA');
  assert.equal(template.items.length, 60);
  assert.equal(template.pageSize, 10);
  assert.ok(template.items.some((item) => item.code === '599651' && item.nombre.includes('MANZANA GRANEL')));
  assert.ok(template.items.some((item) => item.code === '851086' && item.nombre === 'PIMIENTO VERDE'));
  assert.ok(!template.items.some((item) => item.code === '620114'));
  assert.ok(!template.items.some((item) => item.code === '851084'));
});

test('produce tally paginates without losing counts', () => {
  const template = loadTemplate(config, 'fruta');
  const counts = { 0: 1, 10: 2 };
  const first = buildTallyKeyboard('abc', template, counts, 0).inline_keyboard;
  const second = buildTallyKeyboard('abc', template, counts, 1).inline_keyboard;
  assert.match(first[0][0].text, /AGUACATE HASS.*1/);
  assert.equal(first.at(-2)[1].text, '1/6');
  assert.match(second[0][0].text, /MANZANA GOLDEN.*2/);
  assert.equal(second[0][0].callback_data, 'tc:abc:10');
  assert.equal(second.at(-2)[1].text, '2/6');
});

test('produce tally creates the regular safe order draft', () => {
  const template = loadTemplate(config, 'fruta');
  const draft = buildDraftFromTally(template, { 0: 1, 10: 2 }, new Date('2026-07-16T09:00:00Z'), 'Europe/Madrid');
  assert.equal(draft.orderName, 'FRUTA Y VERDURA 1607');
  assert.deepEqual(draft.items.map(({ code, quantity }) => ({ code, quantity })), [
    { code: '851220', quantity: '1' },
    { code: '852460', quantity: '2' }
  ]);
});


test('meat tally stays on its original single page', () => {
  const template = loadTemplate({}, 'carne');
  const keyboard = buildTallyKeyboard('meat', template, {}, 0).inline_keyboard;

  assert.equal(keyboard.length, template.items.length + 1);
  assert.equal(keyboard.at(-1)[0].text, '✔ 生成订单');
  assert.ok(!keyboard.flat().some((button) => button.callback_data.startsWith('tcp:')));
});
