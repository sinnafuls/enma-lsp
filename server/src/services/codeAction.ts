// Code action provider — quick-fixes.
//
//   1. AC-10 unknown-type quickfix: when a diagnostic has code 'EN_UNKNOWN_TYPE',
//      compute Levenshtein distance ≤2 against known type names and emit
//      "Did you mean 'X'?" actions with TextEdits replacing the bad span.
//   2. Pointer-rule misuse: '.' on pointer / '->' on value swap quickfix.
//      Emitted when diagnostic code matches AC-7 codes.
//   3. Missing 'override': insert 'override' keyword before the method's
//      return type. Emitted when code is 'EN_MISSING_OVERRIDE'.

import * as lsp from 'vscode-languageserver';

import { TextRange } from '../compiler_tokenizer/textLocation';
import { SymbolGlobalScope } from '../compiler_analyzer/symbolScope';
import { SymbolType } from '../compiler_analyzer/symbolObject';

export interface CodeActionContext {
    diagnostics: ReadonlyArray<lsp.Diagnostic>;
    uri: string;
}

export function provideCodeAction(
    globalScope: SymbolGlobalScope,
    range: TextRange,
    context: CodeActionContext,
): lsp.CodeAction[] {
    const actions: lsp.CodeAction[] = [];

    const knownTypes = collectKnownTypeNames(globalScope);

    for (const diag of context.diagnostics) {
        if (!intersects(range, diag.range)) continue;
        if (diag.code === 'EN_UNKNOWN_TYPE') {
            const word = wordFromRange(diag.message);
            if (word !== undefined) {
                const candidates = closeMatches(word, knownTypes, 2);
                for (const cand of candidates) {
                    actions.push({
                        title: `Did you mean '${cand}'?`,
                        kind: lsp.CodeActionKind.QuickFix,
                        diagnostics: [diag],
                        edit: {
                            changes: {
                                [context.uri]: [{ range: diag.range, newText: cand }],
                            },
                        },
                    });
                }
            }
        }
        if (diag.code === 'EN_DOT_ON_POINTER') {
            actions.push({
                title: "Use '->' on pointer",
                kind: lsp.CodeActionKind.QuickFix,
                diagnostics: [diag],
                edit: {
                    changes: {
                        [context.uri]: [{ range: diag.range, newText: '->' }],
                    },
                },
            });
        }
        if (diag.code === 'EN_ARROW_ON_VALUE') {
            actions.push({
                title: "Use '.' on value",
                kind: lsp.CodeActionKind.QuickFix,
                diagnostics: [diag],
                edit: {
                    changes: {
                        [context.uri]: [{ range: diag.range, newText: '.' }],
                    },
                },
            });
        }
        if (diag.code === 'EN_MISSING_OVERRIDE') {
            actions.push({
                title: "Add 'override'",
                kind: lsp.CodeActionKind.QuickFix,
                diagnostics: [diag],
                edit: {
                    changes: {
                        [context.uri]: [{
                            range: { start: diag.range.start, end: diag.range.start },
                            newText: 'override ',
                        }],
                    },
                },
            });
        }
    }

    return actions;
}

// ---- Known-type collection ---------------------------------------------

function collectKnownTypeNames(globalScope: SymbolGlobalScope): string[] {
    const names: string[] = [];
    for (const [, holder] of globalScope.symbolTable) {
        if (holder instanceof SymbolType) names.push(holder.identifierText);
    }
    // Walk one level into namespace children; stops noise from runaway recursion.
    for (const [, child] of globalScope.childScopeTable) {
        for (const [, h] of child.symbolTable) {
            if (h instanceof SymbolType) names.push(h.identifierText);
        }
    }
    // Add primitives explicitly (they may already be there as bundled).
    for (const p of [
        'int8','int16','int32','int64','uint8','uint16','uint32','uint64',
        'float32','float64','float','double','bool','char','wchar','string','wstring',
        'void','size_t','auto',
    ]) names.push(p);
    return names;
}

function closeMatches(word: string, candidates: string[], maxDist: number): string[] {
    const out: { name: string; dist: number }[] = [];
    for (const c of candidates) {
        if (c === word) continue;
        const d = levenshtein(word, c);
        if (d <= maxDist) out.push({ name: c, dist: d });
    }
    out.sort((a, b) => a.dist - b.dist);
    const dedup: string[] = [];
    const seen = new Set<string>();
    for (const o of out) {
        if (seen.has(o.name)) continue;
        seen.add(o.name);
        dedup.push(o.name);
        if (dedup.length >= 3) break;
    }
    return dedup;
}

function levenshtein(a: string, b: string): number {
    if (a === b) return 0;
    const m = a.length, n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    const dp = new Array<number>(n + 1);
    for (let j = 0; j <= n; j++) dp[j] = j;
    for (let i = 1; i <= m; i++) {
        let prev = dp[0];
        dp[0] = i;
        for (let j = 1; j <= n; j++) {
            const tmp = dp[j];
            const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
            dp[j] = Math.min(
                dp[j] + 1,           // deletion
                dp[j - 1] + 1,       // insertion
                prev + cost,         // substitution
            );
            prev = tmp;
        }
    }
    return dp[n];
}

function wordFromRange(message: string): string | undefined {
    // Diagnostic message format: "Unknown type 'flojat64'"
    const m = message.match(/'([^']+)'/);
    return m ? m[1] : undefined;
}

function intersects(a: TextRange, b: lsp.Range): boolean {
    if (a.end.line < b.start.line) return false;
    if (a.start.line > b.end.line) return false;
    return true;
}
