import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyAutoTaskOverrides, listAutoTasks, setAutoTask } from './autoTasks.js';

function configDePrueba(logsDir) {
  return {
    logsDir,
    autoAdvisor: { enabled: true, time: '07:15' },
    arrival: { enabled: true, printTime: '08:30' },
    ordering: { enabled: true, reminderTime: '10:00' }
  };
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'auto-tareas-'));
}

test('listAutoTasks expone las tres tareas diarias con su hora', () => {
  const tareas = listAutoTasks(configDePrueba(tmpDir()));
  assert.equal(tareas.length, 3);
  const porId = Object.fromEntries(tareas.map((t) => [t.id, t]));
  assert.equal(porId.advisor.time, '07:15');
  assert.equal(porId.llegada.time, '08:30');
  assert.equal(porId.recordatorio.time, '10:00');
  assert.ok(tareas.every((t) => t.enabled === true && t.label && t.desc));
});

test('setAutoTask cambia hora en caliente y persiste para el siguiente arranque', () => {
  const dir = tmpDir();
  const config = configDePrueba(dir);
  const resultado = setAutoTask(config, 'advisor', { time: '6:05' });
  assert.equal(resultado.time, '06:05');
  assert.equal(config.autoAdvisor.time, '06:05');

  const configNueva = configDePrueba(dir);
  applyAutoTaskOverrides(configNueva);
  assert.equal(configNueva.autoAdvisor.time, '06:05');
  assert.equal(configNueva.arrival.printTime, '08:30');
});

test('setAutoTask apaga y enciende sin tocar la hora', () => {
  const dir = tmpDir();
  const config = configDePrueba(dir);
  setAutoTask(config, 'recordatorio', { enabled: false });
  assert.equal(config.ordering.enabled, false);
  assert.equal(config.ordering.reminderTime, '10:00');

  const configNueva = configDePrueba(dir);
  applyAutoTaskOverrides(configNueva);
  assert.equal(configNueva.ordering.enabled, false);

  setAutoTask(configNueva, 'recordatorio', { enabled: true, time: '09:45' });
  assert.equal(configNueva.ordering.enabled, true);
  assert.equal(configNueva.ordering.reminderTime, '09:45');
});

test('setAutoTask rechaza horas malas, ids desconocidos y cambios vacios', () => {
  const config = configDePrueba(tmpDir());
  assert.throws(() => setAutoTask(config, 'advisor', { time: '25:00' }), /时间格式/);
  assert.throws(() => setAutoTask(config, 'advisor', { time: 'pronto' }), /时间格式/);
  assert.throws(() => setAutoTask(config, 'nadaqueVer', { time: '08:00' }), /没有这个/);
  assert.throws(() => setAutoTask(config, 'advisor', {}), /没有要改/);
  assert.equal(config.autoAdvisor.time, '07:15');
});

test('overrides corruptos o con horas invalidas se ignoran', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'auto-tareas.json'), JSON.stringify({
    advisor: { time: '99:99', enabled: 'si' },
    llegada: { time: '9:00' },
    basura: { time: '11:00' }
  }));
  const config = configDePrueba(dir);
  applyAutoTaskOverrides(config);
  assert.equal(config.autoAdvisor.time, '07:15');
  assert.equal(config.autoAdvisor.enabled, true);
  assert.equal(config.arrival.printTime, '09:00');
});
