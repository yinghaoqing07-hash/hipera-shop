import test from 'node:test';
import assert from 'node:assert/strict';
import { MODULOS_UNIDEGES, matchAbrirUnideges, parseUnidegesCommand } from './unidegesMenu.js';

test('parseUnidegesCommand: menu, abrir y modulos con alias', () => {
  assert.deepEqual(parseUnidegesCommand('/unideges'), { accion: 'menu' });
  assert.deepEqual(parseUnidegesCommand('/ug'), { accion: 'menu' });
  assert.deepEqual(parseUnidegesCommand('/unideges abrir'), { accion: 'abrir' });
  assert.deepEqual(parseUnidegesCommand('/unideges articulos'), { accion: 'modulo', modulo: 'articulos' });
  assert.deepEqual(parseUnidegesCommand('/unideges Artículos'), { accion: 'modulo', modulo: 'articulos' });
  assert.deepEqual(parseUnidegesCommand('/ug albaranes'), { accion: 'modulo', modulo: 'albaranes' });
  assert.deepEqual(parseUnidegesCommand('/unideges 日结'), { accion: 'modulo', modulo: 'fin' });
  assert.deepEqual(parseUnidegesCommand('/unideges inicio'), { accion: 'modulo', modulo: 'inicio' });
  // argumento desconocido → menú de botones, no error
  assert.deepEqual(parseUnidegesCommand('/unideges nada'), { accion: 'menu' });
  assert.equal(parseUnidegesCommand('/pedido'), null);
  assert.equal(parseUnidegesCommand('unideges'), null);
});

test('solo fin de dia pide confirmacion (inicio entra directo desde v215)', () => {
  const peligrosos = Object.entries(MODULOS_UNIDEGES).filter(([, m]) => m.peligro).map(([id]) => id).sort();
  assert.deepEqual(peligrosos, ['fin']);
  assert.equal(MODULOS_UNIDEGES.articulos.tecla, 'F3');
  assert.equal(MODULOS_UNIDEGES.fin.tecla, 'F12');
});

test('matchAbrirUnideges: solo con mencion explicita de la app', () => {
  assert.equal(matchAbrirUnideges('打开unideges'), true);
  assert.equal(matchAbrirUnideges('帮我开一下 UnideGes'), true);
  assert.equal(matchAbrirUnideges('abre el unideges'), true);
  assert.equal(matchAbrirUnideges('unideges'), true);
  assert.equal(matchAbrirUnideges('打开促销'), false);
  assert.equal(matchAbrirUnideges('叫肉'), false);
  assert.equal(matchAbrirUnideges('unideges的图存哪了'), false);
});
