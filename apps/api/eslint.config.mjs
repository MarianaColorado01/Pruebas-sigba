import { base } from '@sigba/config/eslint.base';
import { fronteras } from '@sigba/config/eslint.fronteras';

export default [
  ...base(),

  // Las fronteras entre módulos (Arquitectura 5.2). Ver packages/config/eslint.fronteras.js.
  ...fronteras({ raiz: 'src' }),

  {
    name: 'api/nest',
    files: ['**/*.ts'],
    rules: {
      // Nest inyecta por decorador; los tipos de retorno explícitos no aportan aquí.
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-extraneous-class': 'off',
    },
  },
];
