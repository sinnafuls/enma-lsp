// Call hierarchy provider — incoming and outgoing calls.
//
// prepareCallHierarchy: resolve the function/method under the caret to a
//   CallHierarchyItem (best-effort: symbol table lookup for global functions,
//   identifier token for others).
// incomingCalls: scan rawTokens of every file for `name(` call patterns —
//   same approach as the reference provider, extended to include the name of
//   the enclosing function (found via token-level scan).
// outgoingCalls: scan the declaration's token range in the originating file
//   for `identifier(` patterns, de-duplicated.
//
// Full body-level call analysis (using the analyze queue) is blocked on the
// author's week-3 body-analysis work. Token heuristics are the same trade-off
// the reference provider already makes.

import * as lsp from 'vscode-languageserver';

import { TextPosition, TextLocation } from '../compiler_tokenizer/textLocation';
import { TokenObject, TokenKind } from '../compiler_tokenizer/tokenObject';
import { SymbolGlobalScope } from '../compiler_analyzer/symbolScope';
import { SymbolFunctionHolder } from '../compiler_analyzer/symbolObject';
import {
    findTokenAtPosition,
    findScopeAtPosition,
    lookupSymbolByName,
} from './utils';
import { ReferenceTokens } from './reference';

interface ItemData {
    name: string;
    uri: string;
}

function rangeOf(loc: TextLocation): lsp.Range {
    return {
        start: { line: loc.start.line, character: loc.start.character },
        end: { line: loc.end.line, character: loc.end.character },
    };
}

function toItem(name: string, loc: TextLocation): lsp.CallHierarchyItem {
    const data: ItemData = { name, uri: loc.uri };
    return {
        name,
        kind: lsp.SymbolKind.Function,
        uri: loc.uri,
        range: rangeOf(loc),
        selectionRange: rangeOf(loc),
        data,
    };
}

export function prepareCallHierarchy(
    globalScope: SymbolGlobalScope,
    rawTokens: ReadonlyArray<TokenObject>,
    caret: TextPosition,
): lsp.CallHierarchyItem[] {
    const at = findTokenAtPosition(rawTokens, caret);
    if (at === undefined || at.token.kind !== TokenKind.Identifier) return [];
    const scope = findScopeAtPosition(globalScope, caret);
    const holder = lookupSymbolByName(scope, at.token.text);
    if (holder === undefined) return [];
    if (!(holder instanceof SymbolFunctionHolder)) return [];
    const first = holder.toList()[0];
    if (first === undefined) return [];
    return [toItem(first.identifierText, first.identifierToken.location)];
}

/** Next non-comment, non-whitespace token after index (direction +1). */
function nextSig(tokens: ReadonlyArray<TokenObject>, index: number): TokenObject | undefined {
    for (let i = index + 1; i < tokens.length; i++) {
        if (tokens[i].kind === TokenKind.Comment) continue;
        return tokens[i];
    }
    return undefined;
}

