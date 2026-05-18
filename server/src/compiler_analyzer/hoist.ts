// Hoist pass — walks NodeScript top-level + nested decls, registering
// every type/function/variable into the SymbolGlobalScope before bodies are
// analyzed. Forward-references work because all declarations in a file (and
// transitively included files) land in the symbol table before any
// expression analysis fires.
//
// Pattern ported from angel-lsp's hoist.ts (~50% port). Enma-specific bits:
//  - Multi-inheritance: bases are captured in order on Class/Struct/Interface
//    and assigned via `assignBaseList`. C3 linearization runs lazily in
//    `mro.ts` when a member-lookup or rename needs the resolved order.
//  - `auto` vars register with ResolvedType.autoPending(host); the analyzer
//    pass (via autoResolution.ts) replaces the placeholder with the inferred
//    type once the initializer is analyzed.
//  - §A8 / §A11 modifiers: ignored at hoist; checked by sub-analyzers.

import {
    NodeAnnotation,
    NodeClass,
    NodeConstructor,
    NodeDelegate,
    NodeDestructor,
    NodeEnum,
    NodeField,
    NodeFunction,
    NodeInterface,
    NodeKind,
    NodeMember,
    NodeMethod,
    NodeMixin,
    NodeNamespace,
    NodeProperty,
    NodeScript,
    NodeStruct,
    NodeTemplate,
    NodeTopLevel,
    NodeTypedef,
    NodeUsing,
    NodeVar,
} from '../compiler_parser/nodes';
import {
    AccessModifier,
    SymbolFunction,
    SymbolType,
    SymbolVariable,
    createEnumValueSymbol,
    modifiersToAccess,
} from './symbolObject';
import {
    SymbolGlobalScope,
    SymbolScope,
    createAnonymousIdentifier,
} from './symbolScope';
import { ResolvedType } from './resolvedType';
import { tryGetBuiltinType, builtinThisToken } from './builtinType';
import {
    analyzeFunctionBody,
    analyzeStmtBlock,
    analyzeType,
    AnalyzeQueue,
    HoistQueue,
    HoistResult,
} from './analyzer';
import { autoPendingPlaceholder } from './autoResolution';
import { analyzerDiagnostic } from './analyzerDiagnostic';
import { checkAnnotation } from './annotationCheck';
import { checkDllAnnotationPermission } from './permissionGate';
import { computeMro } from './mro';

// ---- Public entry -------------------------------------------------------

export function hoistAfterParsed(ast: NodeScript, globalScope: SymbolGlobalScope): HoistResult {
    const analyzeQueue: AnalyzeQueue = [];
    const hoistQueue: HoistQueue = [];

    hoistTopLevelList(globalScope, ast.children, analyzeQueue, hoistQueue);

    // Drain hoist queue (annotations / base-list resolution / member copy from
    // base classes). Resolves forward refs that were unresolvable mid-walk.
    while (hoistQueue.length > 0) {
        const next = hoistQueue.shift();
        if (next) next();
    }

    return { globalScope, analyzeQueue, ast };
}

// ---- Top-level dispatcher ----------------------------------------------

