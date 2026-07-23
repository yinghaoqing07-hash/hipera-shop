# Cómo se compila el panel de flujo

La página `/flujo` usa React Flow (`@xyflow/react`) + dagre, **precompilados**
en `web/flujo.bundle.js` y `web/flujo.bundle.css`. En los PC de la tienda no
hay build: el bot sirve esos dos archivos tal cual, sin CDN ni npm extra.

Si tocas `app.jsx` o `estilos.css`, recompila así (en cualquier máquina con
Node, NO hace falta hacerlo en la tienda):

```bash
mkdir -p /tmp/flujo-build && cd /tmp/flujo-build
npm init -y
npm install react@18 react-dom@18 @xyflow/react @dagrejs/dagre esbuild
cp <repo>/web/flujo/app.jsx <repo>/web/flujo/estilos.css .
./node_modules/.bin/esbuild app.jsx --bundle --minify --format=iife \
  --target=chrome100 --define:process.env.NODE_ENV='"production"' \
  --outfile=flujo.bundle.js
cp flujo.bundle.js flujo.bundle.css <repo>/web/
```

y commitea los dos `web/flujo.bundle.*` junto con el fuente.
