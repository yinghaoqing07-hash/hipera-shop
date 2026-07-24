import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { aplicarFix, empaquetarEvidencia, esArchivoJs, esSoloPr, extraerArchivoCorregido, guardarExitoPaso, resumenSinCodigo, validarPropuesta } from './diagnostico.js';

function entorno() {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'diag-'));
  const config = {
    __toolRoot: raiz,
    logsDir: path.join(raiz, 'logs'),
    desktop: { screenshotDir: path.join(raiz, 'shots') }
  };
  fs.mkdirSync(path.join(raiz, 'desktop'), { recursive: true });
  fs.mkdirSync(config.logsDir, { recursive: true });
  return { raiz, config };
}

const SCRIPT_BASE = 'param(\n  [string]$Accion\n)\nfunction Emit { ConvertTo-Json @{} }\n' + '# relleno\n'.repeat(20);

test('extraerArchivoCorregido: bloque valido, lista blanca y sin bloque', () => {
  const conBloque = '【根因判断】焦点问题\n<<<ARCHIVO:unideges-menu.ps1>>>\ncontenido del script\n<<<FIN>>>\ndespues';
  const fix = extraerArchivoCorregido(conBloque);
  assert.equal(fix.archivo, 'desktop/unideges-menu.ps1');
  assert.equal(fix.contenido, 'contenido del script');

  const fuera = extraerArchivoCorregido('<<<ARCHIVO:config.local.json>>>\n{"llm":{}}\n<<<FIN>>>');
  assert.ok(fuera.rechazo && fuera.rechazo.includes('lista blanca'));

  assert.equal(extraerArchivoCorregido('solo diagnostico, sin codigo'), null);
});

test('resumenSinCodigo quita el bloque para el chat', () => {
  const conBloque = '【修复方案】cambiar espera\n<<<ARCHIVO:unideges-menu.ps1>>>\nxxx\n<<<FIN>>>';
  const resumen = resumenSinCodigo(conBloque);
  assert.ok(!resumen.includes('xxx'));
  assert.ok(resumen.includes('【修复方案】'));
});

test('aplicarFix: valida, respalda y reemplaza; el original sobrevive al rechazo', () => {
  const { config } = entorno();
  const destino = path.resolve(config.__toolRoot, 'desktop/unideges-menu.ps1');
  fs.writeFileSync(destino, SCRIPT_BASE, 'utf8');

  // rechazo por validador: el original queda intacto
  const malo = aplicarFix(config, { archivo: 'desktop/unideges-menu.ps1', contenido: SCRIPT_BASE + '# v2\n' },
    () => ({ ok: false, detalle: 'Token inesperado' }));
  assert.equal(malo.ok, false);
  assert.ok(malo.motivo.includes('语法验证'));
  assert.equal(fs.readFileSync(destino, 'utf8'), SCRIPT_BASE);

  // aplicado: backup + contenido nuevo con BOM
  const bueno = aplicarFix(config, { archivo: 'desktop/unideges-menu.ps1', contenido: SCRIPT_BASE + '# v2\n' },
    () => ({ ok: true }));
  assert.equal(bueno.ok, true);
  assert.ok(fs.existsSync(bueno.backup));
  const escrito = fs.readFileSync(destino, 'utf8');
  assert.ok(escrito.startsWith('﻿'));
  assert.ok(escrito.includes('# v2'));
  assert.equal(fs.readFileSync(bueno.backup, 'utf8'), SCRIPT_BASE);
});

test('aplicarFix rechaza tamaños absurdos y archivos fuera de lista', () => {
  const { config } = entorno();
  fs.writeFileSync(path.resolve(config.__toolRoot, 'desktop/unideges-menu.ps1'), SCRIPT_BASE, 'utf8');
  const chico = aplicarFix(config, { archivo: 'desktop/unideges-menu.ps1', contenido: 'param(' }, () => ({ ok: true }));
  assert.equal(chico.ok, false);
  const fuera = aplicarFix(config, { archivo: 'src/bot.js', contenido: SCRIPT_BASE }, () => ({ ok: true }));
  assert.equal(fuera.ok, false);
  assert.ok(fuera.motivo.includes('白名单'));
});