function hoistTopLevelList(
    parent: SymbolScope,
    decls: ReadonlyArray<NodeTopLevel | NodeMember>,
    aq: AnalyzeQueue,
    hq: HoistQueue,
): void {
    for (const d of decls) {
        switch (d.kind) {
            case NodeKind.Namespace:
                hoistNamespace(parent, d, aq, hq);
                break;
            case NodeKind.Using:
                hoistUsing(parent, d);
                break;
            case NodeKind.Typedef:
                hoistTypedef(parent, d);
                break;
            case NodeKind.Template:
                hoistTemplate(parent, d, aq, hq);
                break;
            case NodeKind.Class:
                hoistClass(parent, d, aq, hq, false);
                break;
            case NodeKind.Struct:
                hoistStruct(parent, d, aq, hq);
                break;
            case NodeKind.Interface:
                hoistInterface(parent, d, aq, hq);
                break;
            case NodeKind.Enum:
                hoistEnum(parent, d);
                break;
            case NodeKind.Mixin:
                hoistMixin(parent, d, aq, hq);
                break;
            case NodeKind.Delegate:
                hoistDelegate(parent, d);
                break;
            case NodeKind.Function:
                hoistFunction(parent, d, aq, hq, /*instanceMember*/ false);
                break;
            case NodeKind.Coroutine:
                // Treat as a function for hoist purposes; body becomes a coroutine scope.
                hoistFunction(parent, {
                    ...d,
                    kind: NodeKind.Function,
                    body: d.body,
                    isExtern: false,
                    modifiers: [],
                    templateParams: [],
                } as NodeFunction, aq, hq, false);
                break;
            case NodeKind.Var:
                hoistVar(parent, d, aq, hq, false);
                break;
            case NodeKind.Method:
                hoistMethod(parent, d, aq, hq);
                break;
            case NodeKind.Field:
                hoistField(parent, d, aq, hq);
                break;
            case NodeKind.Constructor:
                hoistConstructor(parent, d, aq, hq);
                break;
            case NodeKind.Destructor:
                hoistDestructor(parent, d, aq, hq);
                break;
            case NodeKind.Property:
                hoistProperty(parent, d);
                break;
            case NodeKind.Import:
            case NodeKind.OperatorOverload:
            case NodeKind.StmtExpr:
                // No symbol to register at the type-table level. (Imports are
                // resolved by the inspector layer; OperatorOverload is per-
                // class and registered alongside its parent's members.)
                break;
            default:
                // Permissive: ignore unknown decls so partial-AST is OK.
                break;
        }
    }
}

// ---- Namespace ----------------------------------------------------------

function hoistNamespace(parent: SymbolScope, node: NodeNamespace, aq: AnalyzeQueue, hq: HoistQueue): void {
    const scope = parent.insertScope(node.name.text, 'namespace');

    // Register a marker SymbolType so qualified-name resolution can find the
    // namespace (membersScopePath points at this scope). This mirrors the
    // angel-lsp pattern of "namespace shows up as a Type with a member scope".
    const marker = SymbolType.create({
        identifierToken: node.name,
        scopePath: parent.scopePath,
        linkedNode: undefined,
        membersScopePath: scope.scopePath,
    });
    parent.insertSymbol(marker);

    hoistTopLevelList(scope, node.children, aq, hq);
}

// ---- Using --------------------------------------------------------------

function hoistUsing(scope: SymbolScope, node: NodeUsing): void {
    if (node.isNamespace) {
        const path = node.path.map(t => t.text);
        if (path.length === 0) return;
        // Push as a using-namespace decl on the *current* scope so lookups
        // here can transit through it.
        scope.pushUsingNamespace(path, node.path[0]);
        return;
    }

    // `using T = X;` alias.
    if (!node.alias) return;

    // The aliasTarget is a NodeType; we don't fully resolve here (forward refs).
    // Instead register a marker SymbolType keyed by the alias name; the
    // analyzer pass replaces its members-scope-path on first use.
    const marker = SymbolType.create({
        identifierToken: node.alias,
        scopePath: scope.scopePath,
        linkedNode: undefined,
        membersScopePath: undefined,
    });
    scope.insertSymbol(marker);
}

// ---- Typedef ------------------------------------------------------------

function hoistTypedef(scope: SymbolScope, node: NodeTypedef): void {
    // Register an alias to the underlying type (resolved lazily).
    const sym = SymbolType.create({
        identifierToken: node.name,
        scopePath: scope.scopePath,
        linkedNode: undefined,
        membersScopePath: undefined,
    });
    scope.insertSymbolAndCheck(sym);
}

// ---- Template -----------------------------------------------------------

