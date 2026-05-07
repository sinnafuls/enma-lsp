// Signature help provider.
//
// Find the current call expression by scanning rawTokens backwards from caret
// for an unmatched `(`. The token immediately before that paren is the callee
// name. Resolve it against the scope chain. List all overloads as signatures
// and compute activeParameter from the comma-count between paren and caret.

import * as lsp from 'vscode-languageserver';

import { TextPosition } from '../compiler_tokenizer/textLocation';
import { TokenObject, TokenKind } from '../compiler_tokenizer/tokenObject';
import { SymbolGlobalScope } from '../compiler_analyzer/symbolScope';
import { SymbolFunctionHolder, SymbolFunction } from '../compiler_analyzer/symbolObject';
import {
    findScopeAtPosition,
    positionLess,
    positionEq,
} from './utils';

export function provideSignatureHelp(
    globalScope: SymbolGlobalScope,
    rawTokens: ReadonlyArray<TokenObject>,
    caret: TextPosition,
): lsp.SignatureHelp | undefined {
    // Find the open `(` whose matching `)` lies at or after caret.
    const call = findActiveCall(rawTokens, caret);
    if (call === undefined) return undefined;

    const calleeToken = call.calleeToken;

    const scope = findScopeAtPosition(globalScope, caret);
    const holder = scope.lookupSymbolWithParent(calleeToken.text);
    if (!(holder instanceof SymbolFunctionHolder)) return undefined;

    const signatures: lsp.SignatureInformation[] = holder.overloadList.map(buildSignature);
    return {
        signatures,
        activeSignature: 0,
        activeParameter: call.argIndex,
    };
}

function buildSignature(fn: SymbolFunction): lsp.SignatureInformation {
    const params: lsp.ParameterInformation[] = [];
    let label = fn.identifierText + '(';
    for (let i = 0; i < fn.parameterTypes.length; i++) {
        const type = fn.parameterTypes[i];
        const typeStr = type ? type.identifierText : '?';
        let pname = '';
        if (fn.linkedNode && 'params' in fn.linkedNode) {
            pname = fn.linkedNode.params[i]?.name?.text ?? '';
        }
        const piece = pname.length > 0 ? `${typeStr} ${pname}` : typeStr;
        if (i > 0) label += ', ';
        const paramStart = label.length;
        label += piece;
        params.push({ label: [paramStart, label.length] });
    }
    label += ')';
    if (fn.returnType) label = (fn.returnType.identifierText) + ' ' + label;

    return { label, parameters: params };
}

interface ActiveCall {
    calleeToken: TokenObject;
    argIndex: number;
}

function findActiveCall(rawTokens: ReadonlyArray<TokenObject>, caret: TextPosition): ActiveCall | undefined {
    // Walk tokens preceding caret, tracking paren depth. A `(` at depth 0 is our active call.
    let depth = 0;
    let argIndex = 0;

    // Collect tokens that end before-or-at caret, in reverse.
    const before: TokenObject[] = [];
    for (let i = 0; i < rawTokens.length; i++) {
        const t = rawTokens[i];
        if (t.kind === TokenKind.EOF) continue;
        if (positionLess(t.location.end, caret) || positionEq(t.location.end, caret)) {
            before.push(t);
        } else {
            break;
        }
    }

    for (let i = before.length - 1; i >= 0; i--) {
        const t = before[i];
        if (t.kind === TokenKind.Comment) continue;
        if (t.kind === TokenKind.String) continue;

        if (t.kind === TokenKind.Punctuation || t.kind === TokenKind.Operator) {
            if (t.text === ')') { depth++; continue; }
            if (t.text === '(') {
                if (depth === 0) {
                    // Look back for the callee identifier.
                    for (let j = i - 1; j >= 0; j--) {
                        const cand = before[j];
                        if (cand.kind === TokenKind.Comment) continue;
                        if (cand.kind === TokenKind.Identifier || cand.kind === TokenKind.Reserved) {
                            return { calleeToken: cand, argIndex };
                        }
                        break;
                    }
                    return undefined;
                }
                depth--;
                continue;
            }
            if (t.text === ',' && depth === 0) {
                argIndex++;
                continue;
            }
            if (t.text === ';' || t.text === '{' || t.text === '}') {
                return undefined;
            }
        }
    }
    return undefined;
}
