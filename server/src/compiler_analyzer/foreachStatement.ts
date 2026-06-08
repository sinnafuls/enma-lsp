// `for (T v : iterable)` analysis.
//
// The loop variable's type is taken from its declaration (`T` in the foreach
// header), so binding never needs to infer it from the iterable. The statement
// walker calls this to register the loop variable(s) in the foreach body scope;
// it analyses the iterable expression and body itself.

import { NodeStmtForeach } from '../compiler_parser/nodes';
import { SymbolScope } from './symbolScope';
import { ResolvedType } from './resolvedType';
import { analyzeType } from './analyzer';
import { SymbolVariable } from './symbolObject';
import { resolvedBuiltinChar } from './builtinType';

export function analyzeForeach(scope: SymbolScope, node: NodeStmtForeach): void {
    const elemType = analyzeType(scope, node.elemType, true);
    scope.insertSymbolAndCheck(SymbolVariable.create({
        identifierToken: node.elemName,
        scopePath: scope.scopePath,
        type: elemType ?? undefined,
        isInstanceMember: false,
        accessRestriction: undefined,
    }));

    // kv-foreach `for (T1 k, T2 v : map)` binds an additional value variable.
    if (node.valueType !== undefined && node.valueName !== undefined) {
        const valueType = analyzeType(scope, node.valueType, true);
        scope.insertSymbolAndCheck(SymbolVariable.create({
            identifierToken: node.valueName,
            scopePath: scope.scopePath,
            type: valueType ?? undefined,
            isInstanceMember: false,
            accessRestriction: undefined,
        }));
    }
}

/**
 * Best-effort element type of an iterable: `string`→`char`, and a single
 * template argument (`array<T>`, `list<T>`) → `T`. Returns undefined for
 * shapes we don't model so callers stay silent.
 */
export function inferIterableElement(iter: ResolvedType | undefined): ResolvedType | undefined {
    if (!iter || !iter.typeOrFunc.isType() || iter.pointerLevel > 0) return undefined;
    if (iter.identifierText === 'string') return resolvedBuiltinChar;

    const templates = iter.typeOrFunc.templateTypes;
    const translator = iter.templateTranslator;
    if (templates && templates.length === 1 && translator) {
        return translator.get(templates[0]) ?? undefined;
    }
    return undefined;
}
