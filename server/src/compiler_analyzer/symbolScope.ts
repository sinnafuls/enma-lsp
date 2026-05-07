// Scope tree + global scope.
//
// Mirrors angel-lsp's structure: each scope holds a SymbolTable (string →
// SymbolObjectHolder) and a child-scope table; the global scope additionally
// owns the per-file context (filepath, info records). Functions are stored in
// SymbolFunctionHolder so overloads share a single table key.

import { TokenObject } from '../compiler_tokenizer/tokenObject';
import {
    SymbolFunctionHolder,
    SymbolObject,
    SymbolObjectHolder,
    SymbolType,
    SymbolVariable,
    ScopePath,
    isScopePathEqual,
} from './symbolObject';
import {
    AutocompleteInstanceMemberInfo,
    AutocompleteNamespaceAccessInfo,
    AutoTypeResolutionInfo,
    FunctionCallInfo,
    ReferenceInfo,
    ScopeRegionInfo,
} from './info';
import { analyzerDiagnostic } from './analyzerDiagnostic';

export type ScopeTable = Map<string, SymbolScope>;
export type SymbolTable = Map<string, SymbolObjectHolder>;

interface DetailScopeInformation {
    reference: ReferenceInfo[];
    scopeRegion: ScopeRegionInfo[];
    autocompleteInstanceMember: AutocompleteInstanceMemberInfo[];
    autocompleteNamespaceAccess: AutocompleteNamespaceAccessInfo[];
    functionCall: FunctionCallInfo[];
    autoTypeResolution: AutoTypeResolutionInfo[];
}

interface GlobalScopeContext {
    filepath: string;
    info: DetailScopeInformation;
}

function createInitialContext(filepath: string): GlobalScopeContext {
    return {
        filepath,
        info: {
            reference: [],
            scopeRegion: [],
            autocompleteInstanceMember: [],
            autocompleteNamespaceAccess: [],
            functionCall: [],
            autoTypeResolution: [],
        },
    };
}

/** Linked-node tag — what kind of decl owns this scope. */
export type ScopeLinkedKind =
    | 'global'
    | 'namespace'
    | 'class'
    | 'struct'
    | 'interface'
    | 'enum'
    | 'function'
    | 'function-holder'
    | 'method'
    | 'method-holder'
    | 'constructor'
    | 'destructor'
    | 'block'
    | 'lambda'
    | 'if'
    | 'for'
    | 'foreach'
    | 'while'
    | 'do-while'
    | 'try'
    | 'catch'
    | 'defer'
    | 'match';

interface ScopeUsingNamespace {
    scopePath: ScopePath;
    fromTokens: TokenObject[];
}

export class SymbolScope {
    private readonly _parent: SymbolScope | undefined;
    private readonly _children: ScopeTable = new Map();
    private readonly _symbols: SymbolTable = new Map();
    private readonly _usingNamespaces: ScopeUsingNamespace[] = [];

    public readonly scopePath: ScopePath;

    public constructor(
        parent: SymbolScope | undefined,
        public readonly key: string,
        public linkedKind: ScopeLinkedKind = 'block',
    ) {
        this._parent = parent;
        this.scopePath = parent !== undefined ? [...parent.scopePath, key] : [];
    }

    public get parentScope(): SymbolScope | undefined { return this._parent; }
    public isGlobalScope(): this is SymbolGlobalScope {
        return this._parent === undefined;
    }

    public get symbolTable(): ReadonlyMap<string, SymbolObjectHolder> { return this._symbols; }
    public get childScopeTable(): ReadonlyMap<string, SymbolScope> { return this._children; }

    /** Walk parents (incl. self) until predicate. */
    public takeParentBy(pred: (s: SymbolScope) => boolean): SymbolScope | undefined {
        if (pred(this)) return this;
        return this._parent ? this._parent.takeParentBy(pred) : undefined;
    }

    public getGlobalScope(): SymbolGlobalScope {
        let s: SymbolScope = this;
        while (s._parent !== undefined) s = s._parent;
        return s as SymbolGlobalScope;
    }

