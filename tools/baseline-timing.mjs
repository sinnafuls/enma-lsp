// One-shot cold-parse timing script for Phase 1 baseline.
// Usage: node tools/baseline-timing.mjs
// Requires: server/dist/server.js (esbuild bundle) is NOT used here;
// instead we use ts-node via the compiled output.
// We measure via the real-corpus-probe pattern using compiled JS in server/out/.
// Since server/out/ may not exist, we use a direct require of the dist bundle
// and expose timing via a small wrapper.

import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const files = [
    path.join(root, 'samples', 'showcase.em'),
    path.join(root, '.omc', 'corpus', 'corpus_005.em'),
];

// Run ts-node timing inline for each file
for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    const lines = src.split('\n').length;
    const size = fs.statSync(f).size;
    const runs = 5;
    const script = `
process.env.ENMA_LSP_TEST = '1';
const { tokenize } = require('./server/src/compiler_tokenizer/tokenizer');
const { preprocessAfterTokenized } = require('./server/src/compiler_parser/parserPreprocess');
const { parseAfterPreprocessed } = require('./server/src/compiler_parser/parser');
const src = ${JSON.stringify(src)};
const uri = 'file:///timing-probe.em';
const times = [];
for (let i = 0; i < ${runs}; i++) {
    const t0 = performance.now();
    const tokens = tokenize(uri, src);
    const pre = preprocessAfterTokenized(tokens, { fileUri: uri });
    parseAfterPreprocessed(pre, { fileUri: uri });
    times.push(performance.now() - t0);
}
const median = times.slice().sort((a,b)=>a-b)[Math.floor(${runs}/2)];
console.log(JSON.stringify({ file: ${JSON.stringify(path.basename(f))}, lines: ${lines}, bytes: ${size}, median_ms: median.toFixed(3), all_ms: times.map(t=>t.toFixed(3)) }));
`;
    try {
        const result = execSync(`node -e "${script.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, {
            cwd: root,
            encoding: 'utf8',
            timeout: 30000,
        });
        console.log(result.trim());
    } catch (e) {
        console.error(`Failed for ${f}:`, e.message);
    }
}
