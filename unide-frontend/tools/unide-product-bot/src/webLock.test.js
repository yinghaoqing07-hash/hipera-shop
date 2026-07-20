import test from 'node:test';
import assert from 'node:assert/strict';
import { conCandadoWeb, tareaWebActual } from './webLock.js';

const espera = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('dos tareas no se solapan: la segunda espera a la primera', async () => {
  const orden = [];
  const primera = conCandadoWeb('uno', async () => {
    orden.push('uno empieza');
    await espera(60);
    orden.push('uno acaba');
  });
  await espera(5);
  const segunda = conCandadoWeb('dos', async () => {
    orden.push('dos empieza');
  });
  await Promise.all([primera, segunda]);
  assert.deepEqual(orden, ['uno empieza', 'uno acaba', 'dos empieza']);
});

test('alEsperar se llama solo cuando hay que esperar, con la tarea actual', async () => {
  let avisado = null;
  const larga = conCandadoWeb('promociones', () => espera(60));
  await espera(5);
  assert.equal(tareaWebActual().etiqueta, 'promociones');
  await conCandadoWeb('pedido', () => espera(5), (t) => { avisado = t.etiqueta; });
  assert.equal(avisado, 'promociones');

  let avisadoLibre = false;
  await conCandadoWeb('libre', () => espera(1), () => { avisadoLibre = true; });
  assert.equal(avisadoLibre, false);
  await larga;
});

test('reentrante: un flujo con candado puede llamar a otro sin bloquearse', async () => {
  const resultado = await conCandadoWeb('padre', async () => {
    return conCandadoWeb('hijo', async () => 'anidado ok');
  });
  assert.equal(resultado, 'anidado ok');
});

test('un fallo no atasca la cola y el candado queda libre', async () => {
  await assert.rejects(
    () => conCandadoWeb('rota', async () => { throw new Error('boom'); }),
    /boom/
  );
  assert.equal(tareaWebActual(), null);
  const despues = await conCandadoWeb('siguiente', async () => 'sigue viva');
  assert.equal(despues, 'sigue viva');
});

test('FIFO: tres tareas encoladas salen en orden', async () => {
  const orden = [];
  const tareas = ['a', 'b', 'c'].map((nombre) =>
    conCandadoWeb(nombre, async () => { orden.push(nombre); await espera(10); }));
  await Promise.all(tareas);
  assert.deepEqual(orden, ['a', 'b', 'c']);
});
