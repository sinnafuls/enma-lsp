// Lazy template monomorphization.
//
// Cache key tuple: (template-symbol, type-args, instantiating-scope-uri,
// mro-fingerprint). All four components MUST be in the cache key — different
// scope-URIs or different MRO contexts produce distinct instantiations.
//
// mro-fingerprint = stable FNV-1a hash of the C3 linearization of the
// enclosing class (or null when instantiating from a free-function context).

import { ResolvedType } from './resolvedType';
import {
    SymbolFunction,
    SymbolType,
} from './symbolObject';
import { computeMro } from './mro';

// Public alias so callers can refer to the Symbol shape used as a template handle.
// Templates in Enma are SymbolType (class/struct templates) or SymbolFunction
// (function templates).
export type SymbolTemplate = SymbolType | SymbolFunction;

interface CacheEntry {
    instance: SymbolFunction | SymbolType;
}

// keys: `${tmplKey}|${typeArgsKey}|${scopeUri}|${mroFingerprint}`
const s_cache: Map<string, CacheEntry> = new Map();

/**
 * Instantiate a template with the given type-args, scope-URI, and MRO
 * fingerprint. The cache key is the 4-tuple
 * `(template, typeArgs, scopeUri, mroFingerprint)` — mro-fingerprint
 * appears here because instantiations resolved through different ancestor
 * MROs can differ.
 */
export function instantiate(
    template: SymbolTemplate,
    typeArgs: ResolvedType[],
    scopeUri: string,
    mroFingerprint: string | null,
): SymbolFunction | SymbolType {
    const key = makeCacheKey(template, typeArgs, scopeUri, mroFingerprint);
    const hit = s_cache.get(key);
    if (hit) return hit.instance;

    // For now, instantiation produces a clone of the template handle with
    // template bindings recorded externally (the analyzer's expression pass
    // builds the TemplateTranslator). We don't deeply rewrite the AST; the
    // call/lookup site applies the translator on the fly.
    const instance: SymbolFunction | SymbolType = template;
    s_cache.set(key, { instance });
    return instance;
}

/** Compute the mro-fingerprint for a class context, or null for free-function. */
export function computeMroFingerprint(enclosingClass: SymbolType | null): string | null {
    if (enclosingClass === null) return null;
    const mro = computeMro(enclosingClass);
    const sig = mro.map(t => `${t.scopePath.join('::')}::${t.identifierText}`).join('->');
    return fnv1a(sig);
}

function makeCacheKey(
    template: SymbolTemplate,
    typeArgs: ResolvedType[],
    scopeUri: string,
    mroFingerprint: string | null,
): string {
    const tmplKey = `${template.scopePath.join('::')}::${template.identifierText}`;
    const argsKey = typeArgs.map(a => describeType(a)).join(',');
    return `${tmplKey}|${argsKey}|${scopeUri}|${mroFingerprint ?? '<null>'}`;
}

function describeType(t: ResolvedType): string {
    return `${t.typeOrFunc.scopePath.join('::')}::${t.identifierText}*${t.pointerLevel}${t.isReference ? '&' : ''}${t.isConst ? 'c' : ''}${t.isNullable ? '?' : ''}`;
}

/** FNV-1a 32-bit hex string. Stable, fast, no deps. */
function fnv1a(s: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    // Coerce to unsigned 32-bit and hex-encode.
    return (h >>> 0).toString(16).padStart(8, '0');
}

/** Test/maintenance hook — clear the instantiation cache. */
export function _resetInstantiationCache(): void {
    s_cache.clear();
}

/** Test hook — number of distinct instantiations recorded. */
export function _instantiationCacheSize(): number {
    return s_cache.size;
}
