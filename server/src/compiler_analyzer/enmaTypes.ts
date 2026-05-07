// Stdlib type registration.
//
// Loads `data/enma-stdlib.json` (819 entries) and seeds the active global
// scope with primitives + every stdlib type/method/factory/destructor.
// Phase 6 will replace this with a generated `.em.predefined` file; for now
// we ingest the JSON directly. Each registered symbol is tagged with
// `origin: 'bundled'` so AC-21 collision detection can identify it.
//
// §A7: when `process.env.ENMA_LSP_TEST === '1'`, this module returns without
// registering anything. Analyzer tests use the env-var to keep their
// assertion expectations clean.

import * as fs from 'fs';
import * as path from 'path';
import { TokenIdentifier, TokenKind } from '../compiler_tokenizer/tokenObject';
import { TextLocation } from '../compiler_tokenizer/textLocation';
import { ResolvedType } from './resolvedType';
import {
    SymbolFunction,
    SymbolType,
    SymbolVariable,
    AccessModifier,
} from './symbolObject';
import { SymbolGlobalScope } from './symbolScope';
import {
    builtinBool,
    builtinChar,
    builtinFloat,
    builtinFloat64,
    builtinInt32,
    builtinInt64,
    builtinString,
    builtinVoid,
    eachBuiltinType,
    tryGetBuiltinType,
} from './builtinType';

// ---- JSON entry shape (matches data/enma-stdlib.json) ------------------

interface StdlibParam {
    type: string;
    name: string;
}

type StdlibEntryKind = 'type' | 'method' | 'factory' | 'destructor' | 'function' | 'global_function' | 'global' | 'enum' | 'enum_value';

interface StdlibEntry {
    kind: StdlibEntryKind;
    name: string;
    parent: string;   // empty string for top-level entries
    ret: string;
    sig: string;
    desc: string;
    params: StdlibParam[];
}

interface StdlibFile {
    count: number;
    entries: StdlibEntry[];
}

// ---- Helpers ------------------------------------------------------------

const STDLIB_LOC: TextLocation = {
    uri: 'enma://stdlib',
    start: { line: 0, character: 0 },
    end: { line: 0, character: 0 },
};

function virtualIdent(text: string): TokenIdentifier {
    return { kind: TokenKind.Identifier, text, location: STDLIB_LOC };
}

function resolveStdlibType(name: string, knownStdlib: Map<string, SymbolType>): ResolvedType | undefined {
    if (!name) return undefined;

    // `element` is the array template parameter — leave unresolved (becomes a
    // generic). Stdlib JSON uses it as a placeholder.
    if (name === 'element') return undefined;

    const builtin = tryGetBuiltinType(name);
    if (builtin) return new ResolvedType(builtin);

    const stdlibSym = knownStdlib.get(name);
    if (stdlibSym) return new ResolvedType(stdlibSym);

    return undefined;
}

// ---- Public API ---------------------------------------------------------

/**
 * Locate the bundled stdlib JSON. Tries cwd-relative + module-relative paths.
 * Returns undefined if not found (e.g. test isolation).
 */
export function findStdlibJsonPath(): string | undefined {
    const candidates = [
        path.resolve(__dirname, '..', '..', '..', 'data', 'enma-stdlib.json'),
        path.resolve(__dirname, '..', '..', '..', '..', 'data', 'enma-stdlib.json'),
        path.resolve(process.cwd(), 'data', 'enma-stdlib.json'),
        path.resolve(process.cwd(), '..', 'data', 'enma-stdlib.json'),
    ];
    for (const p of candidates) {
        try {
            if (fs.existsSync(p)) return p;
        } catch { /* ignore */ }
    }
    return undefined;
}

/** Read + parse the stdlib JSON. Returns undefined when missing/invalid. */
export function readStdlibJson(jsonPath: string): StdlibFile | undefined {
    try {
        const raw = fs.readFileSync(jsonPath, 'utf8');
        return JSON.parse(raw) as StdlibFile;
    } catch {
        return undefined;
    }
}

/**
 * Register primitives + stdlib symbols into a global scope.
 * §A7: respects ENMA_LSP_TEST=1 by registering ONLY primitives (skipping
 * the 819 stdlib entries) so analyzer tests are deterministic.
 */
