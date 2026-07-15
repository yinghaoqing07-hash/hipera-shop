import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ActiveConversationStore, classifyShortDecision } from './activeConversation.js';

function tempStateFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unide-active-conversation-'));
  return { dir, file: path.join(dir, 'active.json') };
}

test('classifies short confirmations without hijacking normal conversation', () => {
  assert.equal(classifyShortDecision('要'), 'confirm');
  assert.equal(classifyShortDecision('继续。'), 'confirm');
  assert.equal(classifyShortDecision('重试'), 'confirm');
  assert.equal(classifyShortDecision('取消'), 'cancel');
  assert.equal(classifyShortDecision('/pedido'), '');
  assert.equal(classifyShortDecision('要看最新三个订单'), '');
});

test('persists the executable order draft across bot restarts', () => {
  const { dir, file } = tempStateFile();
  try {
    const first = new ActiveConversationStore(file);
    first.set(7125, {
      kind: 'order_apply',
      sessionId: 'draft-17',
      status: 'awaiting_confirmation',
      orderDraft: { orderName: 'CARNE 1507', items: [{ codigo: '617519', cantidad: 1 }] }
    });

    const reloaded = new ActiveConversationStore(file);
    assert.equal(reloaded.get(7125).sessionId, 'draft-17');
    assert.equal(reloaded.get(7125).orderDraft.orderName, 'CARNE 1507');
    assert.match(reloaded.formatContext(7125), /orderName=CARNE 1507/);
    assert.equal(reloaded.clearMatchingSession(7125, 'another'), false);
    assert.equal(reloaded.clearMatchingSession(7125, 'draft-17'), true);
    assert.equal(reloaded.get(7125), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('turns an interrupted running task into an explicit retry task', () => {
  const { dir, file } = tempStateFile();
  try {
    const old = Date.now();
    fs.writeFileSync(file, JSON.stringify({
      version: 1,
      chats: {
        7125: {
          kind: 'order_apply',
          sessionId: 'draft-retry',
          status: 'running',
          orderDraft: { orderName: 'CARNE 1507', items: [{ codigo: '617519', cantidad: 1 }] },
          createdAt: old,
          updatedAt: old
        }
      }
    }), 'utf8');

    const store = new ActiveConversationStore(file, { runningTimeoutMs: 60 * 60 * 1000 });
    assert.equal(store.get(7125).status, 'awaiting_retry');
    assert.match(store.get(7125).failure, /重试/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
