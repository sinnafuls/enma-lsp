// AST node types for Enma parser. Discriminated union, Phase 3 / §A5.
// All nodes carry a TextRange (and ultimately a uri via the source).
// Tokens referenced by nodes are TokenObjects from the preprocessed stream.

import { TextRange } from '../compiler_tokenizer/textLocation';
import {
    TokenObject,
    TokenIdentifier,
    TokenReserved,
    TokenString,
    TokenNumber,
    TokenChar,
    TokenFStringText,
} from '../compiler_tokenizer/tokenObject';

// ---- Node kinds ----

export const enum NodeKind {
    // Root
    Script = 'Script',

    // Top-level
    Import = 'Import',
    Namespace = 'Namespace',
    Using = 'Using',
    Typedef = 'Typedef',
    Template = 'Template',
    Mixin = 'Mixin',
    Delegate = 'Delegate',
    Property = 'Property',
    OperatorOverload = 'OperatorOverload',
    Class = 'Class',
    Struct = 'Struct',
    Interface = 'Interface',
    Enum = 'Enum',
    EnumValue = 'EnumValue',
    Function = 'Function',
    Method = 'Method',
    Constructor = 'Constructor',
    Destructor = 'Destructor',
    Coroutine = 'Coroutine',
    Var = 'Var',
    Field = 'Field',
    Param = 'Param',
    TemplateParam = 'TemplateParam',
    Annotation = 'Annotation',
    Type = 'Type',

    // Statements
    StmtBlock = 'StmtBlock',
    StmtIf = 'StmtIf',
    StmtFor = 'StmtFor',
    StmtForeach = 'StmtForeach',
    StmtWhile = 'StmtWhile',
    StmtDoWhile = 'StmtDoWhile',
    StmtSwitch = 'StmtSwitch',
    StmtBreak = 'StmtBreak',
    StmtContinue = 'StmtContinue',
    StmtReturn = 'StmtReturn',
    StmtGoto = 'StmtGoto',
    StmtLabel = 'StmtLabel',
    StmtTry = 'StmtTry',
    StmtThrow = 'StmtThrow',
    StmtDefer = 'StmtDefer',
    StmtYield = 'StmtYield',
    StmtVar = 'StmtVar',
    StmtExpr = 'StmtExpr',
    StmtEmpty = 'StmtEmpty',

    // Match (expression — also usable as statement)
    ExprMatch = 'ExprMatch',
    MatchArm = 'MatchArm',

    // Expressions
    ExprBinary = 'ExprBinary',
    ExprUnary = 'ExprUnary',
    ExprPostfix = 'ExprPostfix',
    ExprTernary = 'ExprTernary',
    ExprAssign = 'ExprAssign',
    ExprCall = 'ExprCall',
    ExprMemberDot = 'ExprMemberDot',
    ExprMemberArrow = 'ExprMemberArrow',
    ExprNamespaceAccess = 'ExprNamespaceAccess',
    ExprIndex = 'ExprIndex',
    ExprCast = 'ExprCast',
    ExprNew = 'ExprNew',
    ExprDelete = 'ExprDelete',
    ExprSizeof = 'ExprSizeof',
    ExprOffsetof = 'ExprOffsetof',
    ExprStaticAssert = 'ExprStaticAssert',
    ExprFuncRef = 'ExprFuncRef',
    ExprIntrinsic = 'ExprIntrinsic',
    ExprIdentifier = 'ExprIdentifier',
    ExprThis = 'ExprThis',
    ExprParen = 'ExprParen',
    ExprLambdaBracket = 'ExprLambdaBracket',
    ExprLambdaArrow = 'ExprLambdaArrow',
    ExprDesignatedInit = 'ExprDesignatedInit',
    ExprArrayInit = 'ExprArrayInit',
    DesignatedInitField = 'DesignatedInitField',
    LambdaCapture = 'LambdaCapture',

    // Literals
    ExprLiteralInt = 'ExprLiteralInt',
    ExprLiteralFloat = 'ExprLiteralFloat',
    ExprLiteralString = 'ExprLiteralString',
    ExprLiteralChar = 'ExprLiteralChar',
    ExprLiteralBool = 'ExprLiteralBool',
    ExprLiteralNull = 'ExprLiteralNull',
    ExprLiteralUserDefined = 'ExprLiteralUserDefined',
    ExprFString = 'ExprFString',
}

