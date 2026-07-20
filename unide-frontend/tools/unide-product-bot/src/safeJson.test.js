import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readJsonSafe, writeJsonAtomic } from './safeJson.js';

function tmpFile(nombre = 'estado.json') {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'safejson-')), nombre);
}

test('escribe, relee y deja .bak de la version anterior', () => {
  const file = tmpFile();
  writeJsonAtomic(file, { v: 1 });
  writeJsonAtomic(file, { v: 2 });
  assert.deepEqual(readJsonSafe(file, null), { v: 2 });
  assert.deepEqual(JSON.parse(fs.readFileSync(`${file}.bak`, 'utf8')), { v: 1 });
});

test('archivo inexistente devuelve el fallback', () => {
  assert.deepEqual(readJsonSafe(tmpFile('nada.json'), { defecto: true }), { defecto: true });
});

test('principal corrupto se recupera del .bak', () => {
  const file = tmpFile();
  writeJsonAtomic(file, { bueno: 1 });
  writeJsonAtomic(file, { bueno: 2 });
  fs.writeFileSync(file, '{ truncado por corte de l', 'utf8');
  assert.deepEqual(readJsonSafe(file, null), { bueno: 1 });
});

test('corrupto sin .bak usable devuelve el fallback sin lanzar', () => {
  const file = tmpFile();
  fs.writeFileSync(file, 'ni json ni nada', 'utf8');
  assert.deepEqual(readJsonSafe(file, []), []);
});

test('tolera BOM al frente del archivo', () => {
  const file = tmpFile();
  fs.writeFileSync(file, '﻿{"conBom":true}', 'utf8');
  assert.deepEqual(readJsonSafe(file, null), { conBom: true });
});
