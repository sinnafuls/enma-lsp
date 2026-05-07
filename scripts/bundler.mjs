#!/usr/bin/env node
// Enma bundler — recursively inlines `#include "..."` directives into a single
// .em file ready for `enma::compile()` ingestion. Mirrors angel-lsp's bundler
// design.
//
// CLI:
//   node scripts/bundler.mjs <srcEntry.em> <out.em> [--strip]
//
// Options:
//   --strip   Remove line and block comments (string literals are preserved
//             verbatim, including any comment-like content).
//
// Behaviour:
//   - `#include "path"` is resolved relative to the includer's directory; if
//     the file is not found there, we retry against the entry's directory.
//   - `#pragma once` deduplicates: a file marked once is included exactly once.
//   - Cycle detection: if an active include chain re-enters a file, a warning
//     is emitted and the second occurrence is skipped (no infinite loop).
//   - Output starts with a header comment listing the source manifest.
//
// Exit codes:
//   0 on success, 1 on any unrecoverable error (missing entry, missing
//   include path with no fallback, etc.).

import * as fs from 'node:fs';
import * as path from 'node:path';

// --------------------------------------------------------------------------
// API entry — exported for the VSCode extension and the test harness.
// --------------------------------------------------------------------------

/**
 * @typedef {Object} BundleResult
 * @property {string} output        Bundled .em source.
 * @property {string[]} manifest    Absolute paths of every file included, in
 *                                  the order they were first inlined.
 * @property {string[]} warnings    Non-fatal issues (cycles, duplicate paths).
 * @property {string[]} errors      Fatal issues (missing include paths).
 */

/**
 * Bundle a .em entry file by recursively inlining its `#include` directives.
 *
 * @param {string} entryPath        Absolute or cwd-relative entry file path.
 * @param {{ strip?: boolean }} [opts]
 * @returns {BundleResult}
 */
export function bundle(entryPath, opts = {}) {
    const strip = opts.strip === true;
    const absEntry = path.resolve(entryPath);
    const entryDir = path.dirname(absEntry);

    /** @type {string[]} */
    const manifest = [];
    /** @type {string[]} */
    const warnings = [];
    /** @type {string[]} */
    const errors = [];
    const includedOnce = new Set();        // for `#pragma once` dedup
    const activeStack = new Set();         // cycle detection

    if (!fs.existsSync(absEntry)) {
        errors.push(`entry file not found: ${absEntry}`);
        return { output: '', manifest, warnings, errors };
    }

    const body = expandFile(absEntry, entryDir, manifest, warnings, errors,
                            includedOnce, activeStack, strip);

    const header = renderHeader(absEntry, manifest);
    return { output: header + body, manifest, warnings, errors };
}

// --------------------------------------------------------------------------
// Internals
// --------------------------------------------------------------------------

const INCLUDE_RE  = /^[ \t]*#include[ \t]+"([^"]+)"[ \t]*$/;
const PRAGMA_ONCE = /^[ \t]*#pragma[ \t]+once[ \t]*$/;

function expandFile(absPath, entryDir, manifest, warnings, errors,
                    includedOnce, activeStack, strip) {
    if (includedOnce.has(absPath)) {
        return '';                          // `#pragma once` honoured
    }
    if (activeStack.has(absPath)) {
        warnings.push(`circular include detected; skipping re-entry: ${absPath}`);
        return '';
    }

    let content;
    try {
        content = fs.readFileSync(absPath, 'utf8');
    } catch (e) {
        errors.push(`failed to read ${absPath}: ${(e && e.message) ? e.message : String(e)}`);
        return '';
    }

    if (manifest.indexOf(absPath) < 0) manifest.push(absPath);
    activeStack.add(absPath);

    const includerDir = path.dirname(absPath);
    const lines = content.split(/\r?\n/);
    /** @type {string[]} */
    const out = [];
    let pragmaOnce = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (PRAGMA_ONCE.test(line)) {
            pragmaOnce = true;
            // Drop the pragma line (it's been consumed).
            continue;
        }

        const m = line.match(INCLUDE_RE);
        if (m) {
            const rel = m[1];
            const resolved = resolveInclude(rel, includerDir, entryDir);
            if (!resolved) {
                errors.push(`unable to resolve #include "${rel}" from ${absPath}`);
                continue;
            }
            out.push(`// ---- begin include "${rel}" ----`);
            const inner = expandFile(resolved, entryDir, manifest, warnings, errors,
                                     includedOnce, activeStack, strip);
            out.push(inner);
            out.push(`// ---- end include "${rel}" ----`);
            continue;
        }

        out.push(line);
    }

    activeStack.delete(absPath);
    if (pragmaOnce) includedOnce.add(absPath);

    let body = out.join('\n');
    if (strip) body = stripComments(body);
    if (!body.endsWith('\n')) body += '\n';
    return body;
}

