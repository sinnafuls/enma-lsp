// Binary / unary / postfix operator type resolution.
//
// Result types follow the Enma reference (§4 Operators, §8 operator
// overloading): comparison/logical yield bool; assignment yields the lhs type;
// arithmetic/bitwise yield the promoted numeric operand (or, when the lhs is a
// script struct/class defining `operator<op>`, that operator's return type).
//
// This module never emits diagnostics — it only deduces a best-effort result
// type and degrades to undefined / the lhs type when unsure.

import { ResolvedType } from './resolvedType';
import { resolvedBuiltinBool } from './builtinType';
import { SymbolType } from './symbolObject';
import { SymbolScope } from './symbolScope';
import { NodeKind, NodeClass, NodeStruct, NodeOperatorOverload } from '../compiler_parser/nodes';
import { analyzeType } from './analyzer';

const COMPARISON_OPS: Record<string, true> = { '<': true, '<=': true, '>': true, '>=': true, '==': true, '!=': true };
const LOGICAL_OPS: Record<string, true> = { '&&': true, '||': true };
const ASSIGN_OPS: Record<string, true> = {
    '=': true, '+=': true, '-=': true, '*=': true, '/=': true, '%=': true,
    '<<=': true, '>>=': true, '&=': true, '|=': true, '^=': true,
};

const FLOAT_RANK: Record<string, number> = { float64: 2, double: 2, float32: 1, float: 1 };

/** Look up a `operator<op>` member on a script struct/class (incl. its bases). */
function findMemberOperator(scope: SymbolScope, type: SymbolType, op: string): ResolvedType | undefined {
    const visit = (t: SymbolType, seen: Set<SymbolType>): ResolvedType | undefined => {
        if (seen.has(t)) return undefined;
        seen.add(t);
        const node = t.linkedNode;
        if (node && (node.kind === NodeKind.Class || node.kind === NodeKind.Struct)) {
            for (const m of (node as NodeClass | NodeStruct).members) {
                if (m.kind === NodeKind.OperatorOverload && (m as NodeOperatorOverload).op.text === op) {
                    const membersScope = t.membersScopePath ? scope.getGlobalScope().resolveScope(t.membersScopePath) ?? scope : scope;
                    return analyzeType(membersScope, (m as NodeOperatorOverload).returnType);
                }
            }
        }
        for (const b of t.baseList) {
            if (!b || !b.typeOrFunc.isType()) continue;
            const r = visit(b.typeOrFunc as SymbolType, seen);
            if (r) return r;
        }
        return undefined;
    };
    return visit(type, new Set());
}

export function resolveBinaryOp(
    scope: SymbolScope,
    op: string,
    left: ResolvedType | undefined,
    right: ResolvedType | undefined,
): ResolvedType | undefined {
    if (COMPARISON_OPS[op] || LOGICAL_OPS[op]) return resolvedBuiltinBool;
    if (ASSIGN_OPS[op]) return left;

    // Struct/class operator overload on the lhs.
    if (left && left.pointerLevel === 0 && left.typeOrFunc.isType()) {
        const lt = left.typeOrFunc as SymbolType;
        if (lt.linkedNode && (lt.linkedNode.kind === NodeKind.Class || lt.linkedNode.kind === NodeKind.Struct)) {
            const overloadResult = findMemberOperator(scope, lt, op);
            if (overloadResult) return overloadResult;
            return left;
        }
    }

    // Numeric promotion: a float operand wins over an int operand; otherwise
    // keep the lhs type. Pointers and other types fall through to the lhs.
    const lname = left?.typeOrFunc.isType() && left.pointerLevel === 0 ? left.identifierText : undefined;
    const rname = right?.typeOrFunc.isType() && right.pointerLevel === 0 ? right.identifierText : undefined;
    const lf = lname ? FLOAT_RANK[lname] : undefined;
    const rf = rname ? FLOAT_RANK[rname] : undefined;
    if (lf !== undefined || rf !== undefined) {
        if (rf !== undefined && (lf === undefined || rf > lf)) return right;
        return left;
    }
    return left ?? right;
}

export function resolveUnaryOp(op: string, operand: ResolvedType | undefined): ResolvedType | undefined {
    if (op === '!') return resolvedBuiltinBool;
    if (op === '*' && operand && operand.pointerLevel > 0) {
        return operand.cloneWithDecoration({ pointerLevel: operand.pointerLevel - 1 });
    }
    if (op === '&' && operand) {
        return operand.cloneWithDecoration({ pointerLevel: operand.pointerLevel + 1 });
    }
    return operand;
}

export function resolvePostfixOp(_op: string, operand: ResolvedType | undefined): ResolvedType | undefined {
    return operand;
}
