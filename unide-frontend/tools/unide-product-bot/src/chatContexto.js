import { AsyncLocalStorage } from 'node:async_hooks';

// chatId en contexto async (mismo patrón que el candado de webLock.js:14):
// handleUpdate envuelve el despacho con conChat(chatId, …) y cualquier capa
// profunda (conSondaFlujo, salidaFlujo…) lo lee con chatIdActual() SIN tener
// que pasar chatId por todos los parámetros. Fuera de un handler (tareas
// automáticas) devuelve null → los diagnósticos automáticos se racionan.
const contexto = new AsyncLocalStorage();

export function conChat(chatId, fn) {
  return contexto.run({ chatId: chatId ?? null }, fn);
}

export function chatIdActual() {
  return contexto.getStore()?.chatId ?? null;
}
