import assert from 'node:assert/strict';
import test from 'node:test';
import { llmComposeReply } from './llm.js';

test('composes a natural reply from the factual draft and context', async (t) => {
  const originalFetch = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        stop_reason: 'end_turn',
        usage: { input_tokens: 30, output_tokens: 12 },
        content: [{ type: 'text', text: JSON.stringify({ respuesta: '已经成功修改 2 个：620475 3,49 EUR；620207 1,19 EUR。' }) }]
      })
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const answer = await llmComposeReply('成功 2 个：620475 3,49 EUR；620207 1,19 EUR。', {
    llm: { apiKey: 'test-key', model: 'test-model' }
  }, undefined, {
    userText: '刚刚改了几个？',
    history: [{ role: 'user', content: '改一下价格' }],
    memoryContext: '[M1][preference] 回复要简短。'
  });

  assert.match(answer, /620475/);
  assert.equal(requestBody.model, 'test-model');
  assert.equal(requestBody.output_config.format.type, 'json_schema');
  assert.match(requestBody.messages[0].content, /FUENTE DE VERDAD/);
  assert.match(requestBody.messages[0].content, /回复要简短/);
});

test('honors the configured reply length limit', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: JSON.stringify({ respuesta: 'x'.repeat(500) }) }]
    })
  });
  t.after(() => { globalThis.fetch = originalFetch; });
  const answer = await llmComposeReply('resultado', { llm: { apiKey: 'test-key' } }, undefined, { maxChars: 200 });
  assert.equal(answer.length, 200);
});
