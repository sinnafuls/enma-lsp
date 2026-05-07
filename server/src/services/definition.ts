// Definition provider — F12. Walks tokens, finds identifier at caret, looks
// up symbol, returns its declaration token's location.

import * as lsp from 'vscode-languageserver';

import { TextPosition, TextLocation } from '../compiler_tokenizer/textLocation';
import { TokenObject, TokenKind } from '../compiler_tokenizer/tokenObject';
import { SymbolGlobalScope } from '../compiler_analyzer/symbolScope';
import {
    findTokenAtPosition,
    findScopeAtPosition,
    lookupSymbolByName,
} from './utils';

function locationToLspLocation(loc: TextLocation): lsp.Location {
    return {
        uri: loc.uri,
        range: {
            start: { line: loc.start.line, character: loc.start.character },
            end: { line: loc.end.line, character: loc.end.character },
        },
    };
}

export function provideDefinition(
    globalScope: SymbolGlobalScope,
    rawTokens: ReadonlyArray<TokenObject>,
    caret: TextPosition,
): lsp.Location[] {
    const at = findTokenAtPosition(rawTokens, caret);
    if (at === undefined) return [];

    const token = at.token;
    if (token.kind !== TokenKind.Identifier) return [];

    const scope = findScopeAtPosition(globalScope, caret);
    const holder = lookupSymbolByName(scope, token.text);
    if (holder === undefined) return [];

    const out: lsp.Location[] = [];
    for (const sym of holder.toList()) {
        out.push(locationToLspLocation(sym.identifierToken.location));
    }
    return out;
}
