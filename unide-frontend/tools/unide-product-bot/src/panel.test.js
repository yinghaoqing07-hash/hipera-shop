import test from 'node:test';
import assert from 'node:assert/strict';
import { accesoPermitido } from './panel.js';

const H = (correo) => (correo ? { 'cf-access-authenticated-user-email': correo } : {});

test('puerta apagada (sin lista): todo pasa', () => {
  assert.equal(accesoPermitido(H(''), []), true);
  // aunque llegue con cabecera de Access, si no hay lista configurada NO se
  // deja entrar por el túnel (evita exponer si alguien monta Access sin lista)
  assert.equal(accesoPermitido(H('quien@sea.com'), []), false);
});

test('acceso local (sin cabecera) siempre permitido', () => {
  assert.equal(accesoPermitido(H(''), ['jefe@tienda.com']), true);
  assert.equal(accesoPermitido({}, ['jefe@tienda.com']), true);
});

test('acceso remoto: solo correos de la lista', () => {
  const lista = ['Jefe@Tienda.com', 'socio@tienda.com'];
  assert.equal(accesoPermitido(H('jefe@tienda.com'), lista), true); // case-insensitive
  assert.equal(accesoPermitido(H('  socio@tienda.com '), lista), true); // se recorta
  assert.equal(accesoPermitido(H('intruso@fuera.com'), lista), false);
});