function hoistTemplate(scope: SymbolScope, node: NodeTemplate, aq: AnalyzeQueue, hq: HoistQueue): void {
    // Register each `typename T` param as a stub SymbolType in the template's
    // parent scope so that references to T in the body's return type, param
    // types, and field types resolve cleanly during hoist without emitting
    // false-positive EN_UNKNOWN_TYPE diagnostics. The real monomorphization
    // (templateInstantiation.ts) overwrites these stubs at instantiation time.
    for (const param of node.params) {
        // Only register typename params. Value params (`int N`, keyword===null)
        // are not types; skip them.
        if (param.keyword !== null) {
            const stub = SymbolType.create({
                identifierToken: param.name,
                scopePath: scope.scopePath,
                linkedNode: undefined,
                membersScopePath: undefined,
                isTypeParameter: true,
            });
            // Use plain insertSymbol so duplicate template params in the same
            // scope silently coexist without EN_DUP_SYM noise.
            scope.insertSymbol(stub);
        }
    }

    // The template body is a single decl. Hoist with the template's parent
    // scope; bind template params on the body's own scope when the analyzer
    // pass walks into it (handled by templateInstantiation.ts later).
    hoistTopLevelList(scope, [node.body], aq, hq);
}

// ---- Class / Struct / Interface ----------------------------------------

function hoistClass(parent: SymbolScope, node: NodeClass, aq: AnalyzeQueue, hq: HoistQueue, isMixin: boolean): void {
    const sym = SymbolType.create({
        identifierToken: node.name,
        scopePath: parent.scopePath,
        linkedNode: node,
        membersScopePath: undefined,
        isMixin,
    });
    if (!parent.insertSymbolAndCheck(sym)) return;

    const scope = parent.insertScope(node.name.text, 'class');
    sym.assignMembersScopePath(scope.scopePath);

    // Implicit `this` symbol.
    scope.insertSymbol(SymbolVariable.create({
        identifierToken: builtinThisToken,
        scopePath: scope.scopePath,
        type: new ResolvedType(sym),
        isInstanceMember: false,
        accessRestriction: AccessModifier.Private,
    }));

    // Capture base list — C3 MRO precomputed at end of hoist queue.
    hq.push(() => {
        const bases: (ResolvedType | undefined)[] = [];
        for (const base of node.bases) {
            const resolved = analyzeType(parent, base);
            bases.push(resolved);
        }
        sym.assignBaseList(bases);
        if (bases.length > 0) computeMro(sym);
    });

    hoistTopLevelList(scope, node.members, aq, hq);
    hoistAnnotations(node.annotations, hq);
}

function hoistStruct(parent: SymbolScope, node: NodeStruct, aq: AnalyzeQueue, hq: HoistQueue): void {
    const sym = SymbolType.create({
        identifierToken: node.name,
        scopePath: parent.scopePath,
        linkedNode: node,
        membersScopePath: undefined,
        isStruct: true,
    });
    if (!parent.insertSymbolAndCheck(sym)) return;

    const scope = parent.insertScope(node.name.text, 'struct');
    sym.assignMembersScopePath(scope.scopePath);

    scope.insertSymbol(SymbolVariable.create({
        identifierToken: builtinThisToken,
        scopePath: scope.scopePath,
        type: new ResolvedType(sym),
        isInstanceMember: false,
        accessRestriction: AccessModifier.Private,
    }));

    hq.push(() => {
        const bases: (ResolvedType | undefined)[] = [];
        for (const base of node.bases) bases.push(analyzeType(parent, base));
        sym.assignBaseList(bases);
        if (bases.length > 0) computeMro(sym);
    });

    hoistTopLevelList(scope, node.members, aq, hq);
    hoistAnnotations(node.annotations, hq);
}

