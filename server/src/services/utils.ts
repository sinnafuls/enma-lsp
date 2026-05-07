// Phase 7 — shared service utilities.
//
// Service providers consume tokens, AST nodes, and symbol tables to answer
// LSP requests. Helpers here:
//   - position arithmetic (TextPosition is data-only in Enma; angel-lsp had
//     methods on its position class, we replicate them as free functions)
//   - token lookup at caret (binary search rawTokens by location)
//   - scope walking
//   - symbol lookup by name (qualified or unqualified)
//   - keyword hover docs (ported from client/legacy/extension.js KEYWORD_HOVERS)
//   - operator-overload table (used by inlay hints)

import { TextPosition, TextLocation } from '../compiler_tokenizer/textLocation';
import { TokenObject, TokenKind } from '../compiler_tokenizer/tokenObject';
import {
    SymbolFunctionHolder,
    SymbolObjectHolder,
    SymbolType,
    SymbolVariable,
    ScopePath,
    isScopePathEqual,
} from '../compiler_analyzer/symbolObject';
import {
    SymbolGlobalScope,
    SymbolScope,
} from '../compiler_analyzer/symbolScope';

// ---- Position helpers --------------------------------------------------

export function positionInRange(loc: TextLocation, p: TextPosition): boolean {
    if (p.line < loc.start.line) return false;
    if (p.line > loc.end.line) return false;
    if (p.line === loc.start.line && p.character < loc.start.character) return false;
    if (p.line === loc.end.line && p.character > loc.end.character) return false;
    return true;
}

export function positionLess(a: TextPosition, b: TextPosition): boolean {
    if (a.line !== b.line) return a.line < b.line;
    return a.character < b.character;
}

export function positionEq(a: TextPosition, b: TextPosition): boolean {
    return a.line === b.line && a.character === b.character;
}

// ---- Token lookup ------------------------------------------------------

/** Find the token whose location contains `caret`, or undefined. Linear; OK for service-time use. */
export function findTokenAtPosition(
    tokens: ReadonlyArray<TokenObject>,
    caret: TextPosition,
): { token: TokenObject; index: number } | undefined {
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.kind === TokenKind.EOF) continue;
        if (positionInRange(t.location, caret)) return { token: t, index: i };
    }
    return undefined;
}

/** Closest token AT or BEFORE caret position; returns last preceding if none contains. */
export function findTokenAtOrBefore(
    tokens: ReadonlyArray<TokenObject>,
    caret: TextPosition,
): { token: TokenObject; index: number } | undefined {
    let last: { token: TokenObject; index: number } | undefined;
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.kind === TokenKind.EOF) continue;
        if (positionInRange(t.location, caret)) return { token: t, index: i };
        if (positionLess(t.location.end, caret) || positionEq(t.location.end, caret)) {
            last = { token: t, index: i };
        }
    }
    return last;
}

// ---- Scope walking ------------------------------------------------------

/** Walk parent chain (incl. self) collecting all scopes. */
export function collectScopeChain(scope: SymbolScope): SymbolScope[] {
    const out: SymbolScope[] = [];
    let s: SymbolScope | undefined = scope;
    while (s !== undefined) {
        out.push(s);
        s = s.parentScope;
    }
    return out;
}

/** Find the deepest scope whose recorded scopeRegion contains `caret`; falls back to global. */
export function findScopeAtPosition(global: SymbolGlobalScope, caret: TextPosition): SymbolScope {
    let best: SymbolScope = global;
    let bestDepth = 0;
    for (const r of global.info.scopeRegion) {
        if (!positionInRange(r.boundingLocation, caret)) continue;
        const depth = r.targetScope.scopePath.length;
        if (depth >= bestDepth) {
            bestDepth = depth;
            best = r.targetScope;
        }
    }
    return best;
}

// ---- Symbol lookup ------------------------------------------------------

/**
 * Resolve a name (optionally qualified path). Walks parent chain; for qualified
 * paths walks the namespace tree.
 */
export function lookupSymbolByName(
    scope: SymbolScope,
    name: string,
    qualifiedPath?: ScopePath,
): SymbolObjectHolder | undefined {
    if (qualifiedPath !== undefined && qualifiedPath.length > 0) {
        // Walk into the namespace path from global, then look up `name` there.
        const global = scope.getGlobalScope();
        let cur: SymbolScope | undefined = global;
        for (const seg of qualifiedPath) {
            cur = cur?.lookupScope(seg);
            if (cur === undefined) return undefined;
        }
        return cur.lookupSymbol(name);
    }
    return scope.lookupSymbolWithParent(name);
}

