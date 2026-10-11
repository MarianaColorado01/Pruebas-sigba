import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: './',
    setupFiles: ['./test/auth0-test-env.ts'],
    // `AppModule` se conecta como sigba_app: el rol tiene que existir con LOGIN.
    globalSetup: ['./test/rol-de-aplicacion.ts'],
    include: ['**/*.e2e-spec.ts'],
  },
});
