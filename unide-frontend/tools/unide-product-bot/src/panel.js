import fs from 'node:fs';
import http from 'node:http';
import { basename as pathBasename, dirname as pathDirname, join as pathJoin } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderPanelPage } from './panelPage.js';

// Versión que corre la tienda, pintada en una esquina del panel. Manda el
// número de version.txt (se incrementa en cada release: v127, v128…), que
// es fácil de comparar de un vistazo; de apoyo va la fecha de compilación
// de este archivo (git archive fija el mtime al commit y el zip lo conserva).
let VERSION = '';
try {
  const propio = fileURLToPath(import.meta.url);
  const d = fs.statSync(propio).mtime;
  const fecha = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  let num = '';
  try { num = fs.readFileSync(pathJoin(pathDirname(propio), '..', 'version.txt'), 'utf8').trim(); } catch { /* sin numero */ }
  VERSION = num ? `v${num} · ${fecha}` : `v ${fecha}`;
} catch { /* sin versión */ }

// Panel de escritorio del bot: un mini servidor HTTP SOLO en 127.0.0.1 con
// una página de botones grandes para las acciones de cada día (imprimir la
// lista de llegada, refrescar promociones, análisis de ahorro…). Los botones
// despachan EXACTAMENTE los mismos comandos que se escribirían en Telegram
// (mismo código, mismas guardas, misma confirmación de escritura) y el
// resultado llega por Telegram como siempre — el panel es un mando a
// distancia con estado, no un segundo canal de salida. Sin dependencias:
// node:http y una página autocontenida. panel.cmd lo abre en el navegador.

