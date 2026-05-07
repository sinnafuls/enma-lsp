// Completion provider — main symbol completion.
//
// Strategy (matches legacy/extension.js intent, against real symbol tables):
//   1. Look at the rawTokens immediately before caret.
//   2. If the prev tokens form `<id>.` or `<id>->` → member access. Resolve
//      the receiver type, return its members only.
//   3. If the prev tokens form `<id>::` → namespace access. List members of
//      the namespace/class scope.
//   4. Otherwise: walk the scope chain and emit all visible symbols + keywords.

import * as lsp from 'vscode-languageserver';

import { TextPosition } from '../compiler_tokenizer/textLocation';
import { TokenObject, TokenKind } from '../compiler_tokenizer/tokenObject';
import {
    SymbolGlobalScope,
    SymbolScope,
} from '../compiler_analyzer/symbolScope';
import {
    SymbolFunctionHolder,
    SymbolObjectHolder,
    SymbolType,
    SymbolVariable,
    isSymbolInstanceMember,
} from '../compiler_analyzer/symbolObject';
import {
    findScopeAtPosition,
    findTokenAtOrBefore,
    KEYWORD_HOVERS,
    positionLess,
    positionEq,
} from './utils';

export function provideCompletion(
    globalScope: SymbolGlobalScope,
    rawTokens: ReadonlyArray<TokenObject>,
    caret: TextPosition,
): lsp.CompletionItem[] {
    // Find the last non-trivia token at or before caret.
    const ctx = analyzeAccessContext(rawTokens, caret);

    const scope = findScopeAtPosition(globalScope, caret);

    if (ctx.kind === 'member') {
        return completeMembers(globalScope, scope, ctx.receiverName, ctx.usedArrow);
    }
    if (ctx.kind === 'namespace') {
        return completeNamespaceMembers(globalScope, ctx.namespaceName);
    }

    return completeScopeChain(globalScope, scope);
}

// ---- Access-context analysis -------------------------------------------

interface DefaultCtx { kind: 'default' }
interface MemberCtx { kind: 'member'; receiverName: string; usedArrow: boolean }
interface NamespaceCtx { kind: 'namespace'; namespaceName: string }

type AccessContext = DefaultCtx | MemberCtx | NamespaceCtx;

function analyzeAccessContext(
    rawTokens: ReadonlyArray<TokenObject>,
    caret: TextPosition,
): AccessContext {
    // Walk tokens AT OR BEFORE caret (meaningful, not comments / EOF).
    const meaningful: { token: TokenObject; index: number }[] = [];
    for (let i = 0; i < rawTokens.length; i++) {
        const t = rawTokens[i];
        if (t.kind === TokenKind.EOF) continue;
        if (t.kind === TokenKind.Comment) continue;
        // Token must end at-or-before caret to be considered prior.
        if (positionLess(t.location.end, caret) || positionEq(t.location.end, caret)) {
            meaningful.push({ token: t, index: i });
        } else if (positionLess(t.location.start, caret) && !positionLess(t.location.end, caret)) {
            // Token straddles caret — partial identifier being typed; skip.
            continue;
        } else {
            break;
        }
    }
    if (meaningful.length === 0) return { kind: 'default' };

    const last = meaningful[meaningful.length - 1].token;
    // If user is typing partial identifier (caret right after / inside ident),
    // skip the trailing identifier and look at the operator before it.
    let prev = last;
    let prevIdx = meaningful.length - 1;
    if (last.kind === TokenKind.Identifier) {
        if (meaningful.length < 2) return { kind: 'default' };
        prev = meaningful[meaningful.length - 2].token;
        prevIdx = meaningful.length - 2;
    }

    // `.` or `->` or `::`?
    if (prev.kind === TokenKind.Operator || prev.kind === TokenKind.Punctuation) {
        if (prev.text === '.') {
            const recv = meaningful[prevIdx - 1]?.token;
            if (recv?.kind === TokenKind.Identifier) {
                return { kind: 'member', receiverName: recv.text, usedArrow: false };
            }
        } else if (prev.text === '->') {
            const recv = meaningful[prevIdx - 1]?.token;
            if (recv?.kind === TokenKind.Identifier) {
                return { kind: 'member', receiverName: recv.text, usedArrow: true };
            }
        } else if (prev.text === '::') {
            const recv = meaningful[prevIdx - 1]?.token;
            if (recv?.kind === TokenKind.Identifier) {
                return { kind: 'namespace', namespaceName: recv.text };
            }
        }
    }

    return { kind: 'default' };
}

// ---- Member access -----------------------------------------------------

