/**
 * Profile harness for enma-lsp cold-parse hot path.
 * Usage: node tools/profile-parse.mjs <file.em> [--warmup N] [--runs N]
 * Requires: server/out/ built via `cd server && npx tsc -b`
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

// Parse CLI args
const args = process.argv.slice(2);
let targetFile = null;
let warmupCount = 100;
let runCount = 1000;

for (let i = 0; i < args.length; i++) {
    if (args[i] === '--warmup' && args[i + 1]) { warmupCount = parseInt(args[++i]); }
    else if (args[i] === '--runs' && args[i + 1]) { runCount = parseInt(args[++i]); }
    else if (!args[i].startsWith('--')) { targetFile = args[i]; }
}

if (!targetFile) {
    console.error('Usage: node tools/profile-parse.mjs <file.em> [--warmup N] [--runs N]');
    process.exit(1);
}

const filePath = path.resolve(root, targetFile);
if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
}

const src = fs.readFileSync(filePath, 'utf8');
const lines = src.split('\n').length;
const bytes = fs.statSync(filePath).size;
const fileUri = `file:///${filePath.replace(/\\/g, '/')}`;

// Load compiled modules from server/out/
const require = createRequire(import.meta.url);
process.env.ENMA_LSP_TEST = '1';

const { tokenize } = require(path.join(root, 'server/out/compiler_tokenizer/tokenizer.js'));
const { preprocessAfterTokenized } = require(path.join(root, 'server/out/compiler_parser/parserPreprocess.js'));
const { parseAfterPreprocessed } = require(path.join(root, 'server/out/compiler_parser/parser.js'));

function runOnce() {
    const tokens = tokenize(fileUri, src);
    const pre = preprocessAfterTokenized(tokens, { fileUri });
    parseAfterPreprocessed(pre, { fileUri });
}

// Warmup
for (let i = 0; i < warmupCount; i++) runOnce();

// Measure
const times = new Array(runCount);
for (let i = 0; i < runCount; i++) {
    const t0 = process.hrtime.bigint();
    runOnce();
    const t1 = process.hrtime.bigint();
    times[i] = Number(t1 - t0) / 1_000_000; // ns → ms
}

// Stats
times.sort((a, b) => a - b);
const p50 = times[Math.floor(runCount * 0.50)];
const p99 = times[Math.floor(runCount * 0.99)];
const mean = times.reduce((s, v) => s + v, 0) / runCount;
const min = times[0];
const max = times[runCount - 1];

const label = path.basename(filePath);
console.log(`\n=== ${label} (${lines} lines, ${bytes} bytes) ===`);
console.log(`  warmup: ${warmupCount}  runs: ${runCount}`);
console.log(`  median (p50): ${p50.toFixed(3)} ms`);
console.log(`  p99:          ${p99.toFixed(3)} ms`);
console.log(`  mean:         ${mean.toFixed(3)} ms`);
console.log(`  min:          ${min.toFixed(3)} ms`);
console.log(`  max:          ${max.toFixed(3)} ms`);