export function registerEnmaTypes(global: SymbolGlobalScope, options?: {
    skipStdlib?: boolean;
    stdlib?: StdlibFile;
}): void {
    // 1. Primitives — always available.
    for (const t of eachBuiltinType()) {
        global.insertSymbol(t);
    }

    if (options?.skipStdlib === true || process.env.ENMA_LSP_TEST === '1') {
        return;
    }

    // 2. Stdlib JSON.
    const stdlib = options?.stdlib ?? (() => {
        const p = findStdlibJsonPath();
        return p ? readStdlibJson(p) : undefined;
    })();
    if (!stdlib) return;

    // First pass: register all top-level types (so methods can reference them
    // when resolving param types in pass 2).
    const knownStdlib = new Map<string, SymbolType>();

    for (const entry of stdlib.entries) {
        if (entry.kind === 'type' && entry.parent === '') {
            const t = SymbolType.create({
                identifierToken: virtualIdent(entry.name),
                scopePath: [],
                linkedNode: undefined,
                membersScopePath: [entry.name],
            });
            t.origin = 'bundled';
            global.insertSymbol(t);
            knownStdlib.set(entry.name, t);
            global.insertScope(entry.name, 'class');
        } else if (entry.kind === 'enum' && entry.parent === '') {
            const e = SymbolType.create({
                identifierToken: virtualIdent(entry.name),
                scopePath: [],
                linkedNode: undefined,
                membersScopePath: [entry.name],
                isEnum: true,
            });
            e.origin = 'bundled';
            global.insertSymbol(e);
            knownStdlib.set(entry.name, e);
            global.insertScope(entry.name, 'enum');
        }
    }

    // Second pass: methods, factories, destructors, free functions, enum
    // values, globals.
    for (const entry of stdlib.entries) {
        switch (entry.kind) {
            case 'type':
            case 'enum':
                continue;
            case 'method': {
                const owner = global.lookupScope(entry.parent);
                if (!owner) continue;
                const ret = resolveStdlibType(entry.ret, knownStdlib);
                const fn = SymbolFunction.create({
                    identifierToken: virtualIdent(entry.name),
                    scopePath: [entry.parent],
                    linkedNode: undefined,
                    functionScopePath: undefined,
                    returnType: ret,
                    parameterTypes: entry.params.map(p => resolveStdlibType(p.type, knownStdlib)),
                    isInstanceMember: true,
                    accessRestriction: AccessModifier.Public,
                });
                owner.insertSymbol(fn);
                break;
            }
            case 'factory': {
                const owner = global.lookupScope(entry.parent);
                if (!owner) continue;
                const ret = resolveStdlibType(entry.ret, knownStdlib);
                const fn = SymbolFunction.create({
                    identifierToken: virtualIdent(entry.name),
                    scopePath: [entry.parent],
                    linkedNode: undefined,
                    functionScopePath: undefined,
                    returnType: ret,
                    parameterTypes: entry.params.map(p => resolveStdlibType(p.type, knownStdlib)),
                    isInstanceMember: false,
                    accessRestriction: AccessModifier.Public,
                    isConstructor: true,
                });
                owner.insertSymbol(fn);
                break;
            }
            case 'destructor': {
                const owner = global.lookupScope(entry.parent);
                if (!owner) continue;
                const fn = SymbolFunction.create({
                    identifierToken: virtualIdent(entry.name),
                    scopePath: [entry.parent],
                    linkedNode: undefined,
                    functionScopePath: undefined,
                    returnType: new ResolvedType(builtinVoid),
                    parameterTypes: [],
                    isInstanceMember: true,
                    accessRestriction: AccessModifier.Public,
                    isDestructor: true,
                });
                owner.insertSymbol(fn);
                break;
            }
            case 'function':
            case 'global_function': {
                const ret = resolveStdlibType(entry.ret, knownStdlib);
                const fn = SymbolFunction.create({
                    identifierToken: virtualIdent(entry.name),
                    scopePath: [],
                    linkedNode: undefined,
                    functionScopePath: undefined,
                    returnType: ret,
                    parameterTypes: entry.params.map(p => resolveStdlibType(p.type, knownStdlib)),
                    isInstanceMember: false,
                    accessRestriction: undefined,
                });
                global.insertSymbol(fn);
                break;
            }
            case 'global': {
                const t = resolveStdlibType(entry.ret, knownStdlib);
                const v = SymbolVariable.create({
                    identifierToken: virtualIdent(entry.name),
                    scopePath: [],
                    type: t,
                    isInstanceMember: false,
                    accessRestriction: undefined,
                });
                global.insertSymbol(v);
                break;
            }
            case 'enum_value': {
                const owner = global.lookupScope(entry.parent);
                if (!owner) continue;
                const enumSym = knownStdlib.get(entry.parent);
                const v = SymbolVariable.create({
                    identifierToken: virtualIdent(entry.name),
                    scopePath: [entry.parent],
                    type: enumSym ? new ResolvedType(enumSym) : undefined,
                    isInstanceMember: false,
                    accessRestriction: AccessModifier.Public,
                    isConst: true,
                    isStatic: true,
                });
                owner.insertSymbol(v);
                break;
            }
        }
    }

}