test('empaquetarEvidencia junta caja, exito previo, codigo y capturas', () => {
  const { config } = entorno();
  fs.writeFileSync(path.join(config.logsDir, 'caja-negra.txt'), '+1s paso uno\n+2s ERROR: fallo', 'utf8');
  fs.writeFileSync(path.resolve(config.__toolRoot, 'desktop/unideges-menu.ps1'), SCRIPT_BASE, 'utf8');
  guardarExitoPaso(config, 'abrir', ['+1s todo bien', 'RESULT: step=abrir status=ok']);
  fs.mkdirSync(config.desktop.screenshotDir, { recursive: true });
  fs.writeFileSync(path.join(config.desktop.screenshotDir, 'unideges-menu-login-intento-1-x.png'), 'png', 'utf8');

  const res = { trace: ['+3s login: captura unideges-menu-login-intento-1-x.png'], screenshot: null };
  const paquete = empaquetarEvidencia(config, { etiqueta: '打开 UnideGes', step: 'abrir', res });
  assert.ok(paquete.texto.includes('CAJA NEGRA'));
  assert.ok(paquete.texto.includes('ERROR: fallo'));
  assert.ok(paquete.texto.includes('EXITOSA DEL MISMO PASO'));
  assert.ok(paquete.texto.includes('param('));
  assert.equal(paquete.imagenes.length, 1);
  assert.ok(fs.existsSync(path.join(paquete.carpeta, 'evidencia.txt')));
});

// --- parches JS (24/07): node --check + import real + exports intactos ---

const JS_BASE = 'export function fetchCosa() { return 1; }\nexport const VERSION = 3;\n';

function entornoJs() {
  const { config } = entorno();
  const destino = path.resolve(config.__toolRoot, 'src/webMensajeria.js');
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, JS_BASE, 'utf8');
  return { config };
}

test('validarPropuesta js: acepta parche que conserva exports y carga', () => {
  const { config } = entornoJs();
  const v = validarPropuesta(config, { archivo: 'src/webMensajeria.js', contenido: JS_BASE + 'export function extra() { return 2; }\n' });
  assert.equal(v.ok, true, v.motivo);
  assert.ok(v.temp.endsWith('.js'));
});

test('validarPropuesta js: rechaza sintaxis rota, top-level que lanza y exports borrados', () => {
  const { config } = entornoJs();
  const sintaxis = validarPropuesta(config, { archivo: 'src/webMensajeria.js', contenido: JS_BASE + 'export function rota( {\n' });
  assert.equal(sintaxis.ok, false);
  assert.match(sintaxis.motivo, /import 失败/);

  const lanza = validarPropuesta(config, { archivo: 'src/webMensajeria.js', contenido: 'throw new Error("boom");\n' + JS_BASE });
  assert.equal(lanza.ok, false);
  assert.match(lanza.motivo, /import 失败/);

  const borrado = validarPropuesta(config, { archivo: 'src/webMensajeria.js', contenido: 'export function fetchCosa() { return 1; }\n' });
  assert.equal(borrado.ok, false);
  assert.match(borrado.motivo, /export/);
});

test('esSoloPr y esArchivoJs distinguen los niveles de riesgo', () => {
  assert.equal(esSoloPr('src/webBrowser.js'), true);
  assert.equal(esSoloPr('src/webOrder.js'), false);
  assert.equal(esArchivoJs('src/webOrder.js'), true);
  assert.equal(esArchivoJs('desktop/unideges-menu.ps1'), false);
});

test('aplicarFix js: marca esJs para avisar del reinicio', () => {
  const { config } = entornoJs();
  const r = aplicarFix(config, { archivo: 'src/webMensajeria.js', contenido: JS_BASE + '// mejora\n' });
  assert.equal(r.ok, true, r.motivo);
  assert.equal(r.esJs, true);
  assert.ok(fs.existsSync(r.backup));
});