// ---- Common base ----

export interface NodeBase {
    readonly kind: NodeKind;
    readonly range: TextRange;
}

// ---- Type / annotation / parameter shared ----

export interface NodeType extends NodeBase {
    readonly kind: NodeKind.Type;
    /** Qualified name path: e.g. ["geom", "Point"] for `geom::Point`, ["int32"] for primitive. */
    readonly path: ReadonlyArray<TokenIdentifier | TokenReserved>;
    /** Generic args, if any: e.g. `array<int32>` or `map<string, int64>`. */
    readonly generics: ReadonlyArray<NodeType>;
    /** Pointer level: `T*` is 1, `T**` is 2, `T` is 0. */
    readonly pointerLevel: number;
    /** Reference: `T&` */
    readonly isReference: boolean;
    /** const T */
    readonly isConst: boolean;
    /** nullable T */
    readonly isNullable: boolean;
    /** `decltype(expr)` form — when set, `path` holds a synthetic 'decltype' token. */
    readonly decltypeExpr?: NodeExpr;
}

export interface NodeAnnotation extends NodeBase {
    readonly kind: NodeKind.Annotation;
    readonly name: TokenIdentifier | TokenReserved;
    /** Args inside parentheses: `[[align(16)]]` → [LiteralInt 16]. Empty for argument-less. */
    readonly args: ReadonlyArray<NodeExpr>;
}

export interface NodeParam extends NodeBase {
    readonly kind: NodeKind.Param;
    readonly type: NodeType | null;        // null only for variadic `...`
    readonly name: TokenIdentifier | null; // null for unnamed / variadic-marker
    readonly isVariadic: boolean;
    readonly defaultValue: NodeExpr | null;
}

export interface NodeTemplateParam extends NodeBase {
    readonly kind: NodeKind.TemplateParam;
    /** `typename T` → 'typename', `T` → 'typename' (default), `int N` → typename token kept null and constraint=int */
    readonly keyword: TokenReserved | null;
    readonly name: TokenIdentifier;
    /** Optional default-arg type for template param. */
    readonly defaultType: NodeType | null;
}

// ---- Top-level ----

export interface NodeScript extends NodeBase {
    readonly kind: NodeKind.Script;
    readonly children: ReadonlyArray<NodeTopLevel>;
}

export type NodeTopLevel =
    | NodeImport
    | NodeNamespace
    | NodeUsing
    | NodeTypedef
    | NodeTemplate
    | NodeMixin
    | NodeDelegate
    | NodeProperty
    | NodeOperatorOverload
    | NodeClass
    | NodeStruct
    | NodeInterface
    | NodeEnum
    | NodeFunction
    | NodeCoroutine
    | NodeVar
    | NodeStmtExpr;            // permissive recovery — top-level stray expr stmt

export interface NodeImport extends NodeBase {
    readonly kind: NodeKind.Import;
    readonly path: TokenString;
    /** Optional `as <ID>` alias for namespace-style scoping at use sites. */
    readonly alias: TokenIdentifier | null;
}

export interface NodeUsing extends NodeBase {
    readonly kind: NodeKind.Using;
    /** `using namespace foo;` → isNamespace=true; `using T = X;` → isNamespace=false + alias */
    readonly isNamespace: boolean;
    readonly path: ReadonlyArray<TokenIdentifier | TokenReserved>;
    readonly alias: TokenIdentifier | null;
    readonly aliasTarget: NodeType | null;
}

export interface NodeNamespace extends NodeBase {
    readonly kind: NodeKind.Namespace;
    readonly name: TokenIdentifier;
    readonly children: ReadonlyArray<NodeTopLevel>;
}

export interface NodeTypedef extends NodeBase {
    readonly kind: NodeKind.Typedef;
    readonly underlying: NodeType;
    readonly name: TokenIdentifier;
}

export interface NodeTemplate extends NodeBase {
    readonly kind: NodeKind.Template;
    readonly params: ReadonlyArray<NodeTemplateParam>;
    /** Body is a single decl: function / class / struct / interface / using-alias. */
    readonly body: NodeTopLevel;
}

