import { defineConfig } from 'vitest/config';

/**
 * Las pruebas que miden tiempo, en una pasada aparte y una a la vez. Corridas
 * junto con el resto de la suite, las demás pruebas les quitan CPU y la
 * medición dice cuánto tardó la máquina ocupada, no la consulta. Cada una se
 * marca con `it.runIf(process.env['SIGBA_RENDIMIENTO'] === '1')`.
 */
export default defineConfig({
  test: {
    globals: true,
    root: './',
    globalSetup: ['./test/rol-de-aplicacion.ts'],
    include: ['test/stock.integracion.spec.ts'],
    testNamePattern: 'percentil 95',
    fileParallelism: false,
    env: { SIGBA_RENDIMIENTO: '1' },
  },
});
