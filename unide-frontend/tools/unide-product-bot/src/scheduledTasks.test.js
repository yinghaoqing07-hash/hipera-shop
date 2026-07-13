import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  ScheduledTaskStore,
  parseLlmScheduleArgument,
  parseScheduleCommand,
  safeTaskFromCommand
} from './scheduledTasks.js';

function makeStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unide-tasks-'));
  const file = path.join(dir, 'tasks.json');
  return { dir, file, store: new ScheduledTaskStore({ path: file, maxLateMinutes: 360 }) };
}

test('scheduled task persists, becomes due and completes', () => {
  const { dir, file, store } = makeStore();
  try {
    const runAt = new Date(Date.now() + 60000);
    const task = store.add({ action: 'carne', runAt, chatId: 123, label: '肉类盘点' });
    assert.equal(task.command, '/carne');
    const reloaded = new ScheduledTaskStore({ path: file, maxLateMinutes: 360 });
    assert.equal(reloaded.list({ status: 'pending' }).length, 1);
    const due = reloaded.claimDue(new Date(runAt.getTime() + 1000));
    assert.equal(due.length, 1);
    assert.equal(due[0].status, 'running');
    reloaded.complete(task.id);
    assert.equal(reloaded.list({ status: 'completed' }).length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('pending task can be cancelled and cannot be claimed', () => {
  const { dir, store } = makeStore();
  try {
    const runAt = new Date(Date.now() + 60000);
    const task = store.add({ action: 'pedido', argument: 'carne', runAt, chatId: 123 });
    assert.equal(store.cancel(task.id)?.status, 'cancelled');
    assert.equal(store.cancel(task.id), null);
    assert.equal(store.claimDue(new Date(runAt.getTime() + 1000)).length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('manual task commands accept only safe actions', () => {
  const now = new Date(2098, 0, 1, 0, 0);
  const parsed = parseScheduleCommand('/tarea 2099-07-14 10:00 /pedidos 3', now);
  assert.equal(parsed.action, 'create');
  assert.equal(parsed.taskAction, 'pedidos_recientes');
  assert.equal(parsed.argument, '3');
  assert.equal(parseScheduleCommand('/tareas', now).action, 'list');
  assert.deepEqual(parseScheduleCommand('/cancelar_tarea 12', now), { action: 'cancel', id: 12 });
  assert.equal(parseScheduleCommand('/tarea 2099-07-14 10:00 /articulo 123', now).action, 'invalid');
  assert.equal(safeTaskFromCommand('/pedido_nuevo'), null);
});

test('LLM schedule argument is strict and keeps the safe command', () => {
  const now = new Date(2098, 0, 1, 0, 0);
  const parsed = parseLlmScheduleArgument('2099-07-14 10:00|/carne|肉类叫货', now);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.command, '/carne');
  assert.equal(parsed.label, '肉类叫货');
  assert.equal(parseLlmScheduleArgument('2099-07-14 10:00|/precio_fruta platano 2,99|改价', now).ok, false);
});
