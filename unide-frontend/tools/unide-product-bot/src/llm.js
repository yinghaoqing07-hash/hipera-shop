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

// ---------- router de intenciones ----------
// El usuario escribe en chino/español coloquial ("帮我打一下152的清单") y el
// modelo lo traduce a uno de los comandos del bot. Solo se llama cuando el
// mensaje no casó con ningún comando ni plantilla — los comandos exactos
// siguen siendo gratis e instantáneos.

const INTENT_SCHEMA = {
  type: 'object',
  properties: {
    accion: {
      type: 'string',
      enum: ['llegada', 'ahorro_pedido', 'ahorro', 'promociones', 'precio_fruta', 'precios_fruta', 'bloq_venta', 'pedido', 'carne', 'articulo', 'ayuda', 'responder'],
      description: 'Comando del bot al que corresponde el mensaje, o "responder" si no corresponde a ninguno'
    },
    argumento: { type: 'string', description: 'Argumento del comando (números de pedido, "nombre precio", código…); vacío si no aplica' },
    respuesta: { type: 'string', description: 'Solo para accion=responder: la respuesta al usuario, EN CHINO, corta' }
  },
  required: ['accion', 'argumento', 'respuesta'],
  additionalProperties: false
};

const INTENT_SYSTEM = `Eres el intérprete de intenciones de un bot de Telegram que ayuda a la dueña de un pequeño supermercado español. La usuaria escribe en chino coloquial (a veces español). Tu trabajo: decidir a qué comando corresponde su mensaje y con qué argumento.

Comandos disponibles:
- llegada — imprimir la lista de comprobación de llegada en la impresora de la tienda. argumento: números o palabras del nombre del pedido ("152 153", "carne 0807"), una fecha ("1/7"), o vacío = pedidos que llegan hoy. Palabras clave: 打印, 清单, 对货, 到货, imprimir, lista.
- ahorro_pedido — abrir un pedido de la web y cruzarlo con las promociones (qué va ya a precio promo, qué sustituir). argumento: número del pedido o vacío = el PDA más reciente. Palabras clave: 省钱, 促销对比, 划算.
- ahorro — resumen general de promociones vigentes y estrategia de compra.
- promociones — descargar de la web las promociones vigentes (CSV). Palabras clave: 促销, 刷新促销.
- precio_fruta — cambiar el precio de UNA fruta/verdura en el UnideGes de escritorio (con confirmación). argumento: "nombre precio", p. ej. "platano 2,99". Palabras clave: 改价, 换价格.
- precios_fruta — cambio de precios de fruta EN LOTE. argumento: una línea por artículo "nombre precio".
- bloq_venta — marcar o desmarcar el checkbox Bloq.Venta de un artículo en el UnideGes de escritorio. argumento: "nombre_o_codigo off" (desmarcar = 恢复可卖/解锁, p.ej. "把X的bloc venta关了") o "nombre_o_codigo on" (marcar = 停卖/锁上). Palabras clave: bloq venta, bloc venta, 停卖, 开卖, 解锁, 锁.
- pedido — plantillas/recordatorio de pedido. argumento: "carne", "fruta", "pda" o vacío.
- carne — empezar el recuento de carne para el pedido.
- articulo — consultar un producto por código o EAN. argumento: el código.
- ayuda — mostrar la ayuda del bot.
- responder — el mensaje NO corresponde a ningún comando: una PREGUNTA (sobre promociones, precios, pedidos, fechas…), una duda, un saludo o algo ambiguo. Contesta tú en el campo "respuesta", EN CHINO (los nombres de productos y promociones quedan en español tal cual). Si la pregunta se puede contestar con los DATOS DE HOY del final, respóndela con cifras, fechas y nombres CONCRETOS de esos datos. Si los datos no llegan para contestar, dilo claramente y sugiere el comando útil. Usa el historial de la conversación para resolver referencias ("那152呢", "第二个", "那个促销").

Reglas: en la duda entre ejecutar algo y preguntar, pregunta (responder). Nunca inventes argumentos que la usuaria no dijo. Los números de pedido van tal cual en el argumento. Los DATOS DE HOY (si los hay al final) cuentan como la verdad: no inventes promociones, precios ni pedidos que no estén ahí.`;

// Devuelve { accion, argumento, respuesta }. extras (opcional):
//   history — últimos turnos del chat [{role:'user'|'assistant', content}] para
//             que el modelo resuelva referencias ("那152呢");
//   datos   — texto con los datos del día (promociones, pedidos) para que
//             accion=responder conteste con cifras reales, no de memoria.
export async function llmRouteIntent(text, config, logger, extras = {}) {
  const apiKey = llmApiKey(config);
  if (!apiKey) throw new Error('LLM sin apiKey');
  const history = Array.isArray(extras.history) ? extras.history : [];
  const system = extras.datos
    ? `${INTENT_SYSTEM}\n\n=== DATOS DE HOY ===\n${String(extras.datos).slice(0, 150000)}`
    : INTENT_SYSTEM;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(config?.llm?.timeoutMs) || 60000);
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
        max_tokens: 1500,
        system,
        output_config: { format: { type: 'json_schema', schema: INTENT_SCHEMA } },
        messages: [...history, { role: 'user', content: String(text || '').slice(0, 2000) }]
      })
    });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Anthropic API ${response.status}: ${body.slice(0, 200)}`);
  }
  const data = await response.json();
  if (data.stop_reason === 'refusal') throw new Error('refusal');
  const textOut = (data.content || []).find((b) => b.type === 'text')?.text;
  if (!textOut) throw new Error('respuesta sin texto');
  const parsed = JSON.parse(textOut);
  logger?.info('llm intent', { accion: parsed.accion, argumento: parsed.argumento, inputTokens: data.usage?.input_tokens });
  return {
    accion: String(parsed.accion || 'responder'),
    argumento: String(parsed.argumento || '').trim(),
    respuesta: String(parsed.respuesta || '').trim()
  };
}

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
