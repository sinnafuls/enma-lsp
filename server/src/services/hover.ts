// Hover provider — returns markdown for the symbol/keyword at caret.
//
// Resolution order:
//   1. Token at caret. If it's a TokenReserved (keyword), return a static
//      keyword hover from KEYWORD_HOVERS.
//   2. If it's a TokenIdentifier, look the symbol up in scope chain. If found,
//      return code-block (signature) + scope-path label.
//   3. Otherwise undefined.

import * as lsp from 'vscode-languageserver';

import { TextPosition } from '../compiler_tokenizer/textLocation';
import { TokenObject, TokenKind } from '../compiler_tokenizer/tokenObject';
import { SymbolGlobalScope } from '../compiler_analyzer/symbolScope';
import {
    findTokenAtPosition,
    findScopeAtPosition,
    lookupSymbolByName,
    stringifySymbol,
    KEYWORD_HOVERS,
    extractDocComment,
} from './utils';

export function provideHover(
    globalScope: SymbolGlobalScope,
    rawTokens: ReadonlyArray<TokenObject>,
    caret: TextPosition,
): lsp.Hover | undefined {
    const at = findTokenAtPosition(rawTokens, caret);
    if (at === undefined) return undefined;

    const token = at.token;

    // Keyword hover (TokenReserved)
    if (token.kind === TokenKind.Reserved) {
        const kw = KEYWORD_HOVERS[token.text];
        if (kw !== undefined) {
            return {
                contents: {
                    kind: 'markdown',
                    value: '```enma\n' + token.text + '\n```\n\n' + kw,
                },
            };
        }
        return undefined;
    }

    // Identifier hover — symbol lookup
    if (token.kind !== TokenKind.Identifier) return undefined;

    const scope = findScopeAtPosition(globalScope, caret);
    const holder = lookupSymbolByName(scope, token.text);
    if (holder === undefined) return undefined;

    const declToken = holder.isFunctionHolder()
        ? holder.first.identifierToken
        : holder.identifierToken;
    const rawUri = rawTokens.find(t => t.kind !== TokenKind.EOF)?.location.uri ?? '';
    const doc = declToken.location.uri === rawUri
        ? extractDocComment(rawTokens, declToken)
        : undefined;
    const sig = stringifySymbol(holder);
    return {
        contents: {
            kind: 'markdown',
            value: '```enma\n' + sig + '\n```' + (doc !== undefined ? '\n\n' + doc : ''),
        },
    };
}