export interface NodeMixin extends NodeBase {
    readonly kind: NodeKind.Mixin;
    readonly name: TokenIdentifier;
    readonly bases: ReadonlyArray<NodeType>;
    readonly members: ReadonlyArray<NodeMember>;
}

export interface NodeDelegate extends NodeBase {
    readonly kind: NodeKind.Delegate;
    readonly returnType: NodeType;
    readonly name: TokenIdentifier;
    readonly params: ReadonlyArray<NodeParam>;
}

export interface NodeProperty extends NodeBase {
    readonly kind: NodeKind.Property;
    readonly type: NodeType;
    readonly name: TokenIdentifier;
    readonly getter: NodeStmtBlock | null;
    readonly setter: NodeStmtBlock | null;
}

export interface NodeOperatorOverload extends NodeBase {
    readonly kind: NodeKind.OperatorOverload;
    readonly returnType: NodeType;
    /** Operator token, e.g. '+' '==' '[]'. */
    readonly op: TokenObject;
    readonly params: ReadonlyArray<NodeParam>;
    readonly body: NodeStmtBlock;
    readonly annotations?: ReadonlyArray<NodeAnnotation>;
    readonly modifiers?: ReadonlyArray<TokenReserved>;
}

// ---- Class / Struct / Interface members ----

export type NodeMember =
    | NodeField
    | NodeMethod
    | NodeConstructor
    | NodeDestructor
    | NodeProperty
    | NodeOperatorOverload
    | NodeTypedef
    | NodeUsing
    | NodeEnum
    | NodeStruct
    | NodeClass
    | NodeInterface
    | NodeMixin
    | NodeDelegate
    | NodeTemplate;

export interface NodeClass extends NodeBase {
    readonly kind: NodeKind.Class;
    readonly name: TokenIdentifier;
    /** §A3: ordered base list. C3 linearization happens in analyzer. */
    readonly bases: ReadonlyArray<NodeType>;
    readonly annotations: ReadonlyArray<NodeAnnotation>;
    readonly members: ReadonlyArray<NodeMember>;
}

export interface NodeStruct extends NodeBase {
    readonly kind: NodeKind.Struct;
    readonly name: TokenIdentifier;
    readonly bases: ReadonlyArray<NodeType>;
    readonly annotations: ReadonlyArray<NodeAnnotation>;
    readonly members: ReadonlyArray<NodeMember>;
}

export interface NodeInterface extends NodeBase {
    readonly kind: NodeKind.Interface;
    readonly name: TokenIdentifier;
    readonly bases: ReadonlyArray<NodeType>;
    readonly annotations: ReadonlyArray<NodeAnnotation>;
    readonly members: ReadonlyArray<NodeMember>;
}

export interface NodeEnum extends NodeBase {
    readonly kind: NodeKind.Enum;
    readonly name: TokenIdentifier;
    /** Optional underlying type: `enum X : int32 { ... }` */
    readonly underlying: NodeType | null;
    readonly annotations: ReadonlyArray<NodeAnnotation>;
    readonly values: ReadonlyArray<NodeEnumValue>;
}

export interface NodeEnumValue extends NodeBase {
    readonly kind: NodeKind.EnumValue;
    readonly name: TokenIdentifier;
    readonly value: NodeExpr | null;
}

export interface NodeField extends NodeBase {
    readonly kind: NodeKind.Field;
    readonly type: NodeType;
    readonly name: TokenIdentifier;
    readonly initializer: NodeExpr | null;
    readonly annotations: ReadonlyArray<NodeAnnotation>;
    readonly modifiers: ReadonlyArray<TokenReserved>;
    /** Bitfield width: `uint32 ready : 1;` → bitWidth holds the `1` expression. */
    readonly bitWidth?: NodeExpr | null;
}

export interface NodeMethod extends NodeBase {
    readonly kind: NodeKind.Method;
    readonly returnType: NodeType;
    readonly name: TokenIdentifier;
    readonly params: ReadonlyArray<NodeParam>;
    readonly body: NodeStmtBlock | null; // null for interface methods
    readonly annotations: ReadonlyArray<NodeAnnotation>;
    readonly modifiers: ReadonlyArray<TokenReserved>;
    readonly templateParams: ReadonlyArray<NodeTemplateParam>;
}

