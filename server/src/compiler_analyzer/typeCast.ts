// `cast<T>(x)`, `static_cast<T>(x)`, `reinterpret_cast<T>(x)`,
// `const_cast<T>(x)` — type-preservation analysis.
//
// Returns the target type as ResolvedType. Reports diagnostics when the cast
// is provably unsound (e.g. const_cast away const between unrelated types).
// Skeleton implementation — full lattice arrives in week 2 alongside
// typeConversion.ts.

import { ResolvedType } from './resolvedType';
import { NodeExprCast } from '../compiler_parser/nodes';
import { SymbolScope } from './symbolScope';
import { analyzeType } from './analyzer';

export type CastKind = 'cast' | 'static_cast' | 'reinterpret_cast' | 'const_cast';

/** Produce the result type of a cast expression. */
export function analyzeCast(scope: SymbolScope, node: NodeExprCast): ResolvedType | undefined {
    return analyzeType(scope, node.targetType);
}
