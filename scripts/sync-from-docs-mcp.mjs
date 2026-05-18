#!/usr/bin/env node
// sync-from-docs-mcp — merge declarations from a docs catalogue file into the
// bundled `.em.predefined` files.
//
// The catalogue is a JSON document written by the developer running the docs
// MCP servers (enma-docs + perception-docs). Keeping the catalogue as a
// checked-in JSON file (rather than running MCP queries inline) means:
//   - CI can verify the catalogue without an MCP server reachable
//   - the maintainer reviews every new symbol before it lands (the catalogue
//     diff IS the review surface)
//
// Usage:
//   node scripts/sync-from-docs-mcp.mjs                    # dry-run, print diff
//   node scripts/sync-from-docs-mcp.mjs --write            # mutate predefined files
//   node scripts/sync-from-docs-mcp.mjs --catalogue p.json # custom catalogue path
//
// Source-of-truth rule: append-only — the predefined files win against the
// catalogue. Identifiers already present in a predefined are NEVER overwritten;
// new identifiers are appended under a dated section header.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergePredefined } from './lib/predefinedMerge.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const PREDEFINED_FILES = {
    enma_stdlib: path.join(repoRoot, 'server', 'src', 'predefined', 'enma-stdlib.em.predefined'),
    perception:  path.join(repoRoot, 'server', 'src', 'predefined', 'perception.em.predefined'),
};

const DEFAULT_CATALOGUE = path.join(repoRoot, 'data', 'docs-catalogue.json');

function parseArgs(argv) {
    const args = argv.slice(2);
    const out = { cataloguePath: DEFAULT_CATALOGUE, write: false };
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '--write') out.write = true;
        else if (a === '--catalogue') out.cataloguePath = args[++i];
        else if (a === '--help' || a === '-h') out.help = true;
        else {
            process.stderr.write(`unknown argument: ${a}\n`);
            out.invalid = true;
        }
    }
    return out;
}

function printHelp() {
    process.stdout.write([
        'Usage: node scripts/sync-from-docs-mcp.mjs [--write] [--catalogue PATH]',
        '',
        'Merges declarations from data/docs-catalogue.json into the bundled',
        '.em.predefined files. Append-only — existing symbols are never overwritten.',
        '',
        'Flags:',
        '  --write             mutate the predefined files (default: dry-run)',
        '  --catalogue PATH    use a custom catalogue path',
        '  -h | --help         show this message',
        '',
        'See docs/docs-mcp-sync.md for the catalogue format and refresh workflow.',
    ].join('\n') + '\n');
}

function loadCatalogue(p) {
    if (!fs.existsSync(p)) {
        process.stderr.write(`sync-from-docs-mcp: catalogue not found at ${p}\n`);
        process.stderr.write(`Create one (see docs/docs-mcp-sync.md) or pass --catalogue.\n`);
        process.exit(2);
    }
    const raw = fs.readFileSync(p, 'utf8');
    let json;
    try { json = JSON.parse(raw); }
    catch (e) {
        process.stderr.write(`sync-from-docs-mcp: ${p} is not valid JSON: ${e.message}\n`);
        process.exit(2);
    }
    if (!Array.isArray(json.symbols)) {
        process.stderr.write(`sync-from-docs-mcp: ${p} must have a top-level "symbols" array\n`);
        process.exit(2);
    }
    return json;
}

function bucketByModule(symbols) {
    const out = new Map();
    for (const m of Object.keys(PREDEFINED_FILES)) out.set(m, []);
    for (const s of symbols) {
        if (!out.has(s.module)) {
            process.stderr.write(`sync-from-docs-mcp: ignoring symbol with unknown module '${s.module}': ${s.name}\n`);
            continue;
        }
        out.get(s.module).push(s);
    }
    return out;
}

function main(argv) {
    const args = parseArgs(argv);
    if (args.help) { printHelp(); return 0; }
    if (args.invalid) return 1;

    const catalogue = loadCatalogue(args.cataloguePath);
    const buckets = bucketByModule(catalogue.symbols);

    let totalAdded = 0;
    let totalSkipped = 0;
    for (const [module, syms] of buckets) {
        if (syms.length === 0) continue;
        const file = PREDEFINED_FILES[module];
        const existing = fs.readFileSync(file, 'utf8');
        const result = mergePredefined(existing, syms);
        totalAdded += result.added.length;
        totalSkipped += result.skipped.length;

        process.stdout.write(`\n--- ${path.relative(repoRoot, file)} ---\n`);
        process.stdout.write(`  parsed=${syms.length}  added=${result.added.length}  skipped=${result.skipped.length}\n`);
        for (const s of result.added) process.stdout.write(`  + ${s.kind.padEnd(8)} ${s.name}\n`);
        for (const s of result.skipped) process.stdout.write(`  - ${(s.symbol?.name ?? '<?>').padEnd(20)} (${s.reason})\n`);

        if (result.added.length === 0) continue;

        if (args.write) {
            fs.writeFileSync(file, result.nextContent);
            process.stdout.write(`  wrote ${path.relative(repoRoot, file)}\n`);
        }
    }

    process.stdout.write(`\nsync summary: +${totalAdded} new, ${totalSkipped} skipped\n`);
    if (!args.write && totalAdded > 0) {
        process.stdout.write(`Re-run with --write to mutate the predefined files.\n`);
    }
    return 0;
}

process.exit(main(process.argv));
