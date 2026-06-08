// Navigation providers — go-to-type-definition and go-to-implementation.
//
// typeDefinition: from a variable/expression, jump to the declaration of its
//   *type* (rather than the variable itself, which is what `definition` gives).
// implementation: from a class/interface/struct, jump to the concrete types
//   that derive from it (§A3 multi-inheritance base lists). From anything else
//   it returns nothing so the editor falls back to `definition`.

import * as lsp from 'vscode-languageserver';

import { TextPosition, TextLocation } from '../compiler_tokenizer/textLocation';
import { TokenObject, TokenKind } from '../compiler_tokenizer/tokenObject';
import { SymbolGlobalScope, SymbolScope } from '../compiler_analyzer/symbolScope';
import { SymbolType } from '../compiler_analyzer/symbolObject';
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

/** Resolve the identifier under the caret to a symbol holder. */
function holderAt(globalScope: SymbolGlobalScope, rawTokens: ReadonlyArray<TokenObject>, caret: TextPosition) {
    const at = findTokenAtPosition(rawTokens, caret);
    if (at === undefined || at.token.kind !== TokenKind.Identifier) return undefined;
    const scope = findScopeAtPosition(globalScope, caret);
    return lookupSymbolByName(scope, at.token.text);
}

export function provideTypeDefinition(
    globalScope: SymbolGlobalScope,
    rawTokens: ReadonlyArray<TokenObject>,
    caret: TextPosition,
): lsp.Location[] {
    const holder = holderAt(globalScope, rawTokens, caret);
    if (holder === undefined) return [];

    // A type identifier resolves to its own declaration.
    if (holder.isType()) {
        return [locationToLspLocation(holder.identifierToken.location)];
    }
    // A variable resolves to the declaration of its type.
    if (holder.isVariable()) {
        const base = holder.type?.typeOrFunc;
        if (base !== undefined && base.isType() && base.linkedNode !== undefined) {
            return [locationToLspLocation(base.identifierToken.location)];
        }
    }
    return [];
}

/** Collect every SymbolType reachable from the scope tree. */
export function collectAllTypes(global: SymbolGlobalScope): SymbolType[] {
    const out: SymbolType[] = [];
    const visit = (scope: SymbolScope): void => {
        for (const holder of scope.symbolTable.values()) {
            if (holder.isType()) out.push(holder);
        }
        for (const child of scope.childScopeTable.values()) visit(child);
    };
    visit(global);
    return out;
}

export function provideImplementation(
    globalScope: SymbolGlobalScope,
    rawTokens: ReadonlyArray<TokenObject>,
    caret: TextPosition,
): lsp.Location[] {
    const holder = holderAt(globalScope, rawTokens, caret);
    if (holder === undefined || !holder.isType()) return [];

    const target = holder;
    const out: lsp.Location[] = [];
    const seen = new Set<string>();
    for (const candidate of collectAllTypes(globalScope)) {
        if (candidate === target) continue;
        const derives = candidate.baseList.some((base) => base?.typeOrFunc.equals(target));
        if (!derives) continue;
        const loc = candidate.identifierToken.location;
        const key = `${loc.uri}:${loc.start.line}:${loc.start.character}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(locationToLspLocation(loc));
    }
    return out;
}
