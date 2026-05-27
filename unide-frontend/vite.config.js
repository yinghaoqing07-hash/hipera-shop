import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// =====================================================================
// Configuración Vite — code splitting y chunking manual
// =====================================================================
// La build por defecto produce un único bundle principal que crecía a
// ~1.3 MB (gzip 370 KB) por mezclar React, react-router, lucide-react,
// react-hot-toast, html2canvas, etc. junto al código de la app. Para
// el visitante nuevo en 4G eso eran ~3 s de descarga sólo del JS, sin
// contar parsing.
//
// Estrategia:
//   1. Páginas Admin / Login / Register se cargan con lazy() en
//      main.jsx → Rollup genera chunks separados automáticamente.
//   2. Las libs grandes y estables (React core, router, iconos) van
//      a chunks fijos con manualChunks. El navegador las cachea entre
//      despliegues y no las re-descarga aunque cambie la app.
//   3. supabase-js + react-hot-toast se quedan en el chunk principal
//      porque se usan desde el primer render (login state, toasts de
//      cookies) y separarlos no ahorra latencia perceptible.
//
// chunkSizeWarningLimit: subimos a 800 KB para no spamear warnings;
// el chunk de Admin (con jsPDF + html2canvas + qrcode) seguirá
// rondando ese tamaño y eso es esperado — sólo lo cargan los admins.
// =====================================================================
export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;

          // React core + scheduler + JSX runtime: van JUNTOS para evitar
          // el ciclo `vendor-react -> vendor -> vendor-react` que aparece
          // si scheduler queda en 'vendor' mientras react lo importa.
          // scheduler es interno de React y casi nunca se actualiza.
          if (
            id.includes('node_modules/react/') ||
            id.includes('node_modules/react-dom/') ||
            id.includes('node_modules/scheduler/') ||
            id.includes('node_modules/react-is/')
          ) {
            return 'vendor-react';
          }

          // Router: pequeño pero cargado en el primer paint.
          if (id.includes('react-router')) {
            return 'vendor-router';
          }

          // Iconos: lucide-react entrega un export por icono, Rollup
          // sólo incluye los usados, pero la lista usada por HIPERA
          // ronda ~60 iconos → vale la pena aislarlos para que el
          // cliente los cachee entre despliegues.
          if (id.includes('lucide-react')) {
            return 'vendor-icons';
          }

          // Cualquier otra dep → devolvemos undefined para que Rollup
          // decida automáticamente. Esto es CLAVE: las deps usadas
          // sólo por Admin (jspdf, html2canvas, qrcode...) se quedan
          // en el chunk de Admin en lugar de inflar el bundle
          // principal de la home. Si forzamos un 'vendor' fijo aquí,
          // perdemos esa ganancia.
          return undefined;
        },
      },
    },
  },
})
