// Implicit conversion lattice for primitives.
//
// Grounded in the Enma language reference (§2 "Primitive Types →
// Implicit-conversion rules"):
//
//   * same-sign integer widen / narrow (intN ↔ intM, uintN ↔ uintM): implicit
//   * int → float:                       implicit
//   * float32 → float64:                 implicit
//   * pointer ↔ int64 / uint64:          implicit (both 8-byte slots)
//   * function → int64 / uint64 / ptr:   implicit
//   * signed ↔ unsigned (any width):     COMPILE ERROR (needs cast<T>)
//   * float → int:                       COMPILE ERROR (would truncate)
//   * float64 → float32:                 COMPILE ERROR (narrowing)
//   * numeric literals are exempt from the strict checks (handled at the
//     call site by the statement walker, which knows whether the source is a
//     literal node).

import { ResolvedType } from './resolvedType';
import { SymbolType } from './symbolObject';

export type ConversionResult = 'identical' | 'widening' | 'narrowing' | 'lossy' | 'incompatible';

/** Diagnostic payload for an illegal implicit conversion. */
export interface ConversionError {
    readonly code: string;
    readonly message: string;
    readonly hint: string;
}

type NumericKind = 'sint' | 'uint' | 'float' | 'atomic';

interface NumericInfo {
    readonly kind: NumericKind;
    readonly bits: number;
}

const SIGNED: Record<string, true> = { int8: true, int16: true, int32: true, int64: true };
const UNSIGNED: Record<string, true> = { uint8: true, uint16: true, uint32: true, uint64: true, size_t: true };
const ATOMIC: Record<string, true> = { aint8: true, aint16: true, aint32: true, aint64: true };
const FLOAT: Record<string, true> = { float32: true, float: true, float64: true, double: true };

function bitsOf(name: string): number {
    const m = /(\d+)$/.exec(name);
    if (m) return parseInt(m[1], 10);
    if (name === 'size_t') return 64;
    if (name === 'float') return 32;
    if (name === 'double') return 64;
    return 64;
}

/** Classify a primitive's numeric family + width, or undefined if non-numeric. */
function numericInfo(t: SymbolType): NumericInfo | undefined {
    const n = t.identifierText;
    if (SIGNED[n]) return { kind: 'sint', bits: bitsOf(n) };
    if (UNSIGNED[n]) return { kind: 'uint', bits: bitsOf(n) };
    if (ATOMIC[n]) return { kind: 'atomic', bits: bitsOf(n) };
    if (FLOAT[n]) return { kind: 'float', bits: bitsOf(n) };
    return undefined;
}

/**
 * Conversion cost for overload ranking. Returns the cost of implicitly
 * converting `from` to `to`, or `null` when the conversion is not implicitly
 * legal (so the overload is not viable through it).
 *
 *   0 = identical / exact      1 = same-category widening (intN→intM, f32→f64)
 *   2 = derived → base         4 = cross-category (int→float)
 */
export function conversionCost(
    from: ResolvedType | undefined,
    to: ResolvedType | undefined,
): number | null {
    if (!from || !to) return null;
    if (from.equals(to)) return 0;
    if (!from.typeOrFunc.isType() || !to.typeOrFunc.isType()) {
        // function → int64 / uint64 / pointer is implicit.
        if (from.typeOrFunc.isFunction() && to.typeOrFunc.isType()) {
            const toT = to.typeOrFunc as SymbolType;
            if (to.pointerLevel > 0 || toT.identifierText === 'int64' || toT.identifierText === 'uint64') return 1;
        }
        return null;
    }

    const fromT = from.typeOrFunc as SymbolType;
    const toT = to.typeOrFunc as SymbolType;

    // Pointer handling.
    if (from.pointerLevel > 0 || to.pointerLevel > 0) {
        if (from.pointerLevel > 0 && to.pointerLevel > 0) {
            if (from.pointerLevel !== to.pointerLevel) return null;
            if (fromT.equals(toT)) return 0;
            // Derived* → Base* upcast: allowed at cost 2.
            if (isBaseOf(toT, fromT)) return 2;
            return null;
        }
        // pointer ↔ int64 / uint64 (one side is a scalar 8-byte slot).
        const ptrSlot = from.pointerLevel > 0 ? toT : fromT;
        if (ptrSlot.identifierText === 'int64' || ptrSlot.identifierText === 'uint64') return 1;
        return null;
    }

    const fi = numericInfo(fromT);
    const ti = numericInfo(toT);
    if (fi && ti) {
        // Atomics: only identity is implicit; treat the rest as not-implicit
        // but cost-wise unknown — keep them out of the strict not-viable set so
        // overload ranking degrades gracefully.
        if (fi.kind === 'atomic' || ti.kind === 'atomic') {
            return fi.kind === ti.kind && fi.bits === ti.bits ? 0 : null;
        }
        // Same family (same sign, same atomicity).
        if (fi.kind === ti.kind) return fi.bits === ti.bits ? 0 : 1;
        // int → float (either signedness): implicit, cost 4 (less preferred than int→int).
        if ((fi.kind === 'sint' || fi.kind === 'uint') && ti.kind === 'float') return 4;
        // float → int: never implicit (would truncate).
        if (fi.kind === 'float') return null;
        // sint ↔ uint: the engine allows this (corpus evidence); cost 2 so same-sign
        // overloads still win, but cross-sign calls don't hard-fail.
        if ((fi.kind === 'sint' || fi.kind === 'uint') && (ti.kind === 'sint' || ti.kind === 'uint')) return 2;
    }

    // enum → integer: Enma enums have an integral underlying type (§3); enum
    // values can be passed wherever any integer is expected. Cost 2.
    if (fromT.isEnum && ti !== undefined && (ti.kind === 'sint' || ti.kind === 'uint')) return 2;
    // integer → enum: also allowed (assigning int result back to enum var).
    if (toT.isEnum && fi !== undefined && (fi.kind === 'sint' || fi.kind === 'uint')) return 2;

    // derived → base (upcast) across class/struct inheritance.
    if (isBaseOf(toT, fromT)) return 2;

    return null;
}

