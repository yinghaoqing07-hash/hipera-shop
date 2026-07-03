// Config propia del backend para que vitest NO herede el vite.config.js
// del frontend (que vive un directorio más arriba y usa plugins de React).
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/__tests__/**/*.test.js'],
    // Placeholders para que los módulos que crean el cliente de Supabase
    // al importarse (lib/supabase.js) puedan cargarse en tests sin .env.
    // Ningún test hace llamadas de red reales.
    env: {
      SUPABASE_URL: 'https://placeholder.supabase.co',
      SUPABASE_SERVICE_KEY: 'placeholder',
    },
  },
});
