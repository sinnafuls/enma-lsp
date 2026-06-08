// `cast<T>(x)`, `static_cast<T>(x)`, `reinterpret_cast<T>(x)`,
// `const_cast<T>(x)` — result-type analysis.
//
// The result of a cast expression is its (decorated) target type. Casts are an
// explicit statement of intent by the author, so we do not second-guess the
// conversion here — validity diagnostics would need the engine's exact cast
// lattice (and would risk false positives on legitimate reinterpret/const
// casts), so they are intentionally left to the engine's own compile pass.

import { ResolvedType } from './resolvedType';
import { NodeExprCast } from '../compiler_parser/nodes';
import { SymbolScope } from './symbolScope';
import { analyzeType } from './analyzer';

export type CastKind = 'cast' | 'static_cast' | 'reinterpret_cast' | 'const_cast';

/** Produce the result type of a cast expression. */
export function analyzeCast(scope: SymbolScope, node: NodeExprCast): ResolvedType | undefined {
    return analyzeType(scope, node.targetType, true);
}
