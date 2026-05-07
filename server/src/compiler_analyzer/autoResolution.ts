// `auto` resolution helpers (§A4-N4).
//
// During hoist, a `auto x = expr;` declaration registers the variable with a
// ResolvedType.autoPending(host) sentinel. The analyzer pass infers the type
// from the initializer expression and replaces the symbol's type. If a use site
// resolves a symbol whose stored type is still autoPending, that's the
// "Cannot infer type — use of `auto` requires an initializer" error.

import { TextLocation } from '../compiler_tokenizer/textLocation';
import { TokenObject } from '../compiler_tokenizer/tokenObject';
import { analyzerDiagnostic } from './analyzerDiagnostic';
import { builtinNullableMarker } from './builtinType';
import { ResolvedType } from './resolvedType';
import { SymbolType, SymbolVariable } from './symbolObject';

/** Build a fresh AutoPending placeholder. The host SymbolType is just a plug. */
export function autoPendingPlaceholder(): ResolvedType {
    // Reuse the nullable marker as a placeholder host — it has a virtual location
    // and a benign-looking identifier. Inspector code never displays this.
    return ResolvedType.autoPending(builtinNullableMarker);
}

/**
 * Bind an inferred type to a `auto`-declared variable. Mutates `variable.type`.
 * No-op (with diagnostic) when the inferred type is undefined.
 */
export function bindAutoType(
    variable: SymbolVariable,
    inferred: ResolvedType | undefined,
    autoToken: TokenObject,
    location: TextLocation,
): void {
    if (inferred === undefined) {
        analyzerDiagnostic.error(
            location,
            "Cannot infer type — initializer for 'auto' has no resolvable type",
            'EN_AUTO_NO_INIT_TYPE',
        );
        return;
    }
    variable.assignType(inferred);
}

/** True when the resolved type is the autoPending sentinel. */
export function isAutoPending(t: ResolvedType | undefined): boolean {
    return t !== undefined && t.isAutoPending;
}

/**
 * Use-site check — call when a use of `name` would dereference a still-pending
 * auto type. Emits "Cannot infer type" once per use site.
 */
export function reportAutoUseBeforeInit(name: string, location: TextLocation): void {
    analyzerDiagnostic.error(
        location,
        `Cannot infer type — use of 'auto' for '${name}' requires an initializer`,
        'EN_AUTO_USE_BEFORE_INIT',
    );
}

