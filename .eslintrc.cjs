module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
  ],
  rules: {
    'no-unused-vars': 'off',
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
