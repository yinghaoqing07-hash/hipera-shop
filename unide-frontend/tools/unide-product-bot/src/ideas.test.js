import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { IdeaStore, formatIdeaList, matchIdeaNatural, parseIdeaCommand } from './ideas.js';

function tienda() {
  return new IdeaStore({ logsDir: fs.mkdtempSync(path.join(os.tmpdir(), 'ideas-')) }, null);
}

test('agregar, completar, borrar y persistencia', () => {
  const store = tienda();
  const a = store.agregar('给面板加一个天气卡片');
  const b = store.agregar('叫货单支持按周对比');
  assert.equal(a.id, 1);
  assert.equal(b.id, 2);
  assert.equal(store.pendientes().length, 2);

  assert.equal(store.marcarHecha(1).estado, 'hecha');
  assert.equal(store.marcarHecha(1), null); // ya estaba hecha
  assert.equal(store.pendientes().length, 1);
  assert.equal(store.hechas().length, 1);

  // reabrir desde disco: mismo contenido y el seq no se reutiliza
  const otra = new IdeaStore({ logsDir: path.dirname(store.file) }, null);
  assert.equal(otra.pendientes().length, 1);
  assert.equal(otra.agregar('tercera').id, 3);

  assert.equal(otra.borrar(2).id, 2);
  assert.equal(otra.borrar(99), null);
});

test('agregar vacío no crea nada', () => {
  const store = tienda();
  assert.equal(store.agregar('   '), null);
  assert.equal(store.pendientes().length, 0);
});

test('parseIdeaCommand', () => {
  assert.deepEqual(parseIdeaCommand('/idea 加个夜间模式'), { accion: 'agregar', texto: '加个夜间模式' });
  assert.deepEqual(parseIdeaCommand('/idea'), { accion: 'agregar', texto: '' });
  assert.deepEqual(parseIdeaCommand('/ideas'), { accion: 'listar' });
  assert.deepEqual(parseIdeaCommand('/ideas_exportar'), { accion: 'exportar' });
  assert.equal(parseIdeaCommand('/idear otra cosa'), null);
  assert.equal(parseIdeaCommand('hola'), null);
});

test('matchIdeaNatural', () => {
  assert.equal(matchIdeaNatural('记个想法：流程图加个全屏按钮'), '流程图加个全屏按钮');
  assert.equal(matchIdeaNatural('帮我存一个点子 促销到期前一天提醒我'), '促销到期前一天提醒我');
  assert.equal(matchIdeaNatural('我有个想法，改价前先截图对比'), '改价前先截图对比');
  assert.equal(matchIdeaNatural('记个想法'), '');
  assert.equal(matchIdeaNatural('帮我打一下152的清单'), null);
  assert.equal(matchIdeaNatural('想法很多的人'), null);
});

test('idea con ancla y nombre: se guardan y salen en lista y export', () => {
  const store = tienda();
  const idea = store.agregar('搜完自动比价', { ancla: 'ug-buscar', nombre: '促销比价' });
  assert.equal(idea.ancla, 'ug-buscar');
  assert.equal(idea.nombre, '促销比价');
  const rutaPor = (ancla) => (ancla === 'ug-buscar' ? ['打开 UnideGes', '商品 (F3)', '查商品'] : null);
  const lista = formatIdeaList(store, rutaPor);
  assert.match(lista, /促销比价/);
  assert.match(lista, /位置：打开 UnideGes → 商品 \(F3\) → 查商品/);
  const texto = store.exportarTexto(rutaPor);
  assert.match(texto, /位置：.*查商品 → \[新\] 促销比价/);
  // sin rutaPor tampoco casca
  assert.match(store.exportarTexto(), /搜完自动比价/);
});

test('exportarTexto lleva las pendientes numeradas', () => {
  const store = tienda();
  store.agregar('idea uno');
  store.agregar('idea dos');
  store.marcarHecha(1);
  const texto = store.exportarTexto();
  assert.match(texto, /功能想法/);
  assert.match(texto, /1\. \[#2/);
  assert.ok(!texto.includes('idea uno')); // las hechas no viajan
  assert.equal(tienda().exportarTexto(), '');
});

test('formatIdeaList', () => {
  const store = tienda();
  assert.match(formatIdeaList(store), /想法本还是空的/);
  store.agregar('probar');
  assert.match(formatIdeaList(store), /#1/);
  store.marcarHecha(1);
  assert.match(formatIdeaList(store), /已完成 1 条/);
});
