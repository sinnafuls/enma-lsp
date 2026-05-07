// `for (T v : iterable)` analysis.
//
// Decides what `T` should be given iterable's type. For arrays of element T,
// the loop var is T. For `string` it's `char`. For a custom type with an
// `iterator` member it's the iterator's value type.
// Skeleton — full implementation in week 2.

import { NodeStmtForeach } from '../compiler_parser/nodes';
import { SymbolScope } from './symbolScope';
import { ResolvedType } from './resolvedType';
import { analyzeType } from './analyzer';
import { SymbolVariable } from './symbolObject';

export function analyzeForeach(scope: SymbolScope, node: NodeStmtForeach): void {
    const elemType = analyzeType(scope, node.elemType);

    // Bind the loop variable in the body's scope.
    const v = SymbolVariable.create({
        identifierToken: node.elemName,
        scopePath: scope.scopePath,
        type: elemType ?? undefined,
        isInstanceMember: false,
        accessRestriction: undefined,
    });
    scope.insertSymbolAndCheck(v);

    // kv-foreach binds an additional value variable.
    if (node.valueType !== undefined && node.valueName !== undefined) {
        const valueType = analyzeType(scope, node.valueType);
        const v2 = SymbolVariable.create({
            identifierToken: node.valueName,
            scopePath: scope.scopePath,
            type: valueType ?? undefined,
            isInstanceMember: false,
            accessRestriction: undefined,
        });
        scope.insertSymbolAndCheck(v2);
    }

    void node.iterable;
    void node.body;
}

export function inferIterableElement(_iter: ResolvedType | undefined): ResolvedType | undefined {
    return undefined;
}
