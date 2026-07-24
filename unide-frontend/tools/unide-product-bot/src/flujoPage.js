// Cáscara HTML del panel de flujo (/flujo): la app de verdad es React Flow
// + dagre, precompilada en web/flujo.bundle.js (ver web/flujo/BUILD.md).
// Aquí solo el esqueleto con el fondo oscuro ya puesto para que no
// parpadee en blanco mientras carga el bundle.
export function renderFlujoPage(version) {
  const v = encodeURIComponent(String(version || ''));
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>流程图 · JARVIS</title>
<link rel="icon" href="/icons/jarvis-192.png">
<meta name="theme-color" content="#0d1117">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/icons/jarvis-180.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="JARVIS">
<link rel="stylesheet" href="/flujo.css?v=${v}">
<style>
  html, body { height: 100%; margin: 0; background: #0d1117; }
</style>
</head>
<body>
<div id="raiz"></div>
<script>
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
window.__FLUJO_VERSION = ${JSON.stringify(String(version || ''))};
</script>
<script src="/flujo.js?v=${v}"></script>
</body>
</html>`;
}
