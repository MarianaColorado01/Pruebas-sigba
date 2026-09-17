import { base } from '@sigba/config/eslint.base';

/**
 * Lint de lo que vive en la raíz y queda fuera de los workspaces: `scripts/`.
 * Cada paquete de `apps/` y `packages/` trae su propia configuración.
 */
export default [
  { ignores: ['apps/**', 'packages/**', 'docs/**', '.claude/**'] },
  ...base(),
  {
    name: 'raiz/scripts',
    files: ['scripts/**/*.mjs'],
    rules: {
      // Son herramientas de línea de comandos: imprimir es lo que hacen.
      'no-console': 'off',
    },
  },
];
