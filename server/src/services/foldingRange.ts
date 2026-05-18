// Folding range provider.
//
// Walks the raw token stream to find:
//   - balanced `{` / `}` braces at every nesting depth → one fold per pair
//   - multi-line block comments (`/* … */`)              → one fold per comment
//   - consecutive `//`-line-comment blocks               → one fold per run
//   - `#region` / `#endregion` markers in `//` comments  → one fold per region
//
// We deliberately do NOT walk the AST here. Folding has to keep working on a
// syntactically broken file (mid-typing), and the raw token stream is the only
// representation guaranteed to exist when the parser bails.
//
// All ranges use FoldingRangeKind.Region by default; comment ranges are tagged
// FoldingRangeKind.Comment so editors can collapse-all-comments separately.

import * as lsp from 'vscode-languageserver';

import { TokenObject, TokenKind } from '../compiler_tokenizer/tokenObject';

const REGION_OPEN  = /^\/\/\s*#?region\b/;
const REGION_CLOSE = /^\/\/\s*#?endregion\b/;

export function provideFoldingRanges(
    rawTokens: ReadonlyArray<TokenObject>,
): lsp.FoldingRange[] {
    const ranges: lsp.FoldingRange[] = [];

    // ---- {} pairs ------------------------------------------------------
    const braceStack: number[] = [];
    for (const tok of rawTokens) {
        if (tok.kind !== TokenKind.Punctuation && tok.kind !== TokenKind.Operator) {
            // Some grammars classify braces as Punctuation; some as Operator.
            // The check is cheap — accept both.
        }
        if (tok.text === '{') {
            braceStack.push(tok.location.start.line);
        } else if (tok.text === '}') {
            const open = braceStack.pop();
            if (open !== undefined && tok.location.end.line > open) {
                ranges.push({
                    startLine: open,
                    endLine: tok.location.end.line - 1,
                    kind: lsp.FoldingRangeKind.Region,
                });
            }
        }
    }

    // ---- Block + line comments + #region/#endregion --------------------
    let lineCommentRunStart = -1;
    let lineCommentRunEnd   = -1;
    const regionStack: number[] = [];

    const flushLineRun = () => {
        if (lineCommentRunStart >= 0 && lineCommentRunEnd > lineCommentRunStart) {
            ranges.push({
                startLine: lineCommentRunStart,
                endLine: lineCommentRunEnd,
                kind: lsp.FoldingRangeKind.Comment,
            });
        }
        lineCommentRunStart = -1;
        lineCommentRunEnd   = -1;
    };

    for (const tok of rawTokens) {
        if (tok.kind !== TokenKind.Comment) {
            flushLineRun();
            continue;
        }

        // Block comments fold as a single range when they span >1 line.
        if (tok.commentKind === 'block') {
            flushLineRun();
            if (tok.location.end.line > tok.location.start.line) {
                ranges.push({
                    startLine: tok.location.start.line,
                    endLine: tok.location.end.line,
                    kind: lsp.FoldingRangeKind.Comment,
                });
            }
            continue;
        }

        // Line comment: detect #region/#endregion first.
        const text = tok.text;
        if (REGION_OPEN.test(text)) {
            flushLineRun();
            regionStack.push(tok.location.start.line);
            continue;
        }
        if (REGION_CLOSE.test(text)) {
            flushLineRun();
            const open = regionStack.pop();
            if (open !== undefined && tok.location.start.line > open) {
                ranges.push({
                    startLine: open,
                    endLine: tok.location.start.line,
                    kind: lsp.FoldingRangeKind.Region,
                });
            }
            continue;
        }

        // Consecutive `//` comments collapse into a single fold range.
        const line = tok.location.start.line;
        if (lineCommentRunStart < 0) {
            lineCommentRunStart = line;
            lineCommentRunEnd   = line;
        } else if (line === lineCommentRunEnd + 1) {
            lineCommentRunEnd = line;
        } else {
            flushLineRun();
            lineCommentRunStart = line;
            lineCommentRunEnd   = line;
        }
    }
    flushLineRun();

    return ranges;
}
