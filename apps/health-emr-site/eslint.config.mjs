import { FlatCompat } from '@eslint/eslintrc';
import base from '@health-emr/eslint-config';

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

export default [
  ...base,
  ...compat.extends('next/core-web-vitals'),
  { ignores: ['.next/**', '.next-prod/**', 'next-env.d.ts'] },
];
