import assert from 'node:assert/strict';
import test from 'node:test';
import { llmExtractMemories } from './llm.js';

test('extracts and validates durable memory candidates from structured LLM output', async (t) => {
  const originalFetch = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        stop_reason: 'end_turn',
        usage: { input_tokens: 42 },
        content: [{
          type: 'text',
          text: JSON.stringify({
            memories: [
              {
                text: '肉类通常星期一和星期三叫货。',
                category: 'schedule',
                topic: '肉类叫货时间',
                importance: 4,
                keywords: ['肉类', '星期一', '星期三']
              },
              {
                text: '今天临时买两箱。',
                category: 'other',
                topic: '临时采购',
                importance: 1,
                keywords: ['今天']
              }
            ]
          })
        }]
      })
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await llmExtractMemories('以后肉类通常星期一和星期三叫货', {
    llm: { apiKey: 'test-key', model: 'test-model' },
    memory: { extractionTimeoutMs: 1000 }
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].topic, '肉类叫货时间');
  assert.equal(result[0].importance, 4);
  assert.equal(requestBody.model, 'test-model');
  assert.equal(requestBody.output_config.format.type, 'json_schema');
  assert.match(requestBody.system, /NO guardes/);
});

test('returns no memory when the model refuses extraction', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ stop_reason: 'refusal', content: [] })
  });
  t.after(() => { globalThis.fetch = originalFetch; });
  const result = await llmExtractMemories('记住这个', { llm: { apiKey: 'test-key' } });
  assert.deepEqual(result, []);
});
