// Binary / unary / postfix operator type resolution.
//
// Skeleton: returns the operand type for arithmetic/bitwise; bool for
// comparison; void for assignment. Full operator-overload resolution
// (including OperatorOverload nodes on classes) lands in week 2.

import { ResolvedType } from './resolvedType';
import { resolvedBuiltinBool } from './builtinType';

const COMPARISON_OPS = new Set(['<', '<=', '>', '>=', '==', '!=']);
const LOGICAL_OPS = new Set(['&&', '||']);
const ASSIGN_OPS = new Set(['=', '+=', '-=', '*=', '/=', '%=', '<<=', '>>=', '&=', '|=', '^=']);

export function resolveBinaryOp(
    op: string,
    left: ResolvedType | undefined,
    right: ResolvedType | undefined,
): ResolvedType | undefined {
    if (COMPARISON_OPS.has(op) || LOGICAL_OPS.has(op)) {
        return resolvedBuiltinBool;
    }
    if (ASSIGN_OPS.has(op)) {
        return left;
    }
    // Arithmetic / bitwise: prefer left's type, fall through to right.
    return left ?? right;
}

export function resolveUnaryOp(op: string, operand: ResolvedType | undefined): ResolvedType | undefined {
    if (op === '!') return resolvedBuiltinBool;
    return operand;
}

export function resolvePostfixOp(_op: string, operand: ResolvedType | undefined): ResolvedType | undefined {
    return operand;
}