function resolveInclude(relPath, includerDir, entryDir) {
    const candidates = [
        path.resolve(includerDir, relPath),
        path.resolve(entryDir, relPath),
    ];
    for (const c of candidates) {
        if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
    }
    return null;
}

function renderHeader(absEntry, manifest) {
    const lines = [
        '// =============================================================================',
        `// Bundled by scripts/bundler.mjs — entry: ${absEntry}`,
        `// Sources (${manifest.length}):`,
        ...manifest.map(p => `//   - ${p}`),
        '// =============================================================================',
        '',
    ];
    return lines.join('\n');
}

/**
 * Remove `//…` line comments and `/* … *\/` block comments while preserving
 * string literals (single, double, and "raw" untouched). The scanner is a
 * minimal state machine — sufficient for Enma's lexical surface.
 *
 * @param {string} src
 */
export function stripComments(src) {
    let out = '';
    let i = 0;
    const n = src.length;
    while (i < n) {
        const c = src[i];
        const c2 = src[i + 1];

        // String literal — preserve verbatim, handling escapes.
        if (c === '"' || c === "'") {
            const quote = c;
            out += c;
            i++;
            while (i < n) {
                const k = src[i];
                if (k === '\\' && i + 1 < n) {
                    out += k + src[i + 1];
                    i += 2;
                    continue;
                }
                out += k;
                i++;
                if (k === quote) break;
                if (k === '\n') break;       // unterminated string — bail to next line
            }
            continue;
        }

        // Line comment — drop until newline (keep the newline).
        if (c === '/' && c2 === '/') {
            i += 2;
            while (i < n && src[i] !== '\n') i++;
            continue;
        }

        // Block comment — drop including the closing */.
        if (c === '/' && c2 === '*') {
            i += 2;
            while (i < n) {
                if (src[i] === '*' && src[i + 1] === '/') { i += 2; break; }
                i++;
            }
            continue;
        }

        out += c;
        i++;
    }
    return out;
}

// --------------------------------------------------------------------------
// CLI
// --------------------------------------------------------------------------

function main(argv) {
    const args = argv.slice(2);
    let strip = false;
    let jsonMode = false;
    /** @type {string[]} */
    const positional = [];
    for (const a of args) {
        if (a === '--strip') strip = true;
        else if (a === '--json') jsonMode = true;
        else if (a === '--help' || a === '-h') {
            console.log(`Usage: node scripts/bundler.mjs <srcEntry.em> <out.em> [--strip] [--json]`);
            process.exit(0);
        } else positional.push(a);
    }

    // --json mode: bundle <src> and emit BundleResult as JSON to stdout (used
    // by the unit tests which can't ESM-import the bundler under ts-node).
    if (jsonMode) {
        if (positional.length < 1) {
            console.error('--json requires <srcEntry.em>');
            process.exit(1);
        }
        const result = bundle(positional[0], { strip });
        process.stdout.write(JSON.stringify(result));
        process.exit(0);
    }

    if (positional.length < 2) {
        console.error(`Usage: node scripts/bundler.mjs <srcEntry.em> <out.em> [--strip]`);
        process.exit(1);
    }
    const [src, dst] = positional;
    const result = bundle(src, { strip });

    for (const w of result.warnings) console.warn(`[bundler] warning: ${w}`);
    for (const e of result.errors)   console.error(`[bundler] error:   ${e}`);

    if (result.errors.length > 0) {
        process.exit(1);
    }

    fs.mkdirSync(path.dirname(path.resolve(dst)), { recursive: true });
    fs.writeFileSync(path.resolve(dst), result.output, 'utf8');
    console.log(
        `[bundler] wrote ${path.resolve(dst)} ` +
        `(${result.manifest.length} source(s)${strip ? ', stripped' : ''})`,
    );
}

// Detect direct CLI invocation in an ESM-friendly way.
const _argv1 = process.argv[1] || '';
if (_argv1 && (
    import.meta.url.endsWith(path.basename(_argv1)) ||
    import.meta.url.includes(_argv1.replace(/\\/g, '/'))
)) {
    main(process.argv);
}
