// Cliente mínimo de la API de Anthropic (Messages API) con el fetch nativo de
// Node — sin dependencias nuevas, porque update-bot no ejecuta npm install en
// el PC de la tienda (mismo estilo que telegram.js).
//
// Único uso por ahora: emparejar líneas del pedido a precio normal con
// promociones de productos REALMENTE sustituibles. Las reglas por palabras
// no distinguen "PIZZA REFRIGERADA" de "patatas sabor pizza" ni "PAN MOLDE"
// de "pan de hamburguesa"; un modelo sí. La salida se fuerza a JSON con
// output_config.format (json_schema) para que sea parseable siempre.

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-opus-4-8';

export function llmConfigured(config) {
  if (config?.llm?.enabled === false) return false;
  return Boolean(config?.llm?.apiKey || process.env.ANTHROPIC_API_KEY);
}

function llmApiKey(config) {
  return config?.llm?.apiKey || process.env.ANTHROPIC_API_KEY;
}

const PAIRS_SCHEMA = {
  type: 'object',
  properties: {
    pares: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          codigo_pedido: { type: 'string', description: 'Código de la línea del pedido' },
          codigo_promo: { type: 'string', description: 'Código del producto en promoción que la sustituye' },
          motivo: { type: 'string', description: 'Por qué son intercambiables, en una frase corta' }
        },
        required: ['codigo_pedido', 'codigo_promo', 'motivo'],
        additionalProperties: false
      }
    }
  },
  required: ['pares'],
  additionalProperties: false
};

const SYSTEM_PROMPT = `Eres el asesor de compras de un pequeño supermercado español.
Recibirás dos listas: las líneas de un pedido que van a PRECIO NORMAL, y los productos actualmente EN PROMOCIÓN del mayorista.

Tu tarea: encontrar promociones que sean SUSTITUTOS REALES de líneas del pedido — el mismo tipo de producto con el mismo uso, de forma que el cliente de la tienda que iba a comprar uno aceptaría el otro (otra marca, otro formato o tamaño del MISMO producto).

Sé estricto. NO son sustitutos:
- Productos que solo comparten un sabor o ingrediente (una pizza refrigerada y unas patatas fritas sabor pizza; jamón y snacks sabor jamón).
- Productos de la misma categoría pero con uso distinto (pan de molde y pan de hamburguesa; queso rallado para cocinar y una pieza de queso de oveja para tabla; leche y nata).
- Formatos radicalmente distintos para ocasiones distintas (una lata individual y un medio palet).

Reglas:
- Como máximo UNA promoción por línea del pedido; si hay varias válidas, elige la de mayor ahorro.
- La misma promoción puede sugerirse para varias líneas si de verdad sustituye a cada una.
- Si no hay ningún par claro, devuelve la lista vacía. Mejor ningún par que un par dudoso.`;

// orderLines: [{code, nombre}] — líneas a precio normal.
// promoItems: [{code, name, pct}] — promociones candidatas (ya filtradas por ahorro mínimo).
// Devuelve [{lineCode, promoCode, motivo}], validado contra las listas de entrada.
export async function llmPickSimilarPromos(orderLines, promoItems, config, logger) {
  const apiKey = llmApiKey(config);
  if (!apiKey) throw new Error('LLM sin apiKey (config.llm.apiKey o ANTHROPIC_API_KEY)');

  const orderTxt = orderLines.map((l) => `${l.code}|${l.nombre}`).join('\n');
  const promoTxt = promoItems.map((p) => `${p.code}|${p.name}|ahorro ${Number.isFinite(p.pct) ? p.pct.toFixed(0) : '?'}%`).join('\n');
  const user = `LÍNEAS DEL PEDIDO A PRECIO NORMAL (codigo|nombre):\n${orderTxt}\n\nPRODUCTOS EN PROMOCIÓN (codigo|nombre|ahorro):\n${promoTxt}`;

  const controller = new AbortController();
  const timeoutMs = Number(config?.llm?.timeoutMs) || 180000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': API_VERSION
      },
      body: JSON.stringify({
        model: config?.llm?.model || DEFAULT_MODEL,
        max_tokens: 8000,
        system: SYSTEM_PROMPT,
        output_config: { format: { type: 'json_schema', schema: PAIRS_SCHEMA } },
        messages: [{ role: 'user', content: user }]
      })
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Anthropic API ${response.status}: ${body.slice(0, 300)}`);
  }
  const data = await response.json();
  if (data.stop_reason === 'refusal') throw new Error('Anthropic API rechazó la petición (refusal)');
  if (data.stop_reason === 'max_tokens') logger?.warn('llm similar: respuesta truncada por max_tokens');
  const text = (data.content || []).find((b) => b.type === 'text')?.text;
  if (!text) throw new Error('Anthropic API: respuesta sin texto');
  const parsed = JSON.parse(text);

  const lineCodes = new Set(orderLines.map((l) => String(l.code)));
  const promoCodes = new Set(promoItems.map((p) => String(p.code)));
  const out = [];
  const seenLines = new Set();
  for (const p of parsed.pares || []) {
    const lineCode = String(p.codigo_pedido || '').replace(/[^\d]/g, '');
    const promoCode = String(p.codigo_promo || '').replace(/[^\d]/g, '');
    if (!lineCodes.has(lineCode) || !promoCodes.has(promoCode)) continue; // alucinado
    if (seenLines.has(lineCode)) continue; // una por línea
    seenLines.add(lineCode);
    out.push({ lineCode, promoCode, motivo: String(p.motivo || '').trim() });
  }
  logger?.info('llm similar pairs', {
    model: config?.llm?.model || DEFAULT_MODEL,
    proposed: (parsed.pares || []).length,
    accepted: out.length,
    inputTokens: data.usage?.input_tokens,
    outputTokens: data.usage?.output_tokens
  });
  return out;
}
