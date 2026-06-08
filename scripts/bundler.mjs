#!/usr/bin/env node
// Enma bundler — concatenates every .em file under a source directory in
// dependency order. `#include "..."` directives only affect ordering; file
// membership is determined by directory walk, so every .em file under the
// source root ships regardless of whether it's reachable via #include.
//
// Mirrors angel-lsp-pcx's bundler design.
//
// CLI:
//   node scripts/bundler.mjs <srcDir> <out.em> [--strip] [--no-format] [--json]
//
// Options:
//   --strip      Remove line + block comments. String literals are preserved
//                verbatim, including any comment-like content.
//   --no-format  Skip whitespace normalization (off by default; format is on).
//   --json       Emit BundleResult as JSON to stdout — used by the unit tests
//                which can't ESM-import the bundler under ts-node.
//
// Behaviour:
//   - Every .em file under <srcDir> (recursive) is included in the output.
//   - `#include "path"` is parsed only to determine ordering: the included
//     file is emitted before the includer. Resolved relative to the includer's
//     directory; falls back to <srcDir> if not found.
//   - `#include` directives are stripped from the emitted output.
//   - Circular #include chains and missing #include targets are fatal errors.
//   - Output starts with a header comment listing the source manifest.
//
// Exit codes:
//   0 on success, 1 on any unrecoverable error.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

// Match #include directives anywhere in a file (line-anchored, multiline).
const INCLUDE_LINE_RE = /^[ \t]*#include[ \t]+"([^"]+)"[ \t]*\r?\n?/gm;

// --------------------------------------------------------------------------
// Public API
// --------------------------------------------------------------------------

/**
 * @typedef {Object} BundleResult
 * @property {string} output        Bundled .em source.
 * @property {string[]} manifest    Absolute paths of every file emitted, in
 *                                  dependency order.
 * @property {string[]} warnings    Non-fatal issues.
 * @property {string[]} errors      Fatal issues.
 * @property {Array<{bundledLine: number, originalUri: string, originalLine: number}>} sourceMap
 *   Maps bundled line numbers back to original source files. Each entry marks the
 *   first line (0-indexed) at which an original file starts in the bundled output.
 */

/**
 * Bundle every .em file under a source directory into a single .em source.
 *
 * @param {string} srcDir  Path to the directory containing .em sources.
 * @param {{ strip?: boolean, format?: boolean }} [opts]
 * @returns {BundleResult}
 */
export function bundle(srcDir, opts = {}) {
    const strip = opts.strip === true;
    const format = opts.format !== false;
    const absDir = path.resolve(srcDir);

    /** @type {string[]} */ const manifest = [];
    /** @type {string[]} */ const warnings = [];
    /** @type {string[]} */ const errors = [];
    /** @type {Array<{bundledLine: number, originalUri: string, originalLine: number}>} */
    const sourceMap = [];

    if (!fs.existsSync(absDir) || !fs.statSync(absDir).isDirectory()) {
        errors.push(`source directory not found: ${absDir}`);
        return { output: '', manifest, warnings, errors, sourceMap };
    }

    const files = collectEmFiles(absDir);
    if (files.length === 0) {
        warnings.push(`no .em files found under ${absDir}`);
        return { output: renderHeader(absDir, manifest), manifest, warnings, errors, sourceMap };
    }

    const ordered = topoSort(files, absDir, errors);
    if (errors.length > 0) {
        return { output: '', manifest, warnings, errors, sourceMap };
    }

    /** @type {string[]} */ const chunks = [];
    /** @type {Array<{bodyLine: number, file: string}>} */ const chunkMeta = [];
    let bodyLine = 0;

    for (const file of ordered) {
        manifest.push(file);
        let content = fs.readFileSync(file, 'utf8');

        // Strip #include lines wholesale — they served their purpose for ordering.
        content = content.replace(INCLUDE_LINE_RE, '');

        if (strip) {
            content = stripComments(content);
        } else {
            content = `// ── File: ${path.relative(absDir, file).replace(/\\/g, '/')} ──\n${content}`;
        }

        if (format) content = normalizeWhitespace(content);
        if (content.length > 0) {
            chunkMeta.push({ bodyLine, file });
            // Lines in this chunk = newlines + 1. Next chunk starts after this
            // chunk's lines plus the one blank separator line from '\n\n' joining.
            const lineCount = (content.match(/\n/g) || []).length + 1;
            bodyLine += lineCount + 1;
            chunks.push(content);
        }
    }

    let body = chunks.join('\n\n');
    if (format) body = normalizeWhitespace(body);

    const header = renderHeader(absDir, manifest);
    // header is the elements joined with '\n'; number of newlines = elements - 1
    // = (5 + manifest.length) - 1 = 4 + manifest.length.
    const headerLines = (header.match(/\n/g) || []).length;

    for (const { bodyLine: bl, file } of chunkMeta) {
        sourceMap.push({
            bundledLine: headerLines + bl,
            originalUri: pathToFileURL(file).href,
            originalLine: 0,
        });
    }

    return { output: header + body + '\n', manifest, warnings, errors, sourceMap };
}

