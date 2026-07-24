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
  // cadenaPor recibe la IDEA entera (v251): la resuelve bot.js, que sabe de
  // rutas a medida, anclas de árbol e ideas madre.
  const rutaPor = (i) => (i.ancla === 'ug-buscar' ? ['打开 UnideGes', '商品 (F3)', '查商品'] : null);
  const lista = formatIdeaList(store, rutaPor);
  assert.match(lista, /促销比价/);
  assert.match(lista, /位置：打开 UnideGes → 商品 \(F3\) → 查商品/);
  const texto = store.exportarTexto(rutaPor);
  assert.match(texto, /位置：.*查商品 → \[新\] 促销比价/);
  // sin rutaPor tampoco casca
  assert.match(store.exportarTexto(), /搜完自动比价/);
});

test('crear vacía + editar (autoguardado del panel); las hechas no se editan', () => {
  const store = tienda();
  const vacia = store.crear({ ancla: 'ug-abrir' });
  assert.equal(vacia.texto, '');
  assert.equal(store.editar(vacia.id, { nombre: '一键重启' }).nombre, '一键重启');
  assert.equal(store.editar(vacia.id, { texto: '失败两次自动重启' }).texto, '失败两次自动重启');
  assert.equal(store.buscar(vacia.id).nombre, '一键重启'); // el otro campo no se toca
  store.marcarHecha(vacia.id);
  assert.equal(store.editar(vacia.id, { texto: 'x' }), null);
  assert.equal(store.editar(999, { texto: 'x' }), null);
  // export: las totalmente vacías no viajan
  store.crear({ ancla: 'ug-abrir' });
  assert.ok(!store.exportarTexto().includes('（只起了名字'));
});

test('ruta a medida: paradas de árbol y libres, y se puede borrar', () => {
  const store = tienda();
  const idea = store.crear({ ancla: 'ug-utilidades', nombre: 'x' });
  assert.equal(idea.ruta, undefined); // sin ruta a medida = automática

  store.editar(idea.id, { ruta: [
    { id: 'ug-utilidades', nombre: '工具 (F6)' },
    { nombre: '运营信息传递' },
    { nombre: '  ' },                       // vacía: se descarta
    { nombre: 'x'.repeat(80), id: 'y' }     // se recorta a 40
  ] });
  const r = store.buscar(idea.id).ruta;
  assert.equal(r.length, 3);
  assert.deepEqual(r[0], { nombre: '工具 (F6)', id: 'ug-utilidades' });
  assert.deepEqual(r[1], { nombre: '运营信息传递' }); // libre, sin id
  assert.equal(r[2].nombre.length, 40);

  store.editar(idea.id, { ruta: [] }); // vaciar = volver a la automática
  assert.equal(store.buscar(idea.id).ruta, undefined);
});

test('ideas colgadas de ideas: hijas() y herencia al borrar la madre', () => {
  const store = tienda();
  const madre = store.crear({ ancla: 'ug-utilidades', nombre: '大功能' });
  const hija = store.crear({ ancla: `idea:${madre.id}`, nombre: '子功能' });
  const nieta = store.crear({ ancla: `idea:${hija.id}`, nombre: '孙功能' });
  assert.deepEqual(store.hijas(madre.id).map((i) => i.id), [hija.id]);

  // al borrar la madre, la hija sube un escalón (hereda su ancla)
  store.borrar(madre.id);
  assert.equal(store.buscar(hija.id).ancla, 'ug-utilidades');
  assert.equal(store.buscar(nieta.id).ancla, `idea:${hija.id}`); // la nieta no se toca
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
