// =====================================================================
// fiskaly — smoke test END-TO-END contra el sandbox (entorno TEST)
// =====================================================================
// Emite la factura VeriFactu de UN pedido real de la BD a través del
// flujo completo de producción (claim → numeración → PUT → persistencia)
// y muestra el resultado, incluida la URL de validación de AEAT.
//
// Uso:
//   node scripts/fiskaly-smoke.js              → elige el pedido más
//                                                reciente facturable
//   node scripts/fiskaly-smoke.js <order-id>   → pedido concreto
//
// Requiere FISKALY_API_KEY/SECRET/CLIENT_ID y SUPABASE_URL/SERVICE_KEY
// en backend/.env. Pensado para el entorno TEST: la factura se registra
// en el sandbox de fiskaly (sin transmisión real a AEAT).
// =====================================================================

import dotenv from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { createFiskalyService, isFiskalyEnabled } from '../services/fiskaly.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env') });
dotenv.config();

async function main() {
  if (!isFiskalyEnabled()) {
    console.error('Faltan FISKALY_API_KEY / FISKALY_API_SECRET / FISKALY_CLIENT_ID en backend/.env');
    process.exit(1);
  }
  if ((process.env.FISKALY_BASE_URL || 'test').includes('live')) {
    console.error('⚠ FISKALY_BASE_URL apunta a LIVE. Este smoke es para el sandbox; abortando.');
    process.exit(1);
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const fiskaly = createFiskalyService({
    supabase,
    reportError: (e, ctx) => console.error(ctx, '\n ', e?.message || e),
  });

  // Pedido objetivo: el pasado por argumento, o el más reciente facturable.
  let orderId = process.argv[2];
  if (!orderId) {
    const { data, error } = await supabase
      .from('orders')
      .select('id, total, status, payment_method, created_at, verifactu_status')
      .neq('status', 'Cancelado')
      .gt('total', 0)
      .in('verifactu_status', ['none', 'error'])
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) throw new Error('No se pudo buscar un pedido: ' + error.message);
    if (!data || data.length === 0) {
      console.error('No hay pedidos facturables (sin facturar, no cancelados, total > 0).');
      process.exit(1);
    }
    orderId = data[0].id;
  }

  const { data: order } = await supabase.from('orders').select('*').eq('id', orderId).single();
  if (!order) { console.error('Pedido no encontrado:', orderId); process.exit(1); }

  console.log('\n— fiskaly smoke (sandbox) —');
  console.log(`pedido   : ${order.id}`);
  console.log(`fecha    : ${order.created_at}`);
  console.log(`estado   : ${order.status} · ${order.payment_method}`);
  console.log(`total    : ${Number(order.total).toFixed(2)} € · descuento ${Number(order.discount || 0).toFixed(2)} €`);
  console.log(`líneas   : ${(order.items || []).length}`);
  console.log(`verifactu: ${order.verifactu_status}\n`);

  const t0 = Date.now();
  const result = await fiskaly.issueInvoiceForOrder(orderId, { force: true });
  const ms = Date.now() - t0;

  if (!result.ok) {
    console.error(`✖ Emisión fallida (${ms} ms):`, result.error || result.skipped);
    process.exit(1);
  }

  const { data: after } = await supabase
    .from('orders')
    .select('invoice_full_number, invoice_issued_at, verifactu_status, verifactu_id, verifactu_qr, tax_breakdown')
    .eq('id', orderId)
    .single();

  console.log(`✔ Factura emitida en ${ms} ms`);
  console.log(`  número    : ${after.invoice_full_number}`);
  console.log(`  estado    : ${after.verifactu_status} (registro: ${after.tax_breakdown?.registration})`);
  console.log(`  fiskaly id: ${after.verifactu_id}`);
  console.log(`  QR (AEAT) : ${after.verifactu_qr}`);
  console.log('  desglose  :', (after.tax_breakdown?.rates || [])
    .map((r) => `${r.rate}%: base ${r.base.toFixed(2)} + IVA ${r.cuota.toFixed(2)}`)
    .join(' · '));
  console.log('\nComprueba la factura en dashboard.fiskaly.com → Spain (SIGN ES) → Invoices.\n');
}

main().catch((e) => {
  console.error('\n✖ ' + (e?.message || e));
  process.exit(1);
});
