// Type hierarchy provider — supertypes / subtypes over the §A3 base lists.
//
// prepare:   resolve the type under the caret to a TypeHierarchyItem.
// supertypes: the base types declared in the type's base list.
// subtypes:   every type whose base list derives from this one (cross-file).
//
// Items carry { name, scopePath } in `data` so the follow-up supertypes /
// subtypes requests can re-resolve the SymbolType from any record's scope.

import * as lsp from 'vscode-languageserver';

import { TextPosition, TextLocation } from '../compiler_tokenizer/textLocation';
import { TokenObject, TokenKind } from '../compiler_tokenizer/tokenObject';
import { SymbolGlobalScope } from '../compiler_analyzer/symbolScope';
import { SymbolType } from '../compiler_analyzer/symbolObject';
import {
    findTokenAtPosition,
    findScopeAtPosition,
    lookupSymbolByName,
} from './utils';
import { collectAllTypes } from './navigation';

interface ItemData {
    name: string;
    scopePath: string[];
}

function kindOf(t: SymbolType): lsp.SymbolKind {
    if (t.isInterface) return lsp.SymbolKind.Interface;
    if (t.isEnum) return lsp.SymbolKind.Enum;
    if (t.isStruct) return lsp.SymbolKind.Struct;
    return lsp.SymbolKind.Class;
}

function rangeOf(loc: TextLocation): lsp.Range {
    return {
        start: { line: loc.start.line, character: loc.start.character },
        end: { line: loc.end.line, character: loc.end.character },
    };
}

function toItem(t: SymbolType): lsp.TypeHierarchyItem {
    const range = rangeOf(t.identifierToken.location);
    const data: ItemData = { name: t.identifierText, scopePath: [...t.scopePath] };
    return {
        name: t.identifierText,
        kind: kindOf(t),
        uri: t.identifierToken.location.uri,
        range,
        selectionRange: range,
        data,
    };
}

function scopePathEqual(a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}

/** Re-resolve the SymbolType an item points at, across every known scope. */
function resolveItem(allScopes: SymbolGlobalScope[], item: lsp.TypeHierarchyItem): SymbolType | undefined {
    const data = item.data as ItemData | undefined;
    if (data === undefined) return undefined;
    for (const scope of allScopes) {
        for (const t of collectAllTypes(scope)) {
            if (t.identifierText === data.name && scopePathEqual(t.scopePath, data.scopePath)) return t;
        }
    }
    return undefined;
}

export function prepareTypeHierarchy(
    globalScope: SymbolGlobalScope,
    rawTokens: ReadonlyArray<TokenObject>,
    caret: TextPosition,
): lsp.TypeHierarchyItem[] {
    const at = findTokenAtPosition(rawTokens, caret);
    if (at === undefined || at.token.kind !== TokenKind.Identifier) return [];
    const scope = findScopeAtPosition(globalScope, caret);
    const holder = lookupSymbolByName(scope, at.token.text);
    if (holder === undefined || !holder.isType()) return [];
    return [toItem(holder)];
}

export function provideSupertypes(
    allScopes: SymbolGlobalScope[],
    item: lsp.TypeHierarchyItem,
): lsp.TypeHierarchyItem[] {
    const t = resolveItem(allScopes, item);
    if (t === undefined) return [];
    const out: lsp.TypeHierarchyItem[] = [];
    for (const base of t.baseList) {
        const baseType = base?.typeOrFunc;
        if (baseType !== undefined && baseType.isType()) out.push(toItem(baseType));
    }
    return out;
}

export function provideSubtypes(
    allScopes: SymbolGlobalScope[],
    item: lsp.TypeHierarchyItem,
): lsp.TypeHierarchyItem[] {
    const t = resolveItem(allScopes, item);
    if (t === undefined) return [];
    const out: lsp.TypeHierarchyItem[] = [];
    const seen = new Set<string>();
    for (const scope of allScopes) {
        for (const candidate of collectAllTypes(scope)) {
            if (candidate === t) continue;
            if (!candidate.baseList.some((b) => b?.typeOrFunc.equals(t))) continue;
            const key = `${candidate.identifierText}\u0000${candidate.scopePath.join('\u0000')}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(toItem(candidate));
        }
    }
    return out;
}
