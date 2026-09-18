import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Vite resuelve el alias @/* leyendo tsconfig.app.json. Un solo sitio donde vive.
  resolve: { tsconfigPaths: true },
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
        // Inter trae siete subconjuntos. El español vive entero en latin y
        // latin-ext; los demás solo serían 85 KB guardados en el celular del
        // operario para nada. Siguen en el build, así que si alguna vez hace
        // falta un glifo, el navegador lo pide con red (ADR-10).
        globIgnores: [
          '**/inter-cyrillic*.woff2',
          '**/inter-greek*.woff2',
          '**/inter-vietnamese*.woff2',
        ],
        // La API nunca se sirve desde caché: el stock desactualizado se marca
        // en la interfaz, no se disfraza de dato fresco (ADR-10).
        navigateFallbackDenylist: [/^\/api\//],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: { port: 5173 },
});
