// Semantic tokens provider.
//
// Walks rawTokens and emits semantic-token records for identifiers we can
// resolve to a symbol. Token-types follow the LSP spec; we use a curated
// subset matching the configurationDefaults coloring contract in package.json.

import * as lsp from 'vscode-languageserver';
import { SemanticTokensBuilder } from 'vscode-languageserver/node';

import { TokenObject, TokenKind } from '../compiler_tokenizer/tokenObject';
import { SymbolGlobalScope } from '../compiler_analyzer/symbolScope';
import {
    SymbolFunctionHolder,
    SymbolType,
    SymbolVariable,
} from '../compiler_analyzer/symbolObject';

// ---- Legend ------------------------------------------------------------

export const SEMANTIC_TOKEN_TYPES: lsp.SemanticTokenTypes[] = [
    lsp.SemanticTokenTypes.variable,
    lsp.SemanticTokenTypes.function,
    lsp.SemanticTokenTypes.namespace,
    lsp.SemanticTokenTypes.class,
    lsp.SemanticTokenTypes.enum,
    lsp.SemanticTokenTypes.parameter,
    lsp.SemanticTokenTypes.property,
    lsp.SemanticTokenTypes.enumMember,
    lsp.SemanticTokenTypes.type,
    lsp.SemanticTokenTypes.struct,
    lsp.SemanticTokenTypes.interface,
    lsp.SemanticTokenTypes.method,
];

export const SEMANTIC_TOKEN_MODIFIERS: lsp.SemanticTokenModifiers[] = [
    lsp.SemanticTokenModifiers.declaration,
    lsp.SemanticTokenModifiers.readonly,
    lsp.SemanticTokenModifiers.static,
    'global' as lsp.SemanticTokenModifiers,
];

export const semanticTokensLegend: lsp.SemanticTokensLegend = {
    tokenTypes: SEMANTIC_TOKEN_TYPES,
    tokenModifiers: SEMANTIC_TOKEN_MODIFIERS,
};

const TYPE_INDEX = {
    variable: 0,
    function: 1,
    namespace: 2,
    class: 3,
    enum: 4,
    parameter: 5,
    property: 6,
    enumMember: 7,
    type: 8,
    struct: 9,
    interface: 10,
    method: 11,
};

const MOD_DECLARATION = 1 << 0;
const MOD_READONLY    = 1 << 1;
// const MOD_STATIC      = 1 << 2; // Reserved for future static modifier support
const MOD_GLOBAL      = 1 << 3;

// ---- Provider ----------------------------------------------------------

export function provideSemanticTokens(
    globalScope: SymbolGlobalScope,
    rawTokens: ReadonlyArray<TokenObject>,
): lsp.SemanticTokens {
    const builder = new SemanticTokensBuilder();

    // Collect known names → kind/scope-info. Walk all symbols in global scope tree.
    const nameInfo = new Map<string, { type: number; mods: number; declUri: string; declLine: number; declChar: number }>();
    indexSymbols(globalScope, nameInfo);

    for (const token of rawTokens) {
        if (token.kind !== TokenKind.Identifier) continue;
        const info = nameInfo.get(token.text);
        if (info === undefined) continue;

        let mods = info.mods;
        // Tag the declaration site itself with the declaration modifier.
        if (token.location.uri === info.declUri &&
            token.location.start.line === info.declLine &&
            token.location.start.character === info.declChar) {
            mods |= MOD_DECLARATION;
        }

        builder.push(
            token.location.start.line,
            token.location.start.character,
            token.text.length,
            info.type,
            mods,
        );
    }

    return builder.build();
}

function indexSymbols(
    scope: import('../compiler_analyzer/symbolScope').SymbolScope,
    out: Map<string, { type: number; mods: number; declUri: string; declLine: number; declChar: number }>,
    isGlobalScope = true,
): void {
    for (const [name, holder] of scope.symbolTable) {
        let type = TYPE_INDEX.variable;
        let mods = 0;
        if (isGlobalScope) mods |= MOD_GLOBAL;

        if (holder instanceof SymbolFunctionHolder) {
            type = holder.first.isInstanceMember ? TYPE_INDEX.method : TYPE_INDEX.function;
        } else if (holder instanceof SymbolType) {
            if (holder.isEnum) type = TYPE_INDEX.enum;
            else if (holder.isInterface) type = TYPE_INDEX.interface;
            else if (holder.isStruct) type = TYPE_INDEX.struct;
            else if (holder.isPrimitive()) type = TYPE_INDEX.type;
            else type = TYPE_INDEX.class;
        } else if (holder instanceof SymbolVariable) {
            if (holder.isInstanceMember) type = TYPE_INDEX.property;
            else type = TYPE_INDEX.variable;
            if (holder.isConst) mods |= MOD_READONLY;
        }

        const tok = (holder instanceof SymbolFunctionHolder) ? holder.first.identifierToken : holder.identifierToken;

        // Don't overwrite an existing record (first-decl wins).
        if (!out.has(name)) {
            out.set(name, {
                type,
                mods,
                declUri: tok.location.uri,
                declLine: tok.location.start.line,
                declChar: tok.location.start.character,
            });
        }
    }

    // Recurse children — they're not global scope.
    for (const [, child] of scope.childScopeTable) {
        indexSymbols(child, out, false);
    }
}
