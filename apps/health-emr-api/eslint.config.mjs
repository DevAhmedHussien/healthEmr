import base from '@health-emr/eslint-config';
export default [...base, { files: ['**/*.ts'], rules: { '@typescript-eslint/no-explicit-any': 'off' } }];
