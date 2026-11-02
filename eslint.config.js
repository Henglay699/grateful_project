import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'apps/api/drizzle/**',
      'apps/web/public/**',
      // Vendored Bklit UI charts (MIT), kept as published.
      'apps/web/src/components/bklit/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
  {
    files: ['apps/api/**/*.ts', 'packages/**/*.ts', 'scripts/**/*.mjs', '*.cjs'],
    languageOptions: { globals: globals.node },
    // The API logs through pino; console is allowed only in CLI scripts (with a disable comment).
    rules: { 'no-console': 'error' },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  // CLI scripts print to the terminal.
  { files: ['scripts/**/*.mjs'], rules: { 'no-console': 'off' } },
  { files: ['*.cjs'], languageOptions: { sourceType: 'commonjs', globals: globals.node } },
  prettier,
);
