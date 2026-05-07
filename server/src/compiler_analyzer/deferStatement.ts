// Defer statement analysis — flag use of locals declared *after* the defer
// (those locals are out of scope at defer-execution time).
//
// We don't run a full data-flow pass; we walk the defer body and look for
// identifier references whose declaration appears at a later source position
// than the defer statement itself within the enclosing scope.

import {
    AnyNode,
    NodeExpr,
    NodeKind,
    NodeStmt,
    NodeStmtBlock,
    NodeStmtDefer,
    NodeStmtVar,
} from '../compiler_parser/nodes';
import { analyzerDiagnostic } from './analyzerDiagnostic';
import { TextLocation } from '../compiler_tokenizer/textLocation';

/**
 * Walk `enclosingBlock` to find every NodeStmtVar declared after `defer` and
 * warn whenever the defer body references one of those names.
 */
export function analyzeDefer(
    defer: NodeStmtDefer,
    enclosingBlock: NodeStmtBlock,
): void {
    // 1) Find the defer's index in the enclosing block.
    const stmts = enclosingBlock.stmts;
    let deferIdx = -1;
    for (let i = 0; i < stmts.length; i++) {
        if (stmts[i] === (defer as unknown as NodeStmt)) {
            deferIdx = i;
            break;
        }
    }
    if (deferIdx === -1) return;

    // 2) Collect names declared AFTER the defer in this block.
    const laterNames = new Map<string, TextLocation>();
    for (let i = deferIdx + 1; i < stmts.length; i++) {
        collectVarDecls(stmts[i], laterNames);
    }
    if (laterNames.size === 0) return;

    // 3) Walk the defer body and warn for each reference to those names.
    walkExprsAndStmts(defer.body, expr => {
        if (expr.kind === NodeKind.ExprIdentifier) {
            const name = expr.token.text;
            if (laterNames.has(name)) {
                analyzerDiagnostic.warning(
                    expr.token.location,
                    `defer references '${name}', declared after the defer; it will be out of scope at defer-execution time`,
                    'EN_DEFER_LATER_LOCAL',
                );
            }
        }
    });
}

function collectVarDecls(stmt: NodeStmt, out: Map<string, TextLocation>): void {
    switch (stmt.kind) {
        case NodeKind.StmtVar: {
            const sv = stmt as NodeStmtVar;
            out.set(sv.name.text, sv.name.location);
            return;
        }
        case NodeKind.StmtBlock:
            for (const s of (stmt as NodeStmtBlock).stmts) collectVarDecls(s, out);
            return;
        default:
            return;
    }
}

function walkExprsAndStmts(node: AnyNode, visit: (e: NodeExpr) => void): void {
    if (!node || typeof node !== 'object') return;
    // If this node looks like an expression, visit it.
    const k = (node as { kind?: NodeKind }).kind;
    if (k && isExpressionKind(k)) visit(node as NodeExpr);

    // Recurse into all object/array children.
    for (const value of Object.values(node)) {
        if (Array.isArray(value)) {
            for (const v of value) {
                if (v && typeof v === 'object') walkExprsAndStmts(v as AnyNode, visit);
            }
        } else if (value && typeof value === 'object' && 'kind' in (value as object)) {
            walkExprsAndStmts(value as AnyNode, visit);
        }
    }
}

function isExpressionKind(k: NodeKind): boolean {
    switch (k) {
        case NodeKind.ExprBinary:
        case NodeKind.ExprUnary:
        case NodeKind.ExprPostfix:
        case NodeKind.ExprTernary:
        case NodeKind.ExprAssign:
        case NodeKind.ExprCall:
        case NodeKind.ExprMemberDot:
        case NodeKind.ExprMemberArrow:
        case NodeKind.ExprNamespaceAccess:
        case NodeKind.ExprIndex:
        case NodeKind.ExprCast:
        case NodeKind.ExprNew:
        case NodeKind.ExprDelete:
        case NodeKind.ExprSizeof:
        case NodeKind.ExprOffsetof:
        case NodeKind.ExprStaticAssert:
        case NodeKind.ExprFuncRef:
        case NodeKind.ExprIntrinsic:
        case NodeKind.ExprIdentifier:
        case NodeKind.ExprThis:
        case NodeKind.ExprParen:
        case NodeKind.ExprLambdaBracket:
        case NodeKind.ExprLambdaArrow:
        case NodeKind.ExprDesignatedInit:
        case NodeKind.ExprArrayInit:
        case NodeKind.ExprMatch:
        case NodeKind.ExprLiteralInt:
        case NodeKind.ExprLiteralFloat:
        case NodeKind.ExprLiteralString:
        case NodeKind.ExprLiteralChar:
        case NodeKind.ExprLiteralBool:
        case NodeKind.ExprLiteralNull:
        case NodeKind.ExprLiteralUserDefined:
        case NodeKind.ExprFString:
            return true;
        default:
            return false;
    }
}
