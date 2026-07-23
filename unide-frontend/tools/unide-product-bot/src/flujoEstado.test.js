import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { abrirFlujoEstado } from './flujoEstado.js';

function configTemporal() {
  return { logsDir: fs.mkdtempSync(path.join(os.tmpdir(), 'flujo-est-')) };
}

test('registrar, resumen e historial (motor ndjson)', async () => {
  const config = configTemporal();
  const estado = await abrirFlujoEstado(config, null, { motor: 'ndjson' });
  assert.equal(estado.motor, 'ndjson');

  estado.iniciar('web-promos');
  assert.deepEqual(estado.corriendo(), ['web-promos']);
  await new Promise((r) => setTimeout(r, 15));
  estado.terminar('web-promos', { ok: true, captura: 'C:\\fotos\\promo.png' });
  estado.iniciar('web-promos');
  estado.terminar('web-promos', { ok: false, detalle: 'timeout esperando el grid' });
  assert.deepEqual(estado.corriendo(), []);

  const r = estado.resumen();
  assert.equal(r['web-promos'].total, 2);
  assert.equal(r['web-promos'].exitos, 1);
  assert.equal(r['web-promos'].ultimoEstado, 'error');
  assert.ok(r['web-promos'].duracionMediaMs >= 10, 'la media sale de la ejecución OK');
  assert.ok(r['web-promos'].ultimaVez);

  const h = estado.historial('web-promos', 10);
  assert.equal(h.length, 2);
  assert.equal(h[0].estado, 'error'); // más reciente primero
  assert.equal(h[0].detalle, 'timeout esperando el grid');
  assert.equal(h[1].captura, 'promo.png'); // solo basename, nunca la ruta entera
});

test('el ndjson persiste entre aperturas', async () => {
  const config = configTemporal();
  const uno = await abrirFlujoEstado(config, null, { motor: 'ndjson' });
  uno.iniciar('x');
  uno.terminar('x', { ok: true });
  const dos = await abrirFlujoEstado(config, null, { motor: 'ndjson' });
  assert.equal(dos.resumen().x.total, 1);
});

test('duracionMs explícito manda sobre el reloj', async () => {
  const estado = await abrirFlujoEstado(configTemporal(), null, { motor: 'ndjson' });
  estado.terminar('login', { ok: true, duracionMs: 4200 });
  assert.equal(estado.historial('login', 1)[0].duracionMs, 4200);
  assert.equal(estado.resumen().login.duracionMediaMs, 4200);
});

test('abandonar quita el corriendo sin escribir fila', async () => {
  const estado = await abrirFlujoEstado(configTemporal(), null, { motor: 'ndjson' });
  estado.iniciar('x');
  estado.abandonar('x');
  assert.deepEqual(estado.corriendo(), []);
  assert.equal(estado.resumen().x, undefined);
});

test('terminar sin nodo o sin iniciar no revienta', async () => {
  const estado = await abrirFlujoEstado(configTemporal(), null, { motor: 'ndjson' });
  estado.terminar('', { ok: true });
  estado.terminar('sin-iniciar', { ok: true });
  assert.equal(estado.resumen()['sin-iniciar'].duracionMediaMs, 0);
});

test('motor sqlite: mismo contrato si node:sqlite existe', async (t) => {
  let disponible = true;
  try { await import('node:sqlite'); } catch { disponible = false; }
  if (!disponible) { t.skip('este Node no trae node:sqlite'); return; }
  const config = configTemporal();
  const estado = await abrirFlujoEstado(config, null, {});
  assert.equal(estado.motor, 'sqlite');
  estado.iniciar('a');
  estado.terminar('a', { ok: true });
  estado.iniciar('a');
  estado.terminar('a', { ok: false, detalle: 'bum' });
  const r = estado.resumen();
  assert.equal(r.a.total, 2);
  assert.equal(r.a.exitos, 1);
  assert.equal(r.a.ultimoEstado, 'error');
  assert.equal(estado.historial('a', 5)[0].detalle, 'bum');
  estado.cerrar();
});
