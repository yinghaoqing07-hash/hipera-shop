// =====================================================================
// HIPERA — Agente de impresion de tickets (PC de la tienda)
// =====================================================================
// Bucle: sondea el backend cada POLL_INTERVAL_MS, imprime los pedidos
// confirmados y no impresos, hace sonar el zumbador y los marca como
// impresos. Disenado para NO caerse nunca: cualquier error se registra
// y el bucle continua (reintenta en el siguiente ciclo).
//
// Uso:
//   node index.js          -> arranca el agente (modo normal)
//   node index.js --test   -> imprime un ticket de PRUEBA y sale
//                             (no necesita backend; sirve para probar
//                              la impresora y el zumbador en la tienda)

import { config, validateConfig } from './lib/config.js';
import { PrintApi } from './lib/api.js';
import { PrintedStore } from './lib/store.js';
import { printRaw } from './lib/printer.js';
import { buildTicket } from './lib/escpos.js';

const IS_TEST = process.argv.includes('--test');

function log(...a) {
  console.log(`[${new Date().toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })}]`, ...a);
}
function logErr(...a) {
  console.error(`[${new Date().toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })}]`, ...a);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Pedido de ejemplo para el modo --test ---
function sampleOrder() {
  return {
    id: 'test1234abcd',
    created_at: new Date().toISOString(),
    confirmed_at: new Date().toISOString(),
    delivery_method: 'home_delivery',
    payment_method: 'Contra Reembolso',
    status: 'Pendiente de Pago',
    stripe_payment_intent: null,
    total: 27.43,
    address: 'Calle de la Prueba 123, 4ºB, 28880 Meco (Madrid)',
    phone: '600123456',
    note: 'Llamar al llegar al portal. Niño durmiendo.',
    items: [
      { name: 'Leche entera 1L', quantity: 3, price: 1.19 },
      { name: 'Pan de molde integral', quantity: 1, price: 1.85 },
      { name: 'Plátano de Canarias (kg)', quantity: 2, price: 1.95 },
      { name: 'Regalo: bolsa reutilizable', quantity: 1, price: 0, isGift: true },
    ],
  };
}

async function printOrder(order) {
  const buf = buildTicket(order, config);
  await printRaw(buf, config.printerName);
}

// --- Procesa la cola una vez ---
async function processQueue(api, store) {
  const pending = await api.getPending(10);
  if (pending.length === 0) return 0;

  let printed = 0;
  for (const order of pending) {
    try {
      if (store.has(order.id)) {
        // Ya impreso localmente pero quizas no marcado en el servidor:
        // reintentamos solo el marcado, sin reimprimir.
        await api.markPrinted(order.id).catch((e) => logErr('  re-marcar fallo:', e.message));
        continue;
      }
      await printOrder(order);
      store.add(order.id);                 // barrera local ANTES de marcar
      log(`🧾 Impreso pedido #${String(order.id).slice(0, 8).toUpperCase()}`);
      try {
        await api.markPrinted(order.id);
      } catch (e) {
        // Impreso OK pero no se pudo marcar: el registro local evitara
        // reimprimir; se reintentara el marcado en el proximo ciclo.
        logErr('  marcado en servidor fallo (se reintentara):', e.message);
      }
      printed++;
    } catch (e) {
      // Fallo de impresion (impresora offline, etc.): NO marcamos, se
      // reintenta en el proximo ciclo. Cortamos el lote para no spamear
      // errores si la impresora esta caida.
      logErr(`  no se pudo imprimir #${String(order.id).slice(0, 8)}:`, e.message);
      break;
    }
  }
  return printed;
}

async function mainLoop() {
  const problems = validateConfig();
  if (problems.length) {
    logErr('Configuracion incompleta:');
    for (const p of problems) logErr('  - ' + p);
    logErr('Edita el archivo .env y vuelve a arrancar.');
    process.exit(1);
  }

  const api = new PrintApi(config);
  const store = new PrintedStore();

  log('=============================================');
  log(' HIPERA — Agente de impresion en marcha');
  log(' Backend  :', config.backendUrl);
  log(' Impresora:', config.printerName);
  log(' Intervalo:', config.pollIntervalMs + ' ms');
  log('=============================================');

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const n = await processQueue(api, store);
      if (n > 0) log(`Ciclo OK — ${n} ticket(s) impreso(s).`);
    } catch (e) {
      // Error de red / backend: registrar y seguir (reintento en el
      // proximo ciclo). El agente nunca se cae por esto.
      logErr('Ciclo con error (se reintenta):', e.message);
    }
    await sleep(config.pollIntervalMs);
  }
}

async function runTest() {
  log('Modo PRUEBA: imprimiendo ticket de ejemplo en', config.printerName);
  try {
    await printOrder(sampleOrder());
    log('✅ Ticket de prueba enviado. Revisa la impresora (debe salir el ticket y sonar el zumbador).');
    process.exit(0);
  } catch (e) {
    logErr('❌ Fallo al imprimir:', e.message);
    logErr('Comprueba: nombre PRINTER_NAME en .env, impresora encendida y con papel.');
    process.exit(1);
  }
}

// Nunca dejamos que una promesa rechazada tumbe el proceso.
process.on('unhandledRejection', (r) => logErr('unhandledRejection:', r?.message || r));
process.on('uncaughtException', (e) => logErr('uncaughtException:', e?.message || e));

if (IS_TEST) {
  runTest();
} else {
  mainLoop();
}