    /** Insert a child scope (or reuse if it exists). */
    public insertScope(key: string, kind: ScopeLinkedKind = 'block'): SymbolScope {
        const existing = this._children.get(key);
        if (existing) return existing;

        const created = new SymbolScope(this, key, kind);
        this._children.set(key, created);
        return created;
    }

    public lookupScope(key: string): SymbolScope | undefined {
        return this._children.get(key);
    }

    public lookupScopeWithParent(key: string): SymbolScope | undefined {
        const me = this._children.get(key);
        if (me) return me;
        return this._parent ? this._parent.lookupScopeWithParent(key) : undefined;
    }

    public resolveRelativeScope(path: ScopePath): SymbolScope | undefined {
        if (path.length === 0) return this;
        const child = this._children.get(path[0]);
        if (!child) return undefined;
        return child.resolveRelativeScope(path.slice(1));
    }

    /**
     * Insert a symbol. Returns undefined on success, or the existing holder
     * if a conflict prevented insertion. Functions overload onto an existing
     * SymbolFunctionHolder.
     */
    public insertSymbol(symbol: SymbolObject): SymbolObjectHolder | undefined {
        const id = symbol.identifierToken.text;
        const existing = this._symbols.get(id);

        if (existing === undefined) {
            this._symbols.set(id, symbol.toHolder());
            return undefined;
        }

        // Function overloading: existing must already be a function-holder.
        if (symbol.isFunction() && existing instanceof SymbolFunctionHolder) {
            existing.pushOverload(symbol);
            return undefined;
        }

        return existing;
    }

    public insertSymbolAndCheck(symbol: SymbolObject): boolean {
        const conflict = this.insertSymbol(symbol);
        if (conflict !== undefined) {
            analyzerDiagnostic.error(
                symbol.identifierToken.location,
                `Symbol '${symbol.identifierToken.text}' is already declared in this scope.`,
                'EN_DUP_SYM',
            );
            return false;
        }
        return true;
    }

    public lookupSymbol(name: string): SymbolObjectHolder | undefined {
        return this._symbols.get(name);
    }

    public lookupSymbolWithParent(name: string): SymbolObjectHolder | undefined {
        const me = this._symbols.get(name);
        if (me) return me;
        return this._parent ? this._parent.lookupSymbolWithParent(name) : undefined;
    }

    public pushUsingNamespace(path: ScopePath, fromToken: TokenObject): void {
        const found = this._usingNamespaces.find(u => isScopePathEqual(u.scopePath, path));
        if (found) {
            found.fromTokens.push(fromToken);
        } else {
            this._usingNamespaces.push({ scopePath: path, fromTokens: [fromToken] });
        }
    }

    public getUsingNamespacesWithParent(): ReadonlyArray<ScopeUsingNamespace> {
        const own = this._usingNamespaces;
        return this._parent === undefined
            ? own
            : [...this._parent.getUsingNamespacesWithParent(), ...own];
    }

    /** Recursive shallow copy of symbols + child scopes from `other` into `this`. */
    public copyFrom(other: SymbolScope): void {
        for (const [key, holder] of other._symbols) {
            if (!this._symbols.has(key)) this._symbols.set(key, holder);
        }
        for (const [key, child] of other._children) {
            const own = this.insertScope(key, child.linkedKind);
            own.copyFrom(child);
        }
    }
}

// ---- Global scope --------------------------------------------------------

export class SymbolGlobalScope extends SymbolScope {
    private readonly _context: GlobalScopeContext;

    public constructor(filepathOrContext: string | GlobalScopeContext) {
        super(undefined, '', 'global');
        this._context = typeof filepathOrContext === 'string'
            ? createInitialContext(filepathOrContext)
            : filepathOrContext;
    }

    public getContext(): Readonly<GlobalScopeContext> {
        return this._context;
    }

    public get filepath(): string { return this._context.filepath; }

    public get info(): Readonly<DetailScopeInformation> { return this._context.info; }

    public pushReference(info: ReferenceInfo): void {
        this._context.info.reference.push(info);
    }

    public pushScopeRegion(info: ScopeRegionInfo): void {
        this._context.info.scopeRegion.push(info);
    }

