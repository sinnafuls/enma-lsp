// Production esbuild wrapper — sets NODE_ENV=production before running the config.
// Used by vscode:prepublish so vsce package always produces a minified, map-free bundle.
process.env.NODE_ENV = 'production';
await import('../esbuild.config.mjs');