/** True when `base` appears in `derived`'s base list (recursively). */
function isBaseOf(base: SymbolType, derived: SymbolType): boolean {
    const seen = new Set<SymbolType>();
    const walk = (t: SymbolType): boolean => {
        if (seen.has(t)) return false;
        seen.add(t);
        for (const b of t.baseList) {
            if (!b || !b.typeOrFunc.isType()) continue;
            const bt = b.typeOrFunc as SymbolType;
            if (bt.equals(base)) return true;
            if (walk(bt)) return true;
        }
        return false;
    };
    return walk(derived);
}

/**
 * Decide if `from` can be implicitly converted to `to`.
 * Retained for callers that want the coarse category; derived from cost.
 */
export function classifyConversion(
    from: ResolvedType | undefined,
    to: ResolvedType | undefined,
): ConversionResult {
    if (!from || !to) return 'incompatible';
    if (from.equals(to)) return 'identical';
    const cost = conversionCost(from, to);
    if (cost === null) {
        // Distinguish the documented error shapes for callers that care.
        return implicitConversionError(from, to) !== null ? 'lossy' : 'incompatible';
    }
    if (cost === 0) return 'identical';
    return 'widening';
}

/** Convenience: true if `from` is implicitly assignable to `to`. */
export function canImplicitlyAssign(
    from: ResolvedType | undefined,
    to: ResolvedType | undefined,
): boolean {
    return conversionCost(from, to) !== null;
}

/**
 * Return a diagnostic payload when assigning `from` to `to` is one of the
 * documented illegal implicit numeric conversions, else null.
 *
 * Only fires for float-truncation and float-precision-narrowing — the two
 * conversions where value loss is mathematically guaranteed. Signed/unsigned
 * mismatches are intentionally omitted: corpus evidence shows the engine
 * allows uint→int and int→uint assignments freely (e.g. `int64 pid = p.pid()`
 * where pid() returns uint32), so emitting EN_CONV_SIGN produces false
 * positives on real scripts.
 */
export function implicitConversionError(
    from: ResolvedType | undefined,
    to: ResolvedType | undefined,
): ConversionError | null {
    if (!from || !to) return null;
    if (from.equals(to)) return null;
    if (from.pointerLevel > 0 || to.pointerLevel > 0) return null;
    if (from.isReference || to.isReference) return null;
    if (!from.typeOrFunc.isType() || !to.typeOrFunc.isType()) return null;

    const fi = numericInfo(from.typeOrFunc as SymbolType);
    const ti = numericInfo(to.typeOrFunc as SymbolType);
    if (!fi || !ti) return null;
    if (fi.kind === 'atomic' || ti.kind === 'atomic') return null;

    const fromName = from.identifierText;
    const toName = to.identifierText;

    // float → int: truncation (always lossy).
    if (fi.kind === 'float' && (ti.kind === 'sint' || ti.kind === 'uint')) {
        return {
            code: 'EN_CONV_TRUNC',
            message: `cannot implicitly convert ${fromName} to ${toName} (would truncate float)`,
            hint: `use cast<${toName}>(...) to make the conversion explicit`,
        };
    }
    // float64 → float32: precision narrowing.
    if (fi.kind === 'float' && ti.kind === 'float' && fi.bits > ti.bits) {
        return {
            code: 'EN_CONV_NARROW',
            message: `cannot implicitly convert ${fromName} to ${toName} (narrowing)`,
            hint: `use cast<${toName}>(...) to make the conversion explicit`,
        };
    }

    return null;
}