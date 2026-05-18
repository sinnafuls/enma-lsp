// Const + stack-escape post-pass.
//
// Walks every NodeFunction / NodeMethod / NodeConstructor / NodeDestructor /
// NodeCoroutine body and emits Warnings when:
//
//   EN_CONST_WRITE   — an assignment writes to a local declared `const T x;`
//                      (the engine rejects this; surface it at edit time).
//   EN_STACK_ESCAPE  — `&local` or `@local` flows out of the function body:
//                          return &x;           (return-site escape)
//                          g = &x;              (assignment to a non-local)
//                          obj.field = &x;      (assignment through member)
//                      Address-of-local stored back into another local of the
//                      same function does NOT warn.
//
// Both codes use analyzerDiagnostic.warning() so the §R21 rollback flag does
// not silently demote them; warnings are already the floor severity. Codes are
// stable so the editor's quick-fix layer can react without prose matching.

import {
    NodeExpr,
    NodeExprAssign,
    NodeExprIdentifier,
    NodeExprUnary,
    NodeFunction,
    NodeMethod,
    NodeConstructor,
    NodeDestructor,
    NodeCoroutine,
    NodeKind,
    NodeStmt,
    NodeStmtBlock,
    NodeStmtReturn,
    NodeStmtVar,
    NodeScript,
    NodeTopLevel,
    NodeNamespace,
    NodeClass,
    NodeStruct,
    NodeInterface,
} from '../compiler_parser/nodes';
import { analyzerDiagnostic } from './analyzerDiagnostic';
import { TextLocation, TextRange } from '../compiler_tokenizer/textLocation';

export const CODE_CONST_WRITE  = 'EN_CONST_WRITE';
export const CODE_STACK_ESCAPE = 'EN_STACK_ESCAPE';

type FunctionLike =
    | NodeFunction
    | NodeMethod
    | NodeConstructor
    | NodeDestructor
    | NodeCoroutine;

interface FunctionContext {
    /** File URI; combined with each node's TextRange to produce a TextLocation. */
    uri: string;
    /** Local names visible in the current function (params + StmtVars). */
    locals: Set<string>;
    /** Subset of `locals` declared with the `const` modifier. */
    constLocals: Set<string>;
}

/** Public entry — run the pass on a full parsed script. */
export function runEscapeAndConstCheck(uri: string, ast: NodeScript): void {
    for (const child of ast.children) {
        walkTopLevel(uri, child);
    }
}

function walkTopLevel(uri: string, node: NodeTopLevel): void {
    switch (node.kind) {
        case NodeKind.Function:
        case NodeKind.Coroutine:
            checkFunctionLike(uri, node);
            break;
        case NodeKind.Class:
        case NodeKind.Struct:
        case NodeKind.Interface:
            walkContainer(uri, node);
            break;
        case NodeKind.Namespace:
            walkNamespace(uri, node);
            break;
        default:
            break;
    }
}

function walkContainer(uri: string, node: NodeClass | NodeStruct | NodeInterface): void {
    for (const m of node.members) {
        if (m.kind === NodeKind.Method) checkFunctionLike(uri, m);
        else if (m.kind === NodeKind.Constructor) checkFunctionLike(uri, m);
        else if (m.kind === NodeKind.Destructor) checkFunctionLike(uri, m);
    }
}

function walkNamespace(uri: string, node: NodeNamespace): void {
    for (const child of node.children) {
        walkTopLevel(uri, child);
    }
}

function checkFunctionLike(uri: string, fn: FunctionLike): void {
    if (fn.body === null) return;
    const ctx: FunctionContext = {
        uri,
        locals: new Set(),
        constLocals: new Set(),
    };
    // Parameters live in the function's local set (write to a param isn't
    // currently flagged as const-violating — parameter constness has its own
    // path, but we still want the param names in `locals` so addr-of-param
    // assignments don't trip the escape rule unfairly).
    if ('params' in fn) {
        for (const p of fn.params) {
            if (p.name) ctx.locals.add(p.name.text);
        }
    }
    walkBlock(ctx, fn.body);
}

function walkBlock(ctx: FunctionContext, block: NodeStmtBlock): void {
    for (const stmt of block.stmts) walkStmt(ctx, stmt);
}

function walkStmt(ctx: FunctionContext, stmt: NodeStmt): void {
    switch (stmt.kind) {
        case NodeKind.StmtBlock:
            walkBlock(ctx, stmt);
            return;
        case NodeKind.StmtVar:
            recordVarDecl(ctx, stmt);
            if (stmt.initializer) walkExpr(ctx, stmt.initializer);
            return;
        case NodeKind.StmtExpr:
            walkExpr(ctx, stmt.expr);
            return;
        case NodeKind.StmtReturn:
            checkReturn(ctx, stmt);
            return;
        case NodeKind.StmtIf:
            walkExpr(ctx, stmt.condition);
            walkStmt(ctx, stmt.thenBranch);
            if (stmt.elseBranch) walkStmt(ctx, stmt.elseBranch);
            return;
        case NodeKind.StmtFor:
            if (stmt.init && stmt.init.kind !== NodeKind.StmtEmpty) walkStmt(ctx, stmt.init);
            if (stmt.condition) walkExpr(ctx, stmt.condition);
            if (stmt.update) walkExpr(ctx, stmt.update);
            walkStmt(ctx, stmt.body);
            return;
        case NodeKind.StmtForeach:
            walkExpr(ctx, stmt.iterable);
            walkStmt(ctx, stmt.body);
            return;
        case NodeKind.StmtWhile:
            walkExpr(ctx, stmt.condition);
            walkStmt(ctx, stmt.body);
            return;
        case NodeKind.StmtDoWhile:
            walkStmt(ctx, stmt.body);
            walkExpr(ctx, stmt.condition);
            return;
        case NodeKind.StmtSwitch:
            walkExpr(ctx, stmt.subject);
            for (const arm of stmt.cases) {
                for (const s of arm.stmts) walkStmt(ctx, s);
            }
            return;
        case NodeKind.StmtTry:
            walkBlock(ctx, stmt.tryBlock);
            for (const handler of stmt.catches) walkBlock(ctx, handler.body);
            if (stmt.finallyBlock) walkBlock(ctx, stmt.finallyBlock);
            return;
        case NodeKind.StmtDefer:
            walkBlock(ctx, stmt.body);
            return;
        case NodeKind.StmtThrow:
            if (stmt.value) walkExpr(ctx, stmt.value);
            return;
        case NodeKind.StmtYield:
            if (stmt.value) walkExpr(ctx, stmt.value);
            return;
        default:
            // StmtBreak / StmtContinue / StmtGoto / StmtLabel / StmtEmpty: nothing.
            return;
    }
}

