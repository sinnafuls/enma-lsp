// Workspace symbol provider — Ctrl+T / Cmd+T fuzzy symbol search.
//
// Aggregates symbols from every analyzed global scope and ranks them against
// the query. Recurses into namespace / class / struct / interface / enum
// scopes so deeply-nested declarations are reachable.
//
// Ranking: case-insensitive substring match with a small bonus for prefix
// matches and an even smaller bonus for matching the symbol's identifier
// segment count. The user types a fragment, we surface the closest matches.

import * as lsp from 'vscode-languageserver';

import {
    SymbolGlobalScope,
    SymbolScope,
} from '../compiler_analyzer/symbolScope';
import {
    SymbolFunctionHolder,
    SymbolObjectHolder,
    SymbolType,
    SymbolVariable,
} from '../compiler_analyzer/symbolObject';

const MAX_RESULTS = 200;

interface RankedSymbol {
    score: number;
    symbol: lsp.SymbolInformation;
}

export function provideWorkspaceSymbol(
    query: string,
    globalScopes: ReadonlyArray<SymbolGlobalScope>,
): lsp.SymbolInformation[] {
    const ranked: RankedSymbol[] = [];
    const needle = query.toLowerCase();

    for (const scope of globalScopes) {
        walkScope(scope, needle, ranked, []);
    }

    ranked.sort((a, b) => b.score - a.score);
    return ranked.slice(0, MAX_RESULTS).map(r => r.symbol);
}

function walkScope(
    scope: SymbolScope,
    needle: string,
    out: RankedSymbol[],
    containerPath: string[],
): void {
    for (const [name, holder] of scope.symbolTable) {
        const score = matchScore(name, needle);
        if (score > 0) {
            const sym = holderToSymbol(name, holder, containerPath);
            if (sym !== undefined) out.push({ score, symbol: sym });
        }
    }

    for (const [childName, child] of scope.childScopeTable) {
        // Anonymous block scopes (`for`, `if`, `while`, lambdas, …) carry
        // synthesized keys we don't want to surface as container paths.
        const isNamedContainer = !childName.startsWith('$');
        const nextPath = isNamedContainer ? [...containerPath, childName] : containerPath;
        walkScope(child, needle, out, nextPath);
    }
}

/**
 * Return a positive score when `name` matches `needle`, else 0.
 *
 * - exact match              → 1000
 * - prefix match             → 500 + length-bonus
 * - case-insensitive substr  → 250 + position-bonus
 * - empty query              → 100 (everything matches, no ranking signal)
 */
function matchScore(name: string, needle: string): number {
    if (needle.length === 0) return 100;
    const lower = name.toLowerCase();
    if (lower === needle) return 1000;
    if (lower.startsWith(needle)) return 500 + Math.max(0, 100 - (name.length - needle.length));
    const idx = lower.indexOf(needle);
    if (idx >= 0) return 250 + Math.max(0, 100 - idx);
    return 0;
}

function holderToSymbol(
    name: string,
    holder: SymbolObjectHolder,
    containerPath: string[],
): lsp.SymbolInformation | undefined {
    let kind: lsp.SymbolKind;
    const token = holder instanceof SymbolFunctionHolder
        ? holder.first.identifierToken
        : holder.identifierToken;

    if (holder instanceof SymbolFunctionHolder) {
        kind = holder.first.isInstanceMember ? lsp.SymbolKind.Method : lsp.SymbolKind.Function;
    } else if (holder instanceof SymbolType) {
        if (holder.isEnum) kind = lsp.SymbolKind.Enum;
        else if (holder.isInterface) kind = lsp.SymbolKind.Interface;
        else if (holder.isStruct) kind = lsp.SymbolKind.Struct;
        else if (holder.isPrimitive()) kind = lsp.SymbolKind.TypeParameter;
        else kind = lsp.SymbolKind.Class;
    } else if (holder instanceof SymbolVariable) {
        if (holder.isInstanceMember) kind = lsp.SymbolKind.Property;
        else if (holder.isConst) kind = lsp.SymbolKind.Constant;
        else kind = lsp.SymbolKind.Variable;
    } else {
        return undefined;
    }

    return {
        name,
        kind,
        location: {
            uri: token.location.uri,
            range: {
                start: token.location.start,
                end: token.location.end,
            },
        },
        containerName: containerPath.length > 0 ? containerPath.join('::') : undefined,
    };
}
