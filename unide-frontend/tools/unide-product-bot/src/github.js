// Cliente minimo de la API REST de GitHub (fetch nativo, sin dependencias
// ni git instalado): abre un PR con el contenido de UN archivo. Lo usa el
// bucle de diagnostico para proponer su reparacion como PR revisable en
// vez de tocar el PC directamente. NUNCA toca main: solo crea una rama y
// abre el PR; el merge es SIEMPRE humano.

const API = 'https://api.github.com';

export function githubConfigured(config) {
  return Boolean((config?.github?.token || process.env.GITHUB_TOKEN) && config?.github?.repo);
}

function token(config) {
  return config?.github?.token || process.env.GITHUB_TOKEN;
}

async function gh(config, metodo, ruta, cuerpo) {
  const res = await fetch(API + ruta, {
    method: metodo,
    headers: {
      authorization: `Bearer ${token(config)}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'content-type': 'application/json',
      'user-agent': 'unide-product-bot'
    },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    signal: AbortSignal.timeout(30000)
  });
  const texto = await res.text();
  let data = {};
  try { data = texto ? JSON.parse(texto) : {}; } catch { data = { raw: texto }; }
  if (!res.ok) {
    // El token NUNCA se registra ni se devuelve.
    throw new Error(`GitHub ${metodo} ${ruta} ${res.status}: ${String(data.message || texto).slice(0, 200)}`);
  }
  return data;
}

// Abre un PR que cambia UN archivo. contenidoBytes = Buffer con el archivo
// tal cual va a quedar (BOM incluido si aplica). Devuelve { url, number, rama }.
export async function abrirPrConArchivo(config, { rutaRepo, contenidoBytes, tituloPr, cuerpoPr, rama }) {
  const repo = config.github.repo;
  const base = config.github.base || 'main';

  // 1. SHA de la punta de base (main).
  const ref = await gh(config, 'GET', `/repos/${repo}/git/ref/heads/${base}`);
  const baseSha = ref?.object?.sha;
  if (!baseSha) throw new Error('no pude leer la punta de ' + base);

  // 2. Crear la rama nueva apuntando ahi.
  await gh(config, 'POST', `/repos/${repo}/git/refs`, { ref: `refs/heads/${rama}`, sha: baseSha });

  // 3. SHA actual del archivo en esa rama (necesario para ACTUALIZARLO).
  let fileSha;
  try {
    const actual = await gh(config, 'GET', `/repos/${repo}/contents/${encodeURI(rutaRepo)}?ref=${rama}`);
    fileSha = actual?.sha;
  } catch { fileSha = undefined; /* archivo nuevo */ }

  // 4. Subir el contenido.
  await gh(config, 'PUT', `/repos/${repo}/contents/${encodeURI(rutaRepo)}`, {
    message: tituloPr,
    content: Buffer.from(contenidoBytes).toString('base64'),
    branch: rama,
    sha: fileSha
  });

  // 5. Abrir el PR (contra base; NUNCA se mergea aqui).
  const pr = await gh(config, 'POST', `/repos/${repo}/pulls`, { title: tituloPr, head: rama, base, body: cuerpoPr });
  return { url: pr.html_url, number: pr.number, rama };
}
