// Code action provider — quick-fixes + refactor + source actions.
//
//   1. EN_UNKNOWN_TYPE quickfix: Levenshtein ≤2 "Did you mean?" candidates.
//   2. EN_DOT_ON_POINTER / EN_ARROW_ON_VALUE: access-operator swap.
//   3. EN_MISSING_OVERRIDE: insert 'override'.
//   4. source.organizeImports: sort + deduplicate `import "..."` statements.
//   5. source.fixAll: apply all in-range quick-fixes at once.
//   6. refactor.rewrite.cast: wrap expression in cast<T>(x) (emitted on
//      EN_IMPLICIT_LOSSY diagnostics — available for future use).

import * as lsp from 'vscode-languageserver';

import { TextRange } from '../compiler_tokenizer/textLocation';
import { SymbolGlobalScope } from '../compiler_analyzer/symbolScope';
import { SymbolType } from '../compiler_analyzer/symbolObject';

export interface CodeActionContext {
    diagnostics: ReadonlyArray<lsp.Diagnostic>;
    uri: string;
    /** Raw file content — required for source.organizeImports. */
    content?: string;
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

    // ---- source.organizeImports -----------------------------------------
    if (context.content !== undefined) {
        const importAction = buildOrganizeImportsAction(context.uri, context.content);
        if (importAction !== undefined) actions.push(importAction);
    }

    // ---- source.fixAll --------------------------------------------------
    if (actions.some((a) => a.kind === lsp.CodeActionKind.QuickFix)) {
        actions.push({
            title: 'Fix all Enma issues',
            kind: lsp.CodeActionKind.SourceFixAll,
            edit: mergeEdits(
                actions
                    .filter((a) => a.kind === lsp.CodeActionKind.QuickFix && a.edit !== undefined)
                    .map((a) => a.edit!),
                context.uri,
            ),
        });
    }

    return actions;
}

// ---- source.organizeImports -------------------------------------------

/** Parse + sort + dedupe import "..." lines; return a CodeAction replacing them. */
function buildOrganizeImportsAction(uri: string, content: string): lsp.CodeAction | undefined {
    const lines = content.split('\n');
    const importLineRe = /^(\s*import\s+"[^"]*"\s*;)(.*)$/;
    interface ImportLine { line: number; module: string; raw: string }
    const found: ImportLine[] = [];

    for (let i = 0; i < lines.length; i++) {
        const m = importLineRe.exec(lines[i]);
        if (m) {
            const modMatch = /"([^"]*)"/.exec(m[1]);
            found.push({ line: i, module: modMatch ? modMatch[1] : m[1], raw: m[1] + m[2] });
        }
    }
    if (found.length === 0) return undefined;

    // Sort by module name (case-insensitive), deduplicate.
    const sorted = [...found].sort((a, b) => a.module.localeCompare(b.module, undefined, { sensitivity: 'base' }));
    const seen = new Set<string>();
    const deduped: ImportLine[] = [];
    for (const imp of sorted) {
        if (!seen.has(imp.module)) { seen.add(imp.module); deduped.push(imp); }
    }

    // Check if already ordered + deduped.
    const alreadySorted = found.length === deduped.length &&
        found.every((f, i) => f.module === deduped[i].module);
    if (alreadySorted) return undefined;

    // Build edits: one TextEdit per original import line replacing it with the
    // sorted counterpart (or empty string for duplicates).
    const edits: lsp.TextEdit[] = [];
    for (let i = 0; i < found.length; i++) {
        const lineIdx = found[i].line;
        const newText = i < deduped.length ? deduped[i].raw : '';
        if (found[i].raw !== newText) {
            edits.push({
                range: {
                    start: { line: lineIdx, character: 0 },
                    end: { line: lineIdx, character: lines[lineIdx].length },
                },
                newText,
            });
        }
    }
    if (edits.length === 0) return undefined;

    return {
        title: 'Organize imports',
        kind: lsp.CodeActionKind.SourceOrganizeImports,
        edit: { changes: { [uri]: edits } },
    };
}

// ---- Edit helpers -------------------------------------------------------

function mergeEdits(
    edits: lsp.WorkspaceEdit[],
    uri: string,
): lsp.WorkspaceEdit {
    const all: lsp.TextEdit[] = [];
    const seenRanges = new Set<string>();
    for (const edit of edits) {
        const fileEdits = edit.changes?.[uri] ?? [];
        for (const e of fileEdits) {
            const key = `${e.range.start.line}:${e.range.start.character}-${e.range.end.line}:${e.range.end.character}`;
            if (!seenRanges.has(key)) { seenRanges.add(key); all.push(e); }
        }
    }
    return { changes: { [uri]: all } };
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
