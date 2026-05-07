// Completion-resolve provider — lazily attach documentation/details.
//
// Called when the user highlights a completion item. Looks up the symbol by
// label in the global scope and attaches its stringified signature as detail.

import * as lsp from 'vscode-languageserver';

import { SymbolGlobalScope } from '../compiler_analyzer/symbolScope';
import { stringifySymbol, KEYWORD_HOVERS } from './utils';

export function provideCompletionResolve(
    globalScope: SymbolGlobalScope,
    item: lsp.CompletionItem,
): lsp.CompletionItem {
    if (item.detail) return item;

    if (item.kind === lsp.CompletionItemKind.Keyword) {
        const doc = KEYWORD_HOVERS[item.label];
        if (doc !== undefined) {
            item.documentation = { kind: 'markdown', value: doc };
        }
        return item;
    }

    const holder = globalScope.lookupSymbolWithParent(item.label);
    if (holder !== undefined) {
        item.detail = stringifySymbol(holder);
    }
    return item;
}
