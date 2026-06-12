// =====================================================================
// fiskaly — comprobación OFFLINE de buildInvoiceContent (sin API keys)
// =====================================================================
// Verifica con pedidos sintéticos "difíciles" que la construcción de la
// factura cuadra AL CÉNTIMO:
//   A) full_amount de la factura == orders.total
//   B) suma de full_amount de líneas == full_amount de la factura
//   C) unit_amount × qty × (1+IVA) reproduce cada línea (error < 1e-6 €)
//   D) desglose: Σ(base+cuota) == total
//   E) descuento repartido íntegro (ni un céntimo perdido ni inventado)
//
// Uso:  cd backend && node scripts/fiskaly-payload-check.js
// =====================================================================

import { buildInvoiceContent } from '../services/fiskaly.js';

let failures = 0;

function check(name, cond, detail = '') {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✖ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

function verify(label, order) {
  console.log(`\n— ${label} —`);
  const { content, breakdown } = buildInvoiceContent(order, { series: 'WEB-2026', number: '1' });

  const totalCents = Math.round(Number(order.total) * 100);
  const invoiceCents = Math.round(Number(content.full_amount) * 100);
  check('A: full_amount == total del pedido', invoiceCents === totalCents,
    `factura ${content.full_amount} vs pedido ${order.total}`);

  const sumLines = content.items.reduce((s, it) => s + Math.round(Number(it.full_amount) * 100), 0);
  check('B: Σ líneas == full_amount', sumLines === invoiceCents,
    `líneas ${sumLines} vs factura ${invoiceCents}`);

  let worst = 0;
  for (const it of content.items) {
    const rate = Number(it.system.category.rate);
    const rebuilt = Number(it.unit_amount) * Number(it.quantity) * (1 + rate / 100);
    worst = Math.max(worst, Math.abs(rebuilt - Number(it.full_amount)));
  }
  check('C: unit_amount reconstruye la línea (err < 1e-6 €)', worst < 1e-6,
    `peor error ${worst.toExponential(2)}`);

  const sumBreakdown = breakdown.reduce(
    (s, b) => s + Math.round(b.base * 100) + Math.round(b.cuota * 100), 0);
  check('D: Σ(base+cuota) == total', sumBreakdown === invoiceCents,
    `desglose ${sumBreakdown} vs factura ${invoiceCents}`);

  console.log('    desglose:', breakdown
    .map((b) => `${b.rate}%: base ${b.base.toFixed(2)} + IVA ${b.cuota.toFixed(2)}`)
    .join(' · '));
  if (content.exception_unidentified) console.log('    (exception_unidentified: true)');
}

// --- Caso 1: cesta mixta 4/10/21 + envío, sin descuento ---
verify('cesta mixta con envío', {
  id: '11111111-aaaa-bbbb-cccc-000000000001',
  total: 4.99 + 1.30 + 2 * 2.20 + 3.49, // envío 4,99 + pan 1,30 + 2×leche 2,20 + detergente 3,49
  discount: 0,
  delivery_method: 'home_delivery',
  items: [
    { name: 'Pan de pueblo', price: 1.30, quantity: 1, tax_rate: 4 },
    { name: 'Leche entera 1L', price: 2.20, quantity: 2, tax_rate: 10 },
    { name: 'Detergente 1L', price: 3.49, quantity: 1, tax_rate: 21 },
  ],
});

// --- Caso 2: cupón que NO divide exacto (reparto por resto mayor) ---
verify('cupón 5,00 € sobre tres líneas desiguales', {
  id: '11111111-aaaa-bbbb-cccc-000000000002',
  total: 19.97 - 5 + 4.99, // subtotal 19,97 − cupón 5 + envío 4,99
  discount: 5,
  delivery_method: 'home_delivery',
  items: [
    { name: 'Aceite de oliva', price: 9.99, quantity: 1, tax_rate: 4 },
    { name: 'Galletas', price: 3.33, quantity: 2, tax_rate: 10 },
    { name: 'Pilas AA', price: 3.32, quantity: 1, tax_rate: 21 },
  ],
});

// --- Caso 3: recogida en tienda (sin envío), con regalo y sin tax_rate ---
verify('recogida en tienda, regalo y producto sin clasificar', {
  id: '11111111-aaaa-bbbb-cccc-000000000003',
  total: 12.50,
  discount: 0,
  delivery_method: 'store_pickup',
  items: [
    { name: 'Producto sin revisar', price: 12.50, quantity: 1 }, // sin tax_rate → 21 %
    { name: 'Cristal templado de REGALO', price: 0, quantity: 1, isGift: true },
  ],
});

// --- Caso 4: ticket > 400 € (minorista: exception_unidentified) ---
verify('ticket de 450 € (límite simplificada)', {
  id: '11111111-aaaa-bbbb-cccc-000000000004',
  total: 450.00,
  discount: 0,
  delivery_method: 'store_pickup',
  items: [
    { name: 'Compra grande', price: 4.50, quantity: 100, tax_rate: 21 },
  ],
});

// --- Caso 5: céntimos retorcidos (precio con redondeo puñetero) ---
verify('precios con céntimos retorcidos', {
  id: '11111111-aaaa-bbbb-cccc-000000000005',
  total: 0.99 * 3 + 1.01 * 7 + 4.99 - 1.23,
  discount: 1.23,
  delivery_method: 'home_delivery',
  items: [
    { name: 'Chuche A', price: 0.99, quantity: 3, tax_rate: 10 },
    { name: 'Chuche B', price: 1.01, quantity: 7, tax_rate: 21 },
  ],
});

console.log(failures === 0
  ? '\n✔ Todos los casos cuadran al céntimo.\n'
  : `\n✖ ${failures} comprobaciones fallidas.\n`);
process.exit(failures === 0 ? 0 : 1);
