// Annotation registry + type-checks for argument shape.
//
// Known annotations (per the plan & AC-21b):
//   align, dll, reflect, serialize, export, packed, inline, noinline,
//   noopt, noescape, shadow
//
// Type-checked arg shapes (errorForce — R21 exempt):
//   [[align(N)]]      — exactly one int constant
//   [[dll("name")]]   — exactly one string literal
//
// Other annotations: arity/shape errors are warnings unless explicitly upgraded.
// Unknown annotations emit a plain Warning.

import { NodeAnnotation, NodeExpr, NodeKind } from '../compiler_parser/nodes';
import { analyzerDiagnostic } from './analyzerDiagnostic';

/** Canonical set of known annotations. **MUST contain `shadow`** (AC-21b). */
export const KNOWN_ANNOTATIONS: ReadonlySet<string> = new Set([
    'align',
    'dll',
    'reflect',
    'serialize',
    'export',
    'packed',
    'inline',
    'noinline',
    'noopt',
    'noescape',
    'shadow',
]);

export function isKnownAnnotation(name: string): boolean {
    return KNOWN_ANNOTATIONS.has(name);
}

/**
 * Validate a single annotation. Emits diagnostics directly into the analyzer
 * session.
 */
export function checkAnnotation(annotation: NodeAnnotation): void {
    const name = annotation.name.text;

    if (!KNOWN_ANNOTATIONS.has(name)) {
        analyzerDiagnostic.warning(
            annotation.name.location,
            `Unknown annotation '[[${name}]]'`,
            'EN_ANN_UNKNOWN',
        );
        return;
    }

    switch (name) {
        case 'align':
            checkAlignArgs(annotation);
            break;
        case 'dll':
            checkDllArgs(annotation);
            break;
        case 'shadow':
            // [[shadow]] takes 0 args.
            if (annotation.args.length !== 0) {
                analyzerDiagnostic.warning(
                    annotation.name.location,
                    `[[shadow]] does not take arguments`,
                    'EN_ANN_SHADOW_ARGS',
                );
            }
            break;
        default:
            // Other known annotations: no arg-shape rules at this stage.
            break;
    }
}

function checkAlignArgs(annotation: NodeAnnotation): void {
    if (annotation.args.length !== 1) {
        analyzerDiagnostic.errorForce(
            annotation.name.location,
            `[[align(N)]] requires exactly one integer argument`,
            'EN_ANN_ALIGN_ARITY',
        );
        return;
    }
    const arg = annotation.args[0];
    if (!isIntLiteralExpr(arg)) {
        analyzerDiagnostic.errorForce(
            annotation.name.location,
            `[[align(N)]] requires an integer constant argument`,
            'EN_ANN_ALIGN_TYPE',
        );
    }
}

function checkDllArgs(annotation: NodeAnnotation): void {
    if (annotation.args.length !== 1) {
        analyzerDiagnostic.errorForce(
            annotation.name.location,
            `[[dll("name")]] requires exactly one string argument`,
            'EN_ANN_DLL_ARITY',
        );
        return;
    }
    const arg = annotation.args[0];
    if (!isStringLiteralExpr(arg)) {
        analyzerDiagnostic.errorForce(
            annotation.name.location,
            `[[dll("name")]] requires a string literal argument`,
            'EN_ANN_DLL_TYPE',
        );
    }
}

function isIntLiteralExpr(e: NodeExpr): boolean {
    return e.kind === NodeKind.ExprLiteralInt;
}

function isStringLiteralExpr(e: NodeExpr): boolean {
    return e.kind === NodeKind.ExprLiteralString;
}

