// Reference provider — find all uses of a symbol.
//
// We don't have a populated reference-info side table yet (the analyzer is a
// skeleton). So we scan rawTokens of every record looking for identifiers
// whose text matches the target symbol's identifier. This produces best-effort
// results: it WILL match shadowed identifiers in unrelated scopes, but it's
// what the legacy extension did and is good enough for AC-5 / AC-17.

import * as lsp from 'vscode-languageserver';

import { TextPosition, TextLocation } from '../compiler_tokenizer/textLocation';
import { TokenObject, TokenKind } from '../compiler_tokenizer/tokenObject';
import { SymbolGlobalScope } from '../compiler_analyzer/symbolScope';
import type { ReferenceInfo } from '../compiler_analyzer/info';
import {
    findTokenAtPosition,
    findScopeAtPosition,
    lookupSymbolByName,
} from './utils';

export interface ReferenceTokens {
    /** uri of file */
    uri: string;
    /** all rawTokens for that file */
    rawTokens: ReadonlyArray<TokenObject>;
    /** reference info emitted by the analyzer for this file (may be absent) */
    analyzerInfo?: ReadonlyArray<ReferenceInfo>;
}

function locationToLspLocation(loc: TextLocation): lsp.Location {
    return {
        uri: loc.uri,
        range: {
            start: { line: loc.start.line, character: loc.start.character },
            end: { line: loc.end.line, character: loc.end.character },
        },
    };
}

/**
 * Collect references to the symbol at caret across all provided records.
 * Includes the declaration site itself.
 */
export function provideReferences(
    globalScope: SymbolGlobalScope,
    callerRawTokens: ReadonlyArray<TokenObject>,
    allFiles: ReferenceTokens[],
    caret: TextPosition,
): lsp.Location[] {
    const at = findTokenAtPosition(callerRawTokens, caret);
    if (at === undefined) return [];
    if (at.token.kind !== TokenKind.Identifier) return [];

    const targetName = at.token.text;
    const scope = findScopeAtPosition(globalScope, caret);
    const holder = lookupSymbolByName(scope, targetName);
    if (holder === undefined) {
        // Even without resolution, return literal-text matches across files.
        return scanLiteralMatches(allFiles, targetName);
    }

    const out: lsp.Location[] = [];
    const seen = new Set<string>();
    const push = (loc: TextLocation): void => {
        const key = `${loc.uri}:${loc.start.line}:${loc.start.character}`;
        if (seen.has(key)) return;
        seen.add(key);
        out.push(locationToLspLocation(loc));
    };

    // Declaration sites (overloads).
    const declSymbols = holder.toList();
    for (const sym of declSymbols) {
        push(sym.identifierToken.location);
    }

    // Check if any file has analyzer reference info available.
    const analyzerInfoAvailable = allFiles.some(f => f.analyzerInfo !== undefined && f.analyzerInfo.length > 0);

    if (analyzerInfoAvailable) {
        // Use the precise reference table — no false positives from shadowed identifiers.
        for (const file of allFiles) {
            if (!file.analyzerInfo) continue;
            for (const ref of file.analyzerInfo) {
                const sym = ref.toSymbol;
                const matched = declSymbols.some(
                    s =>
                        s.identifierToken.location.uri === sym.identifierToken.location.uri &&
                        s.identifierToken.location.start.line === sym.identifierToken.location.start.line,
                );
                if (matched) push(ref.fromToken.location);
            }
        }
    } else {
        // Fall back to identifier-text scan (best-effort, may include shadowed names).
        for (const file of allFiles) {
            for (const t of file.rawTokens) {
                if (t.kind !== TokenKind.Identifier) continue;
                if (t.text !== targetName) continue;
                push(t.location);
            }
        }
    }

    return out;
}

/** AC-17 friendly: also scan f-string text spans for occurrences (we already match identifiers in interpolation expressions because they tokenize as Identifier inside the interpolation). */
function scanLiteralMatches(allFiles: ReferenceTokens[], name: string): lsp.Location[] {
    const out: lsp.Location[] = [];
    for (const file of allFiles) {
        for (const t of file.rawTokens) {
            if (t.kind !== TokenKind.Identifier) continue;
            if (t.text !== name) continue;
            out.push(locationToLspLocation(t.location));
        }
    }
    return out;
}
