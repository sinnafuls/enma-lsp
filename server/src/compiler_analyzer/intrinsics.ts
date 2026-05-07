// Compiler intrinsics — typing + arity.
//
// Recognized:
//   __va_count            — no parens; resolves to int64
//   __va_arg(i)           — parens; one int arg; resolves to int64
//   __asm_rdtsc()         — parens; 0 args; resolves to int64
//   __asm_pause()         — parens; 0 args; resolves to void
//   __asm_mfence()        — parens; 0 args; resolves to void
//   __asm_nop()           — parens; 0 args; resolves to void

import { NodeExprIntrinsic } from '../compiler_parser/nodes';
import { analyzerDiagnostic } from './analyzerDiagnostic';
import { ResolvedType } from './resolvedType';
import {
    builtinInt64,
    builtinVoid,
} from './builtinType';

interface IntrinsicSpec {
    requiresParens: boolean;
    arity: number;
    returns: ResolvedType;
}

const INTRINSICS: ReadonlyMap<string, IntrinsicSpec> = (() => {
    const m = new Map<string, IntrinsicSpec>();
    m.set('__va_count',   { requiresParens: false, arity: 0, returns: new ResolvedType(builtinInt64) });
    m.set('__va_arg',     { requiresParens: true,  arity: 1, returns: new ResolvedType(builtinInt64) });
    m.set('__asm_rdtsc',  { requiresParens: true,  arity: 0, returns: new ResolvedType(builtinInt64) });
    m.set('__asm_pause',  { requiresParens: true,  arity: 0, returns: new ResolvedType(builtinVoid) });
    m.set('__asm_mfence', { requiresParens: true,  arity: 0, returns: new ResolvedType(builtinVoid) });
    m.set('__asm_nop',    { requiresParens: true,  arity: 0, returns: new ResolvedType(builtinVoid) });
    return m;
})();

export function isKnownIntrinsic(name: string): boolean {
    return INTRINSICS.has(name);
}

/**
 * Type-check an intrinsic call. Returns the resolved type (int64 / void) on
 * success, undefined on shape failure.
 */
export function analyzeIntrinsic(node: NodeExprIntrinsic): ResolvedType | undefined {
    const name = node.name.text;
    const spec = INTRINSICS.get(name);
    if (!spec) {
        analyzerDiagnostic.error(
            node.name.location,
            `Unknown intrinsic '${name}'`,
            'EN_INTR_UNKNOWN',
        );
        return undefined;
    }

    if (spec.requiresParens && !node.hasParens) {
        analyzerDiagnostic.error(
            node.name.location,
            `intrinsic '${name}' requires parentheses`,
            'EN_INTR_PARENS_MISSING',
        );
        return undefined;
    }
    if (!spec.requiresParens && node.hasParens) {
        analyzerDiagnostic.error(
            node.name.location,
            `intrinsic '${name}' takes no parentheses`,
            'EN_INTR_PARENS_UNEXPECTED',
        );
        return undefined;
    }

    if (node.args.length !== spec.arity) {
        analyzerDiagnostic.error(
            node.name.location,
            `intrinsic '${name}' expects ${spec.arity} argument(s), got ${node.args.length}`,
            'EN_INTR_ARITY',
        );
        return undefined;
    }

    return spec.returns;
}