/** Find a symbol whose declaration token is at `caret` (recurse all scopes). */
export function findSymbolAtPosition(
    scope: SymbolScope,
    caret: TextPosition,
    uri: string,
): SymbolObjectHolder | undefined {
    for (const [, holder] of scope.symbolTable) {
        for (const s of holder.toList()) {
            const tok = s.identifierToken;
            if (tok.location.uri !== uri) continue;
            if (positionInRange(tok.location, caret)) {
                return holder;
            }
        }
    }
    for (const [, child] of scope.childScopeTable) {
        const found = findSymbolAtPosition(child, caret, uri);
        if (found !== undefined) return found;
    }
    return undefined;
}

// ---- Stringify symbols (for hover / completion detail) -----------------

/** Build a one-line signature string for a symbol. */
export function stringifySymbol(holder: SymbolObjectHolder): string {
    if (holder instanceof SymbolFunctionHolder) {
        return stringifyFunction(holder);
    }
    if (holder instanceof SymbolType) {
        return stringifyType(holder);
    }
    if (holder instanceof SymbolVariable) {
        return stringifyVariable(holder);
    }
    return '';
}

export function stringifyType(t: SymbolType): string {
    const tag = t.isEnum ? 'enum'
        : t.isInterface ? 'interface'
        : t.isStruct ? 'struct'
        : t.isMixin ? 'mixin'
        : t.isPrimitive() ? 'type'
        : 'class';
    const path = t.scopePath.length === 0 ? '' : t.scopePath.join('::') + '::';
    return `${tag} ${path}${t.identifierText}`;
}

export function stringifyVariable(v: SymbolVariable): string {
    const typeStr = v.type ? v.type.identifierText + (v.type.pointerLevel > 0 ? '*'.repeat(v.type.pointerLevel) : '') : 'auto';
    const constStr = v.isConst ? 'const ' : '';
    const staticStr = v.isStatic ? 'static ' : '';
    const path = v.scopePath.length === 0 ? '' : v.scopePath.join('::') + '::';
    return `${staticStr}${constStr}${typeStr} ${path}${v.identifierText}`;
}

export function stringifyFunction(holder: SymbolFunctionHolder): string {
    const f = holder.first;
    const ret = f.returnType ? f.returnType.identifierText : 'void';
    const params = f.parameterTypes.map((p, i) => {
        const pname = f.linkedNode && 'params' in f.linkedNode
            ? f.linkedNode.params[i]?.name?.text ?? ''
            : '';
        const ptype = p ? p.identifierText : '?';
        return pname.length > 0 ? `${ptype} ${pname}` : ptype;
    }).join(', ');
    const path = f.scopePath.length === 0 ? '' : f.scopePath.join('::') + '::';
    return `${ret} ${path}${f.identifierText}(${params})`;
}

// ---- Static keyword hover docs (ported from client/legacy/extension.js) -