function recordVarDecl(ctx: FunctionContext, decl: NodeStmtVar): void {
    const name = decl.name.text;
    ctx.locals.add(name);
    if (decl.modifiers.some(m => m.text === 'const')) {
        ctx.constLocals.add(name);
    }
}

function walkExpr(ctx: FunctionContext, expr: NodeExpr): void {
    switch (expr.kind) {
        case NodeKind.ExprAssign:
            checkAssign(ctx, expr);
            walkExpr(ctx, expr.target);
            walkExpr(ctx, expr.value);
            return;
        case NodeKind.ExprBinary:
            walkExpr(ctx, expr.left);
            walkExpr(ctx, expr.right);
            return;
        case NodeKind.ExprUnary:
            walkExpr(ctx, expr.operand);
            return;
        case NodeKind.ExprPostfix:
            walkExpr(ctx, expr.operand);
            return;
        case NodeKind.ExprTernary:
            walkExpr(ctx, expr.condition);
            walkExpr(ctx, expr.thenExpr);
            walkExpr(ctx, expr.elseExpr);
            return;
        case NodeKind.ExprCall:
            walkExpr(ctx, expr.callee);
            for (const a of expr.args) walkExpr(ctx, a);
            return;
        case NodeKind.ExprMemberDot:
        case NodeKind.ExprMemberArrow:
            walkExpr(ctx, expr.object);
            return;
        case NodeKind.ExprIndex:
            walkExpr(ctx, expr.object);
            walkExpr(ctx, expr.index);
            return;
        case NodeKind.ExprCast:
            walkExpr(ctx, expr.value);
            return;
        case NodeKind.ExprParen:
            walkExpr(ctx, expr.inner);
            return;
        case NodeKind.ExprNew:
            for (const a of expr.args) walkExpr(ctx, a);
            return;
        case NodeKind.ExprDelete:
            walkExpr(ctx, expr.target);
            return;
        default:
            return;
    }
}

function checkAssign(ctx: FunctionContext, expr: NodeExprAssign): void {
    const targetLocal = identifierName(expr.target);

    // Const write: target is a local known to be const.
    if (targetLocal && ctx.constLocals.has(targetLocal)) {
        analyzerDiagnostic.warning(
            rangeToLocation(ctx.uri, expr.target.range),
            `Cannot assign to const variable '${targetLocal}'`,
            CODE_CONST_WRITE,
        );
    }

    // Stack escape: RHS is `&local` and target is NOT a local in this scope
    // (it's a global, a field, or an outer-scope binding the analyzer can't
    // see — all of which represent the address-of leaving the stack frame).
    const escapingName = addressOfLocalName(expr.value, ctx);
    if (escapingName !== undefined && (targetLocal === undefined || !ctx.locals.has(targetLocal))) {
        analyzerDiagnostic.warning(
            rangeToLocation(ctx.uri, expr.value.range),
            `Address of stack local '${escapingName}' escapes the current frame`,
            CODE_STACK_ESCAPE,
        );
    }
}

function checkReturn(ctx: FunctionContext, stmt: NodeStmtReturn): void {
    if (stmt.value === null) return;
    const escapingName = addressOfLocalName(stmt.value, ctx);
    if (escapingName !== undefined) {
        analyzerDiagnostic.warning(
            rangeToLocation(ctx.uri, stmt.value.range),
            `Returning the address of stack local '${escapingName}'`,
            CODE_STACK_ESCAPE,
        );
    }
    walkExpr(ctx, stmt.value);
}

/** If `expr` is `&ident` or `@ident` where `ident` names a function-scope
 *  local, return the identifier text; else undefined. */
function addressOfLocalName(expr: NodeExpr, ctx: FunctionContext): string | undefined {
    const target = unwrapAddressOf(expr);
    if (target === undefined) return undefined;
    if (!ctx.locals.has(target)) return undefined;
    return target;
}

function unwrapAddressOf(expr: NodeExpr): string | undefined {
    if (expr.kind !== NodeKind.ExprUnary) return undefined;
    const op = (expr as NodeExprUnary).op.text;
    if (op !== '&' && op !== '@') return undefined;
    const operand = (expr as NodeExprUnary).operand;
    return identifierName(operand);
}

function identifierName(expr: NodeExpr): string | undefined {
    if (expr.kind === NodeKind.ExprIdentifier) {
        return (expr as NodeExprIdentifier).token.text;
    }
    if (expr.kind === NodeKind.ExprParen) {
        return identifierName(expr.inner);
    }
    return undefined;
}

function rangeToLocation(uri: string, range: TextRange): TextLocation {
    return { uri, start: range.start, end: range.end };
}
