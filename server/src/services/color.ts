// Document color provider: finds color(r,g,b,a) calls where all 4 args are
// numeric literals in [0,1] and returns inline color swatches via LSP
// documentColor. Also handles provideColorPresentation for editing.

import * as lsp from 'vscode-languageserver';

import {
    NodeScript, NodeKind,
    NodeTopLevel, NodeMember, NodeStmt, NodeExpr,
    NodeExprCall,
} from '../compiler_parser/nodes';
import { TextRange } from '../compiler_tokenizer/textLocation';

// ---- helpers ---------------------------------------------------------------

function rangeToLsp(r: TextRange): lsp.Range {
    return {
        start: { line: r.start.line, character: r.start.character },
        end:   { line: r.end.line,   character: r.end.character },
    };
}

/**
 * Parse a numeric-literal token's text as a float.
 * Strips trailing type suffixes (f, F, u, U, l, L) used in numeric literals.
 */
function tokenToFloat(text: string): number {
    return parseFloat(text.replace(/[fFuUlL]+$/, ''));
}

function isNumericLiteral(expr: NodeExpr): expr is NodeExpr & { token: { text: string } } {
    return expr.kind === NodeKind.ExprLiteralFloat || expr.kind === NodeKind.ExprLiteralInt;
}

// ---- color call detection --------------------------------------------------

function checkColorCall(call: NodeExprCall, out: lsp.ColorInformation[]): void {
    const callee = call.callee;
    if (callee.kind !== NodeKind.ExprIdentifier) return;
    if (callee.token.text !== 'color') return;
    if (call.args.length !== 4) return;

    const vals: number[] = [];
    for (const arg of call.args) {
        if (!isNumericLiteral(arg)) return;
        const v = tokenToFloat(arg.token.text);
        if (!isFinite(v) || v < 0 || v > 1) return;
        vals.push(v);
    }

    out.push({
        range: rangeToLsp(call.range),
        color: { red: vals[0], green: vals[1], blue: vals[2], alpha: vals[3] },
    });
}

// ---- AST walk --------------------------------------------------------------

function walkExpr(expr: NodeExpr, out: lsp.ColorInformation[]): void {
    switch (expr.kind) {
        case NodeKind.ExprCall:
            checkColorCall(expr, out);
            walkExpr(expr.callee, out);
            for (const a of expr.args) walkExpr(a, out);
            break;
        case NodeKind.ExprBinary:
            walkExpr(expr.left, out);
            walkExpr(expr.right, out);
            break;
        case NodeKind.ExprUnary:
        case NodeKind.ExprPostfix:
            walkExpr(expr.operand, out);
            break;
        case NodeKind.ExprTernary:
            walkExpr(expr.condition, out);
            walkExpr(expr.thenExpr, out);
            walkExpr(expr.elseExpr, out);
            break;
        case NodeKind.ExprAssign:
            walkExpr(expr.target, out);
            walkExpr(expr.value, out);
            break;
        case NodeKind.ExprMemberDot:
        case NodeKind.ExprMemberArrow:
            walkExpr(expr.object, out);
            break;
        case NodeKind.ExprIndex:
            walkExpr(expr.object, out);
            walkExpr(expr.index, out);
            break;
        case NodeKind.ExprParen:
            walkExpr(expr.inner, out);
            break;
        case NodeKind.ExprCast:
            walkExpr(expr.value, out);
            break;
        case NodeKind.ExprNew:
            for (const a of expr.args) walkExpr(a, out);
            if (expr.arraySize !== null) walkExpr(expr.arraySize, out);
            break;
        case NodeKind.ExprNamespaceAccess:
            walkExpr(expr.scope, out);
            break;
        case NodeKind.ExprLambdaBracket:
            walkStmt(expr.body, out);
            break;
        case NodeKind.ExprLambdaArrow:
            if (expr.body.kind === NodeKind.StmtBlock) walkStmt(expr.body, out);
            else walkExpr(expr.body, out);
            break;
        case NodeKind.ExprDesignatedInit:
            for (const field of expr.fields) walkExpr(field.value, out);
            break;
        case NodeKind.ExprArrayInit:
            for (const el of expr.elements) walkExpr(el, out);
            break;
        case NodeKind.ExprMatch:
            walkExpr(expr.subject, out);
            for (const arm of expr.arms) {
                walkExpr(arm.pattern, out);
                walkExpr(arm.body, out);
            }
            break;
    }
}

