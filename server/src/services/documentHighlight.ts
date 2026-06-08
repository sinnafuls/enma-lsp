// Document highlight provider — highlights every occurrence of the identifier
// under the caret within the current file, classified Read vs Write.
//
// Like the reference provider this is identifier-text based (the analyzer does
// not yet expose a populated reference table), but scoped to a single file so
// it matches editor expectations for "highlight occurrences".

import * as lsp from 'vscode-languageserver';

import { TextPosition, TextLocation } from '../compiler_tokenizer/textLocation';
import { TokenObject, TokenKind } from '../compiler_tokenizer/tokenObject';
import { findTokenAtPosition } from './utils';
const ASSIGN_OPERATORS: Record<string, true> = {
    '=': true, '+=': true, '-=': true, '*=': true, '/=': true, '%=': true,
    '&=': true, '|=': true, '^=': true, '<<=': true, '>>=': true,
};

function rangeOf(loc: TextLocation): lsp.Range {
    return {
        start: { line: loc.start.line, character: loc.start.character },
        end: { line: loc.end.line, character: loc.end.character },
    };
}

/** Next/previous token skipping comments (trivia). */
function neighbor(tokens: ReadonlyArray<TokenObject>, index: number, dir: 1 | -1): TokenObject | undefined {
    for (let i = index + dir; i >= 0 && i < tokens.length; i += dir) {
        const t = tokens[i];
        if (t.kind === TokenKind.Comment) continue;
        if (t.kind === TokenKind.EOF) return undefined;
        return t;
    }
    return undefined;
}

function classify(tokens: ReadonlyArray<TokenObject>, index: number): lsp.DocumentHighlightKind {
    const next = neighbor(tokens, index, 1);
    const prev = neighbor(tokens, index, -1);
    if (next !== undefined && next.kind === TokenKind.Operator) {
        if (ASSIGN_OPERATORS[next.text] === true) return lsp.DocumentHighlightKind.Write;
        if (next.text === '++' || next.text === '--') return lsp.DocumentHighlightKind.Write;
    }
    if (prev !== undefined && prev.kind === TokenKind.Operator) {
        if (prev.text === '++' || prev.text === '--') return lsp.DocumentHighlightKind.Write;
    }
    return lsp.DocumentHighlightKind.Read;
}

export function provideDocumentHighlight(
    rawTokens: ReadonlyArray<TokenObject>,
    caret: TextPosition,
): lsp.DocumentHighlight[] {
    const at = findTokenAtPosition(rawTokens, caret);
    if (at === undefined) return [];
    if (at.token.kind !== TokenKind.Identifier) return [];

    const targetName = at.token.text;
    const out: lsp.DocumentHighlight[] = [];
    for (let i = 0; i < rawTokens.length; i++) {
        const t = rawTokens[i];
        if (t.kind !== TokenKind.Identifier) continue;
        if (t.text !== targetName) continue;
        out.push({ range: rangeOf(t.location), kind: classify(rawTokens, i) });
    }
    return out;
}
