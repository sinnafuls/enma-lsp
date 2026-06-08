// Expression analyzer — second-pass type deduction.
//
// Walks an expression tree, deduces a best-effort ResolvedType, and emits the
// doc-grounded diagnostics that depend on expression types (illegal implicit
// conversions on assignment; unresolved/ambiguous overloads at call sites).
//
// Design rule: when the analyzer cannot be *certain* of a type it returns
// undefined, and an undefined type suppresses every downstream conversion
// check. Diagnostics therefore only fire on fully-resolved, concrete shapes —
// no false positives on templates, lambdas, containers, or unresolved symbols.

import { NodeKind } from '../compiler_parser/nodes';
import type {
    NodeExpr,
    NodeExprCall,
    NodeExprNamespaceAccess,
} from '../compiler_parser/nodes';
import type { TextLocation } from '../compiler_tokenizer/textLocation';
import { ResolvedType, applyTemplateTranslator } from './resolvedType';
import {
    resolvedBuiltinBool,
    resolvedBuiltinChar,
    resolvedBuiltinInt64,
    resolvedBuiltinDouble,
    resolvedBuiltinString,
} from './builtinType';
import { getActiveGlobalScope } from './symbolScope';
import type { SymbolScope, SymbolGlobalScope } from './symbolScope';
import {
    SymbolType,
    SymbolVariable,
    SymbolFunctionHolder,
} from './symbolObject';
import type { SymbolObjectHolder } from './symbolObject';
import type { ReferenceInfo } from './info';
import { findSymbolWithParent } from './symbolUtils';
import { analyzeType } from './analyzer';
import { analyzerDiagnostic } from './analyzerDiagnostic';
import { implicitConversionError } from './typeConversion';
import { resolveBinaryOp, resolveUnaryOp, resolvePostfixOp } from './operatorCall';
import { resolveCall } from './functionCall';
import type { FunctionCallResolution } from './functionCall';
import { analyzeConstructorCall, findConstructorHolder } from './constructorCall';
import { inferIterableElement } from './foreachStatement';
import { analyzeCast } from './typeCast';

function rangeToLocation(range: { start: TextLocation['start']; end: TextLocation['end'] }): TextLocation {
    return { uri: getActiveGlobalScope().filepath, start: range.start, end: range.end };
}

/** A bare integer/float literal (paren-wrapping aside) is exempt from the
 *  strict numeric-conversion checks — arithmetic/negation is not (§2). */
export function isExemptLiteral(e: NodeExpr): boolean {
    let cur = e;
    while (cur.kind === NodeKind.ExprParen) cur = cur.inner;
    return cur.kind === NodeKind.ExprLiteralInt || cur.kind === NodeKind.ExprLiteralFloat;
}

function flattenBases(t: SymbolType): SymbolType[] {
    const out: SymbolType[] = [];
    const seen = new Set<SymbolType>();
    const walk = (cur: SymbolType): void => {
        if (seen.has(cur)) return;
        seen.add(cur);
        out.push(cur);
        for (const b of cur.baseList) {
            if (b && b.typeOrFunc.isType()) walk(b.typeOrFunc as SymbolType);
        }
    };
    walk(t);
    return out;
}

/** Resolve a member (field / method set / nested type) on a value/pointer type,
 *  walking the MRO so inherited members resolve. */
function lookupMemberHolder(
    global: SymbolGlobalScope,
    objType: ResolvedType | undefined,
    name: string,
): SymbolObjectHolder | undefined {
    if (!objType || !objType.typeOrFunc.isType()) return undefined;
    const baseType = objType.typeOrFunc as SymbolType;
    const chain = baseType.mroCache ? [...baseType.mroCache] : flattenBases(baseType);
    for (const t of chain) {
        if (!t.membersScopePath) continue;
        const ms = global.resolveScope(t.membersScopePath);
        const h = ms?.lookupSymbol(name);
        if (h) return h;
    }
    return undefined;
}

function reportCall(r: FunctionCallResolution, name: string, location: TextLocation): void {
    if (r.status === 'no-match') {
        analyzerDiagnostic.error(location, `No overload of '${name}' matches the given arguments.`, 'EN_NO_OVERLOAD');
    } else if (r.status === 'ambiguous') {
        analyzerDiagnostic.error(location, `Call to '${name}' is ambiguous across overloads.`, 'EN_AMBIGUOUS_CALL');
    }
}

/** Resolve the holder named by a namespace/enum access (`A::B`). Best-effort:
 *  one or more `::` hops through type-member / namespace scopes. */
function resolveNamespaceMember(
    scope: SymbolScope,
    node: NodeExprNamespaceAccess,
): SymbolObjectHolder | undefined {
    const global = getActiveGlobalScope();
    const container = resolveAccessScope(scope, node.scope);
    if (!container) return undefined;
    return container.lookupSymbol(node.member.text)
        ?? global.resolveScope([...container.scopePath, node.member.text])?.lookupSymbol(node.member.text);
}

