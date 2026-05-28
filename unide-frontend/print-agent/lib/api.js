// =====================================================================
// api.js — cliente del backend (cola de impresion)
// =====================================================================
// Usa fetch global (Node >=18). No conecta a Supabase directamente: solo
// habla con el backend de Railway, autenticandose con X-Print-Token.

const TIMEOUT_MS = 15000;

function withTimeout(promiseFactory) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  return promiseFactory(ctrl.signal).finally(() => clearTimeout(id));
}

export class PrintApi {
  constructor(config) {
    this.base = config.backendUrl;
    this.token = config.token;
  }

  get _headers() {
    return { 'X-Print-Token': this.token, 'Content-Type': 'application/json' };
  }

  /** Devuelve el array de pedidos pendientes de imprimir. */
  async getPending(limit = 10) {
    const url = `${this.base}/api/print/pending?limit=${limit}`;
    const res = await withTimeout((signal) =>
      fetch(url, { headers: this._headers, signal })
    );
    if (!res.ok) {
      const body = await safeText(res);
      throw new Error(`pending HTTP ${res.status}${body ? ' - ' + body : ''}`);
    }
    const data = await res.json();
    return Array.isArray(data.orders) ? data.orders : [];
  }

  /** Marca un pedido como impreso en el servidor (idempotente). */
  async markPrinted(orderId) {
    const url = `${this.base}/api/print/mark`;
    const res = await withTimeout((signal) =>
      fetch(url, { method: 'POST', headers: this._headers, body: JSON.stringify({ order_id: orderId }), signal })
    );
    if (!res.ok) {
      const body = await safeText(res);
      throw new Error(`mark HTTP ${res.status}${body ? ' - ' + body : ''}`);
    }
    return res.json().catch(() => ({}));
  }
}

async function safeText(res) {
  try { return (await res.text()).slice(0, 300); } catch { return ''; }
}
