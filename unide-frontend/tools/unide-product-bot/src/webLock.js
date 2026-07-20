import { AsyncLocalStorage } from 'node:async_hooks';

// Candado GLOBAL del navegador: todos los flujos que conducen el Edge de
// Pedidos (rellenar pedido, promociones, ahorro, llegada, editar...) pasan
// por aquí. Solo UNO corre a la vez; el resto espera en cola FIFO. Sin
// esto, la tarea matinal y un /fruta a medias se pelean por la misma
// pestaña y el resultado es el clásico "se quedó colgado sin motivo".
//
// Reentrante: un flujo que ya tiene el candado puede llamar a otras
// funciones que también lo piden (p. ej. la tarea matinal llama a
// /ahorro_pedido) sin quedarse esperándose a sí misma — se detecta con
// AsyncLocalStorage y se ejecuta directamente.

const contexto = new AsyncLocalStorage();

let cola = Promise.resolve();
let actual = null; // { etiqueta, desde } del flujo que tiene el candado

// Qué está corriendo ahora mismo (para el mensaje "espera, estoy con X").
export function tareaWebActual() {
  if (!actual) return null;
  return { etiqueta: actual.etiqueta, minutos: Math.floor((Date.now() - actual.desde) / 60000) };
}

// Ejecuta fn con el candado del navegador. Si otro flujo lo tiene, espera
// su turno; `alEsperar(tarea)` se llama UNA vez si hay que esperar de
// verdad (para avisar al dueño). Los errores de fn salen tal cual; la cola
// nunca se atasca por un fallo anterior.
export async function conCandadoWeb(etiqueta, fn, alEsperar) {
  if (contexto.getStore()) return fn(); // ya somos el dueño del candado

  const ocupado = actual;
  if (ocupado && typeof alEsperar === 'function') {
    try { alEsperar(tareaWebActual()); } catch { /* avisar nunca rompe */ }
  }
  const anterior = cola;
  let soltar;
  cola = new Promise((resolve) => { soltar = resolve; });
  await anterior;
  actual = { etiqueta: String(etiqueta || 'tarea web'), desde: Date.now() };
  try {
    return await contexto.run({ etiqueta }, fn);
  } finally {
    actual = null;
    soltar();
  }
}
