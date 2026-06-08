// Constructor lookup & call resolution.
//
// `new T(args)` / `new T[N](args)` analysis: locates T's constructor overload
// set, ranks it against the argument types, and yields ResolvedType T* (pointer
// level 1 — `new` always produces a heap pointer in Enma, §7).

import { ResolvedType } from './resolvedType';
import { SymbolFunctionHolder, SymbolType } from './symbolObject';
import { tryResolveActiveScope } from './symbolScope';
import { resolveCall, CallResolutionStatus } from './functionCall';

export interface ConstructorResult {
    /** Resulting heap-pointer type `T*`, or undefined when no ctor matched. */
    type: ResolvedType | undefined;
    status: CallResolutionStatus;
}

export function findConstructorHolder(t: SymbolType): SymbolFunctionHolder | undefined {
    if (!t.membersScopePath) return undefined;
    const scope = tryResolveActiveScope(t.membersScopePath);
    if (!scope) return undefined;
    const holder = scope.lookupSymbol(t.identifierText);
    if (holder instanceof SymbolFunctionHolder) return holder;
    return undefined;
}

export function analyzeConstructorCall(
    type: SymbolType,
    argTypes: ReadonlyArray<ResolvedType | undefined>,
): ConstructorResult {
    const pointerToT = new ResolvedType(type, 1);
    const holder = findConstructorHolder(type);
    if (!holder) {
        // No explicit ctor — the implicit default/aggregate ctor always exists.
        return { type: pointerToT, status: 'ok' };
    }
    const r = resolveCall(holder, argTypes);
    if (r.status === 'no-match') return { type: pointerToT, status: 'no-match' };
    return { type: pointerToT, status: r.status };
}
