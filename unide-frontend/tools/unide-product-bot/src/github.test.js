import test from 'node:test';
import assert from 'node:assert/strict';
import { abrirPrConArchivo, githubConfigured } from './github.js';

function conFetchFalso(rutas) {
  const llamadas = [];
  global.fetch = async (url, opts) => {
    const metodo = opts?.method || 'GET';
    const clave = `${metodo} ${String(url).replace('https://api.github.com', '')}`;
    llamadas.push({ clave, body: opts?.body ? JSON.parse(opts.body) : null, headers: opts?.headers });
    const match = Object.keys(rutas).find((k) => clave.startsWith(k));
    const r = match ? rutas[match] : { status: 404, body: { message: 'no mock' } };
    return { ok: r.status < 400, status: r.status, text: async () => JSON.stringify(r.body || {}) };
  };
  return llamadas;
}

test('githubConfigured exige token y repo', () => {
  const guardado = process.env.GITHUB_TOKEN;
  delete process.env.GITHUB_TOKEN; // aislar del entorno de CI
  try {
    assert.equal(githubConfigured({ github: { repo: 'a/b', token: 'x' } }), true);
    assert.equal(githubConfigured({ github: { repo: 'a/b' } }), false);
    assert.equal(githubConfigured({ github: { token: 'x' } }), false);
  } finally {
    if (guardado !== undefined) process.env.GITHUB_TOKEN = guardado;
  }
});

test('abrirPrConArchivo hace el flujo completo y devuelve la url', async () => {
  const llamadas = conFetchFalso({
    'GET /repos/o/r/git/ref/heads/main': { status: 200, body: { object: { sha: 'basesha' } } },
    'POST /repos/o/r/git/refs': { status: 201, body: {} },
    'GET /repos/o/r/contents/': { status: 200, body: { sha: 'filesha' } },
    'PUT /repos/o/r/contents/': { status: 200, body: { commit: { sha: 'c1' } } },
    'POST /repos/o/r/pulls': { status: 201, body: { html_url: 'https://github.com/o/r/pull/7', number: 7 } }
  });
  const config = { github: { repo: 'o/r', base: 'main', token: 'sk-token' } };
  const pr = await abrirPrConArchivo(config, {
    rutaRepo: 'ruta/al/archivo.ps1',
    contenidoBytes: Buffer.from('contenido'),
    tituloPr: 'fix',
    cuerpoPr: 'cuerpo',
    rama: 'autofix/x'
  });
  assert.equal(pr.url, 'https://github.com/o/r/pull/7');
  assert.equal(pr.number, 7);
  // creo la rama sobre la punta de main
  const crearRama = llamadas.find((l) => l.clave.startsWith('POST /repos/o/r/git/refs'));
  assert.equal(crearRama.body.ref, 'refs/heads/autofix/x');
  assert.equal(crearRama.body.sha, 'basesha');
  // sube el archivo con el sha existente y el contenido en base64
  const subir = llamadas.find((l) => l.clave.startsWith('PUT /repos/o/r/contents/'));
  assert.equal(subir.body.sha, 'filesha');
  assert.equal(Buffer.from(subir.body.content, 'base64').toString(), 'contenido');
  assert.equal(subir.body.branch, 'autofix/x');
  // el PR va contra main, no lo mergea
  const abrir = llamadas.find((l) => l.clave.startsWith('POST /repos/o/r/pulls'));
  assert.equal(abrir.body.base, 'main');
  assert.equal(abrir.body.head, 'autofix/x');
  assert.ok(!llamadas.some((l) => l.clave.includes('/merge')));
  // el token viaja en la cabecera, nunca en la url
  assert.ok(String(subir.headers.authorization).includes('sk-token'));
});

test('un fallo de la API se propaga con el status', async () => {
  conFetchFalso({ 'GET /repos/o/r/git/ref/heads/main': { status: 401, body: { message: 'Bad credentials' } } });
  const config = { github: { repo: 'o/r', token: 'malo' } };
  await assert.rejects(
    () => abrirPrConArchivo(config, { rutaRepo: 'x', contenidoBytes: Buffer.from('y'), tituloPr: 't', cuerpoPr: 'c', rama: 'z' }),
    /401.*Bad credentials/
  );
});
