// Per-URI wrapper around a SymbolGlobalScope.
//
// Mirrors angel-lsp shape so the inspector layer can treat a file's analyzer
// state as a single value with a stable filepath. `pureGlobalScope` is the
// version with only this file's symbols (no transitively-included symbols)
// — used when another file imports this one to avoid double-include blow-up.
//
// **AST-aliasing constraint** (from worker-parser-handwritten):
// The §A1 ParserCache reuses NodeTopLevel subtrees across re-parses. Therefore
// the analyzer MUST NOT mutate AST nodes. Per-decl annotations (resolved
// symbol pointers, inferred types replacing AutoPendingType, MRO linearization
// results) live in the `nodeAnnotations` side-table keyed by node identity.
// On dependent re-analysis the inspector clears the side-table for that URI.

import { AnyNode } from '../compiler_parser/nodes';
import { SymbolGlobalScope, SymbolScope, setActiveGlobalScope } from './symbolScope';
import { ResolvedType } from './resolvedType';
import { SymbolObject, SymbolType } from './symbolObject';

/**
 * Side-table entry — what we know about an AST node after analysis. Empty
 * fields mean "not yet resolved". A re-analysis clears the entry, never the
 * AST node itself.
 */
export interface NodeAnnotation {
    /** For NodeExpr nodes: the deduced type at this expression site. */
    resolvedType?: ResolvedType;
    /** For identifier-shaped expr nodes: the symbol the lookup landed on. */
    resolvedSymbol?: SymbolObject;
    /** For NodeClass/Struct/Interface: the C3 MRO linearization (lazy, computed by mro.ts). */
    mroLinearization?: SymbolType[];
    /** For NodeStmtVar / NodeField / NodeVar with `auto`: the inferred type after init analysis. */
    autoInferredType?: ResolvedType;
}

export class AnalyzerScope {
    public readonly filepath: string;
    public readonly globalScope: SymbolGlobalScope;

    /**
     * Per-URI side-table of AST-node annotations. Keyed by node identity
     * (Object reference equality). Cleared on re-analysis. **MUST be the only
     * place per-decl analyzer state lives — never mutate AST nodes.**
     */
    public readonly nodeAnnotations: Map<AnyNode, NodeAnnotation> = new Map();

    private _pureGlobalScope: SymbolGlobalScope | undefined;

    constructor(filepath: string, globalScope: SymbolGlobalScope) {
        this.filepath = filepath;
        this.globalScope = globalScope;
    }

    /** Lazily build the symbols-only-from-this-file projection. */
    public getPureGlobalScope(): SymbolScope {
        if (this._pureGlobalScope === undefined) {
            this._pureGlobalScope = new SymbolGlobalScope(this.globalScope.getContext());
            this._pureGlobalScope.includeExternalScope(this.globalScope);
        }
        return this._pureGlobalScope;
    }

    /** Get-or-create a side-table entry for an AST node. */
    public annotate(node: AnyNode): NodeAnnotation {
        let a = this.nodeAnnotations.get(node);
        if (!a) {
            a = {};
            this.nodeAnnotations.set(node, a);
        }
        return a;
    }

    /** Read-only lookup. */
    public getAnnotation(node: AnyNode): NodeAnnotation | undefined {
        return this.nodeAnnotations.get(node);
    }

    /** Clear all annotations — call on dependent re-analysis. */
    public clearAnnotations(): void {
        this.nodeAnnotations.clear();
    }
}

/**
 * Build a new global scope and pull in symbols from all included AnalyzerScope
 * collaborators (transitive bundled stdlib + workspace `.em.predefined`).
 */
export function createGlobalScope(filepath: string, includeScopes: AnalyzerScope[]): SymbolGlobalScope {
    const g = new SymbolGlobalScope(filepath);
    setActiveGlobalScope(g);

    for (const inc of includeScopes) {
        g.includeExternalScope(inc.getPureGlobalScope());
    }

    return g;
}