export interface NodeConstructor extends NodeBase {
    readonly kind: NodeKind.Constructor;
    readonly name: TokenIdentifier;            // class name (sanity)
    readonly params: ReadonlyArray<NodeParam>;
    readonly body: NodeStmtBlock | null;       // null for declaration-only (predefined files)
    readonly annotations: ReadonlyArray<NodeAnnotation>;
    /** Constructor init list: `: Base(args), Other::Base(args)`. */
    readonly initList?: ReadonlyArray<{
        readonly base: ReadonlyArray<TokenIdentifier | TokenReserved>;
        readonly args: ReadonlyArray<NodeExpr>;
    }>;
}

export interface NodeDestructor extends NodeBase {
    readonly kind: NodeKind.Destructor;
    readonly name: TokenIdentifier;
    readonly body: NodeStmtBlock | null;       // null for declaration-only (predefined files)
    readonly annotations: ReadonlyArray<NodeAnnotation>;
}

// ---- Free function / coroutine / var ----

export interface NodeFunction extends NodeBase {
    readonly kind: NodeKind.Function;
    readonly returnType: NodeType;
    readonly name: TokenIdentifier;
    readonly params: ReadonlyArray<NodeParam>;
    readonly body: NodeStmtBlock | null;       // null for `extern` decls
    readonly annotations: ReadonlyArray<NodeAnnotation>;
    readonly modifiers: ReadonlyArray<TokenReserved>;
    readonly templateParams: ReadonlyArray<NodeTemplateParam>;
    readonly isExtern: boolean;
}

export interface NodeCoroutine extends NodeBase {
    readonly kind: NodeKind.Coroutine;
    readonly returnType: NodeType;
    readonly name: TokenIdentifier;
    readonly params: ReadonlyArray<NodeParam>;
    readonly body: NodeStmtBlock;
    readonly annotations: ReadonlyArray<NodeAnnotation>;
}

export interface NodeVar extends NodeBase {
    readonly kind: NodeKind.Var;
    readonly type: NodeType;
    readonly name: TokenIdentifier;
    readonly initializer: NodeExpr | null;
    readonly annotations: ReadonlyArray<NodeAnnotation>;
    readonly modifiers: ReadonlyArray<TokenReserved>;
}

// ---- Statements ----

export type NodeStmt =
    | NodeStmtBlock
    | NodeStmtIf
    | NodeStmtFor
    | NodeStmtForeach
    | NodeStmtWhile
    | NodeStmtDoWhile
    | NodeStmtSwitch
    | NodeStmtBreak
    | NodeStmtContinue
    | NodeStmtReturn
    | NodeStmtGoto
    | NodeStmtLabel
    | NodeStmtTry
    | NodeStmtThrow
    | NodeStmtDefer
    | NodeStmtYield
    | NodeStmtVar
    | NodeStmtExpr
    | NodeStmtEmpty;

export interface NodeStmtBlock extends NodeBase {
    readonly kind: NodeKind.StmtBlock;
    readonly stmts: ReadonlyArray<NodeStmt>;
}

export interface NodeStmtIf extends NodeBase {
    readonly kind: NodeKind.StmtIf;
    readonly condition: NodeExpr;
    readonly thenBranch: NodeStmt;
    readonly elseBranch: NodeStmt | null;
    /** C++17 if-init clause: `if (T x = expr; cond)`. */
    readonly init?: NodeStmtVar | NodeStmtExpr | null;
}

export interface NodeStmtFor extends NodeBase {
    readonly kind: NodeKind.StmtFor;
    /** Init: var-decl, expr, or null. */
    readonly init: NodeStmtVar | NodeStmtExpr | NodeStmtEmpty | null;
    readonly condition: NodeExpr | null;
    readonly update: NodeExpr | null;
    readonly body: NodeStmt;
}

export interface NodeStmtForeach extends NodeBase {
    readonly kind: NodeKind.StmtForeach;
    readonly elemType: NodeType;
    readonly elemName: TokenIdentifier;
    /** kv-foreach `for (T1 k, T2 v : iter)` carries the value here. */
    readonly valueType?: NodeType;
    readonly valueName?: TokenIdentifier;
    readonly iterable: NodeExpr;
    readonly body: NodeStmt;
}

export interface NodeStmtWhile extends NodeBase {
    readonly kind: NodeKind.StmtWhile;
    readonly condition: NodeExpr;
    readonly body: NodeStmt;
}

