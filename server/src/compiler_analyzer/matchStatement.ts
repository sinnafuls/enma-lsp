// Match statement / expression analysis — exhaustiveness checking.
//
// When the subject expression resolves to an enum type, we warn if the arms
// don't cover every enum value (and there's no `_` wildcard arm).
//
// The actual subject type comes from the analyzer's expression pass; for
// hoist-time use, callers may pass `subjectType` undefined and we no-op.

import { NodeExprMatch, NodeKind } from '../compiler_parser/nodes';
import { analyzerDiagnostic } from './analyzerDiagnostic';
import { ResolvedType } from './resolvedType';
import { SymbolType } from './symbolObject';
import { tryGetActiveGlobalScope } from './symbolScope';

/**
 * Analyze a match expression / statement. Currently handles enum
 * exhaustiveness only — non-enum subjects are passed through silently.
 */
export function analyzeMatch(
    match: NodeExprMatch,
    subjectType: ResolvedType | undefined,
): void {
    if (subjectType === undefined) return;
    if (!subjectType.typeOrFunc.isType()) return;
    const sym = subjectType.typeOrFunc;
    if (!sym.isEnum) return;

    // Wildcard arm short-circuits.
    if (match.arms.some(a => a.isWildcard)) return;

    const enumValues = collectEnumValueNames(sym);
    if (enumValues.size === 0) return;

    const covered = new Set<string>();
    for (const arm of match.arms) {
        const p = arm.pattern;
        // Identifier or namespace-access patterns can name enum values.
        if (p.kind === NodeKind.ExprIdentifier) {
            covered.add(p.token.text);
        } else if (p.kind === NodeKind.ExprNamespaceAccess) {
            covered.add(p.member.text);
        }
    }

    const missing: string[] = [];
    for (const v of enumValues) if (!covered.has(v)) missing.push(v);

    if (missing.length > 0) {
        analyzerDiagnostic.warning(
            match.range.start
                ? { uri: '', start: match.range.start, end: match.range.end }
                : { uri: '', start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
            `non-exhaustive match on enum '${sym.identifierText}': missing ${missing.join(', ')}`,
            'EN_MATCH_NON_EXHAUSTIVE',
        );
    }
}

function collectEnumValueNames(enumSym: SymbolType): Set<string> {
    const out = new Set<string>();
    const path = enumSym.membersScopePath;
    if (path === undefined) return out;
    const global = tryGetActiveGlobalScope();
    if (!global) return out;
    const scope = global.resolveScope(path);
    if (!scope) return out;
    for (const key of scope.symbolTable.keys()) out.add(key);
    return out;
}