function hoistInterface(parent: SymbolScope, node: NodeInterface, aq: AnalyzeQueue, hq: HoistQueue): void {
    const sym = SymbolType.create({
        identifierToken: node.name,
        scopePath: parent.scopePath,
        linkedNode: node,
        membersScopePath: undefined,
        isInterface: true,
    });
    if (!parent.insertSymbolAndCheck(sym)) return;

    const scope = parent.insertScope(node.name.text, 'interface');
    sym.assignMembersScopePath(scope.scopePath);

    hq.push(() => {
        const bases: (ResolvedType | undefined)[] = [];
        for (const base of node.bases) bases.push(analyzeType(parent, base));
        sym.assignBaseList(bases);
        if (bases.length > 0) computeMro(sym);
    });

    hoistTopLevelList(scope, node.members, aq, hq);
    hoistAnnotations(node.annotations, hq);
}

// ---- Enum ---------------------------------------------------------------

function hoistEnum(parent: SymbolScope, node: NodeEnum): void {
    const sym = SymbolType.create({
        identifierToken: node.name,
        scopePath: parent.scopePath,
        linkedNode: node,
        membersScopePath: undefined,
        isEnum: true,
    });
    if (!parent.insertSymbolAndCheck(sym)) return;

    const scope = parent.insertScope(node.name.text, 'enum');
    sym.assignMembersScopePath(scope.scopePath);

    const enumType = new ResolvedType(sym);
    for (const value of node.values) {
        scope.insertSymbolAndCheck(createEnumValueSymbol({
            identifierToken: value.name,
            scopePath: scope.scopePath,
            enumType,
            valueNode: value,
        }));
    }
}

// ---- Mixin --------------------------------------------------------------

function hoistMixin(parent: SymbolScope, node: NodeMixin, aq: AnalyzeQueue, hq: HoistQueue): void {
    // Mixins are class-shaped; reuse hoistClass with isMixin=true. We adapt
    // a NodeClass-like shape so the existing path works.
    const adapted: NodeClass = {
        kind: NodeKind.Class,
        range: node.range,
        name: node.name,
        bases: node.bases,
        annotations: [],
        members: node.members,
    };
    hoistClass(parent, adapted, aq, hq, true);
}

// ---- Delegate -----------------------------------------------------------

function hoistDelegate(parent: SymbolScope, node: NodeDelegate): void {
    // Delegates are function-typed type aliases. Register as a SymbolType so
    // they can appear in type positions; analyzer pass binds the underlying
    // (returnType, params) signature on first use.
    const sym = SymbolType.create({
        identifierToken: node.name,
        scopePath: parent.scopePath,
        linkedNode: undefined,
        membersScopePath: undefined,
    });
    parent.insertSymbolAndCheck(sym);
}

// ---- Property -----------------------------------------------------------

function hoistProperty(parent: SymbolScope, node: NodeProperty): void {
    // Property maps to a virtual variable; getter/setter are member-scoped
    // helpers. Hoist registers just the variable; analyzer wires getter/setter.
    const v = SymbolVariable.create({
        identifierToken: node.name,
        scopePath: parent.scopePath,
        type: undefined,
        isInstanceMember: true,
        accessRestriction: undefined,
    });
    parent.insertSymbolAndCheck(v);
}

// ---- Function -----------------------------------------------------------

function hoistFunction(
    parent: SymbolScope,
    node: NodeFunction,
    aq: AnalyzeQueue,
    hq: HoistQueue,
    isInstanceMember: boolean,
): void {
    // Function holder scope (no node) -> per-overload anonymous scope (with node)
    const holderScope = parent.insertScope(node.name.text, 'function-holder');
    const fnScope = holderScope.insertScope(createAnonymousIdentifier(), 'function');

    const access = modifiersToAccess(node.modifiers);
    const sym = SymbolFunction.create({
        identifierToken: node.name,
        scopePath: parent.scopePath,
        linkedNode: node,
        functionScopePath: fnScope.scopePath,
        returnType: undefined,
        parameterTypes: [],
        isInstanceMember,
        accessRestriction: access,
        isExtern: node.isExtern,
        isVariadic: node.params.some(p => p.isVariadic),
    });

    if (!parent.insertSymbolAndCheck(sym)) return;

    hq.push(() => {
        sym.assignReturnType(analyzeType(fnScope, node.returnType));
        const paramTypes: (ResolvedType | undefined)[] = [];
        for (const p of node.params) {
            const t = p.type ? analyzeType(fnScope, p.type) : undefined;
            paramTypes.push(t);
            if (p.name) {
                fnScope.insertSymbolAndCheck(SymbolVariable.create({
                    identifierToken: p.name,
                    scopePath: fnScope.scopePath,
                    type: t,
                    isInstanceMember: false,
                    accessRestriction: undefined,
                    linkedNode: p,
                }));
            }
        }
        sym.assignParameterTypes(paramTypes);
    });

    aq.push(() => {
        if (node.body !== null) analyzeFunctionBody(fnScope, node.body);
    });

    // AC-9 — extern decls with [[dll(...)]] are permission-gated.
    if (node.isExtern) {
        hq.push(() => gateExternAnnotations(node.annotations));
    }

    hoistAnnotations(node.annotations, hq);
}

