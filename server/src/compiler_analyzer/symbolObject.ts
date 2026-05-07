// Symbol-table object model.
//
// Discriminated kinds: Type | Variable | Function (which holds an overload set).
// Enma adds: SymbolField, SymbolMethod, SymbolEnum, SymbolEnumValue,
// SymbolNamespace, SymbolTemplate (param), SymbolDelegate, SymbolMixin.
// They are convenience subtypes of the three core kinds — Method/Field reduce
// to Function/Variable with isInstanceMember=true; Enum is a Type with an
// `enumValues` member list; Namespace is a synthesized Type-shaped marker
// whose membersScopePath points at the namespace scope.

import { TokenObject, TokenIdentifier, TokenReserved } from '../compiler_tokenizer/tokenObject';
import {
    NodeClass,
    NodeStruct,
    NodeInterface,
    NodeEnum,
    NodeFunction,
    NodeMethod,
    NodeConstructor,
    NodeDestructor,
    NodeField,
    NodeVar,
    NodeStmtVar,
    NodeParam,
    NodeMixin,
    NodeDelegate,
    NodeTemplateParam,
    NodeEnumValue,
} from '../compiler_parser/nodes';
import { ResolvedType } from './resolvedType';

// ---- Common -------------------------------------------------------------

export type ScopePath = ReadonlyArray<string>;

export function isScopePathEqual(a: ScopePath, b: ScopePath): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}

export enum SymbolKind {
    Type = 'Type',
    Variable = 'Variable',
    Function = 'Function',
}

/** Type-definition node kinds the SymbolType can wrap. */
export type TypeDefinitionNode =
    | NodeClass
    | NodeStruct
    | NodeInterface
    | NodeEnum
    | NodeMixin
    | NodeDelegate;

/** Access modifier — visibility of class members. */
export enum AccessModifier {
    Public = 'public',
    Private = 'private',
    Protected = 'protected',
}

/** Convert a parser modifier token list to an AccessModifier (default Public). */
export function modifiersToAccess(modifiers: ReadonlyArray<TokenReserved>): AccessModifier | undefined {
    for (const m of modifiers) {
        if (m.text === 'private') return AccessModifier.Private;
        if (m.text === 'public') return AccessModifier.Public;
    }
    return undefined;
}

export abstract class SymbolBase {
    public abstract get kind(): SymbolKind;
    public abstract get scopePath(): ScopePath;
    public abstract get identifierText(): string;
    public abstract get identifierToken(): TokenObject;
    public abstract toHolder(): SymbolObjectHolder;

    public isType(): this is SymbolType {
        return this.kind === SymbolKind.Type;
    }
    public isVariable(): this is SymbolVariable {
        return this.kind === SymbolKind.Variable;
    }
    public isFunction(): this is SymbolFunction {
        return this.kind === SymbolKind.Function;
    }

    public equals(other: SymbolBase): boolean {
        return this.identifierText === other.identifierText && isScopePathEqual(this.scopePath, other.scopePath);
    }
}

// ---- SymbolType ---------------------------------------------------------

export class SymbolType extends SymbolBase {
    public get kind(): SymbolKind { return SymbolKind.Type; }

    private _membersScopePath: ScopePath | undefined;
    private _templateTypes: TokenObject[] | undefined;
    /** Ordered base list (§A3 multi-inheritance) — analyzer computes C3 linearization separately. */
    private _baseList: (ResolvedType | undefined)[] | undefined;
    /** §A3: cached C3 MRO output, computed lazily via mro.ts. */
    private _mroCache: SymbolType[] | undefined;
    /** Origin tag — bundled stdlib (`enma-stdlib.json`), workspace `.em.predefined`, or user file. */
    public origin: 'bundled' | 'predefined' | 'user' = 'user';

    constructor(
        public readonly identifierToken: TokenObject,
        public readonly scopePath: ScopePath,
        public readonly linkedNode: TypeDefinitionNode | undefined,
        membersScopePath: ScopePath | undefined,
        public readonly isMixin: boolean = false,
        public readonly isInterface: boolean = false,
        public readonly isStruct: boolean = false,
        public readonly isEnum: boolean = false,
        public readonly isTypeParameter: boolean = false,
    ) {
        super();
        this._membersScopePath = membersScopePath;
    }

