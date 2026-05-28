// =====================================================================
// Generador de tickets ESC/POS (80mm) para HIPERA
// =====================================================================
// Construimos un Buffer con los bytes ESC/POS del ticket. No usamos
// librerias externas: los comandos son secuencias de bytes bien
// conocidas y asi evitamos dependencias nativas en el PC de la tienda.
//
// Codificacion de texto:
//   La impresora trabaja con una "code page". Seleccionamos PC858
//   (ESC t 19), que es PC850 + simbolo del euro, e incluye los
//   caracteres del español (á é í ó ú ñ ¿ ¡ ü ...). encodeLatin()
//   traduce el texto JS a los bytes de esa tabla.

const ESC = 0x1b;
const GS = 0x1d;

// --- Tabla de caracteres no-ASCII -> byte en CP858 ---
// Solo mapeamos lo habitual en español + simbolos utiles. Lo que no
// esté aquí cae a un equivalente ASCII o '?'.
const CP858 = {
  'Ç': 0x80, 'ü': 0x81, 'é': 0x82, 'â': 0x83, 'ä': 0x84, 'à': 0x85,
  'ç': 0x87, 'ê': 0x88, 'ë': 0x89, 'è': 0x8a, 'ï': 0x8b, 'î': 0x8c,
  'ì': 0x8d, 'Ä': 0x8e, 'É': 0x90, 'ô': 0x93, 'ö': 0x94, 'ò': 0x95,
  'û': 0x96, 'ù': 0x97, 'ÿ': 0x98, 'Ö': 0x99, 'Ü': 0x9a,
  'á': 0xa0, 'í': 0xa1, 'ó': 0xa2, 'ú': 0xa3, 'ñ': 0xa4, 'Ñ': 0xa5,
  'ª': 0xa6, 'º': 0xa7, '¿': 0xa8, '¡': 0xad,
  'Á': 0xb7, 'Í': 0xd6, 'Ó': 0xe0, 'Ú': 0xe9,
  '€': 0xd5, // <- diferencia clave de CP858 frente a CP850
  '·': 0xfa,
};

// Reemplazos de respaldo si algun caracter no estuviera disponible.
const ASCII_FALLBACK = {
  '“': '"', '”': '"', '‘': "'", '’': "'", '–': '-', '—': '-', '…': '...',
};

/** Convierte un string JS a un Buffer en CP858 (apto para la impresora). */
export function encodeLatin(str) {
  const s = String(str ?? '');
  const bytes = [];
  for (const ch of s) {
    const code = ch.codePointAt(0);
    if (code <= 0x7f) { bytes.push(code); continue; } // ASCII directo
    if (CP858[ch] !== undefined) { bytes.push(CP858[ch]); continue; }
    if (ASCII_FALLBACK[ch] !== undefined) {
      for (const c of ASCII_FALLBACK[ch]) bytes.push(c.charCodeAt(0));
      continue;
    }
    bytes.push(0x3f); // '?'
  }
  return Buffer.from(bytes);
}

// =====================================================================
// Builder: acumula bytes y ofrece helpers de formato encadenables.
// =====================================================================
export class Ticket {
  constructor(width = 48) {
    this.width = width;
    this.chunks = [];
    this.raw([ESC, 0x40]);        // ESC @  -> init
    this.raw([ESC, 0x74, 19]);    // ESC t 19 -> code page PC858
  }

  raw(arr) { this.chunks.push(Buffer.from(arr)); return this; }
  bytes(buf) { this.chunks.push(buf); return this; }

  align(mode) { // 0=izq 1=centro 2=der
    return this.raw([ESC, 0x61, mode]);
  }
  bold(on) { return this.raw([ESC, 0x45, on ? 1 : 0]); }
  // GS ! n : tamaño. bit 0x10 = doble alto, 0x20 = doble ancho.
  size(doubleW, doubleH) {
    let n = 0;
    if (doubleW) n |= 0x20;
    if (doubleH) n |= 0x10;
    return this.raw([GS, 0x21, n]);
  }
  normal() { this.size(false, false); this.bold(false); return this; }

  text(str) { return this.bytes(encodeLatin(str)); }
  line(str = '') { this.text(str); return this.raw([0x0a]); }

  /** Linea con texto a la izquierda y a la derecha, rellenando con espacios. */
  lineLR(left, right) {
    const l = String(left ?? '');
    const r = String(right ?? '');
    const space = Math.max(1, this.width - l.length - r.length);
    return this.line(l + ' '.repeat(space) + r);
  }

  hr(char = '-') { return this.line(char.repeat(this.width)); }

  feed(n = 1) { return this.raw([ESC, 0x64, n]); } // ESC d n -> avanza n lineas

  cut() { return this.raw([GS, 0x56, 66, 0]); } // GS V 66 0 -> corte parcial con avance

  // ESC B n t -> zumbador. n pitidos, t duracion (x50ms).
  buzzer(count = 3, duration = 3) { return this.raw([ESC, 0x42, count, duration]); }

  // ESC p m t1 t2 -> pulso al cajon portamonedas (pin 0).
  drawer() { return this.raw([ESC, 0x70, 0, 25, 250]); }

  build() { return Buffer.concat(this.chunks); }
}

