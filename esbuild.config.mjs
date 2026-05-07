import * as esbuild from 'esbuild';

const isProduction = process.env.NODE_ENV === 'production';

const sharedOptions = {
  bundle: true,
  platform: 'node',
  target: 'node16',
  format: 'cjs',
  external: ['vscode'],
  sourcemap: !isProduction,
  minify: isProduction,
  logLevel: 'info',
};

await Promise.all([
  esbuild.build({
    ...sharedOptions,
    entryPoints: ['client/src/extension.ts'],
    outfile: 'client/dist/extension.js',
  }),
  esbuild.build({
    ...sharedOptions,
    entryPoints: ['server/src/server.ts'],
    outfile: 'server/dist/server.js',
    // Prepend shebang so `enma-lsp` bin works when installed via npm
    banner: { js: '#!/usr/bin/env node' },
  }),
]);

console.log(`esbuild: built client/dist/extension.js and server/dist/server.js (${isProduction ? 'production' : 'dev'})`);