function hoistMethod(
    parent: SymbolScope,
    node: NodeMethod,
    aq: AnalyzeQueue,
    hq: HoistQueue,
): void {
    const holderScope = parent.insertScope(node.name.text, 'method-holder');
    const fnScope = holderScope.insertScope(createAnonymousIdentifier(), 'method');

    const access = modifiersToAccess(node.modifiers);
    const sym = SymbolFunction.create({
        identifierToken: node.name,
        scopePath: parent.scopePath,
        linkedNode: node,
        functionScopePath: fnScope.scopePath,
        returnType: undefined,
        parameterTypes: [],
        isInstanceMember: true,
        accessRestriction: access,
        isVariadic: node.params.some(p => p.isVariadic),
    });
    if (!parent.insertSymbolAndCheck(sym)) return;

    hq.push(() => {
        sym.assignReturnType(analyzeType(fnScope, node.returnType));
        const paramTypes: (ResolvedType | undefined)[] = [];
        for (const p of node.params) {
            const t = p.type ? analyzeType(fnScope, p.type) : undefined;
            paramTypes.push(t);
            if (p.name) {
                fnScope.insertSymbolAndCheck(SymbolVariable.create({
                    identifierToken: p.name,
                    scopePath: fnScope.scopePath,
                    type: t,
                    isInstanceMember: false,
                    accessRestriction: undefined,
                    linkedNode: p,
                }));
            }
        }
        sym.assignParameterTypes(paramTypes);
    });

    aq.push(() => {
        if (node.body !== null) analyzeStmtBlock(fnScope, node.body);
    });

    hoistAnnotations(node.annotations, hq);
}

function hoistConstructor(parent: SymbolScope, node: NodeConstructor, aq: AnalyzeQueue, hq: HoistQueue): void {
    const holderScope = parent.insertScope(node.name.text, 'method-holder');
    const fnScope = holderScope.insertScope(createAnonymousIdentifier(), 'constructor');

    const sym = SymbolFunction.create({
        identifierToken: node.name,
        scopePath: parent.scopePath,
        linkedNode: node,
        functionScopePath: fnScope.scopePath,
        returnType: undefined,
        parameterTypes: [],
        isInstanceMember: true,
        accessRestriction: undefined,
        isConstructor: true,
        isVariadic: node.params.some(p => p.isVariadic),
    });
    parent.insertSymbol(sym);

    hq.push(() => {
        const paramTypes: (ResolvedType | undefined)[] = [];
        for (const p of node.params) {
            const t = p.type ? analyzeType(fnScope, p.type) : undefined;
            paramTypes.push(t);
            if (p.name) {
                fnScope.insertSymbolAndCheck(SymbolVariable.create({
                    identifierToken: p.name,
                    scopePath: fnScope.scopePath,
                    type: t,
                    isInstanceMember: false,
                    accessRestriction: undefined,
                    linkedNode: p,
                }));
            }
        }
        sym.assignParameterTypes(paramTypes);
    });

    if (node.body !== null) {
        const body = node.body;
        aq.push(() => analyzeStmtBlock(fnScope, body));
    }
    hoistAnnotations(node.annotations, hq);
}

