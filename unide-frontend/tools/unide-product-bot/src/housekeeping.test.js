import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { limpiarArchivosViejos } from './housekeeping.js';

const DIA = 24 * 3600 * 1000;

function crear(dir, nombre, diasDeViejo, ahora) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, nombre);
  fs.writeFileSync(file, 'x');
  const t = new Date(ahora - diasDeViejo * DIA);
  fs.utimesSync(file, t, t);
  return file;
}

function configDePrueba(raiz) {
  return {
    __toolRoot: raiz,
    logsDir: path.join(raiz, 'logs'),
    desktop: { screenshotDir: path.join(raiz, 'screenshots') },
    promotions: { outputDir: 'promotions' }
  };
}

test('borra logs de mas de 30 dias y conserva los recientes', () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'hk-'));
  const ahora = Date.now();
  const viejo = crear(path.join(raiz, 'logs'), '2026-05-01.log', 45, ahora);
  const reciente = crear(path.join(raiz, 'logs'), '2026-07-18.log', 2, ahora);
  const r = limpiarArchivosViejos(configDePrueba(raiz), null, ahora);
  assert.equal(r.borrados, 1);
  assert.equal(fs.existsSync(viejo), false);
  assert.equal(fs.existsSync(reciente), true);
});

test('el archivo mas reciente de una carpeta se conserva aunque sea viejisimo', () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'hk-'));
  const ahora = Date.now();
  const unico = crear(path.join(raiz, 'promotions'), 'promos-enero.csv', 180, ahora);
  const masViejo = crear(path.join(raiz, 'promotions'), 'promos-diciembre.csv', 220, ahora);
  const r = limpiarArchivosViejos(configDePrueba(raiz), null, ahora);
  assert.equal(fs.existsSync(unico), true, 'el mas reciente sobrevive');
  assert.equal(fs.existsSync(masViejo), false);
  assert.equal(r.borrados, 1);
});

test('no toca subcarpetas (updates/backup-prev sobrevive)', () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'hk-'));
  const ahora = Date.now();
  const backup = path.join(raiz, 'updates', 'backup-prev');
  const guardado = crear(backup, 'bot.js', 90, ahora);
  crear(path.join(raiz, 'updates'), 'download-viejo.zip', 90, ahora);
  crear(path.join(raiz, 'updates'), 'download-nuevo.zip', 1, ahora);
  const r = limpiarArchivosViejos(configDePrueba(raiz), null, ahora);
  assert.equal(fs.existsSync(guardado), true);
  assert.equal(r.detalle.updates, 1);
});

test('carpetas inexistentes no fallan', () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'hk-'));
  const r = limpiarArchivosViejos(configDePrueba(raiz), null, Date.now());
  assert.equal(r.borrados, 0);
});
