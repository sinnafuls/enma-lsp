#!/usr/bin/env node
// Corpus mutation-fuzzer for §A6 prereq.
// Inputs: samples/showcase.em productions (extracted by hand-listing).
// Output: .omc/corpus/*.em — ~250 LoC each, ≥20 files, ≥5,000 LoC total.
// Deterministic seed.

import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const outDir = join(repoRoot, '.omc', 'corpus');

// Deterministic PRNG (Mulberry32)
function mulberry32(seed) {
    return function () {
        seed = (seed + 0x6D2B79F5) | 0;
        let t = seed;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const rng = mulberry32(0x1337C0DE);
const pick = (arr) => arr[Math.floor(rng() * arr.length)];
const pickN = (arr, n) => Array.from({ length: n }, () => pick(arr));
const chance = (p) => rng() < p;

// Type pools (categories — fuzzer swaps within category)
const INT_TYPES = ['int8', 'int16', 'int32', 'int64', 'uint8', 'uint16', 'uint32', 'uint64'];
const FLOAT_TYPES = ['float32', 'float64'];
const NUMERIC_TYPES = [...INT_TYPES, ...FLOAT_TYPES];
const SCALAR_TYPES = [...NUMERIC_TYPES, 'bool', 'char'];
const PRIMITIVE_TYPES = [...SCALAR_TYPES, 'string'];

// Identifier pools — exclude Enma reserved words (set/get/operator/property/etc)
const NOUNS = [
    'entity', 'player', 'enemy', 'weapon', 'shield', 'item', 'inventory',
    'world', 'level', 'scene', 'camera', 'light', 'sound', 'music',
    'render', 'physics', 'audio', 'input', 'network', 'storage',
    'config', 'state', 'context', 'manager', 'system', 'service',
    'buffer', 'cache', 'queue', 'stack', 'pool', 'list',
    'request', 'response', 'event', 'message', 'packet', 'frame',
    'point', 'vector', 'matrix', 'rect', 'color', 'shape',
    'node', 'edge', 'graph', 'tree', 'leaf', 'root',
    'session', 'user', 'admin', 'guest', 'client', 'server',
    'token', 'key', 'value', 'pair', 'mapping', 'group',
    'header', 'body', 'footer', 'tag', 'label', 'flag',
];
const VERBS = [
    'compute', 'process', 'handle', 'invoke', 'execute', 'apply',
    'load', 'save', 'parse', 'format', 'render', 'draw',
    'update', 'refresh', 'reload', 'reset', 'clear', 'flush',
    'open', 'close', 'connect', 'disconnect', 'send', 'receive',
    'allocate', 'deallocate', 'spawn', 'release',
    'find', 'lookup', 'fetch', 'scan',
    'sort', 'filter', 'reduce', 'fold', 'collect',
    'merge', 'split', 'join', 'concat', 'append', 'prepend',
    'encode', 'decode', 'compress', 'decompress', 'encrypt', 'decrypt',
];
const ADJ = [
    'fast', 'slow', 'small', 'large', 'tiny', 'huge', 'short', 'long',
    'red', 'blue', 'green', 'gold', 'silver', 'dark', 'light',
    'left', 'right', 'top', 'bottom', 'front', 'back',
    'first', 'last', 'next', 'prev', 'inner', 'outer',
];

let counterIdx = 0;
function genIdent(kind = 'var') {
    counterIdx++;
    if (kind === 'type' || kind === 'class') {
        // CamelCase
        const parts = pickN([...NOUNS, ...ADJ], 1 + Math.floor(rng() * 2));
        return parts.map((p) => p[0].toUpperCase() + p.slice(1)).join('') + (counterIdx % 7 === 0 ? String(counterIdx) : '');
    }
    if (kind === 'enum') {
        const parts = pickN(NOUNS, 1);
        return parts.map((p) => p[0].toUpperCase() + p.slice(1)).join('') + 'Kind';
    }
    if (kind === 'fn') {
        const v = pick(VERBS);
        const n = pick(NOUNS);
        return v + '_' + n;
    }
    if (kind === 'ns') {
        return pick(NOUNS);
    }
    // var
    return pick(NOUNS) + (counterIdx % 5 === 0 ? '_' + counterIdx : '');
}

function genIntLit() {
    const r = rng();
    if (r < 0.2) return '0x' + Math.floor(rng() * 0xFFFFFF).toString(16).toUpperCase();
    if (r < 0.3) {
        // user-defined literal
        const suffix = pick(['_km', '_meter', '_ms', '_kg']);
        return Math.floor(rng() * 1000) + suffix;
    }
    return String(Math.floor(rng() * 1000));
}

function genFloatLit() {
    const r = rng();
    if (r < 0.3) return (rng() * 100).toFixed(3) + 'f';
    if (r < 0.5) return (rng() * 100).toFixed(5);
    if (r < 0.7) return (rng() * 10).toFixed(2) + 'e' + (chance(0.5) ? '-' : '') + (1 + Math.floor(rng() * 5));
    return String(Math.floor(rng() * 1000)) + '.0';
}

function genStrLit() {
    const words = pickN(NOUNS, 1 + Math.floor(rng() * 3));
    return '"' + words.join(' ') + '"';
}

// ---- Production generators ----

function genTypeName() {
    return pick(PRIMITIVE_TYPES);
}

function genIntType() {
    return pick(INT_TYPES);
}

function genFloatType() {
    return pick(FLOAT_TYPES);
}

// expressions
function genExprAtom() {
    const r = rng();
    if (r < 0.3) return genIntLit();
    if (r < 0.5) return genFloatLit();
    if (r < 0.6) return genStrLit();
    if (r < 0.65) return pick(['true', 'false']);
    if (r < 0.7) return 'null';
    return pick(NOUNS);
}

function genExpr(depth = 0) {
    if (depth > 3 || chance(0.4)) return genExprAtom();
    const r = rng();
    if (r < 0.3) {
        // binary
        const op = pick(['+', '-', '*', '/', '%', '<', '>', '==', '!=', '&&', '||']);
        return `(${genExpr(depth + 1)} ${op} ${genExpr(depth + 1)})`;
    }
    if (r < 0.5) {
        // call
        const fn = pick(VERBS) + '_' + pick(NOUNS);
        const argc = Math.floor(rng() * 3);
        const args = Array.from({ length: argc }, () => genExpr(depth + 1)).join(', ');
        return `${fn}(${args})`;
    }
    if (r < 0.6) {
        // unary
        const op = pick(['-', '!', '~']);
        return `${op}${genExprAtom()}`;
    }
    if (r < 0.7) {
        // ternary
        return `(${genExprAtom()} ? ${genExprAtom()} : ${genExprAtom()})`;
    }
    if (r < 0.8) {
        // member access
        return `${pick(NOUNS)}.${pick(NOUNS)}`;
    }
    if (r < 0.9) {
        // index
        return `${pick(NOUNS)}[${genExprAtom()}]`;
    }
    // f-string
    const v = pick(NOUNS);
    return `f"value={${v}}"`;
}

function genStmt(depth = 0) {
    const r = rng();
    if (depth >= 3) return genSimpleStmt();
    if (r < 0.4) return genSimpleStmt();
    if (r < 0.55) return genIfStmt(depth);
    if (r < 0.7) return genForStmt(depth);
    if (r < 0.8) return genWhileStmt(depth);
    if (r < 0.85) return genReturnStmt();
    if (r < 0.9) return genDeferStmt(depth);
    if (r < 0.95) return genTryStmt(depth);
    return genMatchStmt();
}

function genSimpleStmt() {
    const r = rng();
    if (r < 0.4) {
        const t = genIntType();
        const n = genIdent('var');
        return `    ${t} ${n} = ${genExpr()};`;
    }
    if (r < 0.6) {
        const n = pick(NOUNS);
        return `    ${n} = ${genExpr()};`;
    }
    if (r < 0.8) {
        return `    ${genExpr()};`;
    }
    return `    println(${genStrLit()});`;
}

function genIfStmt(depth) {
    const cond = `${pick(NOUNS)} ${pick(['<', '>', '==', '!='])} ${genIntLit()}`;
    const body = pickN([0, 1, 2], 1 + Math.floor(rng() * 2)).map(() => genStmt(depth + 1)).join('\n');
    if (chance(0.5)) {
        const elseBody = genStmt(depth + 1);
        return `    if (${cond}) {\n${body}\n    } else {\n${elseBody}\n    }`;
    }
    return `    if (${cond}) {\n${body}\n    }`;
}

function genForStmt(depth) {
    const r = rng();
    if (r < 0.5) {
        // counted
        const n = pick(['i', 'j', 'k', 'idx']);
        const limit = genIntLit();
        const body = genStmt(depth + 1);
        return `    for (int32 ${n} = 0; ${n} < ${limit}; ${n} = ${n} + 1) {\n${body}\n    }`;
    }
    // foreach
    const t = genIntType();
    const v = pick(NOUNS);
    const coll = pick(NOUNS);
    const body = genStmt(depth + 1);
    return `    for (${t} ${v} : ${coll}) {\n${body}\n    }`;
}

function genWhileStmt(depth) {
    const cond = `${pick(NOUNS)} ${pick(['<', '>', '!='])} ${genIntLit()}`;
    const body = genStmt(depth + 1);
    return `    while (${cond}) {\n${body}\n    }`;
}

function genReturnStmt() {
    if (chance(0.3)) return `    return;`;
    return `    return ${genExpr()};`;
}

function genDeferStmt(depth) {
    return `    defer { ${pick(VERBS)}_${pick(NOUNS)}(); }`;
}

function genTryStmt(depth) {
    const tryBody = genSimpleStmt();
    const catchT = pick(['int32', 'string']);
    const catchVar = 'e';
    const catchBody = `        println(f"caught {${catchVar}}");`;
    return `    try {\n${tryBody}\n    } catch (${catchT} ${catchVar}) {\n${catchBody}\n    }`;
}

function genMatchStmt() {
    const subj = pick(NOUNS);
    const arms = [
        `        ${genIntLit()} => ${genIntLit()},`,
        `        ${genIntLit()} => ${genIntLit()},`,
        `        _ => ${genIntLit()}`,
    ];
    const t = genIntType();
    return `    ${t} m = match (${subj}) {\n${arms.join('\n')}\n    };`;
}

// top-level decls
function genFreeFunction() {
    const ret = chance(0.3) ? 'void' : genIntType();
    const name = genIdent('fn');
    const paramc = Math.floor(rng() * 3);
    const params = Array.from({ length: paramc }, () => `${genIntType()} ${pick(NOUNS)}`).join(', ');
    const stmtCount = 2 + Math.floor(rng() * 6);
    const stmts = Array.from({ length: stmtCount }, () => genStmt(0)).join('\n');
    const tail = ret === 'void' ? '' : '\n' + genReturnStmt();
    return `${ret} ${name}(${params}) {\n${stmts}${tail}\n}`;
}

function genStruct() {
    const name = genIdent('class');
    const fieldCount = 2 + Math.floor(rng() * 4);
    const fields = Array.from({ length: fieldCount }, () => {
        const t = genTypeName();
        const n = pick(NOUNS);
        return `    ${t} ${n};`;
    }).join('\n');
    const ann = chance(0.3) ? pick(['[[packed]]\n', '[[align(16)]]\n', '[[reflect]]\n', '']) : '';
    return `${ann}struct ${name} {\n${fields}\n}`;
}

function genClass() {
    const name = genIdent('class');
    const fieldCount = 1 + Math.floor(rng() * 3);
    const fields = Array.from({ length: fieldCount }, () => {
        const t = genTypeName();
        const n = pick(NOUNS);
        return `    ${t} ${n};`;
    }).join('\n');
    // ctor
    const ctorParam = `${genIntType()} v`;
    const ctorBody = `        this.${pick(NOUNS)} = v;`;
    const ctor = `    ${name}(${ctorParam}) {\n${ctorBody}\n    }`;
    // method
    const mret = chance(0.5) ? 'void' : genIntType();
    const mname = pick(VERBS);
    const mbody = mret === 'void' ? '        // method body' : `        return ${genIntLit()};`;
    const method = `    ${mret} ${mname}() {\n${mbody}\n    }`;
    // optional bases
    const baseCount = chance(0.3) ? 1 + Math.floor(rng() * 2) : 0;
    const bases = baseCount > 0
        ? ' : ' + Array.from({ length: baseCount }, () => genIdent('class')).join(', ')
        : '';
    return `class ${name}${bases} {\n${fields}\n${ctor}\n${method}\n}`;
}

function genInterface() {
    const name = 'I' + genIdent('class');
    const methodCount = 1 + Math.floor(rng() * 3);
    const methods = Array.from({ length: methodCount }, () => {
        const ret = chance(0.5) ? 'void' : genIntType();
        const mname = pick(VERBS);
        return `    ${ret} ${mname}();`;
    }).join('\n');
    return `interface ${name} {\n${methods}\n}`;
}

function genEnum() {
    const name = genIdent('enum');
    const variantCount = 2 + Math.floor(rng() * 4);
    const variants = Array.from({ length: variantCount }, (_, i) => {
        const v = pick(ADJ);
        return v[0].toUpperCase() + v.slice(1) + (chance(0.3) ? ` = ${i}` : '');
    });
    return `enum ${name} { ${variants.join(', ')} }`;
}

function genNamespace() {
    const name = genIdent('ns');
    const inner = [genFreeFunction(), genStruct()].join('\n\n');
    return `namespace ${name} {\n${inner}\n}`;
}

function genTemplate() {
    const tname = genIdent('fn');
    const ret = 'T';
    return `template<typename T>\n${ret} ${tname}(${ret} a, ${ret} b) {\n    return a;\n}`;
}

function genTypedef() {
    const a = genIdent('class');
    const b = genIntType();
    return `typedef ${b} ${a};`;
}

function genDelegate() {
    const name = genIdent('class') + 'Op';
    const ret = genIntType();
    return `delegate ${ret} ${name}(${genIntType()} a, ${genIntType()} b);`;
}

function genGlobalVar() {
    const t = genIntType();
    const n = pick(NOUNS);
    return `const ${t} ${n.toUpperCase()} = ${genIntLit()};`;
}

function genLambdaDemo() {
    const name = genIdent('fn');
    const body = [
        `    int32 base = ${genIntLit()};`,
        `    int32 r1 = [](int32 a, int32 b) -> int32 { return a + b; }(${genIntLit()}, ${genIntLit()});`,
        `    int32 r2 = (int32 x) => x * 2;`,
        `    int32 r3 = [base](int32 x) -> int32 { return base + x; }(${genIntLit()});`,
    ].join('\n');
    return `void ${name}() {\n${body}\n}`;
}

function genFStringDemo() {
    const name = genIdent('fn');
    const body = [
        `    int32 a = ${genIntLit()};`,
        `    int32 b = ${genIntLit()};`,
        `    string s1 = f"a={a}";`,
        `    string s2 = f"a={a}, b={b}";`,
        `    string s3 = f"sum={a + b}";`,
        `    string s4 = f"outer={f"inner={a}"}";`,
    ].join('\n');
    return `void ${name}() {\n${body}\n}`;
}

function genDesignatedInit() {
    return `${genIdent('class')} ${pick(NOUNS)} = { .x = ${genIntLit()}, .y = ${genIntLit()} };`;
}

function genAnnotated() {
    const ann = pick(['[[reflect]]', '[[serialize]]', '[[inline]]', '[[noopt]]']);
    return `${ann}\n${genFreeFunction()}`;
}

function genCoroutine() {
    const name = genIdent('fn');
    return `coroutine int32 ${name}() {\n    int32 i = 0;\n    while (i < 10) {\n        yield i;\n        i = i + 1;\n    }\n    return 0;\n}`;
}

function genVariadic() {
    const name = genIdent('fn');
    return `int64 ${name}(...) {\n    int64 s = 0;\n    int64 i = 0;\n    while (i < __va_count) {\n        s = s + __va_arg(i);\n        i = i + 1;\n    }\n    return s;\n}`;
}

const PROD_GENS = [
    genFreeFunction, genFreeFunction, genFreeFunction,
    genStruct, genStruct,
    genClass, genClass,
    genInterface,
    genEnum,
    genNamespace,
    genTemplate,
    genTypedef,
    genDelegate,
    genGlobalVar, genGlobalVar,
    genLambdaDemo,
    genFStringDemo,
    genDesignatedInit,
    genAnnotated,
    genCoroutine,
    genVariadic,
];

function genFile(targetLines) {
    const header = [
        '// Auto-generated corpus chunk — corpus-fuzz.mjs (deterministic seed)',
        '// Exercises Enma grammar productions for §A6 parser-test gate.',
    ].join('\n');
    const decls = [];
    let lines = header.split('\n').length + 1;
    while (lines < targetLines) {
        const decl = pick(PROD_GENS)();
        decls.push(decl);
        lines += decl.split('\n').length + 1;
    }
    return header + '\n\n' + decls.join('\n\n') + '\n';
}

// ---- Main ----

function main() {
    if (existsSync(outDir)) {
        rmSync(outDir, { recursive: true, force: true });
    }
    mkdirSync(outDir, { recursive: true });

    const fileCount = 22;
    const linesPerFile = 250;
    let totalLines = 0;
    for (let i = 0; i < fileCount; i++) {
        const content = genFile(linesPerFile);
        const fname = `corpus_${String(i).padStart(3, '0')}.em`;
        writeFileSync(join(outDir, fname), content, 'utf8');
        totalLines += content.split('\n').length;
    }
    console.log(`corpus generated: ${fileCount} files, ${totalLines} LoC, seed=0x1337C0DE`);
    console.log(`outDir: ${outDir}`);
}

main();