function hoistDestructor(parent: SymbolScope, node: NodeDestructor, aq: AnalyzeQueue, hq: HoistQueue): void {
    const holderScope = parent.insertScope(`~${node.name.text}`, 'method-holder');
    const fnScope = holderScope.insertScope(createAnonymousIdentifier(), 'destructor');

    const sym = SymbolFunction.create({
        identifierToken: node.name,
        scopePath: parent.scopePath,
        linkedNode: node,
        functionScopePath: fnScope.scopePath,
        returnType: undefined,
        parameterTypes: [],
        isInstanceMember: true,
        accessRestriction: undefined,
        isDestructor: true,
    });
    parent.insertSymbol(sym);

    if (node.body !== null) {
        const body = node.body;
        aq.push(() => analyzeStmtBlock(fnScope, body));
    }
    hoistAnnotations(node.annotations, hq);
}

// ---- Field & free-Var --------------------------------------------------

function hoistField(parent: SymbolScope, node: NodeField, aq: AnalyzeQueue, hq: HoistQueue): void {
    const isAuto = node.type.path.length === 1 && node.type.path[0].text === 'auto';
    const access = modifiersToAccess(node.modifiers);

    const v = SymbolVariable.create({
        identifierToken: node.name,
        scopePath: parent.scopePath,
        type: isAuto ? autoPendingPlaceholder() : undefined,
        isInstanceMember: true,
        accessRestriction: access,
        linkedNode: node,
        isStatic: node.modifiers.some(m => m.text === 'static'),
        isConst: node.modifiers.some(m => m.text === 'const' || m.text === 'constexpr'),
    });
    if (!parent.insertSymbolAndCheck(v)) return;

    hq.push(() => {
        if (!isAuto) v.assignType(analyzeType(parent, node.type));
    });

    hoistAnnotations(node.annotations, hq);
}

function hoistVar(scope: SymbolScope, node: NodeVar, aq: AnalyzeQueue, hq: HoistQueue, isInstanceMember: boolean): void {
    const isAuto = node.type.path.length === 1 && node.type.path[0].text === 'auto';
    const access = modifiersToAccess(node.modifiers);

    const v = SymbolVariable.create({
        identifierToken: node.name,
        scopePath: scope.scopePath,
        type: isAuto ? autoPendingPlaceholder() : undefined,
        isInstanceMember,
        accessRestriction: access,
        linkedNode: node,
        isStatic: node.modifiers.some(m => m.text === 'static'),
        isConst: node.modifiers.some(m => m.text === 'const' || m.text === 'constexpr'),
    });
    if (!scope.insertSymbolAndCheck(v)) return;

    hq.push(() => {
        if (!isAuto) v.assignType(analyzeType(scope, node.type));
    });

    if (isAuto && node.initializer === null) {
        analyzerDiagnostic.error(
            node.name.location,
            `'auto' declaration of '${node.name.text}' requires an initializer`,
            'EN_AUTO_NO_INIT',
        );
    }

    hoistAnnotations(node.annotations, hq);
}

// ---- Annotation hoist (defers to annotationCheck.ts later) -------------

function hoistAnnotations(annotations: ReadonlyArray<NodeAnnotation>, hq: HoistQueue): void {
    // Annotation type-checks (incl. [[align]]/[[dll]] arg shape, unknown
    // annotation warnings) deferred to the hoist queue so symbol-resolution
    // for annotation args can use the fully-populated table.
    if (annotations.length === 0) return;
    hq.push(() => {
        for (const a of annotations) checkAnnotation(a);
    });
}

/**
 * Permission-gate any [[dll(...)]] annotation on an extern decl. Emits an
 * AC-9 errorForce diagnostic when the ffi permission is not granted.
 */
export function gateExternAnnotations(annotations: ReadonlyArray<NodeAnnotation>): void {
    for (const a of annotations) checkDllAnnotationPermission(a);
}

// Re-export for analyzer.ts wire-in.
export { computeMro };

