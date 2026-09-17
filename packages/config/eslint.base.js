import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

/** Rutas que ningún linter debe recorrer. */
export const ignorados = {
  ignores: [
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/coverage/**',
    '**/.vite/**',
    '**/dev-dist/**',
    '**/*.d.ts',
  ],
};

/**
 * Configuración común a todos los paquetes del monorepo.
 * Cada paquete la extiende y añade lo suyo.
 *
 * @param {{ tsconfigRootDir?: string }} opciones
 * @returns {import('eslint').Linter.Config[]}
 */
export function base({ tsconfigRootDir } = {}) {
  return tseslint.config(
    ignorados,
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
      languageOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        globals: { ...globals.node },
        ...(tsconfigRootDir
          ? { parserOptions: { projectService: true, tsconfigRootDir } }
          : {}),
      },
      rules: {
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
        ],
        '@typescript-eslint/no-explicit-any': 'error',
        'no-console': ['warn', { allow: ['warn', 'error'] }],
        eqeqeq: ['error', 'always'],
      },
    },
    prettier,
  );
}

export default base;
