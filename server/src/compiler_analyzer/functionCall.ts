// Function-call overload resolution.
//
// Grounded in the Enma reference (§6 "Overloading"):
//   * an exact type match wins;
//   * otherwise a single widening step is applied (int→int, float→float,
//     int→float, derived→base);
//   * int→int is preferred over int→float;
//   * a call matching no variant, or two equally well, is a compile error.
//
// Costs come from the native-overload model (same-category = 1, cross-category
// int→float = 4) so the "int→int preferred over int→float" tie-break falls out
// of picking the lowest total cost.

import { ResolvedType } from './resolvedType';
import { SymbolFunction, SymbolFunctionHolder, SymbolType } from './symbolObject';
import { conversionCost } from './typeConversion';

export type CallResolutionStatus = 'ok' | 'no-match' | 'ambiguous';

export interface FunctionCallResolution {
    selected: SymbolFunction | undefined;
    /** Best-fit return type, or undefined when nothing matched. */
    returnType: ResolvedType | undefined;
    /**
     * 'ok' — a single best overload (or resolution could not be trusted, so
     * callers must not raise a diagnostic). 'no-match' / 'ambiguous' are only
     * ever returned when the candidate set was fully analysable (every
     * overload AST-linked, every argument type known), so a caller can emit a
     * diagnostic without risking a false positive.
     */
    status: CallResolutionStatus;
}

interface Arity {
    readonly min: number;
    readonly max: number; // Number.POSITIVE_INFINITY for variadic
    readonly known: boolean;
}

function arityOf(fn: SymbolFunction): Arity {
    const node = fn.linkedNode;
    const params = node !== undefined && 'params' in node ? node.params : undefined;
    if (params === undefined) {
        // Destructor or synthesized (predefined / bundled stdlib) signature —
        // default-arg info is unavailable, so arity cannot be trusted.
        const n = fn.parameterTypes.length;
        return { min: fn.isVariadic ? Math.max(0, n - 1) : n, max: fn.isVariadic ? Number.POSITIVE_INFINITY : n, known: false };
    }
    let required = 0;
    let variadic = false;
    for (const p of params) {
        if (p.isVariadic) { variadic = true; continue; }
        if (p.defaultValue === null) required++;
    }
    const fixed = params.filter(p => !p.isVariadic).length;
    return {
        min: required,
        max: variadic ? Number.POSITIVE_INFINITY : fixed,
        known: true,
    };
}

/** Total conversion cost of binding `argTypes` to `fn`, or null if not viable.
 *  Undefined parameter types (predefined files with out-of-order hoisting) and
 *  template type parameters act as wildcards — they accept any argument at cost 0. */
function bindingCost(fn: SymbolFunction, argTypes: ReadonlyArray<ResolvedType | undefined>): number | null {
    const limit = Math.min(fn.parameterTypes.length, argTypes.length);
    let cost = 0;
    for (let i = 0; i < limit; i++) {
        const param = fn.parameterTypes[i];
        // Wildcard: unknown param type or template type parameter accepts anything.
        if (param === undefined) continue;
        if (param.typeOrFunc.isType() && (param.typeOrFunc as SymbolType).isTypeParameter) continue;
        const c = conversionCost(argTypes[i], param);
        if (c === null) return null;
        cost += c;
    }
    return cost;
}

export function resolveCall(
    holder: SymbolFunctionHolder,
    argTypes: ReadonlyArray<ResolvedType | undefined>,
): FunctionCallResolution {
    const overloads = holder.overloadList;
    if (overloads.length === 0) return { selected: undefined, returnType: undefined, status: 'ok' };

    const argc = argTypes.length;
    const arityMatches = overloads.filter(ov => {
        const a = arityOf(ov);
        return argc >= a.min && argc <= a.max;
    });

    // Trustworthy only when every overload is AST-linked (defaults known) and
    // every argument type was deduced. Otherwise fall back to a best guess and
    // never report an error.
    const trustworthy = overloads.every(ov => arityOf(ov).known) && argTypes.every(t => t !== undefined);

    if (!trustworthy) {
        const guess = arityMatches[0] ?? overloads[0];
        return { selected: guess, returnType: guess.returnType, status: 'ok' };
    }

    if (arityMatches.length === 0) {
        return { selected: undefined, returnType: undefined, status: 'no-match' };
    }

    // Rank arity-viable candidates by total conversion cost.
    let bestCost = Number.POSITIVE_INFINITY;
    let best: SymbolFunction | undefined;
    let tie = false;
    for (const ov of arityMatches) {
        const c = bindingCost(ov, argTypes);
        if (c === null) continue;
        if (c < bestCost) { bestCost = c; best = ov; tie = false; }
        else if (c === bestCost) { tie = true; }
    }

    if (best === undefined) return { selected: undefined, returnType: undefined, status: 'no-match' };
    if (tie) return { selected: best, returnType: best.returnType, status: 'ambiguous' };
    return { selected: best, returnType: best.returnType, status: 'ok' };
}