export const KEYWORD_HOVERS: Readonly<Record<string, string>> = {
    // primitive types
    int8:    'Signed 8-bit integer. Range: -128..127.',
    int16:   'Signed 16-bit integer. Range: -32_768..32_767.',
    int32:   'Signed 32-bit integer (default int). Range: ~-2.1B..2.1B.',
    int64:   'Signed 64-bit integer. Range: ~-9.2e18..9.2e18.',
    uint8:   'Unsigned 8-bit integer. Range: 0..255.',
    uint16:  'Unsigned 16-bit integer. Range: 0..65_535.',
    uint32:  'Unsigned 32-bit integer. Range: 0..~4.3B.',
    uint64:  'Unsigned 64-bit integer. Range: 0..~1.8e19.',
    aint8:   'Atomic signed 8-bit integer.',
    aint16:  'Atomic signed 16-bit integer.',
    aint32:  'Atomic signed 32-bit integer.',
    aint64:  'Atomic signed 64-bit integer.',
    float32: 'IEEE-754 32-bit float. Suffix `f` on literals: `1.5f`. Aliased as `float`.',
    float:   'Alias for `float32`.',
    float64: 'IEEE-754 64-bit float (default float). Aliased as `double`.',
    double:  'Alias for `float64`.',
    string:  'UTF-8 text.',
    wstring: 'UTF-16 text.',
    char:    "Single 8-bit code unit. Literal: 'a'.",
    wchar:   'Wide character (16-bit code unit).',
    bool:    'Boolean — `true` or `false`.',
    void:    'No value. Used as return type for functions that produce no result.',
    size_t:  'Platform-natural unsigned integer for sizes.',

    // control flow
    if:       'Conditional branch. `if (cond) { ... } else { ... }`.',
    else:     'Companion to `if`. May chain via `else if`.',
    for:      'Counted or range-based loop.',
    while:    '`while (cond) { ... }`.',
    do:       '`do { ... } while (cond);`.',
    switch:   'C-style branching on integer/enum value.',
    match:    'Expression form: `match (x) { 1 => 10, _ => 0 }`.',
    case:     'Arm of a `switch` statement.',
    default:  'Fallback arm of a `switch`.',
    break:    'Exit innermost loop or `switch`.',
    continue: 'Skip to next iteration of innermost loop.',
    return:   'Return from current function.',
    goto:     'Jump to a labelled statement.',
    try:      'Begin a try-block. Pair with `catch`.',
    catch:    'Catch a thrown value.',
    throw:    'Raise an exception value.',
    defer:    '`defer { stmt; }` — runs at scope exit.',
    yield:    'Suspend a `coroutine` and emit a value.',

    // declarations
    class:     'Reference type with methods, constructor/destructor, inheritance.',
    struct:    'Aggregate value type.',
    interface: 'Pure-virtual contract.',
    enum:      'Named integer constants.',
    namespace: 'Scope for grouping declarations.',
    using:     '`using namespace ns;` to import names.',
    template:  'Generic declaration.',
    typedef:   '`typedef T Name;` — type alias.',
    decltype:  '`decltype(expr)` — deduce the static type of an expression.',
    typename:  'Template-parameter introducer.',
    mixin:     'Add methods to a type outside its body.',
    import:    'Load another module.',
    extern:    'Declare an externally-defined function or variable.',
    delegate:  'Function-type alias.',
    property:  'Field with custom getter/setter.',
    operator:  'Operator overload.',
    coroutine: '`coroutine` modifier on a function.',

    // modifiers
    static:    'Class-level (not per-instance) member.',
    const:     'Read-only after construction.',
    constexpr: 'Computed at compile time when inputs are constant.',
    override:  'Replaces a virtual method from a base class.',
    public:    'Member visible to all callers.',
    private:   'Member visible only inside the type.',
    nullable:  'Pointer/handle that may legitimately be null.',
    out:       'Output parameter; the function writes to it.',
    inline:    'Hint to inline at call site.',
    auto:      'Type inferred from initializer.',
    volatile:  'Suppress optimization through this access.',
    get:       'Property getter clause.',
    set:       'Property setter clause.',

    // literals
    true:    'Boolean true.',
    false:   'Boolean false.',
    null:    'Null pointer literal.',
    nullptr: 'Alias for `null`.',
    this:    'Implicit pointer to the current instance inside a method.',

    // memory / casts
    new:           'Heap-allocate.',
    delete:        'Free a heap pointer.',
    sizeof:        '`sizeof(T)` or `sizeof(expr)` — size in bytes.',
    offsetof:      '`offsetof(T, field)` — byte offset of a struct field.',
    static_assert: 'Compile-time check.',
    cast:          "`cast<T>(expr)` — Enma's general cast.",
    static_cast:   'Compile-time-checked numeric/class cast.',
    reinterpret_cast: 'Bit-pattern cast.',
    const_cast:    'Strip `const`.',
};

// ---- Operator overload name → glyph (for inlay hints) ------------------

export const OPERATOR_OVERLOADS: ReadonlyMap<string, string> = new Map([
    ['opNeg', '-'],     ['opCom', '~'],     ['opPreInc', '++'],   ['opPreDec', '--'],
    ['opPostInc', '++'],['opPostDec', '--'],
    ['opEquals', '=='], ['opCmp', '<=>'],
    ['opAssign', '='],  ['opAddAssign', '+='],['opSubAssign', '-='],['opMulAssign', '*='],
    ['opDivAssign', '/='],['opModAssign', '%='],['opAndAssign', '&='],['opOrAssign', '|='],
    ['opXorAssign', '^='],['opShlAssign', '<<='],['opShrAssign', '>>='],
    ['opAdd', '+'],     ['opSub', '-'],     ['opMul', '*'],     ['opDiv', '/'],     ['opMod', '%'],
    ['opAnd', '&'],     ['opOr', '|'],      ['opXor', '^'],     ['opShl', '<<'],    ['opShr', '>>'],
    ['opIndex', '[-]'], ['opCall', '(-)'],  ['opCast', 'cast'], ['opConv', 'convert'],
]);

// ---- Misc --------------------------------------------------------------

/** Re-export for convenience. */
export { isScopePathEqual };
