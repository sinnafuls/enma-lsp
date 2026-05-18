// Hand-written recursive-descent parser for Enma.
// Input: PreprocessedOutput.preprocessedTokens (post-expansion, conditionals resolved, comments stripped).
// Output: { ast: NodeScript, diagnostics: Diagnostic[] } with partial AST and Continue-on-error recovery.
//
// Grammar source of truth: docs/parser-bnf.txt
// Reference shape ported from angel-lsp parser.ts (recursive-descent harness only;
// Enma-specific productions rebuilt from scratch).
//
// §A1 incremental strategy is exposed via parserCache.ts — this file accepts an optional
// cache to reuse top-level subtrees keyed by FNV-1a hash of the decl's token-text.
//
// §A3 multi-inheritance: bases captured in order on Class/Struct/Interface; analyzer (Phase 4)
// computes C3 linearization.

import { TextRange } from '../compiler_tokenizer/textLocation';
import {
    TokenObject,
    TokenKind,
    TokenIdentifier,
    TokenReserved,
    TokenString,
    TokenNumber,
    TokenChar,
    TokenFStringText,
} from '../compiler_tokenizer/tokenObject';
import { isPrimitive } from '../compiler_tokenizer/reservedWord';
import { Diagnostic, PreprocessedOutput } from './parserPreprocess';
import { ParserState, ParseRecoveryError } from './parserState';
import {
    NodeKind,
    NodeScript,
    NodeTopLevel,
    NodeImport,
    NodeNamespace,
    NodeUsing,
    NodeTypedef,
    NodeTemplate,
    NodeMixin,
    NodeDelegate,
    NodeProperty,
    NodeOperatorOverload,
    NodeClass,
    NodeStruct,
    NodeInterface,
    NodeEnum,
    NodeEnumValue,
    NodeFunction,
    NodeMethod,
    NodeConstructor,
    NodeDestructor,
    NodeCoroutine,
    NodeVar,
    NodeField,
    NodeParam,
    NodeTemplateParam,
    NodeMember,
    NodeAnnotation,
    NodeType,
    NodeStmt,
    NodeStmtBlock,
    NodeStmtIf,
    NodeStmtFor,
    NodeStmtForeach,
    NodeStmtWhile,
    NodeStmtDoWhile,
    NodeStmtSwitch,
    NodeStmtTry,
    NodeStmtThrow,
    NodeStmtDefer,
    NodeStmtYield,
    NodeStmtVar,
    NodeStmtExpr,
    NodeStmtEmpty,
    NodeStmtReturn,
    NodeStmtBreak,
    NodeStmtContinue,
    NodeStmtGoto,
    NodeStmtLabel,
    NodeExpr,
    NodeExprBinary,
    NodeExprUnary,
    NodeExprPostfix,
    NodeExprTernary,
    NodeExprAssign,
    NodeExprCall,
    NodeExprMemberDot,
    NodeExprMemberArrow,
    NodeExprNamespaceAccess,
    NodeExprIndex,
    NodeExprCast,
    NodeExprNew,
    NodeExprDelete,
    NodeExprSizeof,
    NodeExprOffsetof,
    NodeExprStaticAssert,
    NodeExprFuncRef,
    NodeExprIntrinsic,
    NodeExprIdentifier,
    NodeExprThis,
    NodeExprParen,
    NodeExprLambdaBracket,
    NodeExprLambdaArrow,
    NodeExprDesignatedInit,
    NodeExprArrayInit,
    NodeExprMatch,
    NodeMatchArm,
    NodeExprLiteralInt,
    NodeExprLiteralFloat,
    NodeExprLiteralString,
    NodeExprLiteralChar,
    NodeExprLiteralBool,
    NodeExprLiteralNull,
    NodeExprLiteralUserDefined,
    NodeExprFString,
    NodeFStringPart,
    NodeLambdaCapture,
    NodeDesignatedInitField,
} from './nodes';
import {
    ParserCache,
    findTopLevelBoundaries,
    hashTokenRange,
} from './parserCache';

export interface ParseResult {
    readonly ast: NodeScript;
    readonly diagnostics: Diagnostic[];
}

export interface ParseOptions {
    readonly fileUri?: string;
    readonly cache?: ParserCache;
}

// ---- Public entry ----

export function parseAfterPreprocessed(
    preprocessed: PreprocessedOutput,
    options: ParseOptions = {},
): ParseResult {
    const tokens = preprocessed.preprocessedTokens;
    const fileUri = options.fileUri ?? deriveUriFromTokens(tokens);
    const cache = options.cache;

    // Pre-pass: locate top-level boundaries for §A1 cache reuse.
    const boundaries = findTopLevelBoundaries(tokens);
    const cachedNodes = new Map<number, NodeTopLevel>();   // boundary-index → cached node
    if (cache) {
        boundaries.forEach((b, idx) => {
            const [start, end] = b;
            const h = hashTokenRange(tokens, start, end);
            const hit = cache.get(fileUri, h);
            if (hit) cachedNodes.set(idx, hit.node);
        });
    }

    const state = new ParserState(tokens, fileUri);
    const parser = new Parser(state, preprocessed);
    const script = parser.parseScript();

    // Update cache with newly produced top-level nodes (best-effort: re-hash boundaries
    // and store the corresponding parsed children where index alignment holds).
    if (cache) {
        const fresh: Array<{ hash: number; node: NodeTopLevel; tokenStart: number; tokenEnd: number }> = [];
        for (let i = 0; i < boundaries.length && i < script.children.length; i++) {
            const [start, end] = boundaries[i];
            fresh.push({
                hash: hashTokenRange(tokens, start, end),
                node: script.children[i],
                tokenStart: start,
                tokenEnd: end,
            });
        }
        cache.replaceFile(fileUri, fresh);
    }

    return {
        ast: script,
        diagnostics: [...preprocessed.diagnostics, ...state.diagnostics],
    };
}

function deriveUriFromTokens(tokens: ReadonlyArray<TokenObject>): string {
    return tokens.find(t => t.location?.uri)?.location.uri ?? 'file:///unknown';
}

// ---- Parser body ----

const ASSIGN_OPS = new Set(['=', '+=', '-=', '*=', '/=', '%=', '<<=', '>>=', '&=', '|=', '^=']);

const MODIFIERS = new Set([
    'static', 'const', 'constexpr', 'inline', 'override',
    'public', 'private', 'volatile',
    'virtual', 'final', 'friend',
]);

const TYPE_PREFIX_KW = new Set(['const', 'nullable']);

const CAST_KEYWORDS = new Set(['cast', 'static_cast', 'reinterpret_cast', 'const_cast']);

const INTRINSIC_NAMES = new Set([
    '__va_count', '__va_arg',
    '__asm_rdtsc', '__asm_pause', '__asm_mfence', '__asm_nop',
]);

// Reserved words that may appear as plain identifiers in expression / declarator
// position (contextual keywords). Conservative list. Used as a relaxation for the
// parser when the surrounding grammar is unambiguous.
const CONTEXTUAL_AS_IDENT = new Set([
    'get', 'set',
    // `out` is a parameter modifier (per Enma docs), but appears as a normal
    // identifier in declaration / variable / expression / return positions.
    // Treat it contextually like get/set: accept as an identifier outside the
    // parameter-modifier slot.
    'out',
]);

class Parser {
    private currentClassName: string | null = null;          // for ctor/dtor recognition
    constructor(
        private readonly s: ParserState,
        private readonly pre: PreprocessedOutput,
    ) {
        void this.pre;
    }