/** Scan tokens for `name (` call sites and return their locations. */
function findCallSites(tokens: ReadonlyArray<TokenObject>, name: string): lsp.Location[] {
    const out: lsp.Location[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < tokens.length - 1; i++) {
        const t = tokens[i];
        if (t.kind !== TokenKind.Identifier || t.text !== name) continue;
        const nxt = nextSig(tokens, i);
        if (nxt === undefined || nxt.kind !== TokenKind.Punctuation || nxt.text !== '(') continue;
        const loc = t.location;
        const key = `${loc.uri}:${loc.start.line}:${loc.start.character}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
            uri: loc.uri,
            range: {
                start: { line: loc.start.line, character: loc.start.character },
                end: { line: loc.end.line, character: loc.end.character },
            },
        });
    }
    return out;
}

/** Find the name of the function-like construct that contains a token (by scanning backwards for a `funcname(` at depth 0). */
function enclosingFunctionName(tokens: ReadonlyArray<TokenObject>, tokenIndex: number): string {
    let depth = 0;
    for (let i = tokenIndex; i >= 0; i--) {
        const t = tokens[i];
        if (t.kind === TokenKind.Punctuation) {
            if (t.text === ')' || t.text === '}') depth++;
            else if (t.text === '(' && depth > 0) depth--;
            else if (t.text === '(' && depth === 0) {
                // The token at i-1 (skipping trivia) is likely the enclosing function name.
                for (let j = i - 1; j >= 0; j--) {
                    const p = tokens[j];
                    if (p.kind === TokenKind.Comment) continue;
                    if (p.kind === TokenKind.Identifier) return p.text;
                    break;
                }
            }
        }
    }
    return '(unknown)';
}

export function provideIncomingCalls(
    allFiles: ReferenceTokens[],
    item: lsp.CallHierarchyItem,
): lsp.CallHierarchyIncomingCall[] {
    const data = item.data as ItemData | undefined;
    if (data === undefined) return [];
    const targetName = data.name;
    const out: lsp.CallHierarchyIncomingCall[] = [];

    for (const file of allFiles) {
        const callLocs = findCallSites(file.rawTokens, targetName).filter(
            (l) => !(l.uri === item.uri &&
                l.range.start.line === item.selectionRange.start.line),
        );
        if (callLocs.length === 0) continue;

        // Group by enclosing function (best-effort token scan).
        const byEnclosing = new Map<string, lsp.Range[]>();
        for (const loc of callLocs) {
            const tokIdx = file.rawTokens.findIndex(
                (t) => t.location.start.line === loc.range.start.line &&
                    t.location.start.character === loc.range.start.character,
            );
            const enclosing = tokIdx >= 0 ? enclosingFunctionName(file.rawTokens, tokIdx) : '(unknown)';
            if (!byEnclosing.has(enclosing)) byEnclosing.set(enclosing, []);
            byEnclosing.get(enclosing)!.push(loc.range);
        }

        for (const [encName, fromRanges] of byEnclosing) {
            // Build a synthetic caller item for the enclosing function.
            const firstRange = fromRanges[0];
            const callerItem: lsp.CallHierarchyItem = {
                name: encName,
                kind: lsp.SymbolKind.Function,
                uri: file.uri,
                range: firstRange,
                selectionRange: firstRange,
                data: { name: encName, uri: file.uri } satisfies ItemData,
            };
            out.push({ from: callerItem, fromRanges });
        }
    }
    return out;
}

export function provideOutgoingCalls(
    allFiles: ReferenceTokens[],
    item: lsp.CallHierarchyItem,
): lsp.CallHierarchyOutgoingCall[] {
    const data = item.data as ItemData | undefined;
    if (data === undefined) return [];
    const file = allFiles.find((f) => f.uri === data.uri);
    if (file === undefined) return [];

    // Find tokens between the item's declaration and the next top-level `{`.
    const tokens = file.rawTokens;
    const startLine = item.range.start.line;

    // Walk forward to the opening `{` then find the matching `}`.
    let bodyStart = -1;
    let depth = 0;
    let bodyEnd = tokens.length;
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.location.start.line < startLine) continue;
        if (t.kind === TokenKind.Punctuation && t.text === '{') {
            if (bodyStart < 0) { bodyStart = i; depth = 1; continue; }
            depth++;
        }
        if (t.kind === TokenKind.Punctuation && t.text === '}' && bodyStart >= 0) {
            depth--;
            if (depth <= 0) { bodyEnd = i; break; }
        }
    }
    if (bodyStart < 0) return [];

    const seen = new Map<string, lsp.CallHierarchyOutgoingCall>();
    for (let i = bodyStart; i <= bodyEnd && i < tokens.length; i++) {
        const t = tokens[i];
        if (t.kind !== TokenKind.Identifier) continue;
        const nxt = nextSig(tokens, i);
        if (nxt === undefined || nxt.kind !== TokenKind.Punctuation || nxt.text !== '(') continue;
        if (t.text === data.name) continue; // skip self-references
        const callRange: lsp.Range = {
            start: { line: t.location.start.line, character: t.location.start.character },
            end: { line: t.location.end.line, character: t.location.end.character },
        };
        if (!seen.has(t.text)) {
            const targetItem: lsp.CallHierarchyItem = {
                name: t.text,
                kind: lsp.SymbolKind.Function,
                uri: data.uri,
                range: callRange,
                selectionRange: callRange,
                data: { name: t.text, uri: data.uri } satisfies ItemData,
            };
            seen.set(t.text, { to: targetItem, fromRanges: [callRange] });
        } else {
            seen.get(t.text)!.fromRanges.push(callRange);
        }
    }
    return [...seen.values()];
}
