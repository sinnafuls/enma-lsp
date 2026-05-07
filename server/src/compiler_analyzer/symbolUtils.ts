// Utility functions for symbol/scope operations: qualified-name resolution,
// scope walkers, debug-printing.

import {
    SymbolFunctionHolder,
    SymbolObject,
    SymbolObjectHolder,
    SymbolType,
    SymbolVariable,
} from './symbolObject';
import { SymbolScope, isAnonymousIdentifier, collectScopeListWithParentAndUsing } from './symbolScope';

/** Fully-qualified identifier of a symbol (`Outer::Inner::name`). */
export function getFullIdentifier(symbol: SymbolObject | SymbolFunctionHolder): string {
    const path = symbol instanceof SymbolFunctionHolder
        ? symbol.first.scopePath
        : symbol.scopePath;
    const text = symbol instanceof SymbolFunctionHolder
        ? symbol.first.identifierText
        : symbol.identifierText;

    return path.length === 0 ? text : `${path.join('::')}::${text}`;
}

/**
 * Look up an identifier by walking the scope chain (parents + using-namespaces).
 * Returns the holder + the scope that owns it, or undefined.
 */
export function findSymbolWithParent(
    scope: SymbolScope,
    name: string,
): { symbol: SymbolObjectHolder; scope: SymbolScope } | undefined {
    const candidates = collectScopeListWithParentAndUsing(scope);
    for (const c of candidates) {
        const sym = c.lookupSymbol(name);
        if (sym) return { symbol: sym, scope: c };
    }
    return undefined;
}

/** Resolve a qualified-name path (e.g. ['geom','Point']) starting from `scope`. */
export function resolveQualifiedName(
    scope: SymbolScope,
    path: ReadonlyArray<string>,
): SymbolObjectHolder | undefined {
    if (path.length === 0) return undefined;
    if (path.length === 1) {
        return findSymbolWithParent(scope, path[0])?.symbol;
    }

    // Walk into namespace scopes.
    let cur: SymbolScope | undefined = scope;
    for (let i = 0; i < path.length - 1; i++) {
        if (cur === undefined) return undefined;
        cur = cur.lookupScopeWithParent(path[i]) ?? undefined;
    }
    return cur?.lookupSymbol(path[path.length - 1]);
}

/** Pretty-print a scope tree for debug. */
export function printSymbolScope(scope: SymbolScope, depth = 0): string {
    const indent = '  '.repeat(depth);
    const lines: string[] = [];
    lines.push(`${indent}[scope: ${scope.scopePath.join('::') || '(global)'}] ${scope.linkedKind}`);
    for (const [key, holder] of scope.symbolTable) {
        if (holder instanceof SymbolFunctionHolder) {
            lines.push(`${indent}  fn ${key} (${holder.count} overload${holder.count > 1 ? 's' : ''})`);
        } else if (holder instanceof SymbolType) {
            const tag = holder.isEnum ? 'enum'
                : holder.isInterface ? 'interface'
                : holder.isStruct ? 'struct'
                : holder.isMixin ? 'mixin'
                : holder.isPrimitive() ? 'prim'
                : 'class';
            lines.push(`${indent}  ${tag} ${key}`);
        } else if (holder instanceof SymbolVariable) {
            lines.push(`${indent}  var ${key}: ${holder.type?.identifierText ?? '?'}`);
        }
    }
    for (const [key, child] of scope.childScopeTable) {
        if (isAnonymousIdentifier(key)) {
            lines.push(`${indent}  (anon child)`);
        }
        lines.push(printSymbolScope(child, depth + 1));
    }
    return lines.join('\n');
}

