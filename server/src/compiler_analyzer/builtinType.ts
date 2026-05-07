// Built-in primitive types for Enma.
//
// Per plan §A4-N4: `auto` is REMOVED from primitives — it is a declaration-time
// type-inference marker, not a primitive. The hoist phase parks `auto x = expr`
// with the AutoPendingType sentinel from resolvedType.ts; the analyzer pass
// replaces it. The reservedWord PRIMITIVES set still lists `auto` because the
// tokenizer historically treated it as a reserved word — that is OK; the
// analyzer just refuses to materialize it as a SymbolType.
//
// Canonical set drawn from client/legacy/extension.js KEYWORD_HOVERS (the
// existing extension's source of truth) and reservedWord.ts:
//   int{8,16,32,64} uint{8,16,32,64} aint{8,16,32,64}
//   float32 float float64 double
//   char wchar bool string wstring void size_t
//   nullable<T>            (nullable is a unary type constructor, not a flat type)

import { TokenIdentifier, TokenKind, TokenReserved } from '../compiler_tokenizer/tokenObject';
import { TextLocation } from '../compiler_tokenizer/textLocation';
import { SymbolType } from './symbolObject';
import { ResolvedType } from './resolvedType';

const ZERO_LOC: TextLocation = {
    uri: 'enma://builtin',
    start: { line: 0, character: 0 },
    end: { line: 0, character: 0 },
};

function virtualReserved(text: string): TokenReserved {
    return { kind: TokenKind.Reserved, text, location: ZERO_LOC };
}

function virtualIdent(text: string): TokenIdentifier {
    return { kind: TokenKind.Identifier, text, location: ZERO_LOC };
}

function makeBuiltin(name: string): SymbolType {
    return SymbolType.create({
        identifierToken: virtualReserved(name),
        scopePath: [],
        linkedNode: undefined,
        membersScopePath: undefined,
    });
}

// Integer family (signed)
export const builtinInt8    = makeBuiltin('int8');
export const builtinInt16   = makeBuiltin('int16');
export const builtinInt32   = makeBuiltin('int32');
export const builtinInt64   = makeBuiltin('int64');

// Atomic-int family (Enma-specific): same width as int*, but separate type
// identity so atomic ops (load/store/cas) only resolve on these.
export const builtinAInt8   = makeBuiltin('aint8');
export const builtinAInt16  = makeBuiltin('aint16');
export const builtinAInt32  = makeBuiltin('aint32');
export const builtinAInt64  = makeBuiltin('aint64');

// Unsigned
export const builtinUInt8   = makeBuiltin('uint8');
export const builtinUInt16  = makeBuiltin('uint16');
export const builtinUInt32  = makeBuiltin('uint32');
export const builtinUInt64  = makeBuiltin('uint64');

// Floating
export const builtinFloat32 = makeBuiltin('float32');
export const builtinFloat   = makeBuiltin('float');     // alias of float32 in Enma
export const builtinFloat64 = makeBuiltin('float64');
export const builtinDouble  = makeBuiltin('double');    // alias of float64

// Character / boolean / string / void / size
export const builtinChar    = makeBuiltin('char');
export const builtinWChar   = makeBuiltin('wchar');
export const builtinBool    = makeBuiltin('bool');
export const builtinString  = makeBuiltin('string');
export const builtinWString = makeBuiltin('wstring');
export const builtinVoid    = makeBuiltin('void');
export const builtinSizeT   = makeBuiltin('size_t');

// Nullable<T> is structurally a type constructor; the analyzer wraps a base
// type in a ResolvedType with isNullable=true rather than treating `nullable`
// as a freestanding type. Kept here only as a marker for hover/completion.
export const builtinNullableMarker = makeBuiltin('nullable');

// ---- Lookup -------------------------------------------------------------

const BY_NAME: ReadonlyMap<string, SymbolType> = (() => {
    const m = new Map<string, SymbolType>();
    for (const t of [
        builtinInt8, builtinInt16, builtinInt32, builtinInt64,
        builtinAInt8, builtinAInt16, builtinAInt32, builtinAInt64,
        builtinUInt8, builtinUInt16, builtinUInt32, builtinUInt64,
        builtinFloat32, builtinFloat, builtinFloat64, builtinDouble,
        builtinChar, builtinWChar, builtinBool,
        builtinString, builtinWString,
        builtinVoid, builtinSizeT,
        builtinNullableMarker,
    ]) {
        m.set(t.identifierToken.text, t);
    }
    return m;
})();

/** Returns the SymbolType for a primitive name, or undefined if not a primitive. */
export function tryGetBuiltinType(name: string): SymbolType | undefined {
    return BY_NAME.get(name);
}

/** Iterate all primitive types — used by enmaTypes to register them globally. */
export function eachBuiltinType(): IterableIterator<SymbolType> {
    return BY_NAME.values();
}

// ---- Pre-resolved types for fast literal typing ------------------------

export const resolvedBuiltinBool   = new ResolvedType(builtinBool);
export const resolvedBuiltinInt32  = new ResolvedType(builtinInt32);
export const resolvedBuiltinInt64  = new ResolvedType(builtinInt64);
export const resolvedBuiltinFloat  = new ResolvedType(builtinFloat32);
export const resolvedBuiltinDouble = new ResolvedType(builtinFloat64);
export const resolvedBuiltinChar   = new ResolvedType(builtinChar);
export const resolvedBuiltinString = new ResolvedType(builtinString);
export const resolvedBuiltinVoid   = new ResolvedType(builtinVoid);

// ---- Synthetic identifier tokens used by hoist -------------------------

/** Virtual `this` token attached to the implicit `this` symbol on classes. */
export const builtinThisToken = virtualIdent('this');

/** Virtual `value` token for setters' implicit value parameter. */
export const builtinSetterValueToken = virtualIdent('value');

// ---- Number-type predicate (used for arithmetic conversion lattice) -----

const NUMBER_NAMES: ReadonlySet<string> = new Set([
    'int8', 'int16', 'int32', 'int64',
    'uint8', 'uint16', 'uint32', 'uint64',
    'aint8', 'aint16', 'aint32', 'aint64',
    'float32', 'float', 'float64', 'double', 'size_t',
]);

const INT_NAMES: ReadonlySet<string> = new Set([
    'int8', 'int16', 'int32', 'int64',
    'uint8', 'uint16', 'uint32', 'uint64',
    'aint8', 'aint16', 'aint32', 'aint64',
    'size_t',
]);

const FLOAT_NAMES: ReadonlySet<string> = new Set([
    'float32', 'float', 'float64', 'double',
]);

export function isNumberType(t: SymbolType): boolean {
    return NUMBER_NAMES.has(t.identifierToken.text);
}

export function isIntegerType(t: SymbolType): boolean {
    return INT_NAMES.has(t.identifierToken.text);
}

export function isFloatType(t: SymbolType): boolean {
    return FLOAT_NAMES.has(t.identifierToken.text);
}