export interface NodeStmtDoWhile extends NodeBase {
    readonly kind: NodeKind.StmtDoWhile;
    readonly body: NodeStmt;
    readonly condition: NodeExpr;
}

export interface NodeStmtSwitch extends NodeBase {
    readonly kind: NodeKind.StmtSwitch;
    readonly subject: NodeExpr;
    readonly cases: ReadonlyArray<{
        readonly value: NodeExpr | null;       // null for `default`
        readonly stmts: ReadonlyArray<NodeStmt>;
    }>;
}

export interface NodeStmtBreak extends NodeBase {
    readonly kind: NodeKind.StmtBreak;
}

export interface NodeStmtContinue extends NodeBase {
    readonly kind: NodeKind.StmtContinue;
}

export interface NodeStmtReturn extends NodeBase {
    readonly kind: NodeKind.StmtReturn;
    readonly value: NodeExpr | null;
}

export interface NodeStmtGoto extends NodeBase {
    readonly kind: NodeKind.StmtGoto;
    readonly label: TokenIdentifier;
}

export interface NodeStmtLabel extends NodeBase {
    readonly kind: NodeKind.StmtLabel;
    readonly name: TokenIdentifier;
}

export interface NodeStmtTry extends NodeBase {
    readonly kind: NodeKind.StmtTry;
    readonly tryBlock: NodeStmtBlock;
    readonly catches: ReadonlyArray<{
        readonly excType: NodeType;
        readonly excName: TokenIdentifier | null;
        readonly body: NodeStmtBlock;
    }>;
    readonly finallyBlock: NodeStmtBlock | null;
}

export interface NodeStmtThrow extends NodeBase {
    readonly kind: NodeKind.StmtThrow;
    readonly value: NodeExpr | null;
}

export interface NodeStmtDefer extends NodeBase {
    readonly kind: NodeKind.StmtDefer;
    readonly body: NodeStmtBlock;
}

export interface NodeStmtYield extends NodeBase {
    readonly kind: NodeKind.StmtYield;
    readonly value: NodeExpr | null;
}

export interface NodeStmtVar extends NodeBase {
    readonly kind: NodeKind.StmtVar;
    readonly type: NodeType;
    readonly name: TokenIdentifier;
    readonly initializer: NodeExpr | null;
    readonly modifiers: ReadonlyArray<TokenReserved>;
}

export interface NodeStmtExpr extends NodeBase {
    readonly kind: NodeKind.StmtExpr;
    readonly expr: NodeExpr;
}

export interface NodeStmtEmpty extends NodeBase {
    readonly kind: NodeKind.StmtEmpty;
}

// ---- Expressions ----

export type NodeExpr =
    | NodeExprBinary
    | NodeExprUnary
    | NodeExprPostfix
    | NodeExprTernary
    | NodeExprAssign
    | NodeExprCall
    | NodeExprMemberDot
    | NodeExprMemberArrow
    | NodeExprNamespaceAccess
    | NodeExprIndex
    | NodeExprCast
    | NodeExprNew
    | NodeExprDelete
    | NodeExprSizeof
    | NodeExprOffsetof
    | NodeExprStaticAssert
    | NodeExprFuncRef
    | NodeExprIntrinsic
    | NodeExprIdentifier
    | NodeExprThis
    | NodeExprParen
    | NodeExprLambdaBracket
    | NodeExprLambdaArrow
    | NodeExprDesignatedInit
    | NodeExprArrayInit
    | NodeExprMatch
    | NodeExprLiteralInt
    | NodeExprLiteralFloat
    | NodeExprLiteralString
    | NodeExprLiteralChar
    | NodeExprLiteralBool
    | NodeExprLiteralNull
    | NodeExprLiteralUserDefined
    | NodeExprFString;

export interface NodeExprBinary extends NodeBase {
    readonly kind: NodeKind.ExprBinary;
    readonly left: NodeExpr;
    readonly op: TokenObject;
    readonly right: NodeExpr;
}

export interface NodeExprUnary extends NodeBase {
    readonly kind: NodeKind.ExprUnary;
    readonly op: TokenObject;
    readonly operand: NodeExpr;
}

export interface NodeExprPostfix extends NodeBase {
    readonly kind: NodeKind.ExprPostfix;
    readonly operand: NodeExpr;
    readonly op: TokenObject;
}

