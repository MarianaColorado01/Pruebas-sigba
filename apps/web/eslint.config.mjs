import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import { base } from '@sigba/config/eslint.base';

export default [
  ...base(),
  {
    name: 'web/react',
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    name: 'web/shadcn',
    files: ['src/ui/**/*.tsx'],
    rules: {
      // Los componentes de shadcn exportan el componente y sus variantes desde
      // el mismo fichero. Es su forma, no un descuido: separarlas obligaría a
      // editar cada componente que llega del registro.
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    name: 'web/fronteras',
    files: ['src/features/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../*/**', '../../features/*/**'],
              message:
                'Una feature no entra en las carpetas de otra. Lo compartido va a ' +
                'src/shared, src/ui o packages/ui (Arquitectura 5.3).',
            },
          ],
        },
      ],
    },
  },
];
