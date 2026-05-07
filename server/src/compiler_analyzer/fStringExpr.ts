// F-string analysis (§A2).
//
// We don't own the analyzer's expression dispatcher yet (functionCall.ts is
// stubbed during week 2). For now we walk f-string parts, recursively visit
// any `expr` part with the supplied analyzer hook, and emit a soft warning if
// the expression's deduced type is undefined (couldn't be resolved at all).

import { NodeExprFString } from '../compiler_parser/nodes';
import { analyzerDiagnostic } from './analyzerDiagnostic';
import { ResolvedType } from './resolvedType';

export type ExprAnalyzer = (e: import('../compiler_parser/nodes').NodeExpr) => ResolvedType | undefined;

/**
 * Analyze each interpolated `expr` part. The provided `analyzeExpr` is the
 * analyzer's expression dispatcher; we call it for every `expr` part and
 * emit `EN_FSTRING_UNKNOWN_TYPE` (warning) when the type doesn't resolve.
 */
export function analyzeFString(
    fstring: NodeExprFString,
    analyzeExpr: ExprAnalyzer,
): void {
    for (const part of fstring.parts) {
        if (part.kind !== 'expr') continue;
        const t = analyzeExpr(part.expr);
        if (t === undefined) {
            analyzerDiagnostic.warning(
                { uri: '', start: part.openRange.start, end: part.closeRange.end },
                `f-string interpolation has unresolved type`,
                'EN_FSTRING_UNKNOWN_TYPE',
            );
        }
    }
}