export interface NodeExprTernary extends NodeBase {
    readonly kind: NodeKind.ExprTernary;
    readonly condition: NodeExpr;
    readonly thenExpr: NodeExpr;
    readonly elseExpr: NodeExpr;
}

export interface NodeExprAssign extends NodeBase {
    readonly kind: NodeKind.ExprAssign;
    readonly target: NodeExpr;
    readonly op: TokenObject;                  // '=' / '+=' / '-=' / etc.
    readonly value: NodeExpr;
}

export interface NodeExprCall extends NodeBase {
    readonly kind: NodeKind.ExprCall;
    readonly callee: NodeExpr;
    /** Optional explicit template-arg list `f<int32>(...)`. */
    readonly templateArgs: ReadonlyArray<NodeType>;
    readonly args: ReadonlyArray<NodeExpr>;
}

export interface NodeExprMemberDot extends NodeBase {
    readonly kind: NodeKind.ExprMemberDot;
    readonly object: NodeExpr;
    readonly member: TokenIdentifier;
}

export interface NodeExprMemberArrow extends NodeBase {
    readonly kind: NodeKind.ExprMemberArrow;
    readonly object: NodeExpr;
    readonly member: TokenIdentifier;
}

export interface NodeExprNamespaceAccess extends NodeBase {
    readonly kind: NodeKind.ExprNamespaceAccess;
    readonly scope: NodeExpr;                  // identifier / nested ::
    readonly member: TokenIdentifier | TokenReserved;
}

export interface NodeExprIndex extends NodeBase {
    readonly kind: NodeKind.ExprIndex;
    readonly object: NodeExpr;
    readonly index: NodeExpr;
}

export interface NodeExprCast extends NodeBase {
    readonly kind: NodeKind.ExprCast;
    /** 'cast' | 'static_cast' | 'reinterpret_cast' | 'const_cast' */
    readonly castKind: string;
    readonly targetType: NodeType;
    readonly value: NodeExpr;
}

export interface NodeExprNew extends NodeBase {
    readonly kind: NodeKind.ExprNew;
    readonly type: NodeType;
    readonly args: ReadonlyArray<NodeExpr>;
    /** new T[N] form */
    readonly arraySize: NodeExpr | null;
}

export interface NodeExprDelete extends NodeBase {
    readonly kind: NodeKind.ExprDelete;
    readonly target: NodeExpr;
    readonly isArray: boolean;
}

export interface NodeExprSizeof extends NodeBase {
    readonly kind: NodeKind.ExprSizeof;
    /** Either a type or an expression. */
    readonly target: NodeType | NodeExpr;
    readonly isType: boolean;
}

export interface NodeExprOffsetof extends NodeBase {
    readonly kind: NodeKind.ExprOffsetof;
    readonly type: NodeType;
    readonly memberPath: ReadonlyArray<TokenIdentifier>;
}

export interface NodeExprStaticAssert extends NodeBase {
    readonly kind: NodeKind.ExprStaticAssert;
    readonly condition: NodeExpr;
    readonly message: NodeExpr | null;
}

export interface NodeExprFuncRef extends NodeBase {
    readonly kind: NodeKind.ExprFuncRef;
    /** `@name` — the qualified name path. */
    readonly path: ReadonlyArray<TokenIdentifier | TokenReserved>;
}

export interface NodeExprIntrinsic extends NodeBase {
    readonly kind: NodeKind.ExprIntrinsic;
    readonly name: TokenIdentifier | TokenReserved;
    /** Some intrinsics have args (e.g. `__va_arg(i)`); some don't (`__va_count`). */
    readonly args: ReadonlyArray<NodeExpr>;
    readonly hasParens: boolean;
}

export interface NodeExprIdentifier extends NodeBase {
    readonly kind: NodeKind.ExprIdentifier;
    readonly token: TokenIdentifier | TokenReserved;
}

export interface NodeExprThis extends NodeBase {
    readonly kind: NodeKind.ExprThis;
    readonly token: TokenReserved;
}

export interface NodeExprParen extends NodeBase {
    readonly kind: NodeKind.ExprParen;
    readonly inner: NodeExpr;
}

