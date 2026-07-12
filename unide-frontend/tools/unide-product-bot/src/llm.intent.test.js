import assert from 'node:assert/strict';
import test from 'node:test';
import { llmRouteIntent } from './llm.js';

test('routes a conversational follow-up to the persistent price history action', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      content: [{ type: 'text', text: JSON.stringify({ accion: 'price_history', argumento: 'all', respuesta: '' }) }],
      usage: { input_tokens: 50 }
    })
  });
  const result = await llmRouteIntent('现在总共几个知道了吗', {
    llm: { apiKey: 'test-key', model: 'test-model', timeoutMs: 1000 }
  }, null, {
    history: [{ role: 'user', content: '我说的是从 limón 改价后开始算' }],
    datos: 'HISTORIAL REAL DE CAMBIOS DE PRECIO'
  });
  assert.deepEqual(result, { accion: 'price_history', argumento: 'all', respuesta: '' });
});
