import test from 'node:test';
import assert from 'node:assert/strict';
import { MODULOS_UNIDEGES, argumentosUnideges, esFicheroLmanma, matchAbrirUnideges, parsePasos, parseUnidegesCommand } from './unidegesMenu.js';

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

test('submenus: alias, tecla del modulo padre y patron de busqueda', () => {
  assert.deepEqual(parseUnidegesCommand('/unideges 电子货单'), { accion: 'modulo', modulo: 'albaran_electronico' });
  assert.deepEqual(parseUnidegesCommand('/ug albaran_electronico'), { accion: 'modulo', modulo: 'albaran_electronico' });
  assert.deepEqual(parseUnidegesCommand('/ug lmanma'), { accion: 'modulo', modulo: 'lmanma' });
  assert.deepEqual(parseUnidegesCommand('/unideges fichero'), { accion: 'modulo', modulo: 'lmanma' });

  // el submenú se abre DENTRO de su módulo: hereda su tecla F
  assert.equal(MODULOS_UNIDEGES.albaran_electronico.tecla, MODULOS_UNIDEGES.albaranes.tecla); // F7
  assert.equal(MODULOS_UNIDEGES.lmanma.tecla, MODULOS_UNIDEGES.utilidades.tecla);             // F6
  // ninguno es peligroso: solo navegan y hacen captura
  assert.equal(MODULOS_UNIDEGES.albaran_electronico.peligro, false);
  assert.equal(MODULOS_UNIDEGES.lmanma.peligro, false);

  // el patrón tolera acentos escritos de cualquier forma (el PS lo usa como regex)
  const pat = new RegExp(MODULOS_UNIDEGES.albaran_electronico.submenu, 'i');
  assert.ok(pat.test('Albarán electrónico'));
  assert.ok(pat.test('Albaran electronico'));
  // El botón REAL se llama "LMMAMA" (visto en la tienda, 25/07); el patrón
  // acepta las dos grafías pero ANCLADO: "Act. márgenes LMmama" está en el
  // mismo menú y no debe casar.
  const patLm = new RegExp(MODULOS_UNIDEGES.lmanma.submenu, 'i');
  assert.ok(patLm.test('LMMAMA'));
  assert.ok(patLm.test('LMANMA'));
  assert.ok(patLm.test(' LMMAMA ')); // con espacios sueltos, como 'Inventariable '
  assert.ok(!patLm.test('Act. márgenes LMmama'));
  assert.ok(!patLm.test('Act. margenes LMmama'));
});

test('argumentosUnideges: fases de albaran y fichero de lmanma', () => {
  const config = { unideges: {}, desktop: { screenshotDir: 'shots' }, logsDir: 'logs' };
  const leer = argumentosUnideges(config, 'albaran', 'albaran_electronico', { fase: 'leer' }).args;
  assert.ok(leer.includes('-Fase') && leer.includes('leer'));
  assert.ok(leer.includes('F7'));
  const proc = argumentosUnideges(config, 'albaran', 'albaran_electronico', { fase: 'procesar' }).args;
  assert.ok(proc.includes('procesar'));
  // cualquier otra fase cae a 'leer' (mirar es gratis, procesar jamás por defecto)
  const rara = argumentosUnideges(config, 'albaran', 'albaran_electronico', { fase: 'x' }).args;
  assert.ok(rara.includes('leer') && !rara.includes('procesar'));

  const lm = argumentosUnideges(config, 'lmanma', 'lmanma', { archivo: 'C:\\Autocomm\\entradas\\Lmanma 1.txt' });
  assert.ok(lm.args.includes('-Archivo'));
  assert.ok(lm.args.includes('C:\\Autocomm\\entradas\\Lmanma 1.txt'));
  assert.ok(lm.args.includes('F6'));
  // sin archivo no hay acción: nunca se abre el diálogo a ciegas
  assert.ok(argumentosUnideges(config, 'lmanma', 'lmanma', {}).error);
  // el patrón de config manda sobre el del código
  const cfg2 = { unideges: { submenus: { lmanma: 'OTRO' } }, desktop: {}, logsDir: '' };
  assert.ok(argumentosUnideges(cfg2, 'lmanma', 'lmanma', { archivo: 'x.txt' }).args.includes('OTRO'));
});

test('esFicheroLmanma reconoce las grafías reales de la tienda', () => {
  assert.ok(esFicheroLmanma('LMANMA FRUTA S25 US A 2026.txt'));
  assert.ok(esFicheroLmanma('Lmanma%20%20Cambios%20de%20Precios.txt'));
  assert.ok(esFicheroLmanma('LMMAMA algo.txt'));
  assert.ok(!esFicheroLmanma('Ferrer%20T1'));
  assert.ok(!esFicheroLmanma('2026_07_25_01_50_32_MoveFELLog'));
  assert.ok(!esFicheroLmanma(''));
});

test('parsePasos lee las marcas de paso fino de la traza del PS', () => {
  const trace = [
    '+0s accion albaran fase procesar',
    '+1.2s PASO: alb-marcar ok ',
    '+2.4s PASO: alb-procesar ok',
    "+9.1s preparar: 'Codigos desconocidos' -> Aceptar (regla del dueno)",
    '+11s PASO: alb-desconocidos ok ',
    '+14.5s PASO: alb-guardar1 fail no encontre Guardar',
    '+20s PASO: alb-azules ok 3',
    'RESULT: step=albaran-F7 status=ok intentos=1 duration=22.5s msg=revision lista'
  ];
  const pasos = parsePasos(trace);
  assert.equal(pasos.length, 5);
  assert.deepEqual(pasos[0], { id: 'alb-marcar', ok: true, detalle: '' });
  assert.deepEqual(pasos[1], { id: 'alb-procesar', ok: true, detalle: '' });
  assert.deepEqual(pasos[3], { id: 'alb-guardar1', ok: false, detalle: 'no encontre Guardar' });
  assert.deepEqual(pasos[4], { id: 'alb-azules', ok: true, detalle: '3' });
  // ni la linea RESULT ni el texto normal se cuelan
  assert.ok(!pasos.some((p) => /RESULT|preparar/.test(p.id)));
  assert.deepEqual(parsePasos(null), []);
  assert.deepEqual(parsePasos(['PASO: sin-estado raro']), []);
});
