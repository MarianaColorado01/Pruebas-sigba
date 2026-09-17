import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // 'prompt', no 'autoUpdate': la app no se recarga sola mientras un
      // operario captura una recepción. Se le avisa y él decide (ADR-10).
      registerType: 'prompt',
      injectRegister: null,
      manifest: {
        name: 'SIGBA · Banco de Alimentos',
        short_name: 'SIGBA',
        description: 'Recepción, salidas y beneficiarios del Banco de Alimentos',
        lang: 'es-CO',
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#1d4ed8',
        icons: [{ src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        // La API nunca se sirve desde caché: el stock desactualizado se marca
        // en la interfaz, no se disfraza de dato fresco (ADR-10).
        navigateFallbackDenylist: [/^\/api\//],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: { port: 5173 },
});