// =====================================================================
// Logica de negocio: estado de pago para el ticket.
// =====================================================================
// Devuelve { paid, label, amount?, verify? }. El objetivo es que el
// dueño/padres sepan de un vistazo SI HAY QUE COBRAR.
export function resolvePayment(order) {
  const pm = String(order.payment_method || '');
  const pmLow = pm.toLowerCase();
  const isStorePickup = order.delivery_method === 'store_pickup';
  const isCOD = pmLow.includes('contra') || order.status === 'Pendiente de Pago';

  if (isCOD) {
    return {
      paid: false,
      label: isStorePickup ? 'COBRAR AL RECOGER' : 'COBRAR AL ENTREGAR',
      amount: Number(order.total) || 0,
    };
  }
  if (order.stripe_payment_intent) {
    // Pago confirmado por Stripe (tarjeta / Bizum / wallet).
    return { paid: true, label: 'PAGADO ONLINE (' + simplifyMethod(pm) + ')' };
  }
  if (pmLow.includes('bizum')) {
    // Bizum manual: el cliente dice haber pagado pero no esta verificado.
    return { paid: true, label: 'PAGADO (Bizum manual)', verify: true };
  }
  return { paid: true, label: 'PAGADO (' + (pm || 'pendiente') + ')' };
}

function simplifyMethod(pm) {
  const low = pm.toLowerCase();
  if (low.includes('bizum')) return 'Bizum';
  if (low.includes('tarjeta') || low.includes('card')) return 'Tarjeta';
  if (low.includes('apple')) return 'Apple Pay';
  if (low.includes('google')) return 'Google Pay';
  return pm;
}

// =====================================================================
// buildTicket(order, config) -> Buffer ESC/POS listo para imprimir.
// =====================================================================
export function buildTicket(order, config) {
  const W = config?.printWidth || 48;
  const t = new Ticket(W);

  const items = Array.isArray(order.items) ? order.items : [];
  const total = Number(order.total) || 0;
  const subtotal = items.reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.quantity) || 0), 0);
  const isStorePickup = order.delivery_method === 'store_pickup';
  const shipping = Math.max(0, total - subtotal);
  const pay = resolvePayment(order);

  const fmt = (n) => (Number(n) || 0).toFixed(2) + ' EUR';
  const shortId = String(order.id || '').slice(0, 8).toUpperCase();
  const when = formatDate(order.confirmed_at || order.created_at);

  // --- Cabecera (datos de la tienda, configurables) ---
  t.align(1).bold(true).size(true, true).line(config?.storeName || 'HIPERA');
  t.normal().align(1);
  if (config?.storeAddr1) t.line(config.storeAddr1);
  if (config?.storeAddr2) t.line(config.storeAddr2);
  if (config?.storePhone) t.line('Tel: ' + config.storePhone);
  t.hr('=');

  // --- Datos del pedido ---
  t.align(0).bold(true).line('Pedido: #' + shortId).bold(false);
  t.line('Fecha: ' + when);

  // --- Modalidad de entrega (grande, para verlo de un vistazo) ---
  t.hr('=');
  t.align(1).bold(true).size(false, true);
  t.line(isStorePickup ? 'RECOGIDA EN TIENDA' : 'ENVIO A DOMICILIO');
  t.normal();
  t.hr('=');

  // --- Estado de pago (lo mas importante) ---
  t.align(1).bold(true).size(false, true);
  t.line(pay.label);
  if (!pay.paid) {
    t.line(fmt(pay.amount));
  }
  t.normal();
  if (pay.verify) {
    t.align(1).line('(Verificar Bizum recibido)');
  }
  t.hr('-');

  // --- Articulos ---
  t.align(0).bold(true).line('Articulos:').bold(false);
  for (const it of items) {
    const qty = Number(it.quantity) || 0;
    const price = Number(it.price) || 0;
    const lineTotal = qty * price;
    const name = String(it.name || 'Producto');
    const isGift = it.isGift || price === 0;
    t.line(name);
    if (isGift) {
      t.lineLR('  ' + qty + ' x GRATIS', 'GRATIS');
    } else {
      t.lineLR('  ' + qty + ' x ' + price.toFixed(2), lineTotal.toFixed(2));
    }
  }
  t.hr('-');

  // --- Totales ---
  t.align(0);
  t.lineLR('Subtotal:', subtotal.toFixed(2) + ' EUR');
  if (isStorePickup) {
    t.lineLR('Recogida:', 'GRATIS');
  } else {
    t.lineLR('Envio:', shipping > 0 ? shipping.toFixed(2) + ' EUR' : 'GRATIS');
  }
  t.bold(true).size(false, true);
  t.lineLR('TOTAL:', total.toFixed(2));
  t.normal();
  t.hr('-');

  // --- Datos de contacto / entrega ---
  t.align(0).bold(true).line('Cliente:').bold(false);
  if (order.phone) t.line('Tel: ' + order.phone);
  if (!isStorePickup && order.address) {
    t.line('Direccion:');
    // Partimos la direccion en lineas que quepan en el ancho.
    for (const ln of wrap(String(order.address), W)) t.line('  ' + ln);
  }
  if (order.note) {
    t.line('Nota:');
    for (const ln of wrap(String(order.note), W)) t.line('  ' + ln);
  }
  t.hr('-');

  // --- Pie ---
  t.align(1).line('Gracias por su compra').line('HIPERA');
  t.feed(2);

  // --- Cajon (opcional) + corte + zumbador ---
  if (config?.openDrawer) t.drawer();
  t.cut();
  if (config?.buzzerEnabled) t.buzzer(config.buzzerCount, config.buzzerDuration);

  return t.build();
}

function wrap(str, width) {
  const words = str.split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + (cur ? ' ' : '') + w).length > width - 2) {
      if (cur) lines.push(cur);
      cur = w;
    } else {
      cur = cur ? cur + ' ' + w : w;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

function formatDate(iso) {
  try {
    const d = new Date(iso);
    // Hora de Madrid, formato dia/mes/año hh:mm.
    return d.toLocaleString('es-ES', {
      timeZone: 'Europe/Madrid',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return String(iso || '');
  }
}
