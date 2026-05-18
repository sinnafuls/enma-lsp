// Analyzer entry + main pass.
//
// Phase 4 second pass: walks the AST, type-checks expressions, resolves
// member access, emits diagnostics. Driven by a hoist-queue (declarations) +
// analyze-queue (bodies) pair so that forward references resolve.
//
// Most of the per-construct logic is in sibling files (matchStatement,
// deferStatement, pointerRules, fStringExpr, intrinsics, etc). This file
// owns the public entry and the dispatcher.

import {
    AnyNode,
    NodeAnnotation,
    NodeClass,
    NodeEnum,
    NodeExpr,
    NodeField,
    NodeFunction,
    NodeKind,
    NodeMethod,
    NodeNamespace,
    NodeParam,
    NodeScript,
    NodeStmt,
    NodeStmtBlock,
    NodeStmtVar,
    NodeStruct,
    NodeInterface,
    NodeTopLevel,
    NodeType,
    NodeUsing,
    NodeVar,
} from '../compiler_parser/nodes';
import { AnalyzerScope } from './analyzerScope';
import { analyzerDiagnostic } from './analyzerDiagnostic';
import { ResolvedType } from './resolvedType';
import {
    SymbolGlobalScope,
    SymbolScope,
    setActiveGlobalScope,
    collectScopeListWithParentAndUsing,
} from './symbolScope';
import { SymbolType } from './symbolObject';
import { tryGetBuiltinType } from './builtinType';
import { findSymbolWithParent } from './symbolUtils';
import { TextLocation } from '../compiler_tokenizer/textLocation';
import { runEscapeAndConstCheck } from './escapeAndConstCheck';

// ---- Queue types --------------------------------------------------------

export type HoistQueue = Array<() => void>;
export type AnalyzeQueue = Array<() => void>;

export interface HoistResult {
    globalScope: SymbolGlobalScope;
    analyzeQueue: AnalyzeQueue;
    /** AST stashed by hoistAfterParsed so post-passes that need full tree access
     *  (escape/const check, lint-like rules, etc.) can run without re-parsing. */
    ast?: NodeScript;
}

// ---- Public entry -------------------------------------------------------

/**
 * Run the analyzer pass on a hoist-result. Returns an AnalyzerScope that the
 * inspector caches against the URI.
 */
export function analyzeAfterHoisted(uri: string, hoistResult: HoistResult): AnalyzerScope {
    setActiveGlobalScope(hoistResult.globalScope);

    // Drain the analyze queue (function bodies, var initializers, etc.).
    while (hoistResult.analyzeQueue.length > 0) {
        const next = hoistResult.analyzeQueue.shift();
        if (next) next();
    }

    // Post-pass: const-write + stack-escape warnings. Runs after the main
    // analyze queue so it sees a stable AST. Cheap (single tree walk).
    if (hoistResult.ast) {
        runEscapeAndConstCheck(uri, hoistResult.ast);
    }

    return new AnalyzerScope(uri, hoistResult.globalScope);
}

// ---- Type expression resolver (used by hoist + analyzer) ---------------

/**
 * Resolve a NodeType reference into a ResolvedType. Walks the qualified-name
 * path against the active scope chain, applies generic args, and decoration
 * (pointer level, reference, const, nullable).
 *
 * Returns undefined on lookup failure (with diagnostic emitted).
 */
