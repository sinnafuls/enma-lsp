module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
  },
  env: {
    node: true,
    es2020: true,
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  rules: {
    'no-unused-vars': 'off',
    '@typescript-eslint/no-unused-vars': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-empty-interface': 'off',
    '@typescript-eslint/no-empty-function': 'off',
    '@typescript-eslint/no-namespace': 'off',
    '@typescript-eslint/no-non-null-assertion': 'off',
    'no-empty': ['warn', { allowEmptyCatch: true }],
    'no-constant-condition': ['warn', { checkLoops: false }],
  },
  ignorePatterns: [
    'node_modules/',
    'client/dist/',
    'client/out/',
    'server/dist/',
    'server/out/',
    'client/legacy/',
    '*.js',
    '*.mjs',
    '*.cjs',
  ],
};
