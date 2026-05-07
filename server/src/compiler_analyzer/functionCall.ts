// Function-call overload resolution.
//
// Skeleton — picks the first overload whose arity matches; the full ranked
// resolver lands in week 2 alongside typeConversion.ts (so it can rank
// candidates by conversion cost).

import { TextLocation } from '../compiler_tokenizer/textLocation';
import { ResolvedType } from './resolvedType';
import {
    SymbolFunction,
    SymbolFunctionHolder,
} from './symbolObject';
import { canImplicitlyAssign } from './typeConversion';
import { analyzerDiagnostic } from './analyzerDiagnostic';

export interface FunctionCallResolution {
    selected: SymbolFunction | undefined;
    /** Best-fit return type, or undefined when nothing matched. */
    returnType: ResolvedType | undefined;
}

/**
 * Pick the best overload for a call site.
 * - Exact-arity wins.
 * - Among exact-arity candidates, the one whose param types accept all the
 *   argument types implicitly (per typeConversion) wins.
 * - If none match, emit a diagnostic and return the first overload as a
 *   best-guess so downstream services don't crash.
 */
export function resolveCall(
    holder: SymbolFunctionHolder,
    argTypes: ReadonlyArray<ResolvedType | undefined>,
    location: TextLocation,
): FunctionCallResolution {
    const overloads = holder.overloadList;
    if (overloads.length === 0) return { selected: undefined, returnType: undefined };

    // Filter by arity (variadic accepts >= declared count).
    const arityCandidates: SymbolFunction[] = [];
    for (const ov of overloads) {
        const want = ov.parameterTypes.length;
        const have = argTypes.length;
        if (ov.isVariadic ? have >= want - 1 : have === want) arityCandidates.push(ov);
    }

    if (arityCandidates.length === 0) {
        analyzerDiagnostic.error(
            location,
            `No matching overload for '${holder.identifierText}': got ${argTypes.length} arg(s), expected ${overloads.map(o => o.parameterTypes.length).join('/')}`,
            'EN_NO_OVERLOAD',
        );
        return { selected: overloads[0], returnType: overloads[0].returnType };
    }

    // Score by implicit-assignability of every arg.
    let best: SymbolFunction | undefined;
    let bestScore = -1;
    for (const ov of arityCandidates) {
        let score = 0;
        let viable = true;
        const limit = Math.min(ov.parameterTypes.length, argTypes.length);
        for (let i = 0; i < limit; i++) {
            if (canImplicitlyAssign(argTypes[i], ov.parameterTypes[i])) {
                score++;
            } else {
                viable = false;
                break;
            }
        }
        if (viable && score > bestScore) {
            bestScore = score;
            best = ov;
        }
    }

    if (!best) best = arityCandidates[0];
    return { selected: best, returnType: best.returnType };
}
