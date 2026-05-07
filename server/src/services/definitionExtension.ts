// Definition fallback for non-symbol tokens. Currently:
//   - When caret is on a TokenString preceded by `#include` / `import`,
//     resolve the include path against the file's directory and return a
//     Location pointing at the start of the included file.

import * as lsp from 'vscode-languageserver';

import { TextPosition } from '../compiler_tokenizer/textLocation';
import { TokenObject, TokenKind } from '../compiler_tokenizer/tokenObject';
import { findTokenAtPosition } from './utils';
import { resolveIncludeUri } from '../inspector/inspector';

export function provideDefinitionFallback(
    rawTokens: ReadonlyArray<TokenObject>,
    fileUri: string,
    caret: TextPosition,
    workspaceRoot?: string,
): lsp.Location[] {
    const at = findTokenAtPosition(rawTokens, caret);
    if (at === undefined) return [];

    const token = at.token;
    if (token.kind !== TokenKind.String) return [];

    // Walk backwards a couple tokens to look for `#include` / `import`.
    let isIncludePath = false;
    for (let i = at.index - 1; i >= 0 && i >= at.index - 4; i--) {
        const t = rawTokens[i];
        if (t.kind === TokenKind.Comment) continue;
        if (t.kind === TokenKind.Preprocessor && /include/.test(t.text)) {
            isIncludePath = true;
            break;
        }
        if (t.kind === TokenKind.Reserved && t.text === 'import') {
            isIncludePath = true;
            break;
        }
        if (t.kind === TokenKind.Punctuation && t.text === '#') continue;
        if (t.kind === TokenKind.Identifier && t.text === 'include') {
            isIncludePath = true;
            break;
        }
        // Not a quoted include — bail.
        break;
    }

    if (!isIncludePath) return [];

    // Strip surrounding quotes from token text.
    let raw = token.text;
    if ((raw.startsWith('"') && raw.endsWith('"')) ||
        (raw.startsWith('<') && raw.endsWith('>'))) {
        raw = raw.slice(1, -1);
    }

    const resolved = resolveIncludeUri(fileUri, raw, workspaceRoot);
    return [{
        uri: resolved,
        range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
        },
    }];
}
