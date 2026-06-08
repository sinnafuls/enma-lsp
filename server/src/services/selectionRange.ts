// Selection range provider — smart "expand selection" levels.
//
// Builds a nested range chain for each requested position: the identifier/token
// under the caret, then each enclosing bracket pair (), [], {} from innermost
// to outermost, then the whole document. Token/bracket based so it works even
// when the AST failed to fully parse.

import * as lsp from 'vscode-languageserver';

import { TextPosition, TextRange } from '../compiler_tokenizer/textLocation';
import { positionBefore } from '../compiler_tokenizer/textLocation';
import { TokenObject, TokenKind } from '../compiler_tokenizer/tokenObject';

const OPEN_TO_CLOSE: Record<string, string> = { '(': ')', '[': ']', '{': '}' };

function contains(range: TextRange, p: TextPosition): boolean {
    // start <= p <= end
    return !positionBefore(p, range.start) && !positionBefore(range.end, p);
}

function spanLines(range: TextRange): number {
    return (range.end.line - range.start.line) * 100000 + (range.end.character - range.start.character);
}

/** All balanced bracket pairs (as ranges) that contain the caret, innermost first. */
function enclosingBracketRanges(tokens: ReadonlyArray<TokenObject>, caret: TextPosition): TextRange[] {
    const stack: TokenObject[] = [];
    const containing: TextRange[] = [];
    for (const t of tokens) {
        if (t.kind !== TokenKind.Punctuation) continue;
        if (OPEN_TO_CLOSE[t.text] !== undefined) {
            stack.push(t);
            continue;
        }
        if (t.text === ')' || t.text === ']' || t.text === '}') {
            const open = stack.pop();
            if (open === undefined) continue;
            if (OPEN_TO_CLOSE[open.text] !== t.text) continue;
            const range: TextRange = { start: open.location.start, end: t.location.end };
            if (contains(range, caret)) containing.push(range);
        }
    }
    containing.sort((a, b) => spanLines(a) - spanLines(b));
    return containing;
}

function documentRange(tokens: ReadonlyArray<TokenObject>): TextRange {
    let last: TextPosition = { line: 0, character: 0 };
    for (const t of tokens) {
        if (t.kind === TokenKind.EOF) continue;
        if (positionBefore(last, t.location.end)) last = t.location.end;
    }
    return { start: { line: 0, character: 0 }, end: last };
}

function buildChain(rangesInnerToOuter: TextRange[]): lsp.SelectionRange | undefined {
    let node: lsp.SelectionRange | undefined = undefined;
    for (let i = rangesInnerToOuter.length - 1; i >= 0; i--) {
        node = { range: rangesInnerToOuter[i], parent: node };
    }
    return node;
}

function rangeForPosition(tokens: ReadonlyArray<TokenObject>, caret: TextPosition): lsp.SelectionRange {
    const levels: TextRange[] = [];

    // Innermost: the token under the caret, if any.
    for (const t of tokens) {
        if (t.kind === TokenKind.EOF || t.kind === TokenKind.Comment) continue;
        if (contains(t.location, caret)) {
            levels.push({ start: t.location.start, end: t.location.end });
            break;
        }
    }

    for (const r of enclosingBracketRanges(tokens, caret)) levels.push(r);
    levels.push(documentRange(tokens));

    // Deduplicate identical consecutive ranges.
    const deduped: TextRange[] = [];
    for (const r of levels) {
        const prev = deduped[deduped.length - 1];
        if (prev !== undefined && prev.start.line === r.start.line && prev.start.character === r.start.character
            && prev.end.line === r.end.line && prev.end.character === r.end.character) continue;
        deduped.push(r);
    }

    return buildChain(deduped) ?? { range: { start: caret, end: caret } };
}

export function provideSelectionRanges(
    rawTokens: ReadonlyArray<TokenObject>,
    positions: TextPosition[],
): lsp.SelectionRange[] {
    return positions.map((p) => rangeForPosition(rawTokens, p));
}