/** Resolve the scope an `A` (or `A::B`) refers to for a subsequent `::` hop. */
function resolveAccessScope(scope: SymbolScope, node: NodeExpr): SymbolScope | undefined {
    const global = getActiveGlobalScope();
    if (node.kind === NodeKind.ExprIdentifier) {
        const found = findSymbolWithParent(scope, node.token.text);
        if (found?.symbol instanceof SymbolType && found.symbol.membersScopePath) {
            return global.resolveScope(found.symbol.membersScopePath);
        }
        return found?.scope.lookupScope(node.token.text);
    }
    if (node.kind === NodeKind.ExprNamespaceAccess) {
        const inner = resolveAccessScope(scope, node.scope);
        return inner?.lookupScope(node.member.text);
    }
    return undefined;
}

export function analyzeExpr(scope: SymbolScope, expr: NodeExpr): ResolvedType | undefined {
    const global = getActiveGlobalScope();
    switch (expr.kind) {
        case NodeKind.ExprParen:
            return analyzeExpr(scope, expr.inner);

        case NodeKind.ExprLiteralInt:
            return resolvedBuiltinInt64;
        case NodeKind.ExprLiteralFloat:
            return resolvedBuiltinDouble;
        case NodeKind.ExprLiteralString:
            return resolvedBuiltinString;
        case NodeKind.ExprLiteralChar:
            return resolvedBuiltinChar;
        case NodeKind.ExprLiteralBool:
            return resolvedBuiltinBool;
        case NodeKind.ExprLiteralNull:
        case NodeKind.ExprLiteralUserDefined:
            return undefined;

        case NodeKind.ExprFString: {
            for (const part of expr.parts) {
                if (part.kind === 'expr') analyzeExpr(scope, part.expr);
            }
            return resolvedBuiltinString;
        }

        case NodeKind.ExprIdentifier: {
            const found = findSymbolWithParent(scope, expr.token.text);
            if (found?.symbol instanceof SymbolVariable) {
                global.pushReference({ fromToken: expr.token, toSymbol: found.symbol });
                return found.symbol.type;
            }
            if (found?.symbol instanceof SymbolFunctionHolder) {
                global.pushReference({ fromToken: expr.token, toSymbol: found.symbol.first });
            }
            if (found?.symbol instanceof SymbolType) {
                global.pushReference({ fromToken: expr.token, toSymbol: found.symbol });
            }
            return undefined;
        }

        case NodeKind.ExprThis: {
            const found = findSymbolWithParent(scope, 'this');
            return found?.symbol instanceof SymbolVariable ? found.symbol.type : undefined;
        }

        case NodeKind.ExprBinary: {
            const left = analyzeExpr(scope, expr.left);
            const right = analyzeExpr(scope, expr.right);
            return resolveBinaryOp(scope, expr.op.text, left, right);
        }

        case NodeKind.ExprUnary:
            return resolveUnaryOp(expr.op.text, analyzeExpr(scope, expr.operand));

        case NodeKind.ExprPostfix:
            return resolvePostfixOp(expr.op.text, analyzeExpr(scope, expr.operand));

        case NodeKind.ExprTernary: {
            analyzeExpr(scope, expr.condition);
            const t = analyzeExpr(scope, expr.thenExpr);
            analyzeExpr(scope, expr.elseExpr);
            return t;
        }

        case NodeKind.ExprAssign: {
            const target = analyzeExpr(scope, expr.target);
            const value = analyzeExpr(scope, expr.value);
            if (expr.op.text === '=' && !isExemptLiteral(expr.value)) {
                const err = implicitConversionError(value, target);
                if (err) analyzerDiagnostic.error(rangeToLocation(expr.value.range), err.message + '; ' + err.hint, err.code);
            }
            return target;
        }

        case NodeKind.ExprCall:
            return analyzeCallExpr(scope, expr);

        case NodeKind.ExprMemberDot:
        case NodeKind.ExprMemberArrow: {
            const obj = analyzeExpr(scope, expr.object);
            const holder = lookupMemberHolder(global, obj, expr.member.text);
            if (holder instanceof SymbolVariable) {
                global.pushReference({ fromToken: expr.member, toSymbol: holder });
                return applyTemplateTranslator(holder.type, obj?.templateTranslator);
            }
            if (holder instanceof SymbolFunctionHolder) {
                global.pushReference({ fromToken: expr.member, toSymbol: holder.first });
            }
            return undefined;
        }

        case NodeKind.ExprNamespaceAccess: {
            const holder = resolveNamespaceMember(scope, expr);
            if (holder instanceof SymbolVariable) {
                global.pushReference({ fromToken: expr.member, toSymbol: holder });
                return holder.type;
            }
            if (holder instanceof SymbolFunctionHolder) {
                global.pushReference({ fromToken: expr.member, toSymbol: holder.first });
            }
            if (holder instanceof SymbolType) {
                global.pushReference({ fromToken: expr.member, toSymbol: holder });
            }
            return undefined;
        }

        case NodeKind.ExprIndex: {
            const obj = analyzeExpr(scope, expr.object);
            analyzeExpr(scope, expr.index);
            if (obj && obj.pointerLevel > 0) return obj.cloneWithDecoration({ pointerLevel: obj.pointerLevel - 1 });
            return inferIterableElement(obj);
        }

        case NodeKind.ExprCast:
            analyzeExpr(scope, expr.value);
            return analyzeCast(scope, expr);

        case NodeKind.ExprNew: {
            for (const a of expr.args) analyzeExpr(scope, a);
            if (expr.arraySize) analyzeExpr(scope, expr.arraySize);
            const baseType = analyzeType(scope, expr.type, true);
            if (!baseType || !baseType.typeOrFunc.isType()) return undefined;
            const argTypes = expr.args.map(a => analyzeExpr(scope, a));
            const r = analyzeConstructorCall(baseType.typeOrFunc as SymbolType, argTypes);
            if (r.status === 'no-match') {
                analyzerDiagnostic.error(rangeToLocation(expr.range), `No constructor of '${baseType.identifierText}' matches the given arguments.`, 'EN_NO_OVERLOAD');
            } else if (r.status === 'ambiguous') {
                analyzerDiagnostic.error(rangeToLocation(expr.range), `Constructor of '${baseType.identifierText}' is ambiguous across overloads.`, 'EN_AMBIGUOUS_CALL');
            }
            return r.type;
        }

        case NodeKind.ExprDelete:
            analyzeExpr(scope, expr.target);
            return undefined;

        case NodeKind.ExprDesignatedInit: {
            for (const f of expr.fields) analyzeExpr(scope, f.value);
            return expr.typeName ? analyzeType(scope, expr.typeName, true) : undefined;
        }

        case NodeKind.ExprArrayInit: {
            for (const el of expr.elements) analyzeExpr(scope, el);
            return undefined;
        }

        case NodeKind.ExprMatch: {
            analyzeExpr(scope, expr.subject);
            let first: ResolvedType | undefined;
            for (const arm of expr.arms) {
                const bodyType = analyzeExpr(scope, arm.body);
                if (first === undefined) first = bodyType;
            }
            return first;
        }

        case NodeKind.ExprStaticAssert:
            analyzeExpr(scope, expr.condition);
            if (expr.message) analyzeExpr(scope, expr.message);
            return undefined;

        case NodeKind.ExprIntrinsic: {
            for (const a of expr.args) analyzeExpr(scope, a);
            return undefined;
        }

        // Lambdas need their own parameter scope; left to a dedicated pass so we
        // never mis-resolve their bodies. Func-refs / sizeof / offsetof deduce
        // to undefined on purpose (keeps size_t out of sign diagnostics).
        case NodeKind.ExprLambdaBracket:
        case NodeKind.ExprLambdaArrow:
        case NodeKind.ExprFuncRef:
        case NodeKind.ExprSizeof:
        case NodeKind.ExprOffsetof:
            return undefined;

        default:
            return undefined;
    }
}