function walkStmt(stmt: NodeStmt, out: lsp.ColorInformation[]): void {
    switch (stmt.kind) {
        case NodeKind.StmtBlock:
            for (const s of stmt.stmts) walkStmt(s, out);
            break;
        case NodeKind.StmtExpr:
            walkExpr(stmt.expr, out);
            break;
        case NodeKind.StmtVar:
            if (stmt.initializer !== null) walkExpr(stmt.initializer, out);
            break;
        case NodeKind.StmtIf:
            walkExpr(stmt.condition, out);
            walkStmt(stmt.thenBranch, out);
            if (stmt.elseBranch !== null) walkStmt(stmt.elseBranch, out);
            break;
        case NodeKind.StmtFor:
            if (stmt.init !== null) walkStmt(stmt.init, out);
            if (stmt.condition !== null) walkExpr(stmt.condition, out);
            if (stmt.update !== null) walkExpr(stmt.update, out);
            walkStmt(stmt.body, out);
            break;
        case NodeKind.StmtForeach:
            walkExpr(stmt.iterable, out);
            walkStmt(stmt.body, out);
            break;
        case NodeKind.StmtWhile:
            walkExpr(stmt.condition, out);
            walkStmt(stmt.body, out);
            break;
        case NodeKind.StmtDoWhile:
            walkExpr(stmt.condition, out);
            walkStmt(stmt.body, out);
            break;
        case NodeKind.StmtSwitch:
            walkExpr(stmt.subject, out);
            for (const c of stmt.cases) {
                if (c.value !== null) walkExpr(c.value, out);
                for (const s of c.stmts) walkStmt(s, out);
            }
            break;
        case NodeKind.StmtReturn:
            if (stmt.value !== null) walkExpr(stmt.value, out);
            break;
        case NodeKind.StmtThrow:
            if (stmt.value !== null) walkExpr(stmt.value, out);
            break;
        case NodeKind.StmtYield:
            if (stmt.value !== null) walkExpr(stmt.value, out);
            break;
        case NodeKind.StmtDefer:
            walkStmt(stmt.body, out);
            break;
        case NodeKind.StmtTry:
            walkStmt(stmt.tryBlock, out);
            for (const c of stmt.catches) walkStmt(c.body, out);
            if (stmt.finallyBlock !== null) walkStmt(stmt.finallyBlock, out);
            break;
    }
}

function walkMembers(members: ReadonlyArray<NodeMember>, out: lsp.ColorInformation[]): void {
    for (const m of members) {
        switch (m.kind) {
            case NodeKind.Method:
            case NodeKind.Constructor:
            case NodeKind.Destructor:
                if (m.body !== null) walkStmt(m.body, out);
                break;
            case NodeKind.Class:
            case NodeKind.Struct:
            case NodeKind.Interface:
                walkMembers(m.members, out);
                break;
        }
    }
}

function walkTopLevel(nodes: ReadonlyArray<NodeTopLevel>, out: lsp.ColorInformation[]): void {
    for (const n of nodes) {
        switch (n.kind) {
            case NodeKind.Function:
            case NodeKind.Coroutine:
                if (n.body !== null) walkStmt(n.body, out);
                break;
            case NodeKind.Class:
            case NodeKind.Struct:
            case NodeKind.Interface:
                walkMembers(n.members, out);
                break;
            case NodeKind.Namespace:
                walkTopLevel(n.children, out);
                break;
            case NodeKind.Var:
                if (n.initializer !== null) walkExpr(n.initializer, out);
                break;
            case NodeKind.StmtExpr:
                // top-level stray expression statement (permissive recovery)
                walkExpr(n.expr, out);
                break;
        }
    }
}

// ---- public API ------------------------------------------------------------

export function provideDocumentColors(
    ast: NodeScript,
    _content: string,
): lsp.ColorInformation[] {
    const out: lsp.ColorInformation[] = [];
    walkTopLevel(ast.children, out);
    return out;
}

export function provideColorPresentation(
    color: lsp.Color,
    range: lsp.Range,
): lsp.ColorPresentation[] {
    const { red: r, green: g, blue: b, alpha: a } = color;
    const label = `color(${r.toFixed(3)}, ${g.toFixed(3)}, ${b.toFixed(3)}, ${a.toFixed(3)})`;
    return [{ label, textEdit: lsp.TextEdit.replace(range, label) }];
}
