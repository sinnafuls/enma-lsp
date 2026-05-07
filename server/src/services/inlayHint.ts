// Inlay hint provider.
//
// Two kinds of hints (best-effort, AST-based):
//   1. Auto-typed variable: `auto x = expr;` → `: T` after `x` if a side-table
//      entry resolves the inferred type.
//   2. Parameter names at call sites: `foo(1, 2)` → `a:` `b:` chips before
//      each argument when the callee is a known function. Skips when the
//      arg is just an identifier matching the parameter name (likely
//      forwarding) or when the user wrote `name = arg` style.

import * as lsp from 'vscode-languageserver';

import { TextRange } from '../compiler_tokenizer/textLocation';
import {
    NodeScript,
    NodeKind,
    NodeExpr,
    NodeStmt,
    NodeTopLevel,
    NodeMember,
    NodeStmtBlock,
    NodeVar,
    NodeStmtVar,
    NodeExprCall,
} from '../compiler_parser/nodes';
import { SymbolGlobalScope, SymbolScope } from '../compiler_analyzer/symbolScope';
import {
    SymbolFunctionHolder,
} from '../compiler_analyzer/symbolObject';
import { AnalyzerScope } from '../compiler_analyzer/analyzerScope';

function rangeContainsRange(outer: TextRange, inner: TextRange): boolean {
    if (inner.start.line < outer.start.line) return false;
    if (inner.end.line > outer.end.line) return false;
    if (inner.start.line === outer.start.line && inner.start.character < outer.start.character) return false;
    if (inner.end.line === outer.end.line && inner.end.character > outer.end.character) return false;
    return true;
}

export function provideInlayHint(
    globalScope: SymbolGlobalScope,
    analyzerScope: AnalyzerScope | undefined,
    ast: NodeScript,
    range: TextRange,
): lsp.InlayHint[] {
    const out: lsp.InlayHint[] = [];
    walkTopLevel(ast.children, range, globalScope, analyzerScope, out);
    return out;
}

function walkTopLevel(
    nodes: ReadonlyArray<NodeTopLevel>,
    range: TextRange,
    globalScope: SymbolGlobalScope,
    aScope: AnalyzerScope | undefined,
    out: lsp.InlayHint[],
): void {
    for (const n of nodes) {
        if (!rangeContainsRange(range, n.range) && !rangeContainsRange(n.range, range)) continue;
        switch (n.kind) {
            case NodeKind.Function: case NodeKind.Coroutine:
                if (n.body !== null) walkStmt(n.body, range, globalScope, aScope, out);
                break;
            case NodeKind.Class: case NodeKind.Struct: case NodeKind.Interface:
                walkMembers(n.members, range, globalScope, aScope, out);
                break;
            case NodeKind.Namespace:
                walkTopLevel(n.children, range, globalScope, aScope, out);
                break;
            case NodeKind.Var:
                emitAutoVarHint(n as NodeVar, aScope, out);
                if (n.initializer) walkExpr(n.initializer, range, globalScope, out);
                break;
        }
    }
}

function walkMembers(
    members: ReadonlyArray<NodeMember>,
    range: TextRange,
    globalScope: SymbolGlobalScope,
    aScope: AnalyzerScope | undefined,
    out: lsp.InlayHint[],
): void {
    for (const m of members) {
        if (m.kind === NodeKind.Method && m.body !== null) walkStmt(m.body, range, globalScope, aScope, out);
        if (m.kind === NodeKind.Constructor && m.body !== null) walkStmt(m.body, range, globalScope, aScope, out);
        if (m.kind === NodeKind.Destructor && m.body !== null) walkStmt(m.body, range, globalScope, aScope, out);
    }
}

function walkStmt(
    stmt: NodeStmt,
    range: TextRange,
    globalScope: SymbolGlobalScope,
    aScope: AnalyzerScope | undefined,
    out: lsp.InlayHint[],
): void {
    if (!rangeContainsRange(range, stmt.range) && !rangeContainsRange(stmt.range, range)) return;
    switch (stmt.kind) {
        case NodeKind.StmtBlock:
            for (const s of (stmt as NodeStmtBlock).stmts) walkStmt(s, range, globalScope, aScope, out);
            break;
        case NodeKind.StmtVar:
            emitAutoVarHint(stmt as NodeStmtVar, aScope, out);
            if ((stmt as NodeStmtVar).initializer) walkExpr((stmt as NodeStmtVar).initializer!, range, globalScope, out);
            break;
        case NodeKind.StmtExpr:
            walkExpr(stmt.expr, range, globalScope, out);
            break;
        case NodeKind.StmtIf:
            walkExpr(stmt.condition, range, globalScope, out);
            walkStmt(stmt.thenBranch, range, globalScope, aScope, out);
            if (stmt.elseBranch) walkStmt(stmt.elseBranch, range, globalScope, aScope, out);
            break;
        case NodeKind.StmtFor:
            if (stmt.init) walkStmt(stmt.init, range, globalScope, aScope, out);
            if (stmt.condition) walkExpr(stmt.condition, range, globalScope, out);
            if (stmt.update) walkExpr(stmt.update, range, globalScope, out);
            walkStmt(stmt.body, range, globalScope, aScope, out);
            break;
        case NodeKind.StmtWhile:
            walkExpr(stmt.condition, range, globalScope, out);
            walkStmt(stmt.body, range, globalScope, aScope, out);
            break;
        case NodeKind.StmtReturn:
            if (stmt.value) walkExpr(stmt.value, range, globalScope, out);
            break;
    }
}

