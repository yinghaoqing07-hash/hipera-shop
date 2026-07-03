// Config propia del backend para que vitest NO herede el vite.config.js
// del frontend (que vive un directorio más arriba y usa plugins de React).
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/__tests__/**/*.test.js'],
  },
});