// Lambdas
export interface NodeLambdaCapture extends NodeBase {
    readonly kind: NodeKind.LambdaCapture;
    readonly byReference: boolean;
    readonly name: TokenIdentifier | null;     // null for `[=]` / `[&]` defaults
    readonly isDefault: boolean;
}

export interface NodeExprLambdaBracket extends NodeBase {
    readonly kind: NodeKind.ExprLambdaBracket;
    readonly captures: ReadonlyArray<NodeLambdaCapture>;
    readonly params: ReadonlyArray<NodeParam>;
    readonly returnType: NodeType | null;
    readonly body: NodeStmtBlock;
}

export interface NodeExprLambdaArrow extends NodeBase {
    readonly kind: NodeKind.ExprLambdaArrow;
    readonly params: ReadonlyArray<NodeParam>;
    /** Either a single expression or a block body. */
    readonly body: NodeExpr | NodeStmtBlock;
}

export interface NodeDesignatedInitField extends NodeBase {
    readonly kind: NodeKind.DesignatedInitField;
    readonly name: TokenIdentifier;
    readonly value: NodeExpr;
}

export interface NodeExprDesignatedInit extends NodeBase {
    readonly kind: NodeKind.ExprDesignatedInit;
    /** Optional preceding type name: `Point { .x = 1 }`. May be null for context-typed `{ .x = 1 }`. */
    readonly typeName: NodeType | null;
    readonly fields: ReadonlyArray<NodeDesignatedInitField>;
}

export interface NodeExprArrayInit extends NodeBase {
    readonly kind: NodeKind.ExprArrayInit;
    readonly elements: ReadonlyArray<NodeExpr>;
}

// Match (expression form — Enma-specific)
export interface NodeMatchArm extends NodeBase {
    readonly kind: NodeKind.MatchArm;
    /** The pattern: literal, identifier, or `_`. Stored as expression. */
    readonly pattern: NodeExpr;
    readonly body: NodeExpr;
    /** True if the pattern is the `_` wildcard. */
    readonly isWildcard: boolean;
}

export interface NodeExprMatch extends NodeBase {
    readonly kind: NodeKind.ExprMatch;
    readonly subject: NodeExpr;
    readonly arms: ReadonlyArray<NodeMatchArm>;
}

// Literals
export interface NodeExprLiteralInt extends NodeBase {
    readonly kind: NodeKind.ExprLiteralInt;
    readonly token: TokenNumber;
}

export interface NodeExprLiteralFloat extends NodeBase {
    readonly kind: NodeKind.ExprLiteralFloat;
    readonly token: TokenNumber;
}

export interface NodeExprLiteralString extends NodeBase {
    readonly kind: NodeKind.ExprLiteralString;
    readonly token: TokenString;
}

export interface NodeExprLiteralChar extends NodeBase {
    readonly kind: NodeKind.ExprLiteralChar;
    readonly token: TokenChar;
}

export interface NodeExprLiteralBool extends NodeBase {
    readonly kind: NodeKind.ExprLiteralBool;
    readonly token: TokenReserved;
    readonly value: boolean;
}

export interface NodeExprLiteralNull extends NodeBase {
    readonly kind: NodeKind.ExprLiteralNull;
    readonly token: TokenReserved;
}

export interface NodeExprLiteralUserDefined extends NodeBase {
    readonly kind: NodeKind.ExprLiteralUserDefined;
    readonly number: TokenNumber;
    /** Suffix identifier; e.g. for `42_km` the suffix is `_km`. */
    readonly suffix: TokenIdentifier;
}

/** F-string: the parts list interleaves raw text segments with interpolated expressions. */
export type NodeFStringPart =
    | { readonly kind: 'text'; readonly token: TokenFStringText }
    | { readonly kind: 'expr'; readonly expr: NodeExpr; readonly openRange: TextRange; readonly closeRange: TextRange };

export interface NodeExprFString extends NodeBase {
    readonly kind: NodeKind.ExprFString;
    readonly parts: ReadonlyArray<NodeFStringPart>;
}

// ---- Convenience union of every Node ----

export type AnyNode =
    | NodeScript
    | NodeTopLevel
    | NodeMember
    | NodeStmt
    | NodeExpr
    | NodeType
    | NodeAnnotation
    | NodeParam
    | NodeTemplateParam
    | NodeEnumValue
    | NodeMatchArm
    | NodeDesignatedInitField
    | NodeLambdaCapture;