    public static create(args: {
        identifierToken: TokenObject;
        scopePath: ScopePath;
        linkedNode: TypeDefinitionNode | undefined;
        membersScopePath: ScopePath | undefined;
        isMixin?: boolean;
        isInterface?: boolean;
        isStruct?: boolean;
        isEnum?: boolean;
        isTypeParameter?: boolean;
    }): SymbolType {
        return new SymbolType(
            args.identifierToken,
            args.scopePath,
            args.linkedNode,
            args.membersScopePath,
            args.isMixin ?? false,
            args.isInterface ?? false,
            args.isStruct ?? false,
            args.isEnum ?? false,
            args.isTypeParameter ?? false,
        );
    }

    public get membersScopePath(): ScopePath | undefined {
        return this._membersScopePath;
    }

    public assignMembersScopePath(p: ScopePath | undefined): void {
        this._membersScopePath = p;
    }

    public get templateTypes(): TokenObject[] | undefined {
        return this._templateTypes;
    }

    public assignTemplateTypes(types: TokenObject[]): void {
        this._templateTypes = types;
    }

    public get baseList(): ReadonlyArray<ResolvedType | undefined> {
        return this._baseList ?? [];
    }

    public assignBaseList(list: (ResolvedType | undefined)[] | undefined): void {
        this._baseList = list;
        this._mroCache = undefined;
    }

    public get mroCache(): SymbolType[] | undefined {
        return this._mroCache;
    }

    public setMroCache(mro: SymbolType[]): void {
        this._mroCache = mro;
    }

    public get identifierText(): string {
        return this.identifierToken.text;
    }

    public toHolder(): SymbolObjectHolder { return this; }

    /** True when no AST node backs this — i.e. a primitive built-in. */
    public isPrimitive(): boolean {
        return this.linkedNode === undefined && !this.isTypeParameter;
    }

    public isFunctionHolder(): this is SymbolFunctionHolder { return false; }

    public toList(): SymbolType[] { return [this]; }
}

// ---- SymbolVariable -----------------------------------------------------

export class SymbolVariable extends SymbolBase {
    public get kind(): SymbolKind { return SymbolKind.Variable; }

    private _type: ResolvedType | undefined;

    constructor(
        public readonly identifierToken: TokenObject,
        public readonly scopePath: ScopePath,
        type: ResolvedType | undefined,
        public readonly isInstanceMember: boolean,
        public readonly accessRestriction: AccessModifier | undefined,
        /** Backing AST node (Field / Var / StmtVar / Param / EnumValue) for hover, etc. */
        public readonly linkedNode: NodeField | NodeVar | NodeStmtVar | NodeParam | NodeEnumValue | undefined = undefined,
        public readonly isConst: boolean = false,
        public readonly isStatic: boolean = false,
    ) {
        super();
        this._type = type;
    }

    public static create(args: {
        identifierToken: TokenObject;
        scopePath: ScopePath;
        type: ResolvedType | undefined;
        isInstanceMember: boolean;
        accessRestriction: AccessModifier | undefined;
        linkedNode?: NodeField | NodeVar | NodeStmtVar | NodeParam | NodeEnumValue;
        isConst?: boolean;
        isStatic?: boolean;
    }): SymbolVariable {
        return new SymbolVariable(
            args.identifierToken,
            args.scopePath,
            args.type,
            args.isInstanceMember,
            args.accessRestriction,
            args.linkedNode,
            args.isConst ?? false,
            args.isStatic ?? false,
        );
    }

    public get type(): ResolvedType | undefined { return this._type; }

    public assignType(t: ResolvedType | undefined): void {
        this._type = t;
    }

    public get identifierText(): string { return this.identifierToken.text; }

    public toHolder(): SymbolObjectHolder { return this; }

    public isFunctionHolder(): this is SymbolFunctionHolder { return false; }

    public toList(): SymbolVariable[] { return [this]; }
}

// ---- SymbolFunction & holder -------------------------------------------

export class SymbolFunction extends SymbolBase {
    public get kind(): SymbolKind { return SymbolKind.Function; }

    private _returnType: ResolvedType | undefined;
    private _parameterTypes: (ResolvedType | undefined)[] = [];
    private _templateTypes: TokenObject[] | undefined;

    constructor(
        public readonly identifierToken: TokenObject,
        public readonly scopePath: ScopePath,
        public readonly linkedNode: NodeFunction | NodeMethod | NodeConstructor | NodeDestructor | undefined,
        public readonly functionScopePath: ScopePath | undefined,
        returnType: ResolvedType | undefined,
        parameterTypes: (ResolvedType | undefined)[],
        public readonly isInstanceMember: boolean,
        public readonly accessRestriction: AccessModifier | undefined,
        public readonly isConstructor: boolean = false,
        public readonly isDestructor: boolean = false,
        public readonly isVariadic: boolean = false,
        public readonly isExtern: boolean = false,
    ) {
        super();
        this._returnType = returnType;
        this._parameterTypes = parameterTypes;
    }

