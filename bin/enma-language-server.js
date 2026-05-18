#!/usr/bin/env node
// Standalone launcher for the Enma language server.
//
// Lets editors and AI agents that aren't VS Code (Claude Code, Copilot CLI,
// OpenCode, Neovim, Helix, Cursor, Antigravity, Zed, plain LSP clients) drive
// the same server bundle the VSCode extension uses.
//
// Transport selection:
//   - The VSCode extension launches the bundle over Node IPC, so it always
//     supplies --node-ipc explicitly.
//   - Every other LSP client speaks stdio. If no transport flag is present,
//     auto-inject --stdio so the bundle picks the universally supported path.
//
// We require() the prebuilt esbuild bundle at ../server/dist/server.js. That
// bundle already starts with a shebang (added by esbuild banner) but Node
// silently ignores shebangs when require()'d, so loading it as a module here
// is safe.

'use strict';

const path = require('path');
const fs = require('fs');

const TRANSPORT_FLAGS = ['--stdio', '--node-ipc', '--socket'];
const hasTransport = process.argv.some(
    a => TRANSPORT_FLAGS.includes(a) || a.startsWith('--pipe='),
);
if (!hasTransport) {
    process.argv.push('--stdio');
}

const bundle = path.resolve(__dirname, '..', 'server', 'dist', 'server.js');
if (!fs.existsSync(bundle)) {
    process.stderr.write(
        `enma-language-server: missing build artifact at ${bundle}\n` +
        `Run \`npm install && npm run compile\` from the repo root, then try again.\n`,
    );
    process.exit(1);
}

require(bundle);