    public pushAutocompleteInstanceMember(info: AutocompleteInstanceMemberInfo): void {
        this._context.info.autocompleteInstanceMember.push(info);
    }

    public pushAutocompleteNamespaceAccess(info: AutocompleteNamespaceAccessInfo): void {
        this._context.info.autocompleteNamespaceAccess.push(info);
    }

    public pushFunctionCall(info: FunctionCallInfo): void {
        this._context.info.functionCall.push(info);
    }

    public pushAutoTypeResolution(info: AutoTypeResolutionInfo): void {
        this._context.info.autoTypeResolution.push(info);
    }

    public resolveScope(path: ScopePath): SymbolScope | undefined {
        return this.resolveRelativeScope(path);
    }

    /** Copy symbols + child scopes from another global scope (for include). */
    public includeExternalScope(external: SymbolScope): void {
        for (const [key, holder] of external.symbolTable) {
            const me = this.symbolTable.get(key);
            if (me === undefined) {
                if (holder instanceof SymbolFunctionHolder) {
                    for (const f of holder.toList()) this.insertSymbol(f);
                } else {
                    this.insertSymbol(holder);
                }
            }
            // On conflict (already-defined): silently skip; collision warning is
            // emitted separately in enmaTypes.ts when bundled origins collide.
        }
        for (const [key, child] of external.childScopeTable) {
            const myChild = this.insertScope(key, child.linkedKind);
            myChild.copyFrom(child);
        }
    }
}

// ---- Helpers ------------------------------------------------------------

let s_anonCounter = 0;
export function createAnonymousIdentifier(): string {
    return `~${++s_anonCounter}`;
}

export function isAnonymousIdentifier(s: string): boolean {
    return s.startsWith('~');
}

/** Walk parents-and-using-namespaces; used by lookups that respect using. */
export function collectScopeListWithParentAndUsing(scope: SymbolScope): SymbolScope[] {
    const using = scope.getUsingNamespacesWithParent();
    return collectScopeListInternal(scope, using);
}

function collectScopeListInternal(
    scope: SymbolScope,
    using: ReadonlyArray<{ scopePath: ScopePath }>,
): SymbolScope[] {
    const out: SymbolScope[] = [scope];
    for (const u of using) {
        const r = scope.resolveRelativeScope(u.scopePath);
        if (r) out.push(r);
    }
    return scope.parentScope === undefined ? out : [...out, ...collectScopeListInternal(scope.parentScope, using)];
}

// ---- Active-global-scope tracker ---------------------------------------

let s_activeGlobalScope: SymbolGlobalScope | undefined;

export function setActiveGlobalScope(s: SymbolGlobalScope): void {
    s_activeGlobalScope = s;
}

export function getActiveGlobalScope(): SymbolGlobalScope {
    if (s_activeGlobalScope === undefined) {
        throw new Error('No active global scope; call activateContext() before analysis.');
    }
    return s_activeGlobalScope;
}

export function tryGetActiveGlobalScope(): SymbolGlobalScope | undefined {
    return s_activeGlobalScope;
}

export function tryResolveActiveScope(path: ScopePath | undefined): SymbolScope | undefined {
    if (path === undefined) return s_activeGlobalScope;
    return s_activeGlobalScope?.resolveScope(path);
}

/** Find the deepest scope whose recorded ScopeRegion contains a position. */
export function findScopeContainingPosition(
    global: SymbolGlobalScope,
    line: number,
    character: number,
): { scope: SymbolScope; region?: ScopeRegionInfo } {
    let best: SymbolScope = global;
    let bestRegion: ScopeRegionInfo | undefined;
    for (const r of global.info.scopeRegion) {
        const loc = r.boundingLocation;
        if (loc.start.line > line || loc.end.line < line) continue;
        if (loc.start.line === line && loc.start.character > character) continue;
        if (loc.end.line === line && loc.end.character < character) continue;
        // Pick deepest match by scope-path length.
        if (bestRegion === undefined || r.targetScope.scopePath.length > bestRegion.targetScope.scopePath.length) {
            bestRegion = r;
            best = r.targetScope;
        }
    }
    return { scope: best, region: bestRegion };
}