    // BNF: Script ::= { TopLevel }
    parseScript(): NodeScript {
        const startTok = this.s.peek();
        const children: NodeTopLevel[] = [];
        while (!this.s.isEOF) {
            const before = this.s.pos;
            try {
                const decl = this.parseTopLevel();
                if (decl) children.push(decl);
                // If null, the failing parser already called panicRecover internally.
            } catch (e) {
                if (e instanceof ParseRecoveryError) {
                    this.s.panicRecover();
                } else {
                    throw e;
                }
            }
            // Guard against infinite loop on stuck tokens.
            if (this.s.pos === before) this.s.advance();
        }
        const range: TextRange = startTok
            ? { start: startTok.location.start, end: this.s.prev()?.location.end ?? startTok.location.end }
            : { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
        return { kind: NodeKind.Script, range, children };
    }

    // BNF: TopLevel ::= Annotations TopLevelInner
    private parseTopLevel(): NodeTopLevel | null {
        const annotations = this.parseAnnotations();

        const t = this.s.peek();
        if (!t) return null;

        // import "..."
        if (this.isReserved(t, 'import')) return this.parseImport();
        if (this.isReserved(t, 'namespace')) return this.parseNamespace();
        if (this.isReserved(t, 'using')) return this.parseUsing();
        if (this.isReserved(t, 'typedef')) return this.parseTypedef();
        if (this.isReserved(t, 'template')) return this.parseTemplate();
        if (this.isReserved(t, 'mixin')) return this.parseMixin(annotations);
        if (this.isReserved(t, 'delegate')) return this.parseDelegate();
        if (this.isReserved(t, 'class')) return this.parseClass(annotations);
        if (this.isReserved(t, 'struct')) return this.parseStruct(annotations);
        if (this.isReserved(t, 'interface')) return this.parseInterface(annotations);
        if (this.isReserved(t, 'enum')) return this.parseEnum(annotations);
        if (this.isReserved(t, 'extern')) return this.parseExternDecl(annotations);
        if (this.isReserved(t, 'coroutine')) return this.parseCoroutine(annotations);
        // Module-scope `static_assert(...);`. NodeTopLevel has no wrapper for free
        // expressions, so we parse and drop — error-free is enough for the LSP.
        if (this.isReserved(t, 'static_assert')) {
            this.parseStaticAssert();
            this.s.expectPunct(';', `expected ';' after module-scope static_assert`);
            return null;
        }

        // Otherwise: function or variable declaration.
        return this.parseFunctionOrVar(annotations);
    }

    // BNF: Annotations ::= { Annotation }
    private parseAnnotations(): NodeAnnotation[] {
        const result: NodeAnnotation[] = [];
        while (this.s.check(TokenKind.AnnotationOpen)) {
            const ann = this.parseAnnotation();
            if (ann) result.push(ann);
        }
        return result;
    }

    // BNF: Annotation ::= '[[' <ID-or-KW> [ '(' [ ExprList ] ')' ] ']]'
    private parseAnnotation(): NodeAnnotation | null {
        const open = this.s.advance(); // '[['
        if (!open) return null;
        const nameTok = this.s.peek();
        if (!nameTok || (nameTok.kind !== TokenKind.Identifier && nameTok.kind !== TokenKind.Reserved)) {
            this.s.error('expected annotation name', nameTok?.location ?? open.location);
            this.s.skipUntilBalancedClose(']]');
            return null;
        }
        this.s.advance();
        const args: NodeExpr[] = [];
        if (this.s.matchPunct('(')) {
            if (!this.s.check(TokenKind.Punctuation, ')')) {
                this.parseExprListInto(args);
            }
            this.s.expectPunct(')', `expected ')' after annotation args`);
        }
        const close = this.s.expect(TokenKind.AnnotationClose, undefined, `expected ']]' after annotation`);
        const range: TextRange = {
            start: open.location.start,
            end: (close ?? this.s.prev() ?? open).location.end,
        };
        return {
            kind: NodeKind.Annotation,
            range,
            name: nameTok as TokenIdentifier | TokenReserved,
            args,
        };
    }

    // BNF: Import ::= 'import' STRING [ 'as' <ID> ] ';'
    private parseImport(): NodeImport | null {
        const kw = this.s.advance()!; // 'import'
        const pathTok = this.s.peek();
        if (!pathTok || pathTok.kind !== TokenKind.String) {
            this.s.error(`expected string literal after 'import'`, pathTok?.location ?? kw.location);
            this.s.panicRecover();
            return null;
        }
        this.s.advance();
        // Optional `as <ID>` alias clause (e.g. `import "foo.em" as foo;`).
        // `as` is a contextual identifier, not a reserved word.
        let alias: TokenIdentifier | null = null;
        const asTok = this.s.peek();
        if (asTok && asTok.kind === TokenKind.Identifier && asTok.text === 'as') {
            this.s.advance();
            const aliasTok = this.s.expectIdentifier(`expected alias name after 'as'`);
            if (aliasTok) alias = aliasTok as TokenIdentifier;
        }
        this.s.expectPunct(';', `expected ';' after import path`);
        return {
            kind: NodeKind.Import,
            range: this.s.rangeFromTokens(kw),
            path: pathTok as TokenString,
            alias,
        };
    }

    // BNF: Namespace ::= 'namespace' <ID> '{' { TopLevel } '}'
    private parseNamespace(): NodeNamespace | null {
        const kw = this.s.advance()!;
        const name = this.s.expectIdentifier(`expected namespace name`);
        if (!name) { this.s.panicRecover(); return null; }
        this.s.expectPunct('{', `expected '{' after namespace name`);
        const children: NodeTopLevel[] = [];
        while (!this.s.isEOF && !this.s.check(TokenKind.Punctuation, '}')) {
            const before = this.s.pos;
            try {
                const c = this.parseTopLevel();
                if (c) children.push(c);
                // If null, the failing parser already called panicRecover internally.
            } catch (e) {
                if (e instanceof ParseRecoveryError) this.s.panicRecover(); else throw e;
            }
            if (this.s.pos === before) this.s.advance();
        }
        this.s.expectPunct('}', `expected '}' to close namespace`);
        return {
            kind: NodeKind.Namespace,
            range: this.s.rangeFromTokens(kw),
            name: name as TokenIdentifier,
            children,
        };
    }

    // BNF: Using ::= 'using' 'namespace' QualifiedName ';' | 'using' <ID> '=' Type ';'
    private parseUsing(): NodeUsing | null {
        const kw = this.s.advance()!;
        if (this.s.matchReserved('namespace')) {
            const path = this.parseQualifiedName();
            this.s.expectPunct(';', `expected ';' after using-namespace`);
            return {
                kind: NodeKind.Using,
                range: this.s.rangeFromTokens(kw),
                isNamespace: true,
                path,
                alias: null,
                aliasTarget: null,
            };
        }
        const aliasTok = this.s.expectIdentifier(`expected identifier after 'using'`);
        if (!aliasTok) { this.s.panicRecover(); return null; }
        this.s.expectOp('=', `expected '=' in using alias`);
        const target = this.parseType();
        this.s.expectPunct(';', `expected ';' after using alias`);
        return {
            kind: NodeKind.Using,
            range: this.s.rangeFromTokens(kw),
            isNamespace: false,
            path: [],
            alias: aliasTok as TokenIdentifier,
            aliasTarget: target,
        };
    }

    // BNF: Typedef ::= 'typedef' Type <ID> ';'
    private parseTypedef(): NodeTypedef | null {
        const kw = this.s.advance()!;
        const underlying = this.parseType();
        const name = this.s.expectIdentifier(`expected typedef name`);
        if (!name) { this.s.panicRecover(); return null; }
        this.s.expectPunct(';', `expected ';' after typedef`);
        return {
            kind: NodeKind.Typedef,
            range: this.s.rangeFromTokens(kw),
            underlying,
            name: name as TokenIdentifier,
        };
    }

    // BNF: Template ::= 'template' '<' TemplateParamList '>' TopLevelInner
    private parseTemplate(): NodeTemplate | null {
        const kw = this.s.advance()!;
        if (!this.s.matchOp('<')) {
            this.s.error(`expected '<' after 'template'`, this.s.peek()?.location ?? kw.location);
            this.s.panicRecover();
            return null;
        }
        const params = this.parseTemplateParamList();
        if (!this.s.matchOp('>')) {
            this.s.error(`expected '>' after template params`, this.s.peek()?.location ?? kw.location);
        }
        const annotations = this.parseAnnotations();
        const body = this.parseTopLevelInnerForTemplate(annotations);
        if (!body) return null;
        return {
            kind: NodeKind.Template,
            range: this.s.rangeFromTokens(kw),
            params,
            body,
        };
    }

    private parseTopLevelInnerForTemplate(annotations: NodeAnnotation[]): NodeTopLevel | null {
        const t = this.s.peek();
        if (!t) return null;
        if (this.isReserved(t, 'class')) return this.parseClass(annotations);
        if (this.isReserved(t, 'struct')) return this.parseStruct(annotations);
        if (this.isReserved(t, 'interface')) return this.parseInterface(annotations);
        // function template.
        return this.parseFunctionOrVar(annotations);
    }

    private parseTemplateParamList(): NodeTemplateParam[] {
        const params: NodeTemplateParam[] = [];
        if (this.s.checkText('>')) return params;
        do {
            const startTok = this.s.peek();
            if (!startTok) break;
            let keyword: TokenReserved | null = null;
            if (this.s.check(TokenKind.Reserved, 'typename')) {
                keyword = this.s.advance() as TokenReserved;
            }
            const nameTok = this.s.expectIdentifier(`expected template parameter name`);
            if (!nameTok) break;
            let defaultType: NodeType | null = null;
            if (this.s.matchOp('=')) {
                defaultType = this.parseType();
            }
            const range: TextRange = {
                start: startTok.location.start,
                end: this.s.prev()?.location.end ?? startTok.location.end,
            };
            params.push({
                kind: NodeKind.TemplateParam,
                range,
                keyword,
                name: nameTok as TokenIdentifier,
                defaultType,
            });
        } while (this.s.matchOp(','));
        return params;
    }

    // BNF: Mixin ::= 'mixin' <ID> [ ':' BaseList ] '{' { Member } '}'
    //             |  'mixin' Type QualifiedName '(' Params ')' Block       // method-form
    private parseMixin(_annotations: NodeAnnotation[]): NodeMixin | null {
        void _annotations;
        const kw = this.s.advance()!;
        if (this.looksLikeMethodMixin()) {
            return this.parseMethodMixin(kw);
        }
        const name = this.s.expectIdentifier(`expected mixin name`);
        if (!name) { this.s.panicRecover(); return null; }
        const bases = this.s.matchOp(':') ? this.parseBaseList() : [];
        this.s.expectPunct('{', `expected '{' after mixin name`);
        const members = this.parseMemberList(name.text);
        this.s.expectPunct('}', `expected '}' to close mixin`);
        return {
            kind: NodeKind.Mixin,
            range: this.s.rangeFromTokens(kw),
            name: name as TokenIdentifier,
            bases,
            members,
        };
    }

    /** True when the upcoming tokens look like `Type Owner::name(...)` (method-form mixin). */
    private looksLikeMethodMixin(): boolean {
        let depth = 0;
        for (let i = 0; i < 256; i++) {
            const t = this.s.peek(i);
            if (!t) return false;
            if (t.kind === TokenKind.Punctuation) {
                if (t.text === '(' || t.text === '[' || t.text === '{') {
                    if (depth === 0 && (t.text === '{' || t.text === '(')) return false;
                    depth++;
                } else if (t.text === ')' || t.text === ']' || t.text === '}') {
                    if (depth === 0) return false;
                    depth--;
                } else if (t.text === ';' && depth === 0) {
                    return false;
                }
            }
            if (t.kind === TokenKind.Operator) {
                if (t.text === '<') depth++;
                else if (t.text === '>') { if (depth > 0) depth--; }
                else if (t.text === '>>') { depth = Math.max(0, depth - 2); }
                else if (t.text === '::' && depth === 0) {
                    return true;
                }
            }
        }
        return false;
    }

    private parseMethodMixin(kw: TokenObject): NodeMixin | null {
        const returnType = this.parseType();
        const path = this.parseQualifiedName();
        if (path.length < 2) {
            this.s.error(`expected qualified method name in mixin`, this.s.peek()?.location ?? kw.location);
            this.s.panicRecover();
            return null;
        }
        const ownerTokens = path.slice(0, -1);
        const methodNameTok = path[path.length - 1];
        const ownerName = ownerTokens[ownerTokens.length - 1];
        this.s.expectPunct('(', `expected '(' in mixin method`);
        const params = this.parseParamList();
        this.s.expectPunct(')', `expected ')' in mixin method params`);
        const body = this.parseBlock();
        const ownerType: NodeType = {
            kind: NodeKind.Type,
            range: { start: ownerTokens[0].location.start, end: ownerTokens[ownerTokens.length - 1].location.end },
            path: ownerTokens,
            generics: [],
            pointerLevel: 0,
            isReference: false,
            isConst: false,
            isNullable: false,
        };
        const method: NodeMethod = {
            kind: NodeKind.Method,
            range: { start: returnType.range.start, end: body.range.end },
            returnType,
            name: methodNameTok as TokenIdentifier,
            params,
            body,
            annotations: [],
            modifiers: [],
            templateParams: [],
        };
        return {
            kind: NodeKind.Mixin,
            range: this.s.rangeFromTokens(kw),
            name: ownerName as TokenIdentifier,
            bases: [ownerType],
            members: [method],
        };
    }

    // BNF: Delegate ::= 'delegate' Type <ID> '(' [ ParamList ] ')' ';'
    private parseDelegate(): NodeDelegate | null {
        const kw = this.s.advance()!;
        const returnType = this.parseType();
        const name = this.s.expectIdentifier(`expected delegate name`);
        if (!name) { this.s.panicRecover(); return null; }
        this.s.expectPunct('(', `expected '(' after delegate name`);
        const params = this.parseParamList();
        this.s.expectPunct(')', `expected ')' after delegate params`);
        this.s.expectPunct(';', `expected ';' after delegate`);
        return {
            kind: NodeKind.Delegate,
            range: this.s.rangeFromTokens(kw),
            returnType,
            name: name as TokenIdentifier,
            params,
        };
    }

    // BNF: Class / Struct / Interface (all share shape; differ only in keyword)
    private parseClass(annotations: NodeAnnotation[]): NodeClass | null {
        return this.parseClassLikeAs(NodeKind.Class, annotations) as NodeClass | null;
    }
    private parseStruct(annotations: NodeAnnotation[]): NodeStruct | null {
        return this.parseClassLikeAs(NodeKind.Struct, annotations) as NodeStruct | null;
    }
    private parseInterface(annotations: NodeAnnotation[]): NodeInterface | null {
        return this.parseClassLikeAs(NodeKind.Interface, annotations) as NodeInterface | null;
    }
    private parseClassLikeAs(
        kind: NodeKind.Class | NodeKind.Struct | NodeKind.Interface,
        annotations: NodeAnnotation[],
    ): NodeClass | NodeStruct | NodeInterface | null {
        const kw = this.s.advance()!;
        const name = this.s.expectIdentifier(`expected ${kind} name`);
        if (!name) { this.s.panicRecover(); return null; }
        // Optional `final` after class/struct name (vestigial — Enma has no sealed classes).
        this.s.matchReserved('final');
        const bases = this.s.matchOp(':') ? this.parseBaseList() : [];
        this.s.expectPunct('{', `expected '{' after ${kind} name`);
        const prevClass = this.currentClassName;
        this.currentClassName = name.text;
        const members = this.parseMemberList(name.text);
        this.currentClassName = prevClass;
        this.s.expectPunct('}', `expected '}' to close ${kind}`);
        const range = this.s.rangeFromTokens(kw);
        // Build the proper variant — readonly arrays so declaration form is consistent.
        if (kind === NodeKind.Class) {
            return {
                kind: NodeKind.Class,
                range,
                name: name as TokenIdentifier,
                bases,
                annotations,
                members,
            };
        }
        if (kind === NodeKind.Struct) {
            return {
                kind: NodeKind.Struct,
                range,
                name: name as TokenIdentifier,
                bases,
                annotations,
                members,
            };
        }
        return {
            kind: NodeKind.Interface,
            range,
            name: name as TokenIdentifier,
            bases,
            annotations,
            members,
        };
    }

    private parseBaseList(): NodeType[] {
        const bases: NodeType[] = [];
        do {
            // Each base is just a Type. (No access modifiers in Enma per §A3.)
            // However we want to stop at `{` even on parse error; parseType handles common case.
            if (this.s.check(TokenKind.Punctuation, '{')) break;
            bases.push(this.parseType());
        } while (this.s.matchOp(','));
        return bases;
    }

    // BNF: Enum ::= 'enum' [ 'class' | 'struct' ] <ID> [ ':' Type ] '{' EnumValueList [ ',' ] '}'
    private parseEnum(annotations: NodeAnnotation[]): NodeEnum | null {
        const kw = this.s.advance()!;
        // Optional C++-style scoped-enum keyword: `enum class Name` / `enum struct Name`.
        this.s.matchReserved('class') || this.s.matchReserved('struct');
        const name = this.s.expectIdentifier(`expected enum name`);
        if (!name) { this.s.panicRecover(); return null; }
        let underlying: NodeType | null = null;
        if (this.s.matchOp(':')) underlying = this.parseType();
        this.s.expectPunct('{', `expected '{' after enum name`);
        const values: NodeEnumValue[] = [];
        while (!this.s.isEOF && !this.s.check(TokenKind.Punctuation, '}')) {
            const valStart = this.s.peek();
            if (!valStart) break;
            const vname = this.s.expectIdentifier(`expected enum value name`);
            if (!vname) { if (!this.advanceUntilCommaOrBrace()) break; continue; }
            let value: NodeExpr | null = null;
            if (this.s.matchOp('=')) value = this.parseExpr();
            const range: TextRange = {
                start: valStart.location.start,
                end: this.s.prev()?.location.end ?? valStart.location.end,
            };
            values.push({
                kind: NodeKind.EnumValue,
                range,
                name: vname as TokenIdentifier,
                value,
            });
            if (!this.s.matchOp(',')) break;
        }
        this.s.expectPunct('}', `expected '}' to close enum`);
        return {
            kind: NodeKind.Enum,
            range: this.s.rangeFromTokens(kw),
            name: name as TokenIdentifier,
            underlying,
            annotations,
            values,
        };
    }

    private advanceUntilCommaOrBrace(): boolean {
        while (!this.s.isEOF) {
            const t = this.s.peek()!;
            if (t.kind === TokenKind.Operator && t.text === ',') { this.s.advance(); return true; }
            if (t.kind === TokenKind.Punctuation && t.text === '}') return true;
            this.s.advance();
        }
        return false;
    }

    // BNF: ExternDecl ::= 'extern' Type <ID> '(' [ ParamList ] ')' ';'
    private parseExternDecl(annotations: NodeAnnotation[]): NodeFunction | null {
        const kw = this.s.advance()!;
        const returnType = this.parseType();
        const name = this.s.expectIdentifier(`expected extern function name`);
        if (!name) { this.s.panicRecover(); return null; }
        this.s.expectPunct('(', `expected '(' after extern function name`);
        const params = this.parseParamList();
        this.s.expectPunct(')', `expected ')' after extern params`);
        this.s.expectPunct(';', `expected ';' after extern decl`);
        return {
            kind: NodeKind.Function,
            range: this.s.rangeFromTokens(kw),
            returnType,
            name: name as TokenIdentifier,
            params,
            body: null,
            annotations,
            modifiers: [],
            templateParams: [],
            isExtern: true,
        };
    }

    // BNF: Coroutine ::= 'coroutine' Type <ID> '(' [ ParamList ] ')' Block
    private parseCoroutine(annotations: NodeAnnotation[]): NodeCoroutine | null {
        const kw = this.s.advance()!;
        const returnType = this.parseType();
        const name = this.s.expectIdentifier(`expected coroutine name`);
        if (!name) { this.s.panicRecover(); return null; }
        this.s.expectPunct('(', `expected '(' after coroutine name`);
        const params = this.parseParamList();
        this.s.expectPunct(')', `expected ')' after coroutine params`);
        const body = this.parseBlock();
        return {
            kind: NodeKind.Coroutine,
            range: this.s.rangeFromTokens(kw),
            returnType,
            name: name as TokenIdentifier,
            params,
            body,
            annotations,
        };
    }

    // BNF: FunctionOrVar ::= Modifier* Type <ID> ( FunctionTail | VarTail )
    private parseFunctionOrVar(annotations: NodeAnnotation[]): NodeFunction | NodeVar | null {
        const startTok = this.s.peek();
        if (!startTok) return null;

        const modifiers = this.parseModifiers();

        const type = this.parseType();
        const name = this.s.peek();
        if (!name || (name.kind !== TokenKind.Identifier && name.kind !== TokenKind.Reserved)) {
            this.s.error(`expected declaration name`, name?.location ?? startTok.location);
            this.s.panicRecover();
            return null;
        }
        // Allow contextual reserved words (get/set) as decl names; reject other reserved.
        if (name.kind === TokenKind.Reserved && !CONTEXTUAL_AS_IDENT.has(name.text)) {
            this.s.error(`unexpected reserved word '${name.text}' as declaration name`, name.location);
            this.s.panicRecover();
            return null;
        }
        this.s.advance();

        if (this.s.check(TokenKind.Punctuation, '(')) {
            return this.finishFunctionDecl(startTok, modifiers, type, name as TokenIdentifier, annotations, []);
        }

        // var
        let initializer: NodeExpr | null = null;
        if (this.s.matchOp('=')) initializer = this.parseExpr();
        this.s.expectPunct(';', `expected ';' after variable declaration`);
        return {
            kind: NodeKind.Var,
            range: this.s.rangeFromTokens(startTok),
            type,
            name: name as TokenIdentifier,
            initializer,
            annotations,
            modifiers,
        };
    }

    private finishFunctionDecl(
        startTok: TokenObject,
        modifiers: TokenReserved[],
        returnType: NodeType,
        name: TokenIdentifier,
        annotations: NodeAnnotation[],
        templateParams: NodeTemplateParam[],
    ): NodeFunction {
        this.s.expectPunct('(', `expected '(' after function name`);
        const params = this.parseParamList();
        this.s.expectPunct(')', `expected ')' after function params`);
        // Trailing modifiers (parser is permissive — analyzer enforces semantic legality).
        modifiers.push(...this.parseModifiers());
        // Trailing return type: `auto fn(...) -> T { ... }` overrides the
        // leading return type (which is typically `auto`).
        if (this.s.matchOp('->')) {
            returnType = this.parseType();
        }
        let body: NodeStmtBlock | null = null;
        if (this.s.matchPunct(';')) {
            body = null;
        } else {
            body = this.parseBlock();
        }
        return {
            kind: NodeKind.Function,
            range: this.s.rangeFromTokens(startTok),
            returnType,
            name,
            params,
            body,
            annotations,
            modifiers,
            templateParams,
            isExtern: false,
        };
    }

    private parseModifiers(): TokenReserved[] {
        const result: TokenReserved[] = [];
        while (true) {
            const t = this.s.peek();
            if (!t || t.kind !== TokenKind.Reserved || !MODIFIERS.has(t.text)) break;
            this.s.advance();
            result.push(t as TokenReserved);
        }
        return result;
    }

    // ---- Members ----

    private parseMemberList(className: string): NodeMember[] {
        const result: NodeMember[] = [];
        while (!this.s.isEOF && !this.s.check(TokenKind.Punctuation, '}')) {
            // Access labels (`public:` / `private:`) are accepted-and-ignored
            // — Enma doesn't enforce visibility at the script level.
            const t = this.s.peek();
            if (t && t.kind === TokenKind.Reserved
                && (t.text === 'public' || t.text === 'private')
                && this.s.peek(1)?.kind === TokenKind.Operator
                && this.s.peek(1)?.text === ':') {
                this.s.advance(); // label keyword
                this.s.advance(); // ':'
                continue;
            }
            const before = this.s.pos;
            try {
                const m = this.parseMember(className);
                if (m) result.push(m);
                // If null, the failing parser already called panicRecover internally.
            } catch (e) {
                if (e instanceof ParseRecoveryError) this.s.panicRecover(); else throw e;
            }
            if (this.s.pos === before) this.s.advance();
        }
        return result;
    }

    // BNF: Member ::= Annotations MemberInner
    private parseMember(className: string): NodeMember | null {
        const annotations = this.parseAnnotations();
        const t = this.s.peek();
        if (!t) return null;

        // Destructor: `~ClassName ( ) Block`
        if (this.s.check(TokenKind.Operator, '~')) {
            return this.parseDestructor(className, annotations);
        }

        // Nested keyword-introduced decls
        if (this.isReserved(t, 'typedef')) return this.parseTypedef();
        if (this.isReserved(t, 'using')) return this.parseUsing();
        if (this.isReserved(t, 'enum')) return this.parseEnum(annotations);
        if (this.isReserved(t, 'struct')) return this.parseStruct(annotations);
        if (this.isReserved(t, 'class')) return this.parseClass(annotations);
        if (this.isReserved(t, 'interface')) return this.parseInterface(annotations);
        if (this.isReserved(t, 'mixin')) return this.parseMixin(annotations);
        if (this.isReserved(t, 'delegate')) return this.parseDelegate();
        if (this.isReserved(t, 'template')) return this.parseTemplate();
        if (this.isReserved(t, 'property')) return this.parseProperty(annotations);

        // Constructor: `ClassName ( ... ) {`
        if (t.kind === TokenKind.Identifier && t.text === className) {
            const m = this.s.mark();
            this.s.advance();
            if (this.s.check(TokenKind.Punctuation, '(')) {
                return this.parseConstructorTail(t as TokenIdentifier, annotations);
            }
            this.s.restore(m);
        }

        // Field or method (with optional modifiers + type + name + ('(' or '='/';'))
        return this.parseFieldOrMethod(annotations);
    }

    private parseDestructor(className: string, annotations: NodeAnnotation[]): NodeDestructor | null {
        const tilde = this.s.advance()!; // '~'
        const nameTok = this.s.expectIdentifier(`expected class name after '~'`);
        if (!nameTok) { this.s.panicRecover(); return null; }
        if (nameTok.text !== className) {
            this.s.warn(`destructor name '${nameTok.text}' does not match class '${className}'`, nameTok.location);
        }
        this.s.expectPunct('(', `expected '(' in destructor`);
        this.s.expectPunct(')', `expected ')' in destructor`);
        // Allow declaration-only form (predefined files): `~Name();`
        let body: NodeStmtBlock | null;
        if (this.s.matchPunct(';')) {
            body = null;
        } else {
            body = this.parseBlock();
        }
        return {
            kind: NodeKind.Destructor,
            range: this.s.rangeFromTokens(tilde),
            name: nameTok as TokenIdentifier,
            body,
            annotations,
        };
    }

    private parseConstructorTail(nameTok: TokenIdentifier, annotations: NodeAnnotation[]): NodeConstructor {
        this.s.expectPunct('(', `expected '(' in constructor`);
        const params = this.parseParamList();
        this.s.expectPunct(')', `expected ')' in constructor`);
        const initList: Array<{
            base: ReadonlyArray<TokenIdentifier | TokenReserved>;
            args: ReadonlyArray<NodeExpr>;
        }> = [];
        if (this.s.check(TokenKind.Operator, ':')) {
            this.s.advance();
            do {
                const base = this.parseQualifiedName();
                this.s.expectPunct('(', `expected '(' in ctor init`);
                const args: NodeExpr[] = [];
                if (!this.s.check(TokenKind.Punctuation, ')')) this.parseExprListInto(args);
                this.s.expectPunct(')', `expected ')' in ctor init`);
                initList.push({ base, args });
            } while (this.s.matchOp(','));
        }
        // Allow declaration-only form (predefined files): `Name(...);`
        let body: NodeStmtBlock | null;
        if (this.s.matchPunct(';')) {
            body = null;
        } else {
            body = this.parseBlock();
        }
        return {
            kind: NodeKind.Constructor,
            range: this.s.rangeFromTokens(nameTok),
            name: nameTok,
            params,
            body,
            annotations,
            initList,
        };
    }

    // BNF: Property ::= 'property' Type <ID> '{' [ 'get' Block ] [ 'set' Block ] '}'
    private parseProperty(_annotations: NodeAnnotation[]): NodeProperty | null {
        void _annotations;
        const kw = this.s.advance()!;
        const type = this.parseType();
        const name = this.s.expectIdentifier(`expected property name`);
        if (!name) { this.s.panicRecover(); return null; }
        this.s.expectPunct('{', `expected '{' for property body`);
        let getter: NodeStmtBlock | null = null;
        let setter: NodeStmtBlock | null = null;
        while (!this.s.isEOF && !this.s.check(TokenKind.Punctuation, '}')) {
            if (this.s.matchReserved('get')) getter = this.parseBlock();
            else if (this.s.matchReserved('set')) setter = this.parseBlock();
            else { this.s.advance(); }
        }
        this.s.expectPunct('}', `expected '}' for property close`);
        return {
            kind: NodeKind.Property,
            range: this.s.rangeFromTokens(kw),
            type,
            name: name as TokenIdentifier,
            getter,
            setter,
        };
    }

    // Method/field with modifiers, optional template prefix.
    private parseFieldOrMethod(annotations: NodeAnnotation[]): NodeMember | null {
        const startTok = this.s.peek();
        if (!startTok) return null;

        // Allow `template<...>` prefix on a method.
        let templateParams: NodeTemplateParam[] = [];
        if (this.s.check(TokenKind.Reserved, 'template')) {
            this.s.advance();
            if (this.s.matchOp('<')) {
                templateParams = this.parseTemplateParamList();
                this.s.matchOp('>');
            }
        }

        const modifiers = this.parseModifiers();

        // operator overload
        if (this.s.check(TokenKind.Reserved, 'operator')) {
            return this.parseOperatorOverload(startTok, modifiers, annotations);
        }

        // We cannot easily tell field-vs-method-vs-overload until after Type+Name; do it.
        // But operator overload uses `Type 'operator' OpToken (...)` — handled below since 'operator'
        // appears AFTER Type; we re-check after parseType.
        let type = this.parseType();

        if (this.s.check(TokenKind.Reserved, 'operator')) {
            return this.parseOperatorOverloadAfterType(startTok, type, annotations, modifiers);
        }

        const name = this.s.peek();
        // Allow contextual reserved keywords (e.g. `get`, `set`) as method/field names.
        // Real parsers would model these as IDs in member-decl position; we widen here.
        const isContextualReserved = !!name
            && name.kind === TokenKind.Reserved
            && CONTEXTUAL_AS_IDENT.has(name.text);
        if (!name || (name.kind !== TokenKind.Identifier && !isContextualReserved)) {
            this.s.error(`expected member name`, name?.location ?? startTok.location);
            this.s.panicRecover();
            return null;
        }
        this.s.advance();

        if (this.s.check(TokenKind.Punctuation, '(')) {
            this.s.expectPunct('(');
            const params = this.parseParamList();
            this.s.expectPunct(')', `expected ')' after method params`);
            // Trailing modifiers (e.g. `void f() override`, `int g() const final`).
            modifiers.push(...this.parseModifiers());
            // Trailing return type: `auto m(...) -> T { ... }` (replaces leading type).
            if (this.s.matchOp('->')) {
                type = this.parseType();
            }
            let body: NodeStmtBlock | null = null;
            if (this.s.matchPunct(';')) {
                body = null;
            } else {
                body = this.parseBlock();
            }
            const method: NodeMethod = {
                kind: NodeKind.Method,
                range: this.s.rangeFromTokens(startTok),
                returnType: type,
                name: name as TokenIdentifier,
                params,
                body,
                annotations,
                modifiers,
                templateParams,
            };
            return method;
        }

        // field
        let initializer: NodeExpr | null = null;
        if (this.s.matchOp('=')) initializer = this.parseExpr();
        // Bitfield width: `uint32 ready : 1;` — `:` is tokenized as Operator.
        let bitWidth: NodeExpr | null = null;
        const colon = this.s.peek();
        if (colon && colon.kind === TokenKind.Operator && colon.text === ':') {
            this.s.advance();
            bitWidth = this.parseExpr();
        }
        this.s.expectPunct(';', `expected ';' after field`);
        const field: NodeField = {
            kind: NodeKind.Field,
            range: this.s.rangeFromTokens(startTok),
            type,
            name: name as TokenIdentifier,
            initializer,
            annotations,
            modifiers,
            bitWidth,
        };
        return field;
    }

    private parseOperatorOverload(
        startTok: TokenObject,
        modifiers: TokenReserved[],
        annotations: NodeAnnotation[],
    ): NodeOperatorOverload | null {
        // Conversion operator form: `operator T() { body }`. The conversion target
        // type follows `operator`, with no preceding return type.
        const opKw = this.s.advance()!; // 'operator'
        const targetType = this.parseType();
        this.s.expectPunct('(', `expected '(' in conversion operator`);
        const params = this.parseParamList();
        this.s.expectPunct(')', `expected ')' in conversion operator`);
        const body = this.parseBlock();
        const castMarker: TokenReserved = {
            kind: TokenKind.Reserved,
            text: 'cast',
            location: opKw.location,
        };
        return {
            kind: NodeKind.OperatorOverload,
            range: this.s.rangeFromTokens(startTok),
            returnType: targetType,
            op: castMarker,
            params,
            body,
            annotations,
            modifiers,
        };
    }

    private parseOperatorOverloadAfterType(
        startTok: TokenObject,
        returnType: NodeType,
        annotations: NodeAnnotation[],
        modifiers: TokenReserved[] = [],
    ): NodeOperatorOverload | null {
        this.s.expectReserved('operator', `expected 'operator'`);
        const opTok = this.s.peek();
        if (!opTok) {
            this.s.error(`expected operator token`, this.s.endLocation());
            return null;
        }
        // Special-case: `[]`, `()` are two-token operator names.
        let opCombined: TokenObject = opTok;
        this.s.advance();
        if (opTok.kind === TokenKind.Punctuation && opTok.text === '[') {
            const close = this.s.peek();
            if (close?.text === ']') {
                this.s.advance();
                opCombined = { ...opTok, text: '[]' } as TokenObject;
                // `operator[]=` write-subscript variant.
                const eq = this.s.peek();
                if (eq && eq.kind === TokenKind.Operator && eq.text === '=') {
                    this.s.advance();
                    opCombined = { ...opTok, text: '[]=' } as TokenObject;
                }
            }
        } else if (opTok.kind === TokenKind.Punctuation && opTok.text === '(') {
            const close = this.s.peek();
            if (close?.text === ')') {
                this.s.advance();
                opCombined = { ...opTok, text: '()' } as TokenObject;
            }
        }
        this.s.expectPunct('(', `expected '(' in operator overload`);
        const params = this.parseParamList();
        this.s.expectPunct(')', `expected ')' in operator overload`);
        const body = this.parseBlock();
        return {
            kind: NodeKind.OperatorOverload,
            range: this.s.rangeFromTokens(startTok),
            returnType,
            op: opCombined,
            params,
            body,
            annotations,
            modifiers,
        };
    }

    private makeImplicitVoidType(start: { line: number; character: number }): NodeType {
        const tok: TokenReserved = {
            kind: TokenKind.Reserved,
            text: 'void',
            location: { uri: this.s.fileUri, start, end: start },
        };
        return {
            kind: NodeKind.Type,
            range: { start, end: start },
            path: [tok],
            generics: [],
            pointerLevel: 0,
            isReference: false,
            isConst: false,
            isNullable: false,
        };
    }

    // ---- Param list ----

    private parseParamList(): NodeParam[] {
        const params: NodeParam[] = [];
        if (this.s.check(TokenKind.Punctuation, ')')) return params;
        do {
            // Trailing comma allowance
            if (this.s.check(TokenKind.Punctuation, ')')) break;
            const p = this.parseParam();
            if (p) params.push(p);
        } while (this.s.matchOp(','));
        return params;
    }

    // BNF: Param ::= Type [ <ID> [ '=' Expr ] ] | '...' [ <ID> ]
    private parseParam(): NodeParam | null {
        const startTok = this.s.peek();
        if (!startTok) return null;

        // Variadic: tokenizer emits `...` as either a single Punctuation token (preferred)
        // or three '.' operator tokens. Accept both shapes.
        if (this.isVariadicHead()) {
            this.consumeVariadicHead();
            let nameTok: TokenIdentifier | null = null;
            if (this.s.check(TokenKind.Identifier)) {
                nameTok = this.s.advance() as TokenIdentifier;
            }
            const range: TextRange = {
                start: startTok.location.start,
                end: this.s.prev()?.location.end ?? startTok.location.end,
            };
            return {
                kind: NodeKind.Param,
                range,
                type: null,
                name: nameTok,
                isVariadic: true,
                defaultValue: null,
            };
        }

        // Optional `out` parameter modifier: `out Type Name`. Distinguished from
        // `out` as a parameter name (e.g. `int64 out`) by lookahead — only treat
        // as modifier when followed by a type-starter (primitive, identifier,
        // type-prefix kw, `const`, `nullable`).
        if (this.s.check(TokenKind.Reserved, 'out') && this.isTypeStarterAt(1)) {
            this.s.advance();
        }

        const type = this.parseType();
        let name: TokenIdentifier | null = null;
        const nameTokPeek = this.s.peek();
        if (nameTokPeek && (nameTokPeek.kind === TokenKind.Identifier
            || (nameTokPeek.kind === TokenKind.Reserved && CONTEXTUAL_AS_IDENT.has(nameTokPeek.text)))) {
            name = this.s.advance() as TokenIdentifier;
        }
        let defaultValue: NodeExpr | null = null;
        if (this.s.matchOp('=')) defaultValue = this.parseExpr();
        const range: TextRange = {
            start: startTok.location.start,
            end: this.s.prev()?.location.end ?? startTok.location.end,
        };
        return {
            kind: NodeKind.Param,
            range,
            type,
            name,
            isVariadic: false,
            defaultValue,
        };
    }

    /** Accept identifier OR reserved word as a member name (e.g. `.set`, `.get`).
     *  Treat the consumed token as a member name regardless of its lexical class. */
    private consumeMemberName(errMsg: string): TokenIdentifier | null {
        const t = this.s.peek();
        if (t && (t.kind === TokenKind.Identifier || t.kind === TokenKind.Reserved)) {
            this.s.advance();
            return t as TokenIdentifier;
        }
        this.s.error(errMsg, t?.location ?? this.s.endLocation());
        return null;
    }

    private isVariadicHead(): boolean {
        const t = this.s.peek();
        if (!t) return false;
        if (t.kind === TokenKind.Punctuation && t.text === '...') return true;
        if (t.kind === TokenKind.Operator && t.text === '.'
            && this.s.peek(1)?.kind === TokenKind.Operator && this.s.peek(1)?.text === '.'
            && this.s.peek(2)?.kind === TokenKind.Operator && this.s.peek(2)?.text === '.') {
            return true;
        }
        return false;
    }

    private consumeVariadicHead(): void {
        const t = this.s.peek();
        if (t && t.kind === TokenKind.Punctuation && t.text === '...') { this.s.advance(); return; }
        // Three '.' operators
        this.s.advance();
        this.s.advance();
        this.s.advance();
    }

    // ---- Types ----

    // BNF: Type ::= [ 'const' ] [ 'nullable' ] QualifiedName [ '<' TypeArgList '>' ] { '*' } [ '&' ]
    //            |  'decltype' '(' Expr ')'
    parseType(): NodeType {
        const startTok = this.s.peek();
        if (startTok && startTok.kind === TokenKind.Reserved && startTok.text === 'decltype') {
            this.s.advance();
            this.s.expectPunct('(', `expected '(' after 'decltype'`);
            const expr = this.parseExpr();
            this.s.expectPunct(')', `expected ')' after decltype expression`);
            const declMarker: TokenReserved = {
                kind: TokenKind.Reserved,
                text: 'decltype',
                location: startTok.location,
            };
            const range: TextRange = {
                start: startTok.location.start,
                end: this.s.prev()?.location.end ?? startTok.location.end,
            };
            return {
                kind: NodeKind.Type,
                range,
                path: [declMarker],
                generics: [],
                pointerLevel: 0,
                isReference: false,
                isConst: false,
                isNullable: false,
                decltypeExpr: expr,
            };
        }
        let isConst = false;
        let isNullable = false;
        while (true) {
            const t = this.s.peek();
            if (!t || t.kind !== TokenKind.Reserved || !TYPE_PREFIX_KW.has(t.text)) break;
            if (t.text === 'const') { isConst = true; this.s.advance(); continue; }
            if (t.text === 'nullable') { isNullable = true; this.s.advance(); continue; }
            break;
        }
        const path = this.parseQualifiedName();
        const generics: NodeType[] = [];
        if (this.tryEnterTypeGeneric()) {
            do {
                generics.push(this.parseType());
            } while (this.s.matchOp(','));
            // Closing '>' — handled via matchCloseAngle which transparently splits '>>'
            // (right-shift) into two '>'s for nested generics like array<array<T>>.
            if (!this.s.matchCloseAngle()) {
                this.s.error(`expected '>' to close type args`, this.s.peek()?.location ?? this.s.endLocation());
            }
        }
        let pointerLevel = 0;
        while (this.s.check(TokenKind.Operator, '*')) { this.s.advance(); pointerLevel++; }
        let isReference = false;
        // `&` and `&&` (rvalue ref) both collapse to isReference — rvalue refs
        // are accepted only in move-ctor params per spec, but the type-system
        // representation is identical.
        if (this.s.check(TokenKind.Operator, '&&')) {
            this.s.advance(); isReference = true;
        } else if (this.s.check(TokenKind.Operator, '&')) {
            this.s.advance(); isReference = true;
            if (this.s.check(TokenKind.Operator, '&')) this.s.advance();
        }
        // Typed-array suffix `T[]` — desugar to `array<T>`. Only matched as an
        // empty bracket pair (immediate `]`) to avoid colliding with subscript
        // expressions in non-type contexts.
        let typedArrayLevels = 0;
        while (
            this.s.check(TokenKind.Punctuation, '[')
            && this.s.peek(1)?.kind === TokenKind.Punctuation
            && this.s.peek(1)?.text === ']'
        ) {
            this.s.advance(); // [
            this.s.advance(); // ]
            typedArrayLevels++;
        }
        const range: TextRange = startTok
            ? { start: startTok.location.start, end: this.s.prev()?.location.end ?? startTok.location.end }
            : { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
        let result: NodeType = {
            kind: NodeKind.Type,
            range,
            path,
            generics,
            pointerLevel,
            isReference,
            isConst,
            isNullable,
        };
        // Wrap each [] level as array<inner>.
        if (typedArrayLevels > 0) {
            const synthLoc = startTok ? startTok.location : { uri: '', start: range.start, end: range.end };
            for (let i = 0; i < typedArrayLevels; i++) {
                const arrayTok: TokenIdentifier = {
                    kind: TokenKind.Identifier,
                    text: 'array',
                    location: synthLoc,
                };
                result = {
                    kind: NodeKind.Type,
                    range,
                    path: [arrayTok],
                    generics: [result],
                    pointerLevel: 0,
                    isReference: false,
                    isConst: false,
                    isNullable: false,
                };
            }
        }
        return result;
    }

    /** True if current `<` looks like a type-arg-list opener (heuristic with rollback). */
    private tryEnterTypeGeneric(): boolean {
        if (!this.s.check(TokenKind.Operator, '<')) return false;
        // Rough: tentatively assume yes if next is an ID or primitive-keyword.
        const next = this.s.peek(1);
        if (!next) return false;
        if (next.kind !== TokenKind.Identifier && next.kind !== TokenKind.Reserved) return false;
        // Don't enter on primitive comparisons like `x < 3`. The caller is parseType so the
        // grammar guarantees we're parsing a Type; safe to enter.
        this.s.advance();
        return true;
    }

    private parseQualifiedName(): Array<TokenIdentifier | TokenReserved> {
        const path: Array<TokenIdentifier | TokenReserved> = [];
        const head = this.s.peek();
        if (!head || (head.kind !== TokenKind.Identifier && head.kind !== TokenKind.Reserved)) {
            this.s.error(`expected name`, head?.location ?? this.s.endLocation());
            return path;
        }
        this.s.advance();
        path.push(head as TokenIdentifier | TokenReserved);
        while (this.s.matchOp('::')) {
            const next = this.s.peek();
            if (!next || (next.kind !== TokenKind.Identifier && next.kind !== TokenKind.Reserved)) {
                this.s.error(`expected name after '::'`, next?.location ?? this.s.endLocation());
                break;
            }
            this.s.advance();
            path.push(next as TokenIdentifier | TokenReserved);
        }
        return path;
    }

    // ---- Statements ----

    // BNF: Block ::= '{' { Stmt } '}'
    parseBlock(): NodeStmtBlock {
        const open = this.s.peek();
        const startTok = open ?? this.s.prev() ?? this.s.tokens[0];
        if (!this.s.matchPunct('{')) {
            this.s.error(`expected '{' to start block`, this.s.peek()?.location ?? this.s.endLocation());
            return {
                kind: NodeKind.StmtBlock,
                range: startTok ? { start: startTok.location.start, end: startTok.location.end } : { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
                stmts: [],
            };
        }
        const stmts: NodeStmt[] = [];
        while (!this.s.isEOF && !this.s.check(TokenKind.Punctuation, '}')) {
            const before = this.s.pos;
            try {
                const stmt = this.parseStmt();
                if (stmt) stmts.push(stmt);
                // If null, the failing parser already called panicRecover internally.
            } catch (e) {
                if (e instanceof ParseRecoveryError) this.s.panicRecover(); else throw e;
            }
            if (this.s.pos === before) this.s.advance();
        }
        const closeTok = this.s.peek();
        this.s.expectPunct('}', `expected '}' to close block`);
        const range: TextRange = {
            start: (open ?? startTok)?.location.start ?? { line: 0, character: 0 },
            end: closeTok?.location.end ?? this.s.prev()?.location.end ?? { line: 0, character: 0 },
        };
        return { kind: NodeKind.StmtBlock, range, stmts };
    }

    parseStmt(): NodeStmt | null {
        const t = this.s.peek();
        if (!t) return null;

        if (t.kind === TokenKind.Punctuation && t.text === '{') return this.parseBlock();
        if (t.kind === TokenKind.Punctuation && t.text === ';') {
            const semi = this.s.advance()!;
            return {
                kind: NodeKind.StmtEmpty,
                range: { start: semi.location.start, end: semi.location.end },
            } as NodeStmtEmpty;
        }

        if (t.kind === TokenKind.Reserved) {
            switch (t.text) {
                case 'if': return this.parseStmtIf();
                case 'for': return this.parseStmtFor();
                case 'while': return this.parseStmtWhile();
                case 'do': return this.parseStmtDoWhile();
                case 'switch': return this.parseStmtSwitch();
                case 'break': return this.parseStmtBreak();
                case 'continue': return this.parseStmtContinue();
                case 'return': return this.parseStmtReturn();
                case 'goto': return this.parseStmtGoto();
                case 'try': return this.parseStmtTry();
                case 'throw': return this.parseStmtThrow();
                case 'defer': return this.parseStmtDefer();
                case 'yield': return this.parseStmtYield();
                default: break;
            }
        }

        // Label: `<ID> :` (lookahead 2)
        if (t.kind === TokenKind.Identifier) {
            const next = this.s.peek(1);
            if (next && next.kind === TokenKind.Operator && next.text === ':') {
                const nameTok = this.s.advance()!;
                this.s.advance(); // ':'
                return {
                    kind: NodeKind.StmtLabel,
                    range: { start: nameTok.location.start, end: this.s.prev()!.location.end },
                    name: nameTok as TokenIdentifier,
                } as NodeStmtLabel;
            }
        }

        // Otherwise: try VarStmt vs ExprStmt. Heuristic — speculative parse.
        return this.parseVarOrExprStmt();
    }

    private parseStmtIf(): NodeStmtIf | null {
        const kw = this.s.advance()!;
        this.s.expectPunct('(', `expected '(' after 'if'`);
        let init: NodeStmtVar | NodeStmtExpr | null = null;
        if (this.hasIfInitClause()) {
            const initStmt = this.parseVarOrExprStmt();
            if (initStmt && (initStmt.kind === NodeKind.StmtVar || initStmt.kind === NodeKind.StmtExpr)) {
                init = initStmt;
            }
        }
        const condition = this.parseExpr();
        this.s.expectPunct(')', `expected ')' after if-condition`);
        const thenBranch = this.parseStmt() ?? this.makeEmptyStmt(kw);
        let elseBranch: NodeStmt | null = null;
        if (this.s.matchReserved('else')) {
            elseBranch = this.parseStmt();
        }
        return {
            kind: NodeKind.StmtIf,
            range: this.s.rangeFromTokens(kw),
            condition,
            thenBranch,
            elseBranch,
            init,
        };
    }

    /** True iff the upcoming `if (...)` head contains a `;` at depth 0 before its closing `)`. */
    private hasIfInitClause(): boolean {
        let depth = 0;
        for (let i = 0; i < 256; i++) {
            const t = this.s.peek(i);
            if (!t) return false;
            if (t.kind === TokenKind.Punctuation) {
                if (t.text === '(') depth++;
                else if (t.text === ')') {
                    if (depth === 0) return false;
                    depth--;
                } else if (t.text === ';' && depth === 0) {
                    return true;
                } else if (t.text === '{' && depth === 0) {
                    return false;
                }
            }
        }
        return false;
    }

    private parseStmtFor(): NodeStmtFor | NodeStmtForeach | null {
        const kw = this.s.advance()!;
        this.s.expectPunct('(', `expected '(' after 'for'`);

        // Detect foreach: `Type <ID> :` lookahead.
        if (this.looksLikeForeach()) {
            const elemType = this.parseType();
            const elemName = this.s.expectIdentifier(`expected element name in foreach`);
            // kv-foreach: `for (T1 k, T2 v : iter)` — consume the optional second binding.
            let valueType: NodeType | undefined = undefined;
            let valueName: TokenIdentifier | undefined = undefined;
            if (this.s.matchOp(',')) {
                valueType = this.parseType();
                const vn = this.s.expectIdentifier(`expected value name in foreach`);
                valueName = (vn ?? this.makeSyntheticId('_', kw)) as TokenIdentifier;
            }
            this.s.expectOp(':', `expected ':' in foreach`);
            const iterable = this.parseExpr();
            this.s.expectPunct(')', `expected ')' after foreach`);
            const body = this.parseStmt() ?? this.makeEmptyStmt(kw);
            return {
                kind: NodeKind.StmtForeach,
                range: this.s.rangeFromTokens(kw),
                elemType,
                elemName: (elemName ?? this.makeSyntheticId('_', kw)) as TokenIdentifier,
                valueType,
                valueName,
                iterable,
                body,
            } as NodeStmtForeach;
        }

        // Counted for
        let init: NodeStmtVar | NodeStmtExpr | NodeStmtEmpty | null = null;
        if (this.s.matchPunct(';')) {
            init = null;
        } else {
            const stmt = this.parseVarOrExprStmt();
            if (stmt && (stmt.kind === NodeKind.StmtVar || stmt.kind === NodeKind.StmtExpr)) {
                init = stmt;
            }
        }
        let condition: NodeExpr | null = null;
        if (!this.s.check(TokenKind.Punctuation, ';')) condition = this.parseExpr();
        this.s.expectPunct(';', `expected ';' in for-condition`);
        let update: NodeExpr | null = null;
        if (!this.s.check(TokenKind.Punctuation, ')')) update = this.parseExpr();
        this.s.expectPunct(')', `expected ')' after for-clauses`);
        const body = this.parseStmt() ?? this.makeEmptyStmt(kw);
        return {
            kind: NodeKind.StmtFor,
            range: this.s.rangeFromTokens(kw),
            init,
            condition,
            update,
            body,
        } as NodeStmtFor;
    }

    /** Heuristic: if we see `<Type> <ID> :` before any `;` or `)`, treat as foreach. */
    private looksLikeForeach(): boolean {
        const m = this.s.mark();
        try {
            // Walk past optional type prefixes/qualified names/generics/pointers.
            // We scan tokens as a flat lookahead — without committing.
            // Use a depth-tracked scan.
            let depth = 0;
            let sawColon = false;
            let i = 0;
            while (true) {
                const t = this.s.peek(i);
                if (!t) break;
                if (t.kind === TokenKind.Punctuation) {
                    if (t.text === '(') depth++;
                    else if (t.text === ')') {
                        if (depth === 0) break;
                        depth--;
                    } else if (t.text === ';' && depth === 0) break;
                }
                if (t.kind === TokenKind.Operator && t.text === '<') depth++;
                else if (t.kind === TokenKind.Operator && t.text === '>') {
                    if (depth > 0) depth--;
                }
                if (t.kind === TokenKind.Operator && t.text === ':' && depth === 0) {
                    sawColon = true;
                    break;
                }
                i++;
            }
            return sawColon;
        } finally {
            this.s.restore(m);
        }
    }

    private parseStmtWhile(): NodeStmtWhile | null {
        const kw = this.s.advance()!;
        this.s.expectPunct('(', `expected '(' after 'while'`);
        const condition = this.parseExpr();
        this.s.expectPunct(')', `expected ')' after while-condition`);
        const body = this.parseStmt() ?? this.makeEmptyStmt(kw);
        return {
            kind: NodeKind.StmtWhile,
            range: this.s.rangeFromTokens(kw),
            condition,
            body,
        };
    }

    private parseStmtDoWhile(): NodeStmtDoWhile | null {
        const kw = this.s.advance()!;
        const body = this.parseStmt() ?? this.makeEmptyStmt(kw);
        this.s.expectReserved('while', `expected 'while' after 'do' block`);
        this.s.expectPunct('(', `expected '(' in do-while`);
        const condition = this.parseExpr();
        this.s.expectPunct(')', `expected ')' in do-while`);
        this.s.expectPunct(';', `expected ';' after do-while`);
        return {
            kind: NodeKind.StmtDoWhile,
            range: this.s.rangeFromTokens(kw),
            body,
            condition,
        };
    }

    private parseStmtSwitch(): NodeStmtSwitch | null {
        const kw = this.s.advance()!;
        this.s.expectPunct('(', `expected '(' after 'switch'`);
        const subject = this.parseExpr();
        this.s.expectPunct(')', `expected ')' after switch subject`);
        this.s.expectPunct('{', `expected '{' in switch`);
        const cases: NodeStmtSwitch['cases'][number][] = [];
        while (!this.s.isEOF && !this.s.check(TokenKind.Punctuation, '}')) {
            let value: NodeExpr | null = null;
            if (this.s.matchReserved('case')) {
                value = this.parseExpr();
                this.s.expectOp(':', `expected ':' after case value`);
            } else if (this.s.matchReserved('default')) {
                value = null;
                this.s.expectOp(':', `expected ':' after default`);
            } else {
                this.s.error(`expected 'case' or 'default'`, this.s.peek()!.location);
                this.s.advance();
                continue;
            }
            const stmts: NodeStmt[] = [];
            while (!this.s.isEOF
                && !this.s.check(TokenKind.Punctuation, '}')
                && !this.s.check(TokenKind.Reserved, 'case')
                && !this.s.check(TokenKind.Reserved, 'default')) {
                const before = this.s.pos;
                const stmt = this.parseStmt();
                if (stmt) stmts.push(stmt);
                else this.s.panicRecover();
                if (this.s.pos === before) this.s.advance();
            }
            cases.push({ value, stmts });
        }
        this.s.expectPunct('}', `expected '}' to close switch`);
        return {
            kind: NodeKind.StmtSwitch,
            range: this.s.rangeFromTokens(kw),
            subject,
            cases,
        };
    }

    private parseStmtBreak(): NodeStmtBreak {
        const kw = this.s.advance()!;
        this.s.expectPunct(';', `expected ';' after break`);
        return { kind: NodeKind.StmtBreak, range: this.s.rangeFromTokens(kw) };
    }
    private parseStmtContinue(): NodeStmtContinue {
        const kw = this.s.advance()!;
        this.s.expectPunct(';', `expected ';' after continue`);
        return { kind: NodeKind.StmtContinue, range: this.s.rangeFromTokens(kw) };
    }
    private parseStmtReturn(): NodeStmtReturn {
        const kw = this.s.advance()!;
        let value: NodeExpr | null = null;
        if (!this.s.check(TokenKind.Punctuation, ';')) value = this.parseExpr();
        this.s.expectPunct(';', `expected ';' after return`);
        return { kind: NodeKind.StmtReturn, range: this.s.rangeFromTokens(kw), value };
    }
    private parseStmtGoto(): NodeStmtGoto | null {
        const kw = this.s.advance()!;
        const label = this.s.expectIdentifier(`expected label after 'goto'`);
        if (!label) { this.s.panicRecover(); return null; }
        this.s.expectPunct(';', `expected ';' after goto`);
        return {
            kind: NodeKind.StmtGoto,
            range: this.s.rangeFromTokens(kw),
            label: label as TokenIdentifier,
        };
    }
    private parseStmtTry(): NodeStmtTry {
        const kw = this.s.advance()!;
        const tryBlock = this.parseBlock();
        const catches: NodeStmtTry['catches'][number][] = [];
        while (this.s.matchReserved('catch')) {
            this.s.expectPunct('(', `expected '(' in catch`);
            const excType = this.parseType();
            let excName: TokenIdentifier | null = null;
            if (this.s.check(TokenKind.Identifier)) {
                excName = this.s.advance() as TokenIdentifier;
            }
            this.s.expectPunct(')', `expected ')' in catch`);
            const body = this.parseBlock();
            catches.push({ excType, excName, body });
        }
        let finallyBlock: NodeStmtBlock | null = null;
        if (this.s.matchReserved('finally')) finallyBlock = this.parseBlock();
        return {
            kind: NodeKind.StmtTry,
            range: this.s.rangeFromTokens(kw),
            tryBlock,
            catches,
            finallyBlock,
        };
    }
    private parseStmtThrow(): NodeStmtThrow {
        const kw = this.s.advance()!;
        let value: NodeExpr | null = null;
        if (!this.s.check(TokenKind.Punctuation, ';')) value = this.parseExpr();
        this.s.expectPunct(';', `expected ';' after throw`);
        return { kind: NodeKind.StmtThrow, range: this.s.rangeFromTokens(kw), value };
    }
    private parseStmtDefer(): NodeStmtDefer {
        const kw = this.s.advance()!;
        // Two forms: block `defer { ... }` and Go-style `defer Expr;`.
        // Wrap the expression form in a synthetic block so downstream consumers
        // can keep treating `body` as a NodeStmtBlock uniformly.
        if (this.s.check(TokenKind.Punctuation, '{')) {
            const body = this.parseBlock();
            return { kind: NodeKind.StmtDefer, range: this.s.rangeFromTokens(kw), body };
        }
        const exprStartTok = this.s.peek() ?? kw;
        const expr = this.parseExpr();
        this.s.expectPunct(';', `expected ';' after defer expression`);
        const exprStmt: NodeStmtExpr = {
            kind: NodeKind.StmtExpr,
            range: { start: exprStartTok.location.start, end: this.s.prev()?.location.end ?? exprStartTok.location.end },
            expr,
        };
        const body: NodeStmtBlock = {
            kind: NodeKind.StmtBlock,
            range: exprStmt.range,
            stmts: [exprStmt],
        };
        return { kind: NodeKind.StmtDefer, range: this.s.rangeFromTokens(kw), body };
    }
    private parseStmtYield(): NodeStmtYield {
        const kw = this.s.advance()!;
        let value: NodeExpr | null = null;
        if (!this.s.check(TokenKind.Punctuation, ';')) value = this.parseExpr();
        this.s.expectPunct(';', `expected ';' after yield`);
        return { kind: NodeKind.StmtYield, range: this.s.rangeFromTokens(kw), value };
    }

    private parseVarOrExprStmt(): NodeStmt | null {
        // Speculative: try VarStmt; if it fails to parse cleanly into a recognizable shape,
        // fall back to ExprStmt.
        const m = this.s.mark();
        const startTok = this.s.peek();
        if (!startTok) return null;

        // Skip leading modifiers.
        const isLikelyVar = this.looksLikeVarDecl();
        if (isLikelyVar) {
            const modifiers = this.parseModifiers();
            const type = this.parseType();
            const name = this.s.peek();
            if (name && (name.kind === TokenKind.Identifier
                || (name.kind === TokenKind.Reserved && CONTEXTUAL_AS_IDENT.has(name.text)))) {
                this.s.advance();
                let initializer: NodeExpr | null = null;
                if (this.s.matchOp('=')) initializer = this.parseExpr();
                this.s.expectPunct(';', `expected ';' after var declaration`);
                return {
                    kind: NodeKind.StmtVar,
                    range: this.s.rangeFromTokens(startTok),
                    type,
                    name: name as TokenIdentifier,
                    initializer,
                    modifiers,
                } as NodeStmtVar;
            }
            // not a var after all — rollback
            this.s.restore(m);
        }

        // Expr stmt
        const expr = this.parseExpr();
        this.s.expectPunct(';', `expected ';' after expression`);
        return {
            kind: NodeKind.StmtExpr,
            range: this.s.rangeFromTokens(startTok),
            expr,
        } as NodeStmtExpr;
    }

    /** Heuristic: does the upcoming token sequence look like a variable declaration?
     *  i.e. starts with type keyword / qualified-name + identifier (+ '=' or ';' or block-end).
     *  Used only as a tentative gate; we always rollback if the speculative parse fails. */
    private looksLikeVarDecl(): boolean {
        let i = 0;
        // Skip modifiers
        while (true) {
            const t = this.s.peek(i);
            if (!t || t.kind !== TokenKind.Reserved || !MODIFIERS.has(t.text)) break;
            i++;
        }
        // Skip 'const'/'nullable'
        while (true) {
            const t = this.s.peek(i);
            if (!t || t.kind !== TokenKind.Reserved || !TYPE_PREFIX_KW.has(t.text)) break;
            i++;
        }
        // Need name token (ID or primitive)
        const head = this.s.peek(i);
        if (!head) return false;
        // `decltype(expr)` as a type-starter: skip past the matched parens.
        if (head.kind === TokenKind.Reserved && head.text === 'decltype') {
            const open = this.s.peek(i + 1);
            if (!open || open.kind !== TokenKind.Punctuation || open.text !== '(') return false;
            let depth = 1;
            i += 2;
            while (depth > 0) {
                const t = this.s.peek(i);
                if (!t) return false;
                if (t.kind === TokenKind.Punctuation && t.text === '(') depth++;
                else if (t.kind === TokenKind.Punctuation && t.text === ')') depth--;
                i++;
            }
            while (true) {
                const t = this.s.peek(i);
                if (!t) return false;
                if (t.kind === TokenKind.Operator && (t.text === '*' || t.text === '&')) { i++; continue; }
                break;
            }
            const nameTok2 = this.s.peek(i);
            if (!nameTok2) return false;
            const isNameTok2 = nameTok2.kind === TokenKind.Identifier
                || (nameTok2.kind === TokenKind.Reserved && CONTEXTUAL_AS_IDENT.has(nameTok2.text));
            if (!isNameTok2) return false;
            i++;
            const after2 = this.s.peek(i);
            if (!after2) return false;
            if (after2.kind === TokenKind.Operator && after2.text === '=') return true;
            if (after2.kind === TokenKind.Punctuation && after2.text === ';') return true;
            return false;
        }
        const headIsType = head.kind === TokenKind.Reserved && (isPrimitive(head.text) || head.text === 'void' || head.text === 'auto');
        const headIsIdent = head.kind === TokenKind.Identifier;
        if (!headIsType && !headIsIdent) return false;
        i++;
        // Skip qualified-name segments
        while (true) {
            const t = this.s.peek(i);
            if (!t) return false;
            if (t.kind === TokenKind.Operator && t.text === '::') {
                i++;
                const t2 = this.s.peek(i);
                if (!t2 || (t2.kind !== TokenKind.Identifier && t2.kind !== TokenKind.Reserved)) return false;
                i++;
                continue;
            }
            break;
        }
        // Skip generics
        if (this.s.peek(i)?.kind === TokenKind.Operator && this.s.peek(i)?.text === '<') {
            // Simple bracket-depth scan
            let depth = 1;
            i++;
            while (depth > 0) {
                const t = this.s.peek(i);
                if (!t) return false;
                if (t.kind === TokenKind.Operator && t.text === '<') depth++;
                else if (t.kind === TokenKind.Operator && t.text === '>') depth--;
                else if (t.kind === TokenKind.Operator && t.text === '>>') { depth -= 2; if (depth < 0) return false; }
                i++;
            }
        }
        // Skip pointer/ref
        while (true) {
            const t = this.s.peek(i);
            if (!t) return false;
            if (t.kind === TokenKind.Operator && (t.text === '*' || t.text === '&')) { i++; continue; }
            break;
        }
        // Skip typed-array suffix `[]` (one or more).
        while (true) {
            const t = this.s.peek(i);
            const t2 = this.s.peek(i + 1);
            if (t && t2
                && t.kind === TokenKind.Punctuation && t.text === '['
                && t2.kind === TokenKind.Punctuation && t2.text === ']') {
                i += 2;
                continue;
            }
            break;
        }
        // Need identifier (variable name) or contextual reserved as name
        const nameTok = this.s.peek(i);
        if (!nameTok) return false;
        const isNameTok = nameTok.kind === TokenKind.Identifier
            || (nameTok.kind === TokenKind.Reserved && CONTEXTUAL_AS_IDENT.has(nameTok.text));
        if (!isNameTok) return false;
        i++;
        const after = this.s.peek(i);
        if (!after) return false;
        if (after.kind === TokenKind.Operator && after.text === '=') return true;
        if (after.kind === TokenKind.Punctuation && after.text === ';') return true;
        return false;
    }

    private makeEmptyStmt(tok: TokenObject): NodeStmtEmpty {
        return {
            kind: NodeKind.StmtEmpty,
            range: { start: tok.location.start, end: tok.location.start },
        };
    }

    private makeSyntheticId(text: string, atTok: TokenObject): TokenIdentifier {
        return {
            kind: TokenKind.Identifier,
            text,
            location: { uri: this.s.fileUri, start: atTok.location.start, end: atTok.location.start },
        };
    }

    // ---- Expressions ----

    parseExpr(): NodeExpr {
        return this.parseAssign();
    }

    private parseExprListInto(out: NodeExpr[]): void {
        out.push(this.parseExpr());
        while (this.s.matchOp(',')) {
            if (this.s.check(TokenKind.Punctuation, ')')) break;
            out.push(this.parseExpr());
        }
    }

    private parseAssign(): NodeExpr {
        const left = this.parseTernary();
        const t = this.s.peek();
        if (t && t.kind === TokenKind.Operator && ASSIGN_OPS.has(t.text)) {
            this.s.advance();
            const right = this.parseAssign();
            const range: TextRange = { start: left.range.start, end: right.range.end };
            return {
                kind: NodeKind.ExprAssign,
                range,
                target: left,
                op: t,
                value: right,
            } as NodeExprAssign;
        }
        return left;
    }

    private parseTernary(): NodeExpr {
        const cond = this.parseLogicalOr();
        if (this.s.checkText('?')) {
            this.s.advance();
            const thenExpr = this.parseExpr();
            this.s.expectOp(':', `expected ':' in ternary`);
            const elseExpr = this.parseAssign();
            return {
                kind: NodeKind.ExprTernary,
                range: { start: cond.range.start, end: elseExpr.range.end },
                condition: cond,
                thenExpr,
                elseExpr,
            } as NodeExprTernary;
        }
        return cond;
    }

    private parseLogicalOr(): NodeExpr {
        return this.parseLeftAssocBinary('||', () => this.parseLogicalAnd());
    }
    private parseLogicalAnd(): NodeExpr {
        return this.parseLeftAssocBinary('&&', () => this.parseBitOr());
    }
    private parseBitOr(): NodeExpr {
        return this.parseLeftAssocBinary('|', () => this.parseBitXor());
    }
    private parseBitXor(): NodeExpr {
        return this.parseLeftAssocBinary('^', () => this.parseBitAnd());
    }
    private parseBitAnd(): NodeExpr {
        return this.parseLeftAssocBinary('&', () => this.parseEquality());
    }
    private parseEquality(): NodeExpr {
        return this.parseLeftAssocBinaryAny(['==', '!='], () => this.parseRelational());
    }
    private parseRelational(): NodeExpr {
        return this.parseLeftAssocBinaryAny(['<', '<=', '>', '>='], () => this.parseShift());
    }
    private parseShift(): NodeExpr {
        return this.parseLeftAssocBinaryAny(['<<', '>>'], () => this.parseAddSub());
    }
    private parseAddSub(): NodeExpr {
        return this.parseLeftAssocBinaryAny(['+', '-'], () => this.parseMulDiv());
    }
    private parseMulDiv(): NodeExpr {
        return this.parseLeftAssocBinaryAny(['*', '/', '%'], () => this.parseUnary());
    }

    private parseLeftAssocBinary(op: string, sub: () => NodeExpr): NodeExpr {
        let left = sub();
        while (this.s.checkText(op) && this.s.peek()?.kind === TokenKind.Operator) {
            const opTok = this.s.advance()!;
            const right = sub();
            left = {
                kind: NodeKind.ExprBinary,
                range: { start: left.range.start, end: right.range.end },
                left,
                op: opTok,
                right,
            } as NodeExprBinary;
        }
        return left;
    }
    private parseLeftAssocBinaryAny(ops: string[], sub: () => NodeExpr): NodeExpr {
        let left = sub();
        while (true) {
            const t = this.s.peek();
            if (!t || t.kind !== TokenKind.Operator) break;
            if (!ops.includes(t.text)) break;
            this.s.advance();
            const right = sub();
            left = {
                kind: NodeKind.ExprBinary,
                range: { start: left.range.start, end: right.range.end },
                left,
                op: t,
                right,
            } as NodeExprBinary;
        }
        return left;
    }

    private parseUnary(): NodeExpr {
        const t = this.s.peek();
        if (t && t.kind === TokenKind.Operator
            && (t.text === '!' || t.text === '-' || t.text === '+' || t.text === '~'
                || t.text === '*' || t.text === '&'
                || t.text === '++' || t.text === '--')) {
            this.s.advance();
            const operand = this.parseUnary();
            return {
                kind: NodeKind.ExprUnary,
                range: { start: t.location.start, end: operand.range.end },
                op: t,
                operand,
            } as NodeExprUnary;
        }
        if (t && t.kind === TokenKind.Reserved) {
            if (CAST_KEYWORDS.has(t.text)) return this.parseCast();
            if (t.text === 'new') return this.parseNew();
            if (t.text === 'delete') return this.parseDelete();
            if (t.text === 'sizeof') return this.parseSizeof();
            if (t.text === 'offsetof') return this.parseOffsetof();
            if (t.text === 'static_assert') return this.parseStaticAssert();
        }
        // C-style cast: `(T) expr` where T is unambiguously a type token.
        // Only attempt when the parenthesized content looks type-like and is
        // followed by something that can start an expression — to avoid
        // hijacking ordinary `(expr)` paren grouping.
        if (t && t.kind === TokenKind.Punctuation && t.text === '(' && this.looksLikeCStyleCast()) {
            const m = this.s.mark();
            const open = this.s.advance()!; // '('
            try {
                const targetType = this.parseType();
                if (this.s.matchPunct(')') && this.canStartUnary(this.s.peek())) {
                    const operand = this.parseUnary();
                    return {
                        kind: NodeKind.ExprCast,
                        range: { start: open.location.start, end: operand.range.end },
                        castKind: 'cast',
                        targetType,
                        value: operand,
                    } as NodeExprCast;
                }
                this.s.restore(m);
            } catch {
                this.s.restore(m);
            }
        }
        return this.parsePostfix();
    }

    /** True if `(` is immediately followed by tokens that look like a type and a closing `)`. */
    private looksLikeCStyleCast(): boolean {
        // Peek inside the parens: must be a primitive keyword (or known type-prefix
        // keyword) followed eventually by `)`. We refuse identifier-only types here
        // because those would create infinite-ambiguity with `(name)expr`.
        const inner = this.s.peek(1);
        if (!inner) return false;
        // Accept only primitive type keywords as the cast head — narrow but covers
        // the corpus pattern `(float64)x`, `(int64)x`, etc.
        if (inner.kind !== TokenKind.Reserved) return false;
        if (!isPrimitive(inner.text)) return false;
        // After type tokens, we should see `)` then a unary-startable token.
        // Walk past simple type modifiers `*` `&`.
        let i = 2;
        while (true) {
            const tt = this.s.peek(i);
            if (!tt) return false;
            if (tt.kind === TokenKind.Operator && (tt.text === '*' || tt.text === '&')) {
                i++; continue;
            }
            break;
        }
        const close = this.s.peek(i);
        if (!close || close.kind !== TokenKind.Punctuation || close.text !== ')') return false;
        const after = this.s.peek(i + 1);
        return this.canStartUnary(after);
    }

    private canStartUnary(t: TokenObject | undefined): boolean {
        if (!t) return false;
        if (t.kind === TokenKind.Identifier) return true;
        if (t.kind === TokenKind.Number || t.kind === TokenKind.String || t.kind === TokenKind.Char) return true;
        if (t.kind === TokenKind.Punctuation && (t.text === '(' || t.text === '[' || t.text === '{')) return true;
        if (t.kind === TokenKind.Operator
            && (t.text === '!' || t.text === '-' || t.text === '+' || t.text === '~'
                || t.text === '*' || t.text === '&'
                || t.text === '++' || t.text === '--')) return true;
        if (t.kind === TokenKind.Reserved) {
            if (t.text === 'true' || t.text === 'false' || t.text === 'null' || t.text === 'nullptr'
                || t.text === 'this' || t.text === 'new' || t.text === 'sizeof' || t.text === 'offsetof'
                || CAST_KEYWORDS.has(t.text)) return true;
            if (isPrimitive(t.text)) return true;
        }
        return false;
    }

    private parseCast(): NodeExprCast {
        const kw = this.s.advance()!;
        this.s.expectOp('<', `expected '<' after cast`);
        const targetType = this.parseType();
        this.s.expectOp('>', `expected '>' after cast type`);
        this.s.expectPunct('(', `expected '(' in cast`);
        const value = this.parseExpr();
        this.s.expectPunct(')', `expected ')' in cast`);
        return {
            kind: NodeKind.ExprCast,
            range: this.s.rangeFromTokens(kw),
            castKind: kw.text,
            targetType,
            value,
        };
    }

    private parseNew(): NodeExprNew {
        const kw = this.s.advance()!;
        const type = this.parseType();
        let arraySize: NodeExpr | null = null;
        if (this.s.matchPunct('[')) {
            if (!this.s.check(TokenKind.Punctuation, ']')) {
                arraySize = this.parseExpr();
            }
            this.s.expectPunct(']', `expected ']' after new[size]`);
        }
        const args: NodeExpr[] = [];
        if (this.s.matchPunct('(')) {
            if (!this.s.check(TokenKind.Punctuation, ')')) this.parseExprListInto(args);
            this.s.expectPunct(')', `expected ')' after new args`);
        }
        return {
            kind: NodeKind.ExprNew,
            range: this.s.rangeFromTokens(kw),
            type,
            args,
            arraySize,
        };
    }

    private parseDelete(): NodeExprDelete {
        const kw = this.s.advance()!;
        let isArray = false;
        if (this.s.matchPunct('[')) {
            this.s.expectPunct(']', `expected ']' after 'delete['`);
            isArray = true;
        }
        const target = this.parsePostfix();
        return {
            kind: NodeKind.ExprDelete,
            range: this.s.rangeFromTokens(kw),
            target,
            isArray,
        };
    }

    private parseSizeof(): NodeExprSizeof {
        const kw = this.s.advance()!;
        this.s.expectPunct('(', `expected '(' after sizeof`);
        // Tentatively parse as type — fall back to expr.
        const m = this.s.mark();
        let target: NodeType | NodeExpr;
        let isType = false;
        try {
            const t = this.parseType();
            // Only accept if next token closes it: ')'
            if (this.s.check(TokenKind.Punctuation, ')')) {
                target = t;
                isType = true;
            } else {
                this.s.restore(m);
                target = this.parseExpr();
            }
        } catch {
            this.s.restore(m);
            target = this.parseExpr();
        }
        this.s.expectPunct(')', `expected ')' after sizeof arg`);
        return {
            kind: NodeKind.ExprSizeof,
            range: this.s.rangeFromTokens(kw),
            target,
            isType,
        };
    }

    private parseOffsetof(): NodeExprOffsetof {
        const kw = this.s.advance()!;
        this.s.expectPunct('(', `expected '(' after offsetof`);
        const type = this.parseType();
        this.s.expectOp(',', `expected ',' in offsetof`);
        const memberPath: TokenIdentifier[] = [];
        const head = this.s.expectIdentifier(`expected member name in offsetof`);
        if (head) memberPath.push(head as TokenIdentifier);
        while (this.s.matchOp('.')) {
            const seg = this.s.expectIdentifier(`expected member name after '.' in offsetof`);
            if (seg) memberPath.push(seg as TokenIdentifier);
        }
        this.s.expectPunct(')', `expected ')' in offsetof`);
        return {
            kind: NodeKind.ExprOffsetof,
            range: this.s.rangeFromTokens(kw),
            type,
            memberPath,
        };
    }

    private parseStaticAssert(): NodeExprStaticAssert {
        const kw = this.s.advance()!;
        this.s.expectPunct('(', `expected '(' after static_assert`);
        const condition = this.parseExpr();
        let message: NodeExpr | null = null;
        if (this.s.matchOp(',')) message = this.parseExpr();
        this.s.expectPunct(')', `expected ')' in static_assert`);
        return {
            kind: NodeKind.ExprStaticAssert,
            range: this.s.rangeFromTokens(kw),
            condition,
            message,
        };
    }

    private parsePostfix(): NodeExpr {
        let expr = this.parsePrimary();
        while (true) {
            const t = this.s.peek();
            if (!t) break;
            // Call: '('
            if (t.kind === TokenKind.Punctuation && t.text === '(') {
                this.s.advance();
                const args: NodeExpr[] = [];
                if (!this.s.check(TokenKind.Punctuation, ')')) this.parseExprListInto(args);
                this.s.expectPunct(')', `expected ')' after arguments`);
                expr = {
                    kind: NodeKind.ExprCall,
                    range: { start: expr.range.start, end: this.s.prev()!.location.end },
                    callee: expr,
                    templateArgs: [],
                    args,
                } as NodeExprCall;
                continue;
            }
            // Member dot: '.'
            if (t.kind === TokenKind.Operator && t.text === '.') {
                this.s.advance();
                const m = this.consumeMemberName(`expected member name after '.'`);
                if (!m) break;
                expr = {
                    kind: NodeKind.ExprMemberDot,
                    range: { start: expr.range.start, end: m.location.end },
                    object: expr,
                    member: m as TokenIdentifier,
                } as NodeExprMemberDot;
                continue;
            }
            // Member arrow: '->'
            if (t.kind === TokenKind.Operator && t.text === '->') {
                this.s.advance();
                const m = this.consumeMemberName(`expected member name after '->'`);
                if (!m) break;
                expr = {
                    kind: NodeKind.ExprMemberArrow,
                    range: { start: expr.range.start, end: m.location.end },
                    object: expr,
                    member: m as TokenIdentifier,
                } as NodeExprMemberArrow;
                continue;
            }
            // Namespace access: '::'
            if (t.kind === TokenKind.Operator && t.text === '::') {
                this.s.advance();
                const m = this.s.peek();
                if (!m || (m.kind !== TokenKind.Identifier && m.kind !== TokenKind.Reserved)) {
                    this.s.error(`expected name after '::'`, m?.location ?? t.location);
                    break;
                }
                this.s.advance();
                expr = {
                    kind: NodeKind.ExprNamespaceAccess,
                    range: { start: expr.range.start, end: m.location.end },
                    scope: expr,
                    member: m as TokenIdentifier | TokenReserved,
                } as NodeExprNamespaceAccess;
                continue;
            }
            // Index: '['
            if (t.kind === TokenKind.Punctuation && t.text === '[') {
                this.s.advance();
                const index = this.parseExpr();
                this.s.expectPunct(']', `expected ']' after index`);
                expr = {
                    kind: NodeKind.ExprIndex,
                    range: { start: expr.range.start, end: this.s.prev()!.location.end },
                    object: expr,
                    index,
                } as NodeExprIndex;
                continue;
            }
            // Postfix ++ / --
            if (t.kind === TokenKind.Operator && (t.text === '++' || t.text === '--')) {
                this.s.advance();
                expr = {
                    kind: NodeKind.ExprPostfix,
                    range: { start: expr.range.start, end: t.location.end },
                    operand: expr,
                    op: t,
                } as NodeExprPostfix;
                continue;
            }
            // Template-call: `<TypeArgList>(...)` heuristic.
            if (t.kind === TokenKind.Operator && t.text === '<' && this.couldBeTemplateCall()) {
                const m = this.s.mark();
                const ok = this.tryParseTemplateCall(expr);
                if (ok) { expr = ok; continue; }
                this.s.restore(m);
            }
            // Uniform init `T{...}` — only when the head expr is a name path.
            if (t.kind === TokenKind.Punctuation && t.text === '{' && this.isTypeNameExpr(expr)) {
                const inner = this.parseBraceInit();
                if (inner.kind === NodeKind.ExprDesignatedInit) {
                    expr = {
                        kind: NodeKind.ExprDesignatedInit,
                        range: { start: expr.range.start, end: inner.range.end },
                        typeName: this.exprToType(expr),
                        fields: inner.fields,
                    } as NodeExprDesignatedInit;
                } else {
                    expr = {
                        kind: NodeKind.ExprCall,
                        range: { start: expr.range.start, end: inner.range.end },
                        callee: expr,
                        templateArgs: [],
                        args: (inner as NodeExprArrayInit).elements,
                    } as NodeExprCall;
                }
                continue;
            }
            break;
        }
        return expr;
    }

    /** Identifier / namespace-access / member-dot — i.e. a name-path expression suitable as a type prefix. */
    private isTypeNameExpr(e: NodeExpr): boolean {
        return e.kind === NodeKind.ExprIdentifier
            || e.kind === NodeKind.ExprNamespaceAccess
            || e.kind === NodeKind.ExprMemberDot;
    }

    /** Convert a name-path expression (Identifier / NamespaceAccess / MemberDot) into a NodeType. */
    private exprToType(e: NodeExpr): NodeType {
        const path: Array<TokenIdentifier | TokenReserved> = [];
        const collect = (n: NodeExpr): void => {
            if (n.kind === NodeKind.ExprIdentifier) {
                path.push(n.token);
            } else if (n.kind === NodeKind.ExprNamespaceAccess) {
                collect(n.scope);
                path.push(n.member);
            } else if (n.kind === NodeKind.ExprMemberDot) {
                collect(n.object);
                path.push(n.member);
            }
        };
        collect(e);
        return {
            kind: NodeKind.Type,
            range: e.range,
            path,
            generics: [],
            pointerLevel: 0,
            isReference: false,
            isConst: false,
            isNullable: false,
        };
    }

    /** Heuristic: peek ahead from `<` to see whether a matching `>(`  pattern exists.
     *  Bounded by 32 tokens to keep cost cheap. */
    private couldBeTemplateCall(): boolean {
        let depth = 0;
        for (let i = 0; i < 64; i++) {
            const t = this.s.peek(i);
            if (!t) return false;
            if (t.kind === TokenKind.Operator) {
                if (t.text === '<') depth++;
                else if (t.text === '>') {
                    depth--;
                    if (depth === 0) {
                        const after = this.s.peek(i + 1);
                        return !!after && after.kind === TokenKind.Punctuation && after.text === '(';
                    }
                } else if (t.text === '>>') {
                    depth -= 2;
                    if (depth <= 0) {
                        const after = this.s.peek(i + 1);
                        return !!after && after.kind === TokenKind.Punctuation && after.text === '(';
                    }
                }
            }
            // Bail out on non-type-ish punctuation (semicolons, braces).
            if (t.kind === TokenKind.Punctuation && (t.text === ';' || t.text === '{' || t.text === '}')) return false;
        }
        return false;
    }

    private tryParseTemplateCall(callee: NodeExpr): NodeExprCall | null {
        // Consume '<', parse type args, expect '>', then '(...)'.
        if (!this.s.matchOp('<')) return null;
        const templateArgs: NodeType[] = [];
        try {
            templateArgs.push(this.parseType());
            while (this.s.matchOp(',')) templateArgs.push(this.parseType());
        } catch {
            return null;
        }
        if (!this.s.matchCloseAngle()) return null;
        if (!this.s.check(TokenKind.Punctuation, '(')) return null;
        this.s.advance();
        const args: NodeExpr[] = [];
        if (!this.s.check(TokenKind.Punctuation, ')')) this.parseExprListInto(args);
        this.s.expectPunct(')', `expected ')' after template-call arguments`);
        return {
            kind: NodeKind.ExprCall,
            range: { start: callee.range.start, end: this.s.prev()!.location.end },
            callee,
            templateArgs,
            args,
        };
    }

    private parsePrimary(): NodeExpr {
        const t = this.s.peek();
        if (!t) {
            this.s.error('expected expression', this.s.endLocation());
            return this.makeErrorExpr();
        }

        if (t.kind === TokenKind.Punctuation) {
            if (t.text === '(') return this.parseParenOrLambdaArrow();
            if (t.text === '[') return this.parseLambdaBracket();
            if (t.text === '{') return this.parseBraceInit();
        }
        if (t.kind === TokenKind.Operator && t.text === '@') return this.parseFuncRef();
        if (t.kind === TokenKind.FStringStart) return this.parseFString();

        if (t.kind === TokenKind.Number) {
            const n = this.s.advance()! as TokenNumber;
            // UDL: number followed by identifier starting with '_'
            const next = this.s.peek();
            if (next && next.kind === TokenKind.Identifier && next.text.startsWith('_')) {
                this.s.advance();
                const range: TextRange = { start: n.location.start, end: next.location.end };
                if (n.numericKind === 'float') {
                    // Float UDL — represent as user-defined literal too.
                    return {
                        kind: NodeKind.ExprLiteralUserDefined,
                        range,
                        number: n,
                        suffix: next as TokenIdentifier,
                    } as NodeExprLiteralUserDefined;
                }
                return {
                    kind: NodeKind.ExprLiteralUserDefined,
                    range,
                    number: n,
                    suffix: next as TokenIdentifier,
                } as NodeExprLiteralUserDefined;
            }
            if (n.numericKind === 'float') {
                return {
                    kind: NodeKind.ExprLiteralFloat,
                    range: { start: n.location.start, end: n.location.end },
                    token: n,
                } as NodeExprLiteralFloat;
            }
            return {
                kind: NodeKind.ExprLiteralInt,
                range: { start: n.location.start, end: n.location.end },
                token: n,
            } as NodeExprLiteralInt;
        }
        if (t.kind === TokenKind.String) {
            this.s.advance();
            return {
                kind: NodeKind.ExprLiteralString,
                range: { start: t.location.start, end: t.location.end },
                token: t as TokenString,
            } as NodeExprLiteralString;
        }
        if (t.kind === TokenKind.Char) {
            this.s.advance();
            return {
                kind: NodeKind.ExprLiteralChar,
                range: { start: t.location.start, end: t.location.end },
                token: t as TokenChar,
            } as NodeExprLiteralChar;
        }

        if (t.kind === TokenKind.Reserved) {
            if (t.text === 'true' || t.text === 'false') {
                this.s.advance();
                return {
                    kind: NodeKind.ExprLiteralBool,
                    range: { start: t.location.start, end: t.location.end },
                    token: t as TokenReserved,
                    value: t.text === 'true',
                } as NodeExprLiteralBool;
            }
            if (t.text === 'null' || t.text === 'nullptr') {
                this.s.advance();
                return {
                    kind: NodeKind.ExprLiteralNull,
                    range: { start: t.location.start, end: t.location.end },
                    token: t as TokenReserved,
                } as NodeExprLiteralNull;
            }
            if (t.text === 'this') {
                this.s.advance();
                return {
                    kind: NodeKind.ExprThis,
                    range: { start: t.location.start, end: t.location.end },
                    token: t as TokenReserved,
                } as NodeExprThis;
            }
            if (t.text === 'match') return this.parseMatchExpr();
            if (INTRINSIC_NAMES.has(t.text)) return this.parseIntrinsicExpr();
            if (isPrimitive(t.text) || CONTEXTUAL_AS_IDENT.has(t.text)) {
                // Type-name in expression position — used as namespace access mostly. Treat as Identifier.
                // Contextual keywords (`get`/`set`) used in expression context behave as identifiers.
                this.s.advance();
                return {
                    kind: NodeKind.ExprIdentifier,
                    range: { start: t.location.start, end: t.location.end },
                    token: t as TokenReserved,
                } as NodeExprIdentifier;
            }
            // Not a known expr-start reserved word; skip and emit error.
            this.s.error(`unexpected '${t.text}' in expression`, t.location);
            this.s.advance();
            return this.makeErrorExpr();
        }
        if (t.kind === TokenKind.Identifier) {
            // intrinsic by name?
            if (INTRINSIC_NAMES.has(t.text)) return this.parseIntrinsicExpr();
            this.s.advance();
            return {
                kind: NodeKind.ExprIdentifier,
                range: { start: t.location.start, end: t.location.end },
                token: t as TokenIdentifier,
            } as NodeExprIdentifier;
        }
        // Fallback
        this.s.error(`unexpected token in expression: '${t.text}'`, t.location);
        this.s.advance();
        return this.makeErrorExpr();
    }

    private parseFuncRef(): NodeExprFuncRef {
        const at = this.s.advance()!;
        const path = this.parseQualifiedName();
        return {
            kind: NodeKind.ExprFuncRef,
            range: this.s.rangeFromTokens(at),
            path,
        };
    }

    private parseIntrinsicExpr(): NodeExprIntrinsic {
        const nameTok = this.s.advance()!;
        const args: NodeExpr[] = [];
        let hasParens = false;
        if (this.s.matchPunct('(')) {
            hasParens = true;
            if (!this.s.check(TokenKind.Punctuation, ')')) this.parseExprListInto(args);
            this.s.expectPunct(')', `expected ')' after intrinsic args`);
        }
        return {
            kind: NodeKind.ExprIntrinsic,
            range: this.s.rangeFromTokens(nameTok),
            name: nameTok as TokenIdentifier | TokenReserved,
            args,
            hasParens,
        };
    }

    private parseParenOrLambdaArrow(): NodeExpr {
        // Two possible parses: `(expr)` paren, `(params) => body` lambda.
        // Decide via lookahead — if a matching `)` is followed by `=>`, it's a lambda.
        const m = this.s.mark();
        const open = this.s.advance()!; // '('

        if (this.peekIsLambdaArrow(open)) {
            this.s.restore(m);
            return this.parseLambdaArrow();
        }
        // If params look like a lambda but check failed (e.g. empty `()`), still test for `=>`
        // after closing paren.
        // Try parsing as expression first, but if the `)` is followed by `=>`, redo as lambda.
        // Take a fresh mark before tentative expr.
        this.s.restore(m);
        const m2 = this.s.mark();
        const o2 = this.s.advance()!; // '('
        // Try simple parenthesized expression
        if (this.s.matchPunct(')')) {
            // empty (): only valid as lambda
            if (this.s.checkText('=>')) {
                this.s.restore(m2);
                return this.parseLambdaArrow();
            }
            this.s.error(`unexpected '()' in expression`, o2.location);
            return this.makeErrorExpr();
        }
        const inner = this.parseExpr();
        if (!this.s.matchPunct(')')) {
            this.s.error(`expected ')'`, this.s.peek()?.location ?? o2.location);
        }
        // After ')' — if `=>`, it's still a lambda; we lose the param shape. Punt to error+identifier lambda.
        if (this.s.checkText('=>')) {
            this.s.restore(m2);
            return this.parseLambdaArrow();
        }
        return {
            kind: NodeKind.ExprParen,
            range: this.s.rangeFromTokens(o2),
            inner,
        } as NodeExprParen;
    }

    /** True if the `(...)` starting at the given `(` token is followed by `=>` after balanced close. */
    private peekIsLambdaArrow(openTok: TokenObject): boolean {
        void openTok;
        let depth = 1;
        let i = 0;
        while (true) {
            const t = this.s.peek(i);
            if (!t) return false;
            if (t.kind === TokenKind.Punctuation) {
                if (t.text === '(') depth++;
                else if (t.text === ')') {
                    depth--;
                    if (depth === 0) {
                        const after = this.s.peek(i + 1);
                        if (!after) return false;
                        return after.kind === TokenKind.Operator && after.text === '=>';
                    }
                }
            }
            if (t.kind === TokenKind.Punctuation && depth === 0 && (t.text === ';' || t.text === '{')) return false;
            i++;
            if (i > 256) return false;
        }
    }

    // BNF: LambdaBracket ::= '[' [ CaptureList ] ']' '(' [ ParamList ] ')' [ '->' Type ] Block
    private parseLambdaBracket(): NodeExprLambdaBracket {
        const open = this.s.advance()!; // '['
        const captures: NodeLambdaCapture[] = [];
        if (!this.s.check(TokenKind.Punctuation, ']')) {
            do {
                if (this.s.check(TokenKind.Punctuation, ']')) break;
                const cap = this.parseLambdaCapture();
                if (cap) captures.push(cap);
            } while (this.s.matchOp(','));
        }
        this.s.expectPunct(']', `expected ']' to close lambda captures`);
        this.s.expectPunct('(', `expected '(' in lambda`);
        const params = this.parseParamList();
        this.s.expectPunct(')', `expected ')' in lambda params`);
        let returnType: NodeType | null = null;
        if (this.s.check(TokenKind.Operator, '->')) {
            this.s.advance();
            returnType = this.parseType();
        }
        const body = this.parseBlock();
        return {
            kind: NodeKind.ExprLambdaBracket,
            range: this.s.rangeFromTokens(open),
            captures,
            params,
            returnType,
            body,
        };
    }

    private parseLambdaCapture(): NodeLambdaCapture | null {
        const startTok = this.s.peek();
        if (!startTok) return null;
        // `&` alone or `&IDENT`
        if (startTok.kind === TokenKind.Operator && startTok.text === '&') {
            this.s.advance();
            const name = this.s.peek();
            if (name && name.kind === TokenKind.Identifier) {
                this.s.advance();
                return {
                    kind: NodeKind.LambdaCapture,
                    range: this.s.rangeFromTokens(startTok),
                    byReference: true,
                    name: name as TokenIdentifier,
                    isDefault: false,
                };
            }
            return {
                kind: NodeKind.LambdaCapture,
                range: this.s.rangeFromTokens(startTok),
                byReference: true,
                name: null,
                isDefault: true,
            };
        }
        if (startTok.kind === TokenKind.Operator && startTok.text === '=') {
            this.s.advance();
            return {
                kind: NodeKind.LambdaCapture,
                range: this.s.rangeFromTokens(startTok),
                byReference: false,
                name: null,
                isDefault: true,
            };
        }
        if (startTok.kind === TokenKind.Identifier) {
            this.s.advance();
            return {
                kind: NodeKind.LambdaCapture,
                range: this.s.rangeFromTokens(startTok),
                byReference: false,
                name: startTok as TokenIdentifier,
                isDefault: false,
            };
        }
        this.s.error(`unexpected token in lambda capture`, startTok.location);
        this.s.advance();
        return null;
    }

    // BNF: LambdaArrow ::= '(' [ ParamList ] ')' '=>' ( Expr | Block )
    private parseLambdaArrow(): NodeExprLambdaArrow {
        const open = this.s.peek();
        const startTok = open ?? this.s.tokens[this.s.pos];
        this.s.expectPunct('(', `expected '(' in lambda`);
        const params = this.parseParamList();
        this.s.expectPunct(')', `expected ')' in lambda params`);
        this.s.expectOp('=>', `expected '=>' in lambda`);
        let body: NodeExpr | NodeStmtBlock;
        if (this.s.check(TokenKind.Punctuation, '{')) {
            body = this.parseBlock();
        } else {
            body = this.parseExpr();
        }
        return {
            kind: NodeKind.ExprLambdaArrow,
            range: this.s.rangeFromTokens(startTok!),
            params,
            body,
        };
    }

    /** `{ ... }` — array init or designated init, depending on inner content. */
    private parseBraceInit(): NodeExpr {
        const open = this.s.advance()!; // '{'
        // Designated: first non-`{` token is `.`
        if (this.s.check(TokenKind.Operator, '.')) {
            const fields: NodeDesignatedInitField[] = [];
            do {
                if (this.s.check(TokenKind.Punctuation, '}')) break;
                const f = this.parseDesignatedField();
                if (f) fields.push(f);
            } while (this.s.matchOp(','));
            this.s.expectPunct('}', `expected '}' after designated init`);
            return {
                kind: NodeKind.ExprDesignatedInit,
                range: this.s.rangeFromTokens(open),
                typeName: null,
                fields,
            } as NodeExprDesignatedInit;
        }
        // Array init / element list
        const elements: NodeExpr[] = [];
        if (!this.s.check(TokenKind.Punctuation, '}')) {
            elements.push(this.parseExpr());
            while (this.s.matchOp(',')) {
                if (this.s.check(TokenKind.Punctuation, '}')) break;
                elements.push(this.parseExpr());
            }
        }
        this.s.expectPunct('}', `expected '}' after array init`);
        return {
            kind: NodeKind.ExprArrayInit,
            range: this.s.rangeFromTokens(open),
            elements,
        } as NodeExprArrayInit;
    }

    private parseDesignatedField(): NodeDesignatedInitField | null {
        const dotStart = this.s.peek();
        this.s.expectOp('.', `expected '.' in designated init`);
        const nameTok = this.s.expectIdentifier(`expected field name after '.'`);
        if (!nameTok) return null;
        this.s.expectOp('=', `expected '=' in designated init`);
        const value = this.parseExpr();
        return {
            kind: NodeKind.DesignatedInitField,
            range: { start: (dotStart ?? nameTok).location.start, end: value.range.end },
            name: nameTok as TokenIdentifier,
            value,
        };
    }

    // BNF: Match ::= 'match' '(' Expr ')' '{' MatchArmList '}'
    private parseMatchExpr(): NodeExprMatch {
        const kw = this.s.advance()!;
        this.s.expectPunct('(', `expected '(' after 'match'`);
        const subject = this.parseExpr();
        this.s.expectPunct(')', `expected ')' after match subject`);
        this.s.expectPunct('{', `expected '{' for match arms`);
        const arms: NodeMatchArm[] = [];
        if (!this.s.check(TokenKind.Punctuation, '}')) {
            do {
                if (this.s.check(TokenKind.Punctuation, '}')) break;
                const arm = this.parseMatchArm();
                if (arm) arms.push(arm);
            } while (this.s.matchOp(','));
        }
        this.s.expectPunct('}', `expected '}' to close match`);
        return {
            kind: NodeKind.ExprMatch,
            range: this.s.rangeFromTokens(kw),
            subject,
            arms,
        };
    }

    private parseMatchArm(): NodeMatchArm | null {
        const startTok = this.s.peek();
        if (!startTok) return null;
        let pattern: NodeExpr;
        let isWildcard = false;
        // `_` wildcard
        if (startTok.kind === TokenKind.Identifier && startTok.text === '_') {
            this.s.advance();
            pattern = {
                kind: NodeKind.ExprIdentifier,
                range: { start: startTok.location.start, end: startTok.location.end },
                token: startTok as TokenIdentifier,
            } as NodeExprIdentifier;
            isWildcard = true;
        } else {
            pattern = this.parseExpr();
        }
        this.s.expectOp('=>', `expected '=>' in match arm`);
        const body = this.parseExpr();
        return {
            kind: NodeKind.MatchArm,
            range: { start: startTok.location.start, end: body.range.end },
            pattern,
            body,
            isWildcard,
        };
    }

    // BNF: FString ::= <FStringStart> { <FStringText> | <FStringExprOpen> Expr <FStringExprClose> } <FStringEnd>
    private parseFString(): NodeExprFString {
        const start = this.s.advance()!; // FStringStart
        const parts: NodeFStringPart[] = [];
        while (!this.s.isEOF) {
            const t = this.s.peek();
            if (!t) break;
            if (t.kind === TokenKind.FStringEnd) {
                this.s.advance();
                break;
            }
            if (t.kind === TokenKind.FStringText) {
                parts.push({ kind: 'text', token: this.s.advance() as TokenFStringText });
                continue;
            }
            if (t.kind === TokenKind.FStringExprOpen) {
                const open = this.s.advance()!;
                const expr = this.parseExpr();
                const close = this.s.peek();
                if (close && close.kind === TokenKind.FStringExprClose) this.s.advance();
                else this.s.error(`expected '}' in f-string interpolation`, this.s.peek()?.location ?? open.location);
                parts.push({
                    kind: 'expr',
                    expr,
                    openRange: { start: open.location.start, end: open.location.end },
                    closeRange: close
                        ? { start: close.location.start, end: close.location.end }
                        : { start: open.location.end, end: open.location.end },
                });
                continue;
            }
            // Unexpected — bail out.
            this.s.error(`unexpected token in f-string`, t.location);
            this.s.advance();
            break;
        }
        return {
            kind: NodeKind.ExprFString,
            range: this.s.rangeFromTokens(start),
            parts,
        };
    }

    private makeErrorExpr(): NodeExprIdentifier {
        const t = this.s.prev() ?? this.s.tokens[0];
        const start = t?.location.start ?? { line: 0, character: 0 };
        const end = t?.location.end ?? start;
        // Return a synthetic identifier so callers don't need to handle null.
        return {
            kind: NodeKind.ExprIdentifier,
            range: { start, end },
            token: {
                kind: TokenKind.Identifier,
                text: '<error>',
                location: { uri: this.s.fileUri, start, end },
            } as TokenIdentifier,
        };
    }

    // ---- Helpers ----

    private isReserved(t: TokenObject, text: string): boolean {
        return t.kind === TokenKind.Reserved && t.text === text;
    }

    /** True when the token at `offset` looks like a type-starter (primitive,
     *  type-prefix keyword such as `const`/`nullable`, or a plain identifier). */
    private isTypeStarterAt(offset: number): boolean {
        const t = this.s.peek(offset);
        if (!t) return false;
        if (t.kind === TokenKind.Identifier) return true;
        if (t.kind === TokenKind.Reserved) {
            if (isPrimitive(t.text)) return true;
            if (TYPE_PREFIX_KW.has(t.text)) return true;
        }
        return false;
    }
}