// --------------------------------------------------------------------------
// File discovery
// --------------------------------------------------------------------------

function collectEmFiles(rootDir) {
    /** @type {string[]} */ const out = [];
    const stack = [rootDir];
    while (stack.length > 0) {
        const cur = stack.pop();
        let entries;
        try {
            entries = fs.readdirSync(cur, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const e of entries) {
            const p = path.join(cur, e.name);
            if (e.isDirectory()) stack.push(p);
            else if (e.isFile() && p.endsWith('.em')) out.push(p);
        }
    }
    return out.sort();
}

// --------------------------------------------------------------------------
// Topological sort by #include dependencies
// --------------------------------------------------------------------------

function parseIncludes(content) {
    /** @type {string[]} */ const out = [];
    const re = /^[ \t]*#include[ \t]+"([^"]+)"/gm;
    let m;
    while ((m = re.exec(content)) !== null) out.push(m[1]);
    return out;
}

function topoSort(files, srcDir, errors) {
    const visited = new Set();
    const onStack = new Set();
    const ordered = [];

    const visit = (file, chain) => {
        const norm = path.resolve(file);
        if (visited.has(norm)) return;
        if (onStack.has(norm)) {
            const path_str = [...chain, norm]
                .map(p => path.relative(srcDir, p).replace(/\\/g, '/'))
                .join(' -> ');
            errors.push(`circular #include detected: ${path_str}`);
            return;
        }
        if (!fs.existsSync(norm)) {
            const parent = chain[chain.length - 1];
            const where = parent
                ? ` (referenced from ${path.relative(srcDir, parent).replace(/\\/g, '/')})`
                : '';
            errors.push(`#include target not found: ${norm}${where}`);
            return;
        }

        onStack.add(norm);
        const content = fs.readFileSync(norm, 'utf8');
        const fileDir = path.dirname(norm);
        for (const rel of parseIncludes(content)) {
            const resolved = resolveInclude(rel, fileDir, srcDir);
            if (!resolved) {
                errors.push(`unable to resolve #include "${rel}" from ${path.relative(srcDir, norm).replace(/\\/g, '/')}`);
                continue;
            }
            visit(resolved, [...chain, norm]);
        }
        onStack.delete(norm);
        visited.add(norm);
        ordered.push(norm);
    };

    for (const f of files) visit(f, []);
    return ordered;
}

function resolveInclude(rel, includerDir, srcDir) {
    const candidates = [
        path.resolve(includerDir, rel),
        path.resolve(srcDir, rel),
    ];
    for (const c of candidates) {
        if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
    }
    return null;
}

// --------------------------------------------------------------------------
// Comment stripping — Enma-aware (preserves string literals)
// --------------------------------------------------------------------------

export function stripComments(src) {
    let out = '';
    let i = 0;
    const n = src.length;
    while (i < n) {
        const c = src[i];
        const c2 = src[i + 1];

        // Triple-quoted heredoc string: """..."""
        if (c === '"' && c2 === '"' && src[i + 2] === '"') {
            const end = src.indexOf('"""', i + 3);
            if (end === -1) { out += src.slice(i); break; }
            out += src.slice(i, end + 3);
            i = end + 3;
            continue;
        }

        // Regular string / char literal — preserve verbatim with escape handling.
        if (c === '"' || c === "'") {
            const quote = c;
            out += c;
            i++;
            while (i < n) {
                const k = src[i];
                if (k === '\\' && i + 1 < n) { out += k + src[i + 1]; i += 2; continue; }
                out += k;
                i++;
                if (k === quote) break;
                if (k === '\n') break;
            }
            continue;
        }

        // Line comment.
        if (c === '/' && c2 === '/') {
            while (i < n && src[i] !== '\n') i++;
            if (i < n && src[i] === '\n') { out += '\n'; i++; }
            continue;
        }

        // Block comment — preserve newlines for line-number fidelity.
        if (c === '/' && c2 === '*') {
            i += 2;
            while (i < n - 1) {
                if (src[i] === '*' && src[i + 1] === '/') { i += 2; break; }
                if (src[i] === '\n') out += '\n';
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
// Whitespace normalization
// --------------------------------------------------------------------------

function normalizeWhitespace(content) {
    const lines = content.split('\n');
    /** @type {string[]} */ const out = [];
    let blanks = 0;
    for (const line of lines) {
        const t = line.replace(/\s+$/, '');
        if (t.length === 0) {
            blanks++;
            if (blanks <= 2) out.push('');
        } else {
            blanks = 0;
            out.push(t);
        }
    }
    while (out.length > 0 && out[0] === '') out.shift();
    while (out.length > 0 && out[out.length - 1] === '') out.pop();
    return out.join('\n');
}

// --------------------------------------------------------------------------
// Header
// --------------------------------------------------------------------------

function renderHeader(srcDir, manifest) {
    const lines = [
        '// =============================================================================',
        `// Bundled by scripts/bundler.mjs — source dir: ${srcDir}`,
        `// Sources (${manifest.length}):`,
        ...manifest.map(p => `//   - ${path.relative(srcDir, p).replace(/\\/g, '/')}`),
        '// =============================================================================',
        '',
    ];
    return lines.join('\n');
}

// --------------------------------------------------------------------------
// CLI
// --------------------------------------------------------------------------

function main(argv) {
    const args = argv.slice(2);
    let strip = false;
    let format = true;
    let jsonMode = false;
    /** @type {string[]} */ const positional = [];
    for (const a of args) {
        if (a === '--strip') strip = true;
        else if (a === '--no-format') format = false;
        else if (a === '--json') jsonMode = true;
        else if (a === '--help' || a === '-h') {
            console.log(`Usage: node scripts/bundler.mjs <srcDir> <out.em> [--strip] [--no-format] [--json]`);
            process.exit(0);
        } else positional.push(a);
    }

    if (jsonMode) {
        if (positional.length < 1) {
            console.error('--json requires <srcDir>');
            process.exit(1);
        }
        const result = bundle(positional[0], { strip, format });
        process.stdout.write(JSON.stringify(result));
        process.exit(result.errors.length > 0 ? 1 : 0);
    }

    if (positional.length < 2) {
        console.error(`Usage: node scripts/bundler.mjs <srcDir> <out.em> [--strip] [--no-format]`);
        process.exit(1);
    }
    const [src, dst] = positional;
    const result = bundle(src, { strip, format });

    for (const w of result.warnings) console.warn(`[bundler] warning: ${w}`);
    for (const e of result.errors)   console.error(`[bundler] error:   ${e}`);

    if (result.errors.length > 0) process.exit(1);

    fs.mkdirSync(path.dirname(path.resolve(dst)), { recursive: true });
    fs.writeFileSync(path.resolve(dst), result.output, 'utf8');
    console.log(
        `[bundler] wrote ${path.resolve(dst)} ` +
        `(${result.manifest.length} source(s)${strip ? ', stripped' : ''})`,
    );
}

// Direct CLI invocation (ESM-friendly).
const _argv1 = process.argv[1] || '';
if (_argv1 && (
    import.meta.url.endsWith(path.basename(_argv1)) ||
    import.meta.url.includes(_argv1.replace(/\\/g, '/'))
)) {
    main(process.argv);
}
