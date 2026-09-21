import { FlatCompat } from '@eslint/eslintrc';
import base from '@health-emr/eslint-config';

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

export default [
  ...base,
  // Brings in the React and react-hooks plugins, so hook rules are enforced
  // rather than referenced by suppressions that silently do nothing.
  ...compat.extends('next/core-web-vitals'),
  { ignores: ['.next/**', 'next-env.d.ts'] },
  {
    files: ['**/*.tsx'],
    rules: { '@typescript-eslint/no-explicit-any': 'warn' },
  },
];
