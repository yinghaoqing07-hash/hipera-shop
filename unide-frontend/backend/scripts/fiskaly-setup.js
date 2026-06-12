// =====================================================================
// fiskaly SIGN ES — setup one-shot del entorno (TEST o LIVE)
// =====================================================================
// Crea, en este orden e idempotentemente:
//   1) taxpayer  (datos fiscales de QIANG GUO, S.L. — de invoicing.js)
//   2) signer    (dispositivo de firma; certificado gestionado por fiskaly)
//   3) client    (dispositivo emisor: la web hipera.es)
// y al final imprime las variables de entorno que hay que copiar al
// backend/.env (local) o a Railway (producción).
//
// Uso:
//   1. Crear cuenta gratuita en https://dashboard.fiskaly.com
//   2. Crear una organización GESTIONADA (managed) para el taxpayer y,
//      dentro de ella, una API key de TEST (Settings → API Keys)
//   3. Añadir a backend/.env:
//        FISKALY_API_KEY=test_...
//        FISKALY_API_SECRET=...
//   4. cd backend && node scripts/fiskaly-setup.js
//   5. Copiar el FISKALY_CLIENT_ID impreso a backend/.env
//
// Re-ejecutar es seguro: taxpayer/signer/client son PUT idempotentes
// (los uuid de signer y client se conservan en fiskaly-setup.local.json
// para no crear dispositivos nuevos en cada ejecución).
// =====================================================================

import dotenv from 'dotenv';
import { randomUUID } from 'crypto';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { COMPANY } from '../services/invoicing.js';
import { fiskalyFetch } from '../services/fiskaly.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env') });
dotenv.config(); // fallback al cwd

// Los uuid de los dispositivos se conservan entre ejecuciones para que el
// script sea idempotente. Archivo LOCAL, no se commitea (gitignore).
const STATE_FILE = join(__dirname, 'fiskaly-setup.local.json');

function loadState() {
  try {
    if (existsSync(STATE_FILE)) return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  } catch { /* estado corrupto → regenerar */ }
  return {};
}

async function expectOk(resp, what) {
  if (resp.ok) return resp.json();
  const body = await resp.text().catch(() => '');
  throw new Error(`${what} falló: HTTP ${resp.status} ${body.slice(0, 500)}`);
}

async function main() {
  if (!process.env.FISKALY_API_KEY || !process.env.FISKALY_API_SECRET) {
    console.error('Faltan FISKALY_API_KEY / FISKALY_API_SECRET en backend/.env');
    console.error('Créalas en https://dashboard.fiskaly.com (organización gestionada → Settings → API Keys).');
    process.exit(1);
  }

  const env = (process.env.FISKALY_BASE_URL || 'test').includes('live') ? 'LIVE' : 'TEST';
  console.log(`\n— fiskaly SIGN ES setup (entorno ${env}) —\n`);

  // 1) Taxpayer (una vez por organización gestionada). PUT idempotente.
  console.log(`1/3 taxpayer  → ${COMPANY.name} (${COMPANY.nif})`);
  const tp = await fiskalyFetch('/taxpayer', {
    method: 'PUT',
    body: {
      content: {
        issuer: {
          legal_name: COMPANY.name,
          tax_number: COMPANY.nif,
        },
        territory: 'SPAIN_OTHER', // Madrid → régimen VeriFactu (no foral)
      },
    },
  });
  // 409 = ya existe con los mismos datos → seguimos.
  if (tp.status === 409) {
    console.log('    ya existía (ok)');
  } else {
    await expectOk(tp, 'createTaxpayer');
    console.log('    creado');
  }

  // 2) Signer (certificado gestionado por fiskaly → body vacío).
  const state = loadState();
  state.signer_id = state.signer_id || randomUUID();
  console.log(`2/3 signer    → ${state.signer_id}`);
  const sg = await fiskalyFetch(`/signers/${state.signer_id}`, {
    method: 'PUT',
    body: {},
  });
  if (sg.status === 409) {
    console.log('    ya existía (ok)');
  } else {
    await expectOk(sg, 'createSigner');
    console.log('    creado');
  }

  // 3) Client (la web como dispositivo emisor, ligado al signer).
  state.client_id = state.client_id || randomUUID();
  console.log(`3/3 client    → ${state.client_id}`);
  const cl = await fiskalyFetch(`/clients/${state.client_id}`, {
    method: 'PUT',
    body: { content: { signer_id: state.signer_id } },
  });
  if (cl.status === 409) {
    console.log('    ya existía (ok)');
  } else {
    await expectOk(cl, 'createClient');
    console.log('    creado');
  }

  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

  console.log('\n✔ Setup completo. Añade esto a backend/.env (o Railway):\n');
  console.log(`FISKALY_CLIENT_ID=${state.client_id}`);
  console.log('\n(FISKALY_API_KEY y FISKALY_API_SECRET ya los tienes; con las');
  console.log('tres variables presentes, el backend emite facturas al cobrar.)\n');
}

main().catch((e) => {
  console.error('\n✖ ' + (e?.message || e));
  process.exit(1);
});
