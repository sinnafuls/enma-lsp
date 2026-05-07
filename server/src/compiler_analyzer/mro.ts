// §A3 — C3 linearization for multi-inheritance.
//
// Implements the Python 2.3+ C3 algorithm:
//   linearize(C) = [C] + merge(linearize(B1), ..., linearize(Bn), [B1, ..., Bn])
//
// Result is cached on `SymbolType.mroCache`. If the hierarchy cannot be
// linearized (no good head exists), we emit a diagnostic at class-decl time
// and return [self] as a degenerate fallback.
//
// Diamond hierarchies linearize fine; ambiguous-method-resolution diagnostics
// are emitted only at member-lookup time when two equal-rank bases each
// supply the same name.

import { analyzerDiagnostic } from './analyzerDiagnostic';
import { SymbolType, SymbolFunctionHolder } from './symbolObject';
import { SymbolScope, tryGetActiveGlobalScope } from './symbolScope';

/**
 * Compute the C3 linearization of `cls`. Returns the linearization including
 * `cls` at the head. Caches on cls.mroCache. On inconsistency, emits an
 * EN_MRO_INCONSISTENT diagnostic and returns [cls].
 */
export function computeMro(cls: SymbolType): SymbolType[] {
    const cached = cls.mroCache;
    if (cached !== undefined) return cached;

    const baseList = cls.baseList;
    const baseSyms: SymbolType[] = [];
    for (const b of baseList) {
        if (b !== undefined && b.typeOrFunc.isType()) {
            baseSyms.push(b.typeOrFunc);
        }
    }

    // Recurse to compute parent linearizations first.
    const parentLinearizations: SymbolType[][] = baseSyms.map(b => computeMro(b).slice());
    const baseOrder = baseSyms.slice();

    const merged = c3Merge([...parentLinearizations.map(l => l.slice()), baseOrder.slice()]);

    if (merged === undefined) {
        analyzerDiagnostic.errorForce(
            cls.identifierToken.location,
            `inconsistent multi-inheritance hierarchy: cannot linearize '${cls.identifierText}'`,
            'EN_MRO_INCONSISTENT',
        );
        const fallback = [cls];
        cls.setMroCache(fallback);
        return fallback;
    }

    const result = [cls, ...merged];
    cls.setMroCache(result);
    return result;
}

/** Pure C3 merge step. Returns undefined when no good head is found. */
function c3Merge(lists: SymbolType[][]): SymbolType[] | undefined {
    const result: SymbolType[] = [];

    // Strip empties.
    let working = lists.filter(l => l.length > 0);

    while (working.length > 0) {
        let pickedHead: SymbolType | undefined;

        for (const list of working) {
            const head = list[0];
            // "good head" = appears in no other list's tail
            const inOtherTail = working.some(other => {
                if (other === list) return false;
                for (let i = 1; i < other.length; i++) {
                    if (typesEqual(other[i], head)) return true;
                }
                return false;
            });
            if (!inOtherTail) {
                pickedHead = head;
                break;
            }
        }

        if (pickedHead === undefined) return undefined;

        result.push(pickedHead);

        // Strip the head from every list whose head equals pickedHead.
        working = working
            .map(l => (typesEqual(l[0], pickedHead!) ? l.slice(1) : l))
            .filter(l => l.length > 0);
    }

    return result;
}

function typesEqual(a: SymbolType, b: SymbolType): boolean {
    return a === b || a.equals(b);
}

/**
 * Look up a member name across the MRO of `cls`. If two non-equal-rank
 * bases supply the same name, the higher-priority one wins silently. If
 * two equal-rank (siblings) bases supply the same name, emit AC-18
 * ambiguous-method-resolution.
 */
export function lookupMroMember(
    cls: SymbolType,
    name: string,
): { holder: ReturnType<SymbolScope['lookupSymbol']>; from: SymbolType } | undefined {
    const mro = computeMro(cls);
    const global = tryGetActiveGlobalScope();
    if (!global) return undefined;

    // Walk MRO; among DIRECT bases (siblings of cls), check for ambiguity.
    const directBases: SymbolType[] = [];
    for (const b of cls.baseList) {
        if (b !== undefined && b.typeOrFunc.isType()) directBases.push(b.typeOrFunc);
    }

    const directHits: { holder: NonNullable<ReturnType<SymbolScope['lookupSymbol']>>; from: SymbolType }[] = [];
    for (const base of directBases) {
        const hit = lookupOnType(global, base, name);
        if (hit) directHits.push({ holder: hit, from: base });
    }

    if (directHits.length > 1) {
        // Equal-rank ambiguity at this class's own bases.
        analyzerDiagnostic.errorForce(
            cls.identifierToken.location,
            `ambiguous method resolution for '${name}' on '${cls.identifierText}': inherited from ${directHits.map(h => h.from.identifierText).join(' and ')}`,
            'EN_MRO_AMBIGUOUS',
        );
    }

    for (const ancestor of mro) {
        const hit = lookupOnType(global, ancestor, name);
        if (hit) return { holder: hit, from: ancestor };
    }
    return undefined;
}

function lookupOnType(
    global: ReturnType<typeof tryGetActiveGlobalScope> & object,
    type: SymbolType,
    name: string,
): NonNullable<ReturnType<SymbolScope['lookupSymbol']>> | undefined {
    const path = type.membersScopePath;
    if (path === undefined) return undefined;
    const scope = global.resolveScope(path);
    if (!scope) return undefined;
    const sym = scope.lookupSymbol(name);
    if (sym instanceof SymbolFunctionHolder || sym !== undefined) return sym;
    return undefined;
}

