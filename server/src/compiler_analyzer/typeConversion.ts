// Implicit conversion lattice for primitives.
//
// Expanded in week 2 with the full numeric promotion rules. Skeleton
// supplies the predicates the rest of the analyzer needs to compile.

import { ResolvedType } from './resolvedType';
import { isFloatType, isIntegerType, isNumberType } from './builtinType';
import { SymbolType } from './symbolObject';

export type ConversionResult = 'identical' | 'widening' | 'narrowing' | 'lossy' | 'incompatible';

/**
 * Decide if `from` can be implicitly converted to `to`.
 * - identical:    same type
 * - widening:     int8 → int32, float32 → float64, etc.
 * - narrowing:    int64 → int32 (warning at call sites)
 * - lossy:        float → int (error unless explicit cast)
 * - incompatible: structurally different types
 */
export function classifyConversion(
    from: ResolvedType | undefined,
    to: ResolvedType | undefined,
): ConversionResult {
    if (!from || !to) return 'incompatible';
    if (from.equals(to)) return 'identical';

    if (!from.typeOrFunc.isType() || !to.typeOrFunc.isType()) return 'incompatible';

    const fromT = from.typeOrFunc as SymbolType;
    const toT = to.typeOrFunc as SymbolType;

    // Pointer-to-pointer is identity-only at this level (more rules in week 2).
    if (from.pointerLevel > 0 || to.pointerLevel > 0) {
        return from.pointerLevel === to.pointerLevel && fromT.equals(toT) ? 'identical' : 'incompatible';
    }

    // Numeric lattice.
    if (isNumberType(fromT) && isNumberType(toT)) {
        const fromBits = bitsOfNumber(fromT);
        const toBits = bitsOfNumber(toT);
        const fromIsFloat = isFloatType(fromT);
        const toIsFloat = isFloatType(toT);

        if (fromIsFloat && !toIsFloat) return 'lossy';
        if (!fromIsFloat && toIsFloat) {
            return fromBits <= toBits ? 'widening' : 'narrowing';
        }
        // Same family.
        if (fromBits < toBits) return 'widening';
        if (fromBits > toBits) return 'narrowing';
        return 'identical';
    }

    if (isIntegerType(fromT) && isIntegerType(toT)) return 'widening';

    return 'incompatible';
}

function bitsOfNumber(t: SymbolType): number {
    const m = /(\d+)$/.exec(t.identifierText);
    if (m) return parseInt(m[1], 10);
    if (t.identifierText === 'size_t') return 64;
    if (t.identifierText === 'float') return 32;
    if (t.identifierText === 'double') return 64;
    return 32;
}

/** Convenience: true if `from` is implicitly assignable to `to`. */
export function canImplicitlyAssign(
    from: ResolvedType | undefined,
    to: ResolvedType | undefined,
): boolean {
    const r = classifyConversion(from, to);
    return r === 'identical' || r === 'widening';
}
