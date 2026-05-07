// Action hints attached to analyzer state for downstream services (hover,
// completion, signature help, inlay hints, code actions).
//
// Each entry is a small descriptor recorded during analysis that future
// service-layer code (Phase 7) consumes to answer LSP requests. Keep these
// data-only; no dependency on lsp-* types.

import { TokenObject } from '../compiler_tokenizer/tokenObject';
import { TextLocation } from '../compiler_tokenizer/textLocation';
import { SymbolObject, SymbolFunctionHolder } from './symbolObject';
import type { SymbolScope } from './symbolScope';
import { ResolvedType } from './resolvedType';

/** Symbol cross-reference: token X references symbol Y. */
export interface ReferenceInfo {
    readonly fromToken: TokenObject;
    readonly toSymbol: SymbolObject;
}

/** Bounded scope region used by goto/hover to map position → scope. */
export interface ScopeRegionInfo {
    readonly boundingLocation: TextLocation;
    readonly targetScope: SymbolScope;
}

/** Auto-completion target for member access: `obj.<caret>`. */
export interface AutocompleteInstanceMemberInfo {
    readonly autocompleteLocation: TextLocation;
    readonly targetType: ResolvedType;
}

/** Auto-completion target for namespace access: `Outer::Inner::<caret>`. */
export interface AutocompleteNamespaceAccessInfo {
    readonly autocompleteLocation: TextLocation;
    readonly accessScope: SymbolScope;
    readonly namespaceToken: TokenObject;
    readonly tokenAfterNamespaces: TokenObject | undefined;
}

/** Function-call signature info for signature help. */
export interface FunctionCallInfo {
    readonly callerIdentifier: TokenObject;
    readonly calleeFuncHolder: SymbolFunctionHolder;
    readonly callerArgsLocation: TextLocation;
}

/** `auto x = expr;` resolution record so hover can show inferred type. */
export interface AutoTypeResolutionInfo {
    readonly autoToken: TokenObject;
    readonly resolvedType: ResolvedType;
}
