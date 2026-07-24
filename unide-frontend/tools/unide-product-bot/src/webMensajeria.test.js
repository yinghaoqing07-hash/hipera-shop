import test from 'node:test';
import assert from 'node:assert/strict';
import {
  tipoMensaje,
  debeOmitirPorFruta,
  dentroDeVentana,
  parseFechaMensaje,
  filtrarMensajes
} from './webMensajeria.js';

test('tipoMensaje distingue albarán, fichero y otros', () => {
  assert.equal(tipoMensaje('ALBARAN Nº 5189 de entrega'), 'albaran');
  assert.equal(tipoMensaje('Albarán 1234'), 'albaran');
  assert.equal(tipoMensaje('Fichero de precios semana 30'), 'fichero');
  assert.equal(tipoMensaje('archivo adjunto'), 'fichero');
  assert.equal(tipoMensaje('aviso general de la central'), 'otro');
  assert.equal(tipoMensaje(''), 'otro');
});

test('debeOmitirPorFruta solo frena ficheros de fruta', () => {
  assert.equal(debeOmitirPorFruta('fichero', 'Fichero precios FRUTA julio'), true);
  assert.equal(debeOmitirPorFruta('fichero', 'fichero de fruta y verdura'), true);
  assert.equal(debeOmitirPorFruta('albaran', 'Albarán fruta 5189'), false); // los albaranes SIEMPRE bajan
  assert.equal(debeOmitirPorFruta('fichero', 'Fichero precios carnicería'), false);
});

test('parseFechaMensaje entiende dd/mm/aaaa y aaaa-mm-dd', () => {
  assert.equal(parseFechaMensaje('23/07/2026 albarán 5189'), '2026-07-23');
  assert.equal(parseFechaMensaje('mensaje 1/7/26 corto'), '2026-07-01');
  assert.equal(parseFechaMensaje('aviso 2026-07-21 fichero'), '2026-07-21');
  assert.equal(parseFechaMensaje('sin fecha por ningún lado'), '');
});

test('dentroDeVentana cubre la última semana y rechaza lo viejo/futuro', () => {
  const hoy = '2026-07-24';
  assert.equal(dentroDeVentana('2026-07-24', hoy, 7), true);
  assert.equal(dentroDeVentana('2026-07-17', hoy, 7), true);
  assert.equal(dentroDeVentana('2026-07-16', hoy, 7), false);
  assert.equal(dentroDeVentana('2026-07-26', hoy, 7), false);
  assert.equal(dentroDeVentana('', hoy, 7), false);
});

test('filtrarMensajes aplica todas las reglas a la vez y ordena por fecha', () => {
  const rows = [
    { idx: 0, fields: { Asunto: 'ALBARAN 5189 entrega' }, cells: ['23/07/2026', 'ALBARAN 5189 entrega'] },
    { idx: 1, fields: { Asunto: 'Fichero precios FRUTA' }, cells: ['23/07/2026', 'Fichero precios FRUTA'] },
    { idx: 2, fields: { Asunto: 'Fichero limpieza' }, cells: ['18/07/2026', 'Fichero limpieza'] },
    { idx: 3, fields: { Asunto: 'ALBARAN 5100 viejo' }, cells: ['10/07/2026', 'ALBARAN 5100 viejo'] },
    { idx: 4, fields: { Asunto: 'Fichero sin fecha' }, cells: ['Fichero sin fecha'] },
    { idx: 5, fields: { Asunto: 'aviso general' }, cells: ['aviso general 22/07/2026'] },
    { idx: 6, fields: { Asunto: 'ALBARAN 5189 entrega' }, cells: ['23/07/2026', 'ALBARAN 5189 entrega'] } // duplicado
  ];
  const r = filtrarMensajes(rows, { hoyIso: '2026-07-24', dias: 7 });
  assert.equal(r.seleccionados.length, 2); // albarán 5189 + fichero limpieza
  assert.equal(r.seleccionados[0].fechaIso, '2026-07-23'); // reciente primero
  assert.equal(r.omitidosFruta.length, 1);
  assert.match(r.omitidosFruta[0].texto, /FRUTA/i);
  assert.equal(r.sinFecha.length, 1);
  assert.equal(r.fueraDeVentana, 1);
});
