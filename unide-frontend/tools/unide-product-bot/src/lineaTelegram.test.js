import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { esConflictoTelegram, guardarLinea, leerLinea, nombreInstancia } from './lineaTelegram.js';

test('nombreInstancia usa el nombre configurado y cae al hostname', () => {
  assert.equal(nombreInstancia({ instancia: { nombre: '店里' } }), '店里');
  assert.equal(nombreInstancia({ instancia: { nombre: '  家里  ' } }), '家里');
  assert.equal(nombreInstancia({}), os.hostname());
  assert.equal(nombreInstancia({ instancia: { nombre: '' } }), os.hostname());
});

test('leerLinea/guardarLinea: persiste el standby y sobrevive a un fichero roto', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linea-'));
  const config = { logsDir: dir };
  // sin fichero: activa
  assert.equal(leerLinea(config).standby, false);
  guardarLinea(config, { standby: true, motivo: 'prueba' });
  const l = leerLinea(config);
  assert.equal(l.standby, true);
  assert.equal(l.motivo, 'prueba');
  assert.ok(l.desde); // fecha ISO
  guardarLinea(config, { standby: false });
  assert.equal(leerLinea(config).standby, false);
  // fichero corrupto: no revienta, se asume activa
  fs.writeFileSync(path.join(dir, 'telegram-linea.json'), '{roto');
  assert.equal(leerLinea(config).standby, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('esConflictoTelegram reconoce el Conflict de Telegram y nada más', () => {
  assert.equal(esConflictoTelegram(new Error('Conflict: terminated by other getUpdates request; make sure that only one bot instance is running')), true);
  assert.equal(esConflictoTelegram(new Error('409 Conflict en getUpdates')), true);
  assert.equal(esConflictoTelegram(new Error('fetch failed')), false);
  assert.equal(esConflictoTelegram(new Error('Conflict de merge en git')), false);
  assert.equal(esConflictoTelegram(null), false);
});