    public static create(args: {
        identifierToken: TokenObject;
        scopePath: ScopePath;
        linkedNode: NodeFunction | NodeMethod | NodeConstructor | NodeDestructor | undefined;
        functionScopePath: ScopePath | undefined;
        returnType: ResolvedType | undefined;
        parameterTypes: (ResolvedType | undefined)[];
        isInstanceMember: boolean;
        accessRestriction: AccessModifier | undefined;
        isConstructor?: boolean;
        isDestructor?: boolean;
        isVariadic?: boolean;
        isExtern?: boolean;
    }): SymbolFunction {
        return new SymbolFunction(
            args.identifierToken,
            args.scopePath,
            args.linkedNode,
            args.functionScopePath,
            args.returnType,
            args.parameterTypes,
            args.isInstanceMember,
            args.accessRestriction,
            args.isConstructor ?? false,
            args.isDestructor ?? false,
            args.isVariadic ?? false,
            args.isExtern ?? false,
        );
    }

    public clone(opts?: { identifierToken?: TokenObject; accessRestriction?: AccessModifier }): SymbolFunction {
        const c: SymbolFunction = Object.assign(Object.create(Object.getPrototypeOf(this)), this);
        if (opts?.identifierToken) (c as { identifierToken: TokenObject }).identifierToken = opts.identifierToken;
        if (opts?.accessRestriction)
            (c as { accessRestriction: AccessModifier }).accessRestriction = opts.accessRestriction;
        return c;
    }

    public get returnType(): ResolvedType | undefined { return this._returnType; }

    public assignReturnType(t: ResolvedType | undefined): void {
        this._returnType = t;
    }

    public get parameterTypes(): ReadonlyArray<ResolvedType | undefined> {
        return this._parameterTypes;
    }

    public assignParameterTypes(types: (ResolvedType | undefined)[]): void {
        this._parameterTypes = types;
    }

    public get templateTypes(): TokenObject[] | undefined { return this._templateTypes; }

    public assignTemplateTypes(types: TokenObject[]): void {
        this._templateTypes = types;
    }

    public get identifierText(): string { return this.identifierToken.text; }

    public toHolder(): SymbolFunctionHolder {
        return new SymbolFunctionHolder(this);
    }
}

export class SymbolFunctionHolder {
    private readonly _overloadList: SymbolFunction[] = [];

    public constructor(first: SymbolFunction | SymbolFunction[]) {
        if (Array.isArray(first)) {
            this._overloadList = first.slice();
        } else {
            this._overloadList = [first];
        }
    }

    public pushOverload(f: SymbolFunction): void {
        this._overloadList.push(f);
    }

    public get overloadList(): ReadonlyArray<SymbolFunction> {
        return this._overloadList;
    }

    public get count(): number { return this._overloadList.length; }

    public get first(): SymbolFunction { return this._overloadList[0]; }

    public get identifierText(): string { return this.first.identifierText; }
    public get scopePath(): ScopePath { return this.first.scopePath; }

    public isType(): this is SymbolType { return false; }
    public isVariable(): this is SymbolVariable { return false; }
    public isFunctionHolder(): this is SymbolFunctionHolder { return true; }

    public toList(): ReadonlyArray<SymbolFunction> {
        return this._overloadList;
    }
}

// ---- Holder unions ------------------------------------------------------

export type SymbolObject = SymbolType | SymbolVariable | SymbolFunction;
export type SymbolObjectHolder = SymbolType | SymbolVariable | SymbolFunctionHolder;

export function isSymbolInstanceMember(symbol: SymbolObjectHolder): boolean {
    if (symbol instanceof SymbolFunctionHolder) return symbol.first.isInstanceMember;
    if (symbol instanceof SymbolVariable) return symbol.isInstanceMember;
    return false;
}

// ---- Enum-value sub-symbol --------------------------------------------

/** Convenience constructor for enum values — uses SymbolVariable. */
export function createEnumValueSymbol(args: {
    identifierToken: TokenIdentifier;
    scopePath: ScopePath;
    enumType: ResolvedType;
    valueNode: NodeEnumValue;
}): SymbolVariable {
    return SymbolVariable.create({
        identifierToken: args.identifierToken,
        scopePath: args.scopePath,
        type: args.enumType,
        isInstanceMember: false,
        accessRestriction: AccessModifier.Public,
        linkedNode: args.valueNode,
        isConst: true,
        isStatic: true,
    });
}
