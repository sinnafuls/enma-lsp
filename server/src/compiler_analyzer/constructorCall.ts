// Constructor lookup & call resolution.
//
// `new T(args)` analysis: locates T's constructor overload set, runs
// resolveCall, returns ResolvedType for T (with pointer-level=1 since `new`
// produces a heap pointer in Enma). Skeleton — full implementation in week 2.

import { TextLocation } from '../compiler_tokenizer/textLocation';
import { ResolvedType } from './resolvedType';
import {
    SymbolFunctionHolder,
    SymbolType,
} from './symbolObject';
import { SymbolScope, tryResolveActiveScope } from './symbolScope';
import { resolveCall } from './functionCall';

export interface ConstructorResult {
    type: ResolvedType | undefined;
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
    _scope: SymbolScope,
    type: SymbolType,
    argTypes: ReadonlyArray<ResolvedType | undefined>,
    location: TextLocation,
): ConstructorResult {
    const holder = findConstructorHolder(type);
    if (!holder) {
        // No explicit ctor — implicit one always succeeds. Return T*.
        return { type: new ResolvedType(type, 1) };
    }
    const r = resolveCall(holder, argTypes, location);
    if (r.selected) {
        return { type: new ResolvedType(type, 1) };
    }
    return { type: undefined };
}