export function startPanel(config, logger, hooks) {
  const port = Number(config.panel?.port) || 8765;
  // Cerrar la ventana del panel (la X) apaga también el bot: la página manda
  // un beacon 'adios' al cerrarse y aquí se programa el apagado con un margen
  // de gracia — si solo era una recarga, la página vuelve a pedir / o /chat
  // enseguida y el cierre se cancela.
  let cierrePendiente = null;
  const cancelarCierre = () => {
    if (cierrePendiente) {
      clearTimeout(cierrePendiente);
      cierrePendiente = null;
      logger?.info('panel window is back, shutdown cancelled');
    }
  };
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html' || req.url.startsWith('/chat'))) cancelarCierre();
      if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
        // no-store: que el navegador NUNCA sirva una página vieja de caché
        // después de actualizar el bot.
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        res.end(renderPage());
        return;
      }
      if (req.method === 'GET' && req.url === '/status') {
        const status = await hooks.status();
        // La página compara esta versión con la suya: si difieren, se
        // recarga sola (así el aviso de "actualización terminada" es real).
        status.version = VERSION;
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(status));
        return;
      }
      if (req.method === 'GET' && req.url.startsWith('/chat')) {
        const since = new URL(req.url, 'http://x').searchParams.get('since') || '0';
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(hooks.chat ? hooks.chat(since) : { seq: 0, messages: [] }));
        return;
      }
      if (req.method === 'POST' && req.url === '/callback') {
        const body = await readBody(req);
        let data = '';
        try { data = String(JSON.parse(body || '{}').data || '').trim(); } catch { /* json roto */ }
        if (!data) { res.writeHead(400, { 'content-type': 'application/json' }); res.end('{"ok":false}'); return; }
        logger?.info('panel callback', { data });
        const toast = hooks.callback ? await hooks.callback(data) : '';
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, toast }));
        return;
      }
      if (req.method === 'GET' && req.url.startsWith('/file/')) {
        // El id llega con ?s=<seq> para saltar la caché del navegador.
        // Con ?dl=1 el archivo se DESCARGA con su nombre real (los volcados
        // .html "para mandar a Claude" no se pueden leer en el lector).
        const filePath = hooks.file ? hooks.file(req.url.slice(6).split('?')[0]) : null;
        if (!filePath) { res.writeHead(404); res.end(); return; }
        const low = filePath.toLowerCase();
        const tipo = low.endsWith('.jpg') || low.endsWith('.jpeg') ? 'image/jpeg'
          : low.endsWith('.png') ? 'image/png'
          : low.endsWith('.csv') ? 'text/csv; charset=utf-8'
          : 'text/plain; charset=utf-8';
        const cabeceras = { 'content-type': tipo };
        let descarga = false;
        try { descarga = new URL(req.url, 'http://x').searchParams.get('dl') === '1'; } catch { /* sin query */ }
        if (descarga) {
          cabeceras['content-type'] = 'application/octet-stream';
          cabeceras['content-disposition'] = `attachment; filename="${pathBasename(filePath).replace(/"/g, '')}"`;
        }
        res.writeHead(200, cabeceras);
        fs.createReadStream(filePath).pipe(res);
        return;
      }
      if (req.method === 'GET' && req.url.startsWith('/vivo-foto')) {
        // La captura que la IA está analizando ahora mismo (fresca o 404).
        const foto = hooks.liveShot ? hooks.liveShot() : null;
        if (!foto || !fs.existsSync(foto.path)) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
        fs.createReadStream(foto.path).pipe(res);
        return;
      }
      if (req.method === 'GET' && req.url.startsWith('/detalle')) {
        // Detalle bajo demanda de las tarjetas 今日/促销: el panel lo abre
        // en el lector directamente, sin pasar por el chat.
        let que = '';
        try { que = String(new URL(req.url, 'http://x').searchParams.get('que') || ''); } catch { /* sin query */ }
        const detalle = hooks.panelDetalle ? hooks.panelDetalle(que) : null;
        if (!detalle) { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"ok":false}'); return; }
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        res.end(JSON.stringify(detalle));
        return;
      }
      if (req.method === 'GET' && (req.url === '/flujo' || req.url.startsWith('/flujo?'))) {
        // Panel de flujo: árbol de funciones con estado en vivo (React Flow).
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        res.end(hooks.flujo ? hooks.flujo.pagina(VERSION) : 'panel de flujo no disponible');
        return;
      }
      if (req.method === 'GET' && (req.url.startsWith('/flujo.js') || req.url.startsWith('/flujo.css'))) {
        // Bundle precompilado (web/flujo.bundle.*): sin CDN ni build en la
        // tienda. La página lo pide con ?v=<versión>, así que cachear vale.
        const js = req.url.startsWith('/flujo.js');
        const archivo = pathJoin(pathDirname(fileURLToPath(import.meta.url)), '..', 'web', js ? 'flujo.bundle.js' : 'flujo.bundle.css');
        if (!fs.existsSync(archivo)) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'content-type': js ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8', 'cache-control': 'max-age=3600' });
        fs.createReadStream(archivo).pipe(res);
        return;
      }
      if (req.method === 'GET' && req.url === '/api/flujo') {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        res.end(JSON.stringify(hooks.flujo ? hooks.flujo.grafo() : { nodos: [], edges: [] }));
        return;
      }
      if (req.method === 'GET' && req.url === '/api/flujo/ideas') {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        res.end(JSON.stringify(hooks.flujo?.ideas ? hooks.flujo.ideas() : { ideas: [] }));
        return;
      }
      if (req.method === 'GET' && req.url.startsWith('/api/flujo/paso')) {
        let id = '';
        try { id = String(new URL(req.url, 'http://x').searchParams.get('id') || ''); } catch { /* sin query */ }
        const detalle = id && hooks.flujo ? hooks.flujo.paso(id) : null;
        if (!detalle) { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"ok":false}'); return; }
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        res.end(JSON.stringify(detalle));
        return;
      }
      if (req.method === 'GET' && req.url.startsWith('/api/flujo/foto')) {
        let nombre = '';
        try { nombre = String(new URL(req.url, 'http://x').searchParams.get('f') || ''); } catch { /* sin query */ }
        const foto = nombre && hooks.flujo ? hooks.flujo.foto(nombre) : null;
        if (!foto || !fs.existsSync(foto)) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'content-type': foto.toLowerCase().endsWith('.jpg') || foto.toLowerCase().endsWith('.jpeg') ? 'image/jpeg' : 'image/png' });
        fs.createReadStream(foto).pipe(res);
        return;
      }
      if (req.method === 'GET' && req.url === '/comandos') {
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(hooks.commandList());
        return;
      }
      if (req.method === 'POST' && req.url === '/task/cancel') {
        const body = await readBody(req);
        let id = 0;
        try { id = Number(JSON.parse(body || '{}').id); } catch { /* json roto */ }
        if (!Number.isInteger(id) || id <= 0) { res.writeHead(400, { 'content-type': 'application/json' }); res.end('{"ok":false}'); return; }
        const toast = hooks.cancelTask ? await hooks.cancelTask(id) : '';
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, toast }));
        return;
      }
      if (req.method === 'POST' && req.url === '/auto_tarea') {
        // Tareas diarias automáticas: cambiar hora u on/off desde la
        // tarjeta 定时任务. Los errores de validación (hora mala) vuelven
        // como toast legible, no como 500.
        const body = await readBody(req);
        let id = '';
        const cambios = {};
        try {
          const p = JSON.parse(body || '{}');
          id = String(p.id || '').trim();
          if (p.enabled !== undefined) cambios.enabled = Boolean(p.enabled);
          if (p.time !== undefined) cambios.time = String(p.time);
        } catch { /* json roto */ }
        if (!id) { res.writeHead(400, { 'content-type': 'application/json' }); res.end('{"ok":false}'); return; }
        logger?.info('panel auto task', { id, cambios });
        let ok = true;
        let toast = '';
        try {
          toast = hooks.autoTarea ? await hooks.autoTarea(id, cambios) : '';
        } catch (error) {
          ok = false;
          toast = error.message;
        }
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok, toast }));
        return;
      }
      if (req.method === 'POST' && req.url === '/admin') {
        const body = await readBody(req);
        let accion = '';
        try { accion = String(JSON.parse(body || '{}').accion || '').trim(); } catch { /* json roto */ }
        if (accion !== 'stop' && accion !== 'update' && accion !== 'adios') { res.writeHead(400, { 'content-type': 'application/json' }); res.end('{"ok":false}'); return; }
        if (accion === 'adios') {
          if (!cierrePendiente && hooks.admin) {
            logger?.info('panel window closed, bot stops in 3s unless the page returns');
            cierrePendiente = setTimeout(() => { try { hooks.admin('stop'); } catch { /* ya saliendo */ } }, 3000);
          }
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end('{"ok":true}');
          return;
        }
        logger?.info('panel admin', { accion });
        const toast = hooks.admin ? await hooks.admin(accion) : '';
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, toast }));
        return;
      }
      if (req.method === 'POST' && req.url === '/subir') {
        // Subida de archivos desde el panel (p. ej. el export XLSX/CSV que
        // pide /diagnostico_productos — hasta ahora solo se podia mandar
        // por Telegram). Cuerpo binario crudo + nombre en cabecera.
        let nombre = 'archivo';
        try { nombre = decodeURIComponent(String(req.headers['x-nombre'] || 'archivo')); } catch { /* nombre raro */ }
        let cuerpo;
        try {
          cuerpo = await readBodyBuffer(req, 30 * 1024 * 1024);
        } catch (error) {
          res.writeHead(413, { 'content-type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: error.message }));
          return;
        }
        if (!cuerpo.length) { res.writeHead(400, { 'content-type': 'application/json' }); res.end('{"ok":false,"error":"archivo vacio"}'); return; }
        logger?.info('panel upload', { nombre, bytes: cuerpo.length });
        const toast = hooks.upload ? await hooks.upload(nombre, cuerpo) : '';
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, toast }));
        return;
      }
      if (req.method === 'POST' && req.url === '/run') {
        const body = await readBody(req);
        let cmd = '';
        try { cmd = String(JSON.parse(body || '{}').cmd || '').trim(); } catch { /* json roto */ }
        if (!cmd) { res.writeHead(400, { 'content-type': 'application/json' }); res.end('{"ok":false,"error":"cmd vacio"}'); return; }
        logger?.info('panel command', { cmd });
        // No se espera al resultado (una impresión o un análisis tardan
        // minutos): se despacha y la respuesta llega por Telegram.
        hooks.dispatch(cmd).catch((error) => logger?.error('panel dispatch failed', { cmd, error: error.message }));
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('no existe');
    } catch (error) {
      logger?.error('panel request failed', { url: req.url, error: error.message });
      try { res.writeHead(500, { 'content-type': 'application/json' }); res.end('{"ok":false}'); } catch { /* ya cerrado */ }
    }
  });
  server.on('error', (error) => {
    logger?.warn('panel server error', { error: error.message });
    // Puerto ocupado = casi seguro que ya hay OTRO bot corriendo. Dos bots
    // a la vez se pelean por los mensajes de Telegram: este proceso sale.
    if (error.code === 'EADDRINUSE') {
      logger?.error('panel port already in use: another bot is running, exiting to avoid a duplicate', { port });
      // Código 3 = "ya hay otro bot": el bucle vigilante de start-bot.cmd
      // NO debe relanzar este proceso (relanzaría el duplicado en bucle).
      setTimeout(() => process.exit(3), 300);
    }
  });
  // SOLO loopback: el panel no lleva autenticación, no debe salir del PC.
  server.listen(port, '127.0.0.1', () => logger?.info('panel listening', { url: `http://127.0.0.1:${port}`, version: VERSION }));
  return server;
}

// Cuerpo BINARIO con tope: para /subir (los readBody de texto corrompen
// bytes y tienen un tope pensado para JSON pequeño).
function readBodyBuffer(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const trozos = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) { reject(new Error('archivo demasiado grande (tope 30MB)')); req.destroy(); return; }
      trozos.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(trozos)));
    req.on('error', reject);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; if (data.length > 65536) { reject(new Error('body demasiado grande')); req.destroy(); } });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function renderPage() {
  return renderPanelPage(VERSION);
}