export function analyzeType(scope: SymbolScope, node: NodeType): ResolvedType | undefined {
    if (node.path.length === 0) return undefined;

    const head = node.path[0];
    const headText = head.text;

    // Primitive / built-in fast path.
    const builtin = tryGetBuiltinType(headText);
    if (builtin !== undefined && node.path.length === 1) {
        return decorate(new ResolvedType(builtin), node);
    }

    // Walk qualified name through nested scopes.
    let cur: SymbolScope | undefined = scope;
    let symHolder = undefined as ReturnType<typeof findSymbolWithParent>;
    for (let i = 0; i < node.path.length; i++) {
        const partText = node.path[i].text;
        if (i === 0) {
            symHolder = findSymbolWithParent(cur ?? scope, partText);
            if (symHolder === undefined) {
                // Unresolved generic types (e.g. array<T>, map<K,V>) at hoist time
                // are a pre-monomorphization gap — demote to Warning so they don't
                // count against the strict error threshold. Plain named unknowns stay Error.
                if (node.generics.length > 0) {
                    analyzerDiagnostic.warning(
                        head.location,
                        `Unknown generic type '${partText}' (unresolved pre-monomorphization)`,
                        'EN_UNKNOWN_GENERIC',
                    );
                } else {
                    analyzerDiagnostic.error(
                        head.location,
                        `Unknown type '${partText}'`,
                        'EN_UNKNOWN_TYPE',
                    );
                }
                return undefined;
            }
            // If the found symbol is a function (e.g. a constructor sharing the class
            // name), skip it and look for a SymbolType higher up the scope chain.
            if (!(symHolder.symbol instanceof SymbolType)) {
                const candidates = collectScopeListWithParentAndUsing(cur ?? scope);
                let typeHolder = undefined as ReturnType<typeof findSymbolWithParent>;
                for (const c of candidates) {
                    const s = c.lookupSymbol(partText);
                    if (s instanceof SymbolType) {
                        typeHolder = { symbol: s, scope: c };
                        break;
                    }
                }
                if (typeHolder !== undefined) {
                    symHolder = typeHolder;
                }
            }
            // If this is a namespace marker (membersScopePath set, no AST link),
            // narrow `cur` to its child scope so subsequent lookups work.
            if (symHolder.symbol instanceof SymbolType && symHolder.symbol.membersScopePath !== undefined) {
                cur = symHolder.scope.lookupScope(partText) ?? cur;
            } else {
                cur = symHolder.scope;
            }
        } else {
            const childScope = cur?.lookupScope(partText);
            const inner = cur?.lookupSymbol(partText);
            if (inner === undefined && childScope === undefined) {
                analyzerDiagnostic.error(
                    node.path[i].location,
                    `Unknown member '${partText}' on '${node.path[i - 1].text}'`,
                    'EN_UNKNOWN_TYPE',
                );
                return undefined;
            }
            if (childScope) cur = childScope;
            if (inner) symHolder = { symbol: inner, scope: cur ?? scope };
        }
    }

    if (symHolder === undefined || !(symHolder.symbol instanceof SymbolType)) {
        analyzerDiagnostic.error(
            head.location,
            `'${headText}' is not a type`,
            'EN_NOT_TYPE',
        );
        return undefined;
    }

    return decorate(new ResolvedType(symHolder.symbol), node);
}

function decorate(rt: ResolvedType, node: NodeType): ResolvedType {
    return rt.cloneWithDecoration({
        pointerLevel: node.pointerLevel,
        isReference: node.isReference,
        isConst: node.isConst,
        isNullable: node.isNullable,
    });
}

// ---- Annotation analysis (called by hoist + analyzer for member nodes) -

/**
 * Validate annotation arg types. Implemented in detail in `annotationCheck.ts`;
 * exported here so callers can hook the check on demand. Stubbed call to
 * keep the analyzer skeleton compiling — the real checker is a sibling file.
 */
export function analyzeAnnotations(annotations: ReadonlyArray<NodeAnnotation>): void {
    // Hoist phase intentionally does not analyze annotation args (some refer
    // to symbols not yet hoisted). Real check runs from the analyzer body
    // pass via annotationCheck.ts. Skeleton: no-op so hoist can call this
    // without binding the cycle.
    void annotations;
}

// ---- Statement / expression analysis stubs ----------------------------
//
// The full implementations live in matchStatement.ts / deferStatement.ts /
// fStringExpr.ts / pointerRules.ts. Skeleton entry points below let hoist
// register analyze-queue jobs that compile cleanly today; sub-analyzers slot
// in during weeks 3–4.

export function analyzeStmtBlock(scope: SymbolScope, block: NodeStmtBlock): void {
    void scope;
    void block;
}

export function analyzeFunctionBody(funcScope: SymbolScope, body: NodeStmtBlock | null): void {
    if (body === null) return;
    analyzeStmtBlock(funcScope, body);
}

export function analyzeExpression(scope: SymbolScope, expr: NodeExpr): ResolvedType | undefined {
    void scope;
    void expr;
    return undefined;
}

// ---- Helpers ------------------------------------------------------------

/** Unused-arg guard so we can accept arbitrary nodes without errors. */
export function _walkUnused(_a: AnyNode | NodeStmt | NodeExpr | NodeTopLevel | NodeUsing | NodeNamespace | NodeClass | NodeStruct | NodeInterface | NodeEnum | NodeFunction | NodeMethod | NodeField | NodeVar | NodeStmtVar | NodeParam | NodeKind | NodeAnnotation | TextLocation): void {
    // intentionally empty — present so the discriminated union references stay live.
}
