import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  MemoryStore,
  containsSensitiveData,
  formatMemoryList,
  parseMemoryCommand,
  shouldConsiderForMemory
} from './memoryStore.js';

function makeStore(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unide-memory-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, file: path.join(dir, 'bot-memory.json'), store: new MemoryStore({ path: path.join(dir, 'bot-memory.json') }) };
}

test('persists explicit memories across a new process instance', (t) => {
  const { file, store } = makeStore(t);
  const saved = store.remember({
    text: '肉类和果蔬通常星期一叫货，准备星期三到货。',
    category: 'schedule',
    topic: '肉类果蔬叫货时间',
    source: 'explicit',
    importance: 5
  });
  assert.equal(saved.status, 'added');
  assert.ok(fs.existsSync(file));

  const reloaded = new MemoryStore({ path: file });
  assert.equal(reloaded.count, 1);
  assert.equal(reloaded.list()[0].text, '肉类和果蔬通常星期一叫货，准备星期三到货。');
  assert.equal(reloaded.list()[0].source, 'explicit');
});

test('recovers from backup without replacing it with a corrupt primary file', (t) => {
  const { file, store } = makeStore(t);
  store.remember({ text: '先看库存。', source: 'explicit', category: 'procedure' });
  store.remember({ text: '再看促销。', source: 'explicit', category: 'procedure' });
  const backup = `${file}.bak`;
  const validBackup = fs.readFileSync(backup, 'utf8');
  fs.writeFileSync(file, '{ broken json', 'utf8');

  const recovered = new MemoryStore({ path: file });
  assert.equal(recovered.count, 1);
  recovered.remember({ text: '最后确认缺货。', source: 'explicit', category: 'procedure' });

  assert.equal(fs.readFileSync(backup, 'utf8'), validBackup);
  const reloaded = new MemoryStore({ path: file });
  assert.equal(reloaded.count, 2);
  assert.match(reloaded.list().map((entry) => entry.text).join(' '), /最后确认缺货/);
});

test('updates an existing topic instead of accumulating contradictory memories', (t) => {
  const { store } = makeStore(t);
  const first = store.remember({ text: '肉类星期一叫货。', topic: '肉类叫货时间', category: 'schedule' });
  const second = store.remember({ text: '肉类星期一和星期三叫货。', topic: '肉类叫货时间', category: 'correction' });
  assert.equal(first.status, 'added');
  assert.equal(second.status, 'updated');
  assert.equal(store.count, 1);
  assert.match(store.list()[0].text, /星期一和星期三/);
});

test('retrieves relevant Chinese memories and includes permanent rules', (t) => {
  const { store } = makeStore(t);
  store.remember({ text: '叫肉类之前必须先看库存和促销。', category: 'procedure', topic: '肉类叫货检查', importance: 5 });
  store.remember({ text: '标签打印机的纸要正面朝上。', category: 'procedure', topic: '标签纸方向', importance: 3 });
  const context = store.buildContext('今天肉类怎么叫货');
  assert.match(context, /先看库存和促销/);
  assert.doesNotMatch(context, /密码/);
});

test('supports remember, list and safe forget commands', () => {
  assert.deepEqual(parseMemoryCommand('记住：周日十一点前确认 PDA'), { action: 'remember', text: '周日十一点前确认 PDA' });
  assert.deepEqual(parseMemoryCommand('/memories carne'), { action: 'list', query: 'carne' });
  assert.deepEqual(parseMemoryCommand('忘记 12'), { action: 'forget', id: 12 });
  assert.equal(parseMemoryCommand('忘记全部'), null);
});

test('auto learning only considers durable-looking statements', () => {
  assert.equal(shouldConsiderForMemory('以后每次叫货前都先看促销和库存'), true);
  assert.equal(shouldConsiderForMemory('帮我查一下最新三个 pedidos'), false);
  assert.equal(shouldConsiderForMemory('/pedido_nuevo\n620006 2'), false);
});

test('refuses credentials and formats an auditable memory list', (t) => {
  const { store } = makeStore(t);
  assert.equal(containsSensitiveData('API_KEY: sk-super-secret-123456789'), true);
  assert.equal(store.remember({ text: 'password: very-secret-password' }).status, 'sensitive');
  const saved = store.remember({ text: '默认不自动发送 Pedido。', source: 'explicit', category: 'preference' });
  const output = formatMemoryList(store.list(), store.count);
  assert.match(output, new RegExp(`#${saved.entry.id}`));
  assert.match(output, /默认不自动发送 Pedido/);
});
