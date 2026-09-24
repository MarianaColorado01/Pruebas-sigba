import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    // Crea el rol sin privilegios de las pruebas de integración una sola vez.
    globalSetup: ['./test/rol-de-aplicacion.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.e2e-spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/**/index.ts', 'src/**/*.module.ts', 'src/main.ts'],
      reporter: ['text', 'lcov'],
      // RNF-02: la lógica de dominio se escribe con TDD, mínimo 70 % en services.
      thresholds: {
        'src/modules/*/services/**/*.ts': {
          statements: 70,
          branches: 70,
          functions: 70,
          lines: 70,
        },
      },
    },
  },
});
