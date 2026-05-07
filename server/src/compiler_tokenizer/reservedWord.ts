// Canonical keyword list sourced from client/legacy/extension.js KEYWORD_HOVERS (lines 23-119)

export const KEYWORDS: ReadonlySet<string> = new Set([
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

export const PRIMITIVES: ReadonlySet<string> = new Set([
    'int8', 'int16', 'int32', 'int64',
    'uint8', 'uint16', 'uint32', 'uint64',
    'aint8', 'aint16', 'aint32', 'aint64',
    'float32', 'float', 'float64', 'double',
    'char', 'wchar', 'bool', 'string', 'wstring', 'void', 'size_t', 'auto', 'nullable',
]);

export const INTRINSICS: ReadonlySet<string> = new Set([
    '__va_count', '__va_arg',
    '__asm_rdtsc', '__asm_pause', '__asm_mfence', '__asm_nop',
]);

export const RESERVED_WORDS: ReadonlySet<string> = new Set([
    ...KEYWORDS,
    ...INTRINSICS,
]);

export function isReserved(name: string): boolean {
    return RESERVED_WORDS.has(name);
}

export function isPrimitive(name: string): boolean {
    return PRIMITIVES.has(name);
}

export function isIntrinsic(name: string): boolean {
    return INTRINSICS.has(name);
}

export function isKeyword(name: string): boolean {
    return KEYWORDS.has(name);
}