function analyzeCallExpr(scope: SymbolScope, expr: NodeExprCall): ResolvedType | undefined {
    const global = getActiveGlobalScope();
    const argTypes = expr.args.map(a => analyzeExpr(scope, a));
    const callee = expr.callee;

    if (callee.kind === NodeKind.ExprIdentifier) {
        const found = findSymbolWithParent(scope, callee.token.text);
        if (found?.symbol instanceof SymbolFunctionHolder) {
            global.pushReference({ fromToken: callee.token, toSymbol: found.symbol.first });
            const r = resolveCall(found.symbol, argTypes);
            reportCall(r, callee.token.text, rangeToLocation(expr.range));
            return r.returnType;
        }
        if (found?.symbol instanceof SymbolType) {
            // Value-construction `T(args)` — resolve ctor for diagnostics.
            const ctor = findConstructorHolder(found.symbol);
            if (ctor) {
                const r = resolveCall(ctor, argTypes);
                reportCall(r, callee.token.text, rangeToLocation(expr.range));
            }
            return new ResolvedType(found.symbol);
        }
        return undefined;
    }

    if (callee.kind === NodeKind.ExprMemberDot || callee.kind === NodeKind.ExprMemberArrow) {
        const obj = analyzeExpr(scope, callee.object);
        const holder = lookupMemberHolder(global, obj, callee.member.text);
        if (holder instanceof SymbolFunctionHolder) {
            global.pushReference({ fromToken: callee.member, toSymbol: holder.first });
            const r = resolveCall(holder, argTypes);
            reportCall(r, callee.member.text, rangeToLocation(expr.range));
            return applyTemplateTranslator(r.returnType, obj?.templateTranslator);
        }
        return undefined;
    }

    if (callee.kind === NodeKind.ExprNamespaceAccess) {
        const holder = resolveNamespaceMember(scope, callee);
        if (holder instanceof SymbolFunctionHolder) {
            global.pushReference({ fromToken: callee.member, toSymbol: holder.first });
            const r = resolveCall(holder, argTypes);
            reportCall(r, callee.member.text, rangeToLocation(expr.range));
            return r.returnType;
        }
        return undefined;
    }

    // Calling the result of another expression (function pointer, etc.).
    analyzeExpr(scope, callee);
    return undefined;
}
