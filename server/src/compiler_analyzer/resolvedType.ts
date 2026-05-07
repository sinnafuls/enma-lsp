// Resolved-type wrapper: a SymbolType (or SymbolFunction) plus type-arg
// translator + decoration (pointer level, reference, const, nullable).
//
// §A4-N4: AutoPendingType — sentinel used during hoist when a symbol is
// declared with `auto` and the initializer hasn't been analyzed yet. The
// analyzer's expression pass replaces it with the resolved type, OR raises
// "Cannot infer type — use of `auto` requires an initializer" if the
// placeholder survives to use-site resolution.

import { TokenObject } from '../compiler_tokenizer/tokenObject';
import { ScopePath, SymbolFunction, SymbolType, SymbolVariable } from './symbolObject';

/**
 * Mapping from template parameter token (e.g. `T` in `class array<T>`) to its
 * resolved type during instantiation.
 */
export type TemplateTranslator = Map<TokenObject, ResolvedType | undefined>;

/**
 * Sentinel: "this symbol was declared with `auto` and is pending initializer
 * analysis". When the analyzer sees a ResolvedType with `isAutoPending = true`
 * at use site, it raises the cannot-infer error. When initializer analysis
 * completes, it constructs a fresh ResolvedType from the deduced type and
 * mutates the SymbolVariable's stored type via assignType().
 */
export const AutoPendingType: unique symbol = Symbol('AutoPendingType');
export type AutoPendingMarker = typeof AutoPendingType;

/**
 * Represents a resolved type at a use site, including its decoration:
 * pointer level (T*, T**), reference (T&), const, nullable, and template
 * argument bindings.
 */
export class ResolvedType {
    constructor(
        /** The base symbol — either a type, or a function (for callables). */
        public readonly typeOrFunc: SymbolType | SymbolFunction,
        /** Pointer level: 0 = value, 1 = T*, 2 = T**, etc. */
        public readonly pointerLevel: number = 0,
        public readonly isReference: boolean = false,
        public readonly isConst: boolean = false,
        public readonly isNullable: boolean = false,
        /** Template arg binding for instantiation. */
        public readonly templateTranslator?: TemplateTranslator,
        /** Source of access: variable or token (for member-access tracking). */
        public readonly accessSource?: SymbolVariable | TokenObject,
        /** True when this resolves to an `auto`-pending placeholder. */
        public readonly isAutoPending: boolean = false,
    ) {}

    public static create(args: {
        typeOrFunc: SymbolType | SymbolFunction;
        pointerLevel?: number;
        isReference?: boolean;
        isConst?: boolean;
        isNullable?: boolean;
        templateTranslator?: TemplateTranslator;
        accessSource?: SymbolVariable | TokenObject;
        isAutoPending?: boolean;
    }): ResolvedType {
        return new ResolvedType(
            args.typeOrFunc,
            args.pointerLevel ?? 0,
            args.isReference ?? false,
            args.isConst ?? false,
            args.isNullable ?? false,
            args.templateTranslator,
            args.accessSource,
            args.isAutoPending ?? false,
        );
    }

    /** Auto-pending placeholder. Carries a host SymbolType so callers don't deref undefined. */
    public static autoPending(host: SymbolType): ResolvedType {
        return new ResolvedType(host, 0, false, false, false, undefined, undefined, true);
    }

    public cloneWithTemplateTranslator(translator: TemplateTranslator | undefined): ResolvedType {
        return new ResolvedType(
            this.typeOrFunc,
            this.pointerLevel,
            this.isReference,
            this.isConst,
            this.isNullable,
            translator,
            this.accessSource,
            this.isAutoPending,
        );
    }

    public cloneWithAccessSource(src: SymbolVariable | TokenObject | undefined): ResolvedType {
        return new ResolvedType(
            this.typeOrFunc,
            this.pointerLevel,
            this.isReference,
            this.isConst,
            this.isNullable,
            this.templateTranslator,
            src,
            this.isAutoPending,
        );
    }

    public cloneWithDecoration(args: {
        pointerLevel?: number;
        isReference?: boolean;
        isConst?: boolean;
        isNullable?: boolean;
    }): ResolvedType {
        return new ResolvedType(
            this.typeOrFunc,
            args.pointerLevel ?? this.pointerLevel,
            args.isReference ?? this.isReference,
            args.isConst ?? this.isConst,
            args.isNullable ?? this.isNullable,
            this.templateTranslator,
            this.accessSource,
            this.isAutoPending,
        );
    }

    public get scopePath(): ScopePath {
        return this.typeOrFunc.scopePath;
    }

    public get identifierToken(): TokenObject {
        return this.typeOrFunc.identifierToken;
    }

    public get identifierText(): string {
        return this.typeOrFunc.identifierToken.text;
    }

    public isPointer(): boolean {
        return this.pointerLevel > 0;
    }

    public isVoid(): boolean {
        return this.typeOrFunc.isType() && this.typeOrFunc.identifierText === 'void' && this.pointerLevel === 0;
    }

    public equals(other: ResolvedType | undefined): boolean {
        if (other === undefined) return false;
        if (!this.typeOrFunc.equals(other.typeOrFunc)) return false;
        if (this.pointerLevel !== other.pointerLevel) return false;
        if (this.isReference !== other.isReference) return false;
        if (this.isConst !== other.isConst) return false;
        if (this.isNullable !== other.isNullable) return false;
        if (this.isAutoPending !== other.isAutoPending) return false;

        // Compare template bindings.
        const lt = this.typeOrFunc.isType() ? this.typeOrFunc.templateTypes : undefined;
        const rt = other.typeOrFunc.isType() ? other.typeOrFunc.templateTypes : undefined;
        if (lt && rt) {
            if (lt.length !== rt.length) return false;
            for (let i = 0; i < lt.length; i++) {
                const lv = this.templateTranslator?.get(lt[i]);
                const rv = other.templateTranslator?.get(rt[i]);
                if ((lv === undefined) !== (rv === undefined)) return false;
                if (lv && rv && !lv.equals(rv)) return false;
            }
        }

        return true;
    }
}

/**
 * Apply a template translator to a resolved type, recursing into nested
 * template bindings. Mirrors angel-lsp's behavior so member-access lookup
 * on a template instance returns specialized types.
 */
export function applyTemplateTranslator(
    target: ResolvedType | undefined,
    translator: TemplateTranslator | undefined,
): ResolvedType | undefined {
    if (target === undefined || translator === undefined) return target;

    // No nested templates — direct type-parameter substitution.
    const isTypeParam = target.typeOrFunc.isType() && target.typeOrFunc.isTypeParameter;
    if (target.templateTranslator === undefined || target.typeOrFunc.templateTypes?.length === 0) {
        if (isTypeParam) {
            return translator.get(target.typeOrFunc.identifierToken) ?? target;
        }
        return target;
    }

    // Nested templates — rebuild translator recursively.
    const newTranslator = new Map<TokenObject, ResolvedType | undefined>();
    for (const [token, translatedType] of target.templateTranslator) {
        if (
            translatedType?.identifierToken !== undefined &&
            translator.has(translatedType.identifierToken)
        ) {
            newTranslator.set(token, translator.get(translatedType.identifierToken));
        } else {
            newTranslator.set(token, applyTemplateTranslator(translatedType, translator));
        }
    }
    return target.cloneWithTemplateTranslator(newTranslator);
}
