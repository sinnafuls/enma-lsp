// AST visitor utilities.

import {
    AnyNode,
    NodeFStringPart,
    NodeKind,
    NodeScript,
    NodeTopLevel,
} from './nodes';

type Visitor = (node: AnyNode, parent: AnyNode | null) => boolean | void;

/** Walk every node in `root` (pre-order). If the visitor returns false, descent into children of that node is skipped. */
export function forEachNode(root: AnyNode, visit: Visitor): void {
    walk(root, null, visit);
}

function walk(node: AnyNode, parent: AnyNode | null, visit: Visitor): void {
    const cont = visit(node, parent);
    if (cont === false) return;
    for (const child of children(node)) walk(child, node, visit);
}

/** Iterate direct children of a node. */
export function* children(node: AnyNode): Generator<AnyNode> {
    switch (node.kind) {
        case NodeKind.Script:
            for (const c of node.children) yield c;
            return;
        case NodeKind.Namespace:
            for (const c of node.children) yield c;
            return;
        case NodeKind.Import:
        case NodeKind.Using:
        case NodeKind.LambdaCapture:
        case NodeKind.StmtBreak:
        case NodeKind.StmtContinue:
        case NodeKind.StmtEmpty:
        case NodeKind.ExprThis:
        case NodeKind.ExprIdentifier:
        case NodeKind.ExprLiteralInt:
        case NodeKind.ExprLiteralFloat:
        case NodeKind.ExprLiteralString:
        case NodeKind.ExprLiteralChar:
        case NodeKind.ExprLiteralBool:
        case NodeKind.ExprLiteralNull:
        case NodeKind.ExprFuncRef:
        case NodeKind.StmtGoto:
        case NodeKind.StmtLabel:
        case NodeKind.Type:
            // No interesting children (Type's generics are visited explicitly when wanted).
            for (const g of node.kind === NodeKind.Type ? node.generics : []) yield g;
            return;
        case NodeKind.Annotation:
            for (const a of node.args) yield a;
            return;
        case NodeKind.Param:
            if (node.type) yield node.type;
            if (node.defaultValue) yield node.defaultValue;
            return;
        case NodeKind.TemplateParam:
            if (node.defaultType) yield node.defaultType;
            return;
        case NodeKind.Typedef:
            yield node.underlying;
            return;
        case NodeKind.Template:
            for (const p of node.params) yield p;
            yield node.body;
            return;
        case NodeKind.Mixin:
            for (const b of node.bases) yield b;
            for (const m of node.members) yield m;
            return;
        case NodeKind.Delegate:
            yield node.returnType;
            for (const p of node.params) yield p;
            return;
        case NodeKind.Property:
            yield node.type;
            if (node.getter) yield node.getter;
            if (node.setter) yield node.setter;
            return;
        case NodeKind.OperatorOverload:
            yield node.returnType;
            for (const p of node.params) yield p;
            yield node.body;
            return;
        case NodeKind.Class:
        case NodeKind.Struct:
        case NodeKind.Interface:
            for (const a of node.annotations) yield a;
            for (const b of node.bases) yield b;
            for (const m of node.members) yield m;
            return;
        case NodeKind.Enum:
            for (const a of node.annotations) yield a;
            if (node.underlying) yield node.underlying;
            for (const v of node.values) yield v;
            return;
        case NodeKind.EnumValue:
            if (node.value) yield node.value;
            return;
        case NodeKind.Field:
            for (const a of node.annotations) yield a;
            yield node.type;
            if (node.initializer) yield node.initializer;
            return;
        case NodeKind.Method:
            for (const a of node.annotations) yield a;
            for (const tp of node.templateParams) yield tp;
            yield node.returnType;
            for (const p of node.params) yield p;
            if (node.body) yield node.body;
            return;
        case NodeKind.Constructor:
            for (const a of node.annotations) yield a;
            for (const p of node.params) yield p;
            if (node.body) yield node.body;
            return;
        case NodeKind.Destructor:
            for (const a of node.annotations) yield a;
            if (node.body) yield node.body;
            return;
        case NodeKind.Function:
            for (const a of node.annotations) yield a;
            for (const tp of node.templateParams) yield tp;
            yield node.returnType;
            for (const p of node.params) yield p;
            if (node.body) yield node.body;
            return;
        case NodeKind.Coroutine:
            for (const a of node.annotations) yield a;
            yield node.returnType;
            for (const p of node.params) yield p;
            yield node.body;
            return;
        case NodeKind.Var:
            for (const a of node.annotations) yield a;
            yield node.type;
            if (node.initializer) yield node.initializer;
            return;
        case NodeKind.StmtBlock:
            for (const s of node.stmts) yield s;
            return;
        case NodeKind.StmtIf:
            yield node.condition;
            yield node.thenBranch;
            if (node.elseBranch) yield node.elseBranch;
            return;
        case NodeKind.StmtFor:
            if (node.init) yield node.init;
            if (node.condition) yield node.condition;
            if (node.update) yield node.update;
            yield node.body;
            return;
        case NodeKind.StmtForeach:
            yield node.elemType;
            yield node.iterable;
            yield node.body;
            return;
        case NodeKind.StmtWhile:
            yield node.condition;
            yield node.body;
            return;
        case NodeKind.StmtDoWhile:
            yield node.body;
            yield node.condition;
            return;
        case NodeKind.StmtSwitch:
            yield node.subject;
            for (const c of node.cases) {
                if (c.value) yield c.value;
                for (const s of c.stmts) yield s;
            }
            return;
        case NodeKind.StmtReturn:
            if (node.value) yield node.value;
            return;
        case NodeKind.StmtTry:
            yield node.tryBlock;
            for (const c of node.catches) {
                yield c.excType;
                yield c.body;
            }
            if (node.finallyBlock) yield node.finallyBlock;
            return;
        case NodeKind.StmtThrow:
        case NodeKind.StmtYield:
            if (node.value) yield node.value;
            return;
        case NodeKind.StmtDefer:
            yield node.body;
            return;
        case NodeKind.StmtVar:
            yield node.type;
            if (node.initializer) yield node.initializer;
            return;
        case NodeKind.StmtExpr:
            yield node.expr;
            return;
        case NodeKind.ExprBinary:
            yield node.left;
            yield node.right;
            return;
        case NodeKind.ExprUnary:
        case NodeKind.ExprPostfix:
            yield node.operand;
            return;
        case NodeKind.ExprTernary:
            yield node.condition;
            yield node.thenExpr;
            yield node.elseExpr;
            return;
        case NodeKind.ExprAssign:
            yield node.target;
            yield node.value;
            return;
        case NodeKind.ExprCall:
            yield node.callee;
            for (const t of node.templateArgs) yield t;
            for (const a of node.args) yield a;
            return;
        case NodeKind.ExprMemberDot:
        case NodeKind.ExprMemberArrow:
            yield node.object;
            return;
        case NodeKind.ExprNamespaceAccess:
            yield node.scope;
            return;
        case NodeKind.ExprIndex:
            yield node.object;
            yield node.index;
            return;
        case NodeKind.ExprCast:
            yield node.targetType;
            yield node.value;
            return;
        case NodeKind.ExprNew:
            yield node.type;
            for (const a of node.args) yield a;
            if (node.arraySize) yield node.arraySize;
            return;
        case NodeKind.ExprDelete:
            yield node.target;
            return;
        case NodeKind.ExprSizeof:
            yield node.target as AnyNode;
            return;
        case NodeKind.ExprOffsetof:
            yield node.type;
            return;
        case NodeKind.ExprStaticAssert:
            yield node.condition;
            if (node.message) yield node.message;
            return;
        case NodeKind.ExprIntrinsic:
            for (const a of node.args) yield a;
            return;
        case NodeKind.ExprParen:
            yield node.inner;
            return;
        case NodeKind.ExprLambdaBracket:
            for (const c of node.captures) yield c;
            for (const p of node.params) yield p;
            if (node.returnType) yield node.returnType;
            yield node.body;
            return;
        case NodeKind.ExprLambdaArrow:
            for (const p of node.params) yield p;
            yield node.body as AnyNode;
            return;
        case NodeKind.ExprDesignatedInit:
            if (node.typeName) yield node.typeName;
            for (const f of node.fields) yield f;
            return;
        case NodeKind.DesignatedInitField:
            yield node.value;
            return;
        case NodeKind.ExprArrayInit:
            for (const e of node.elements) yield e;
            return;
        case NodeKind.ExprMatch:
            yield node.subject;
            for (const arm of node.arms) yield arm;
            return;
        case NodeKind.MatchArm:
            yield node.pattern;
            yield node.body;
            return;
        case NodeKind.ExprLiteralUserDefined:
            // tokens only
            return;
        case NodeKind.ExprFString:
            for (const part of node.parts) {
                if ((part as NodeFStringPart).kind === 'expr') {
                    yield (part as Extract<NodeFStringPart, { kind: 'expr' }>).expr;
                }
            }
            return;
        default: {
            const _exhaustive: never = node as never;
            return _exhaustive;
        }
    }
}

/** Filter top-level decls of a script. */
export function topLevelDecls(script: NodeScript): ReadonlyArray<NodeTopLevel> {
    return script.children;
}
