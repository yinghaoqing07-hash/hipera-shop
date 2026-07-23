import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cargarArbol, parseFlujoYaml } from './flujoArbol.js';

const EJEMPLO = `# comentario
nodos:
  - id: a
    nombre: Paso A
    grupo: "Grupo 1"
    match: ["打开 UnideGes", '搜商品']
  - id: b
    nombre: 步骤 B
edges:
  - [a, b]
`;

test('parseFlujoYaml entiende el subconjunto completo', () => {
  const r = parseFlujoYaml(EJEMPLO);
  assert.equal(r.nodos.length, 2);
  assert.deepEqual(r.nodos[0], { id: 'a', nombre: 'Paso A', grupo: 'Grupo 1', match: ['打开 UnideGes', '搜商品'] });
  assert.equal(r.nodos[1].nombre, '步骤 B');
  assert.deepEqual(r.edges, [['a', 'b']]);
});

test('parseFlujoYaml avisa con el número de línea', () => {
  assert.throws(() => parseFlujoYaml('nodos:\n  - id: a\n???'), /línea 3/);
  assert.throws(() => parseFlujoYaml('edges:\n  - a, b'), /línea 2/);
});

test('cargarArbol valida ids y edges, y mapea etiquetas por prefijo', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flujo-'));
  fs.writeFileSync(path.join(dir, 'flujo.yaml'), EJEMPLO + '  - [a, fantasma]\n', 'utf8');
  const arbol = cargarArbol({ __toolRoot: dir }, null);
  assert.equal(arbol.error, '');
  assert.equal(arbol.nodos.length, 2);
  assert.deepEqual(arbol.edges, [['a', 'b']]); // el edge al nodo fantasma se descarta
  assert.equal(arbol.nodoPorEtiqueta('打开 UnideGes'), 'a');
  assert.equal(arbol.nodoPorEtiqueta('搜商品 manzana golden'), 'a');
  assert.equal(arbol.nodoPorEtiqueta('otra cosa'), '');
});

test('cargarArbol nunca lanza: yaml roto → árbol vacío con error', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flujo-'));
  fs.writeFileSync(path.join(dir, 'flujo.yaml'), 'nodos:\n???bum', 'utf8');
  const roto = cargarArbol({ __toolRoot: dir }, null);
  assert.equal(roto.nodos.length, 0);
  assert.match(roto.error, /解析失败/);
  const sinArchivo = cargarArbol({ __toolRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'flujo-')) }, null);
  assert.match(sinArchivo.error, /flujo\.yaml/);
});

test('rutaHasta recorre los padres hasta la raíz', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flujo-'));
  fs.writeFileSync(path.join(dir, 'flujo.yaml'), [
    'nodos:',
    '  - id: a',
    '    nombre: A',
    '  - id: b',
    '    nombre: B',
    '  - id: c',
    '    nombre: C',
    'edges:',
    '  - [a, b]',
    '  - [b, c]',
    ''
  ].join('\n'), 'utf8');
  const arbol = cargarArbol({ __toolRoot: dir }, null);
  assert.deepEqual(arbol.rutaHasta('c'), ['A', 'B', 'C']);
  assert.deepEqual(arbol.rutaHasta('a'), ['A']);
  assert.equal(arbol.rutaHasta('zz'), null);
});

test('el flujo.yaml real del repo carga sin errores', () => {
  const arbol = cargarArbol({ __toolRoot: path.resolve(import.meta.dirname, '..') }, null);
  assert.equal(arbol.error, '');
  assert.ok(arbol.nodos.length >= 20, `esperaba >= 20 nodos, hay ${arbol.nodos.length}`);
  assert.ok(arbol.edges.length >= 10);
  assert.equal(arbol.nodoPorEtiqueta('打开 UnideGes'), 'ug-abrir');
  assert.equal(arbol.nodoPorEtiqueta('每日刷新促销'), 'web-promos');
  assert.equal(arbol.nodoPorEtiqueta('UnideGes → Artículos'), 'ug-articulos');
  // el nodo raíz de la web existe y las operaciones web cuelgan de él
  assert.equal(arbol.grupoDe('web-abrir'), '网页');
  assert.equal(arbol.rutaHasta('web-promos')[0], '打开 Unide 网页');
  assert.equal(arbol.rutaHasta('web-enviar')[0], '打开 Unide 网页');
  assert.ok(arbol.grupoDe('web-promos').startsWith('网页'));
});
