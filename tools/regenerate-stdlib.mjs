// Auto-generates server/src/predefined/enma-stdlib.em.predefined from
// data/enma-stdlib.json. Run via: npm run regenerate-stdlib
//
// §A9: output must parse through tokenize + preprocess + parse with 0 diagnostics.
// Entries with names starting with `__` (internal runtime hooks) are skipped.
// Entries with ret/param type `unknown` or `element` are emitted with `variant`
// as the fallback type (closest opaque stdlib type).
// Destructors are skipped (implicit in Enma runtime).
// Type declarations whose name is a reserved/primitive keyword are skipped
// (e.g. `string` is a builtin primitive; its methods are not re-declared here).
// Method entries whose name is a reserved keyword are skipped.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

// ---- Enma reserved words (must match server/src/compiler_tokenizer/reservedWord.ts) ---

const ENMA_RESERVED = new Set([
    // primitive types
    'int8', 'int16', 'int32', 'int64',
    'uint8', 'uint16', 'uint32', 'uint64',
    'aint8', 'aint16', 'aint32', 'aint64',
    'float32', 'float', 'float64', 'double',
    'wstring', 'char', 'wchar', 'bool', 'void', 'size_t',
    // control flow
    'if', 'else', 'for', 'while', 'do', 'switch', 'match', 'case', 'default',
    'break', 'continue', 'return', 'goto', 'try', 'catch', 'throw', 'defer', 'yield',
    // declarations
    'class', 'struct', 'interface', 'enum', 'namespace', 'using', 'template',
    'typedef', 'decltype', 'typename', 'mixin', 'import', 'extern', 'delegate',
    'property', 'operator', 'coroutine',
    // modifiers
    'static', 'const', 'constexpr', 'override', 'public', 'private',
    'nullable', 'out', 'inline', 'auto', 'volatile', 'get', 'set',
    // literals
    'true', 'false', 'null', 'nullptr', 'this',
    // memory / casts
    'new', 'delete', 'sizeof', 'offsetof', 'static_assert', 'cast',
    'static_cast', 'reinterpret_cast', 'const_cast',
    // string type (also a primitive)
    'string',
]);

// ---- Load JSON ----------------------------------------------------------------

const jsonPath = path.join(repoRoot, 'data', 'enma-stdlib.json');
if (!fs.existsSync(jsonPath)) {
    console.error(`regenerate-stdlib: ERROR — ${jsonPath} not found`);
    process.exit(1);
}

const stdlib = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
const entries = stdlib.entries;
const totalEntries = entries.length;

// ---- Helpers ------------------------------------------------------------------

/** Skip internal runtime hooks. */
function isInternal(name) {
    return name.startsWith('__');
}

/**
 * Map a stdlib JSON type name to a safe Enma predefined type token.
 * - `unknown` / `element` / empty → `variant` (closest opaque type)
 * - everything else passes through
 */
function safeType(t) {
    if (!t || t === '' || t === 'unknown' || t === 'element') return 'variant';
    return t;
}

/**
 * Build an Enma parameter list string from a params array.
 * Parameter names may be empty; we generate p0, p1, ... in that case.
 */
function buildParams(params) {
    if (!params || params.length === 0) return '';
    return params.map((p, i) => {
        const typeName = safeType(p.type);
        const rawName = p.name && p.name.trim() ? p.name.trim() : '';
        // Use generated name if param name is empty or is a reserved word.
        const paramName = (!rawName || ENMA_RESERVED.has(rawName)) ? `p${i}` : rawName;
        return `${typeName} ${paramName}`;
    }).join(', ');
}

/**
 * Build a method/function signature line.
 * e.g. `    bool starts_with(string p0);`
 */
function buildMethodLine(entry, indent) {
    const ret = safeType(entry.ret);
    const params = buildParams(entry.params);
    return `${indent}${ret} ${entry.name}(${params});`;
}

// ---- Group entries by parent --------------------------------------------------

// types: kind='type', parent='' — skip if name is a reserved/primitive keyword
const typeNames = [];
const typeEntries = new Map(); // name → { methods: [], factories: [] }

for (const e of entries) {
    if (e.kind === 'type' && e.parent === '' && !isInternal(e.name) && !ENMA_RESERVED.has(e.name)) {
        typeNames.push(e.name);
        typeEntries.set(e.name, { methods: [], factories: [] });
    }
}

for (const e of entries) {
    if (isInternal(e.name)) continue;
    // Skip methods whose name is a reserved keyword (e.g. `get`, `set`, `type` isn't reserved)
    if (e.kind === 'method' && e.parent) {
        if (ENMA_RESERVED.has(e.name)) continue; // skip reserved-word method names
        const owner = typeEntries.get(e.parent);
        if (owner) owner.methods.push(e);
    } else if (e.kind === 'factory' && e.parent) {
        if (ENMA_RESERVED.has(e.name)) continue;
        const owner = typeEntries.get(e.parent);
        if (owner) owner.factories.push(e);
    }
}

// global functions — skip reserved names
const globalFunctions = entries.filter(
    e => e.kind === 'global_function'
        && e.parent === ''
        && !isInternal(e.name)
        && !ENMA_RESERVED.has(e.name)
);

// ---- Emit .em.predefined ------------------------------------------------------

const lines = [];

lines.push(`// Auto-generated from data/enma-stdlib.json — do not edit by hand.`);
lines.push(`// Regenerate via: npm run regenerate-stdlib`);
lines.push(`// Total entries: ${totalEntries}`);
lines.push(``);

// Type declarations (using `class` keyword — Enma's class-like declaration)
lines.push(`// ---- Type declarations -------------------------------------------------------`);
lines.push(``);

let emittedTypes = 0;
let emittedMethods = 0;
let emittedGlobals = 0;
let skippedReserved = 0;

for (const typeName of typeNames) {
    const info = typeEntries.get(typeName);
    lines.push(`class ${typeName} {`);
    emittedTypes++;

    // Factories as constructor-style methods inside the class body.
    for (const f of info.factories) {
        const params = buildParams(f.params);
        lines.push(`    ${typeName} ${f.name}(${params});`);
        emittedMethods++;
    }

    // Instance methods
    for (const m of info.methods) {
        lines.push(buildMethodLine(m, '    '));
        emittedMethods++;
    }

    lines.push(`}`);
    lines.push(``);
}

// Free / global functions
lines.push(`// ---- Global functions -------------------------------------------------------`);
lines.push(``);

for (const fn of globalFunctions) {
    lines.push(buildMethodLine(fn, ''));
    emittedGlobals++;
}

lines.push(``);

const content = lines.join('\n');

// ---- Write output ------------------------------------------------------------

const outDir = path.join(repoRoot, 'server', 'src', 'predefined');
fs.mkdirSync(outDir, { recursive: true });

const outPath = path.join(outDir, 'enma-stdlib.em.predefined');
fs.writeFileSync(outPath, content, 'utf8');

const loc = lines.length;
console.log(`regenerate-stdlib: wrote ${outPath}`);
console.log(`  types:    ${emittedTypes}`);
console.log(`  methods:  ${emittedMethods}`);
console.log(`  globals:  ${emittedGlobals}`);
console.log(`  LoC:      ${loc}`);
console.log(`  entries:  ${totalEntries} total in JSON`);