function completeMembers(
    globalScope: SymbolGlobalScope,
    scope: SymbolScope,
    receiverName: string,
    _usedArrow: boolean,
): lsp.CompletionItem[] {
    // Resolve receiver as a variable or as `this`.
    let receiverType: SymbolType | undefined;

    const sym = scope.lookupSymbolWithParent(receiverName);
    if (sym instanceof SymbolVariable) {
        if (sym.type !== undefined) {
            const tof = sym.type.typeOrFunc;
            if (tof instanceof SymbolType) receiverType = tof;
        }
    } else if (sym instanceof SymbolType) {
        // Static-like member access, treat namespace-style.
        return completeNamespaceMembers(globalScope, receiverName);
    }

    if (receiverType === undefined) return [];

    // Walk membersScopePath to the type's member scope.
    const memberScope = receiverType.membersScopePath !== undefined
        ? globalScope.resolveScope(receiverType.membersScopePath)
        : undefined;
    if (memberScope === undefined) return [];

    return symbolsToCompletionItems(memberScope, /*onlyInstance*/ true);
}

// ---- Namespace access --------------------------------------------------

function completeNamespaceMembers(
    globalScope: SymbolGlobalScope,
    name: string,
): lsp.CompletionItem[] {
    // Try as namespace child scope first.
    const childScope = globalScope.lookupScope(name);
    if (childScope !== undefined) {
        return symbolsToCompletionItems(childScope, /*onlyInstance*/ false);
    }
    // Try as a SymbolType (class/struct/enum) — emit its members + enum values.
    const sym = globalScope.lookupSymbol(name);
    if (sym instanceof SymbolType && sym.membersScopePath !== undefined) {
        const ms = globalScope.resolveScope(sym.membersScopePath);
        if (ms !== undefined) return symbolsToCompletionItems(ms, /*onlyInstance*/ false);
    }
    return [];
}

// ---- Default scope-chain completion ------------------------------------

function completeScopeChain(
    globalScope: SymbolGlobalScope,
    scope: SymbolScope,
): lsp.CompletionItem[] {
    const items: lsp.CompletionItem[] = [];
    const seen = new Set<string>();

    // Walk parent chain.
    let s: SymbolScope | undefined = scope;
    while (s !== undefined) {
        for (const [name, holder] of s.symbolTable) {
            if (seen.has(name)) continue;
            seen.add(name);
            items.push(makeCompletionItem(name, holder));
        }
        // Namespace children visible at this level.
        for (const [name, child] of s.childScopeTable) {
            if (seen.has(name)) continue;
            if (name.startsWith('~')) continue;
            // Only emit if the child has no associated symbol table entry already.
            seen.add(name);
            // Mark namespaces as Module kind.
            const isNs = child.linkedKind === 'namespace' || child.linkedKind === 'global';
            if (isNs) {
                items.push({ label: name, kind: lsp.CompletionItemKind.Module });
            }
        }
        s = s.parentScope;
    }

    // Keyword completions.
    for (const kw of Object.keys(KEYWORD_HOVERS)) {
        if (seen.has(kw)) continue;
        seen.add(kw);
        items.push({ label: kw, kind: lsp.CompletionItemKind.Keyword });
    }

    return items;
}

// ---- Helpers ------------------------------------------------------------

function symbolsToCompletionItems(scope: SymbolScope, onlyInstance: boolean): lsp.CompletionItem[] {
    const items: lsp.CompletionItem[] = [];
    for (const [name, holder] of scope.symbolTable) {
        if (onlyInstance && !isSymbolInstanceMember(holder)) continue;
        if (!onlyInstance && isSymbolInstanceMember(holder)) continue;
        items.push(makeCompletionItem(name, holder));
    }
    return items;
}

function makeCompletionItem(name: string, holder: SymbolObjectHolder): lsp.CompletionItem {
    let kind: lsp.CompletionItemKind = lsp.CompletionItemKind.Text;
    if (holder instanceof SymbolFunctionHolder) {
        kind = holder.first.isInstanceMember
            ? lsp.CompletionItemKind.Method
            : lsp.CompletionItemKind.Function;
    } else if (holder instanceof SymbolType) {
        if (holder.isPrimitive()) kind = lsp.CompletionItemKind.Keyword;
        else if (holder.isEnum) kind = lsp.CompletionItemKind.Enum;
        else if (holder.isInterface) kind = lsp.CompletionItemKind.Interface;
        else if (holder.isStruct) kind = lsp.CompletionItemKind.Struct;
        else kind = lsp.CompletionItemKind.Class;
    } else if (holder instanceof SymbolVariable) {
        kind = holder.isInstanceMember
            ? lsp.CompletionItemKind.Field
            : lsp.CompletionItemKind.Variable;
    }
    return { label: name, kind };
}
