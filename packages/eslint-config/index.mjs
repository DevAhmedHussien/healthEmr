import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

/** Shared flat config. Apps extend this and add their own env/globals. */
export default tseslint.config(
  // `.next-prod` alongside `.next`: the build script redirects Next's output
  // there via NEXT_DIST_DIR, and generated bundles are not ours to lint.
  {
    ignores: [
      'dist/**',
      '.next/**',
      '.next-prod/**',
      'node_modules/**',
      'coverage/**',
      '**/*.generated.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-floating-promises': 'off',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
);