function emitAutoVarHint(node: NodeVar | NodeStmtVar, aScope: AnalyzerScope | undefined, out: lsp.InlayHint[]): void {
    // Type's path[0] is "auto"
    const path = node.type.path;
    if (path.length !== 1) return;
    const head = path[0];
    if (head.text !== 'auto') return;

    // Look up inferred type via side-table (if analyzer ran).
    let inferred = '';
    if (aScope !== undefined) {
        const ann = aScope.getAnnotation(node);
        const t = ann?.autoInferredType ?? ann?.resolvedType;
        if (t !== undefined) inferred = t.identifierText;
    }
    if (inferred === '') return;

    out.push({
        position: { line: node.name.location.end.line, character: node.name.location.end.character },
        label: ': ' + inferred,
        kind: lsp.InlayHintKind.Type,
        paddingLeft: false,
    });
}

function walkExpr(expr: NodeExpr, range: TextRange, globalScope: SymbolGlobalScope, out: lsp.InlayHint[]): void {
    if (!rangeContainsRange(range, expr.range) && !rangeContainsRange(expr.range, range)) return;
    if (expr.kind === NodeKind.ExprCall) {
        emitParameterNameHints(expr as NodeExprCall, globalScope, out);
        for (const a of expr.args) walkExpr(a, range, globalScope, out);
        return;
    }
    if (expr.kind === NodeKind.ExprBinary) {
        walkExpr(expr.left, range, globalScope, out);
        walkExpr(expr.right, range, globalScope, out);
    }
    if (expr.kind === NodeKind.ExprAssign) {
        walkExpr(expr.target, range, globalScope, out);
        walkExpr(expr.value, range, globalScope, out);
    }
    if (expr.kind === NodeKind.ExprUnary) walkExpr(expr.operand, range, globalScope, out);
    if (expr.kind === NodeKind.ExprPostfix) walkExpr(expr.operand, range, globalScope, out);
    if (expr.kind === NodeKind.ExprMemberDot || expr.kind === NodeKind.ExprMemberArrow) walkExpr(expr.object, range, globalScope, out);
}

function emitParameterNameHints(call: NodeExprCall, globalScope: SymbolGlobalScope, out: lsp.InlayHint[]): void {
    // Determine callee name from the callee expression.
    let calleeName: string | undefined;
    let calleeScope: SymbolScope = globalScope;
    const cexpr = call.callee;
    if (cexpr.kind === NodeKind.ExprIdentifier) {
        calleeName = cexpr.token.text;
    } else if (cexpr.kind === NodeKind.ExprMemberDot || cexpr.kind === NodeKind.ExprMemberArrow) {
        calleeName = cexpr.member.text;
    } else if (cexpr.kind === NodeKind.ExprNamespaceAccess) {
        calleeName = cexpr.member.text;
    }
    if (calleeName === undefined) return;

    const holder = calleeScope.lookupSymbolWithParent(calleeName);
    if (!(holder instanceof SymbolFunctionHolder)) return;

    const fn = holder.first;
    if (fn.linkedNode === undefined || !('params' in fn.linkedNode)) return;
    const params = fn.linkedNode.params;

    for (let i = 0; i < call.args.length && i < params.length; i++) {
        const arg = call.args[i];
        const paramName = params[i].name?.text;
        if (paramName === undefined) continue;
        // Skip when arg is just an identifier matching the param name (forwarding).
        if (arg.kind === NodeKind.ExprIdentifier && arg.token.text === paramName) continue;
        out.push({
            position: { line: arg.range.start.line, character: arg.range.start.character },
            label: paramName + ': ',
            kind: lsp.InlayHintKind.Parameter,
            paddingRight: true,
        });
    }
}
