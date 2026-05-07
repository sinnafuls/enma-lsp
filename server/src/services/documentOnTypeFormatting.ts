// On-type formatting provider.
//
// Re-indents the current line based on enclosing brace depth in rawTokens.
// Trigger characters: ';', '}', '\n'. Indent unit: 4 spaces (or
// `enma.formatter.indentSpaces`).

import * as lsp from 'vscode-languageserver';

import { TextPosition } from '../compiler_tokenizer/textLocation';
import { TokenObject, TokenKind } from '../compiler_tokenizer/tokenObject';
import { positionLess } from './utils';

export interface OnTypeFormatOptions {
    indentSpaces: number;
}

export function documentOnTypeFormattingProvider(
    rawTokens: ReadonlyArray<TokenObject>,
    content: string,
    position: TextPosition,
    ch: string,
    options: OnTypeFormatOptions = { indentSpaces: 4 },
): lsp.TextEdit[] {
    if (ch !== ';' && ch !== '}' && ch !== '\n') return [];

    const lines = content.split(/\r?\n/);
    const lineIdx = position.line;
    if (lineIdx < 0 || lineIdx >= lines.length) return [];

    const lineText = lines[lineIdx];
    // Compute target depth by counting unmatched `{` minus `}` in tokens up to
    // this line's start.
    const depth = computeDepthBefore(rawTokens, { line: lineIdx, character: 0 });
    let target = depth;
    if (ch === '}' && lineText.trim() === '}') target = Math.max(0, depth - 1);

    const indent = ' '.repeat(target * options.indentSpaces);

    // Compute current leading whitespace.
    let cur = 0;
    while (cur < lineText.length && (lineText[cur] === ' ' || lineText[cur] === '\t')) cur++;

    if (lineText.slice(0, cur) === indent) return [];

    return [{
        range: {
            start: { line: lineIdx, character: 0 },
            end: { line: lineIdx, character: cur },
        },
        newText: indent,
    }];
}

function computeDepthBefore(rawTokens: ReadonlyArray<TokenObject>, p: TextPosition): number {
    let depth = 0;
    for (const t of rawTokens) {
        if (t.kind === TokenKind.EOF) break;
        if (!positionLess(t.location.start, p)) break;
        if (t.kind === TokenKind.Comment) continue;
        if (t.kind === TokenKind.String) continue;
        if (t.kind === TokenKind.Punctuation || t.kind === TokenKind.Operator) {
            if (t.text === '{') depth++;
            else if (t.text === '}') depth = Math.max(0, depth - 1);
        }
    }
    return depth;
}
