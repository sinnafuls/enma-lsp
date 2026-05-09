// Parser cursor + error-recovery state.

import { TextLocation, TextRange, TextPosition, createPosition } from '../compiler_tokenizer/textLocation';
import { TokenObject, TokenKind } from '../compiler_tokenizer/tokenObject';
import { isPrimitive } from '../compiler_tokenizer/reservedWord';
import { Diagnostic } from './parserPreprocess';

export class ParserState {
    private _pos = 0;
    private readonly _tokens: ReadonlyArray<TokenObject>;
    readonly diagnostics: Diagnostic[] = [];
    readonly fileUri: string;

    /** Set of reserved words that act as top-level decl boundary keywords for panic recovery. */
    static readonly TOP_LEVEL_KEYWORDS = new Set([
        'namespace', 'class', 'struct', 'interface', 'enum', 'template',
        'import', 'using', 'typedef', 'mixin', 'delegate', 'extern', 'coroutine',
    ]);

    constructor(tokens: ReadonlyArray<TokenObject>, fileUri: string) {
        // Strip EOF — we sentinel manually. Keep all other tokens.
        this._tokens = tokens.filter(t => t.kind !== TokenKind.EOF);
        this.fileUri = fileUri;
    }

    get pos(): number { return this._pos; }
    get tokens(): ReadonlyArray<TokenObject> { return this._tokens; }
    get isEOF(): boolean { return this._pos >= this._tokens.length; }
    get length(): number { return this._tokens.length; }

    peek(offset = 0): TokenObject | undefined {
        return this._tokens[this._pos + offset];
    }

    /** Returns the previously-consumed token, or undefined at start. */
    prev(): TokenObject | undefined {
        return this._tokens[this._pos - 1];
    }

    advance(): TokenObject | undefined {
        return this._tokens[this._pos++];
    }

    /** Save the current position; restorable via restore(). */
    mark(): number { return this._pos; }
    restore(mark: number): void { this._pos = mark; }

    /** Jump to a specific position (used by parserCache for cached subtree skipping). */
    jumpTo(pos: number): void { this._pos = pos; }

    /** True if current token matches given kind+text (text optional). */
    check(kind: TokenKind, text?: string): boolean {
        const t = this.peek();
        if (!t) return false;
        if (t.kind !== kind) return false;
        if (text !== undefined && t.text !== text) return false;
        return true;
    }

    /** Convenience: check + advance if matched. Returns the token or null. */
    match(kind: TokenKind, text?: string): TokenObject | null {
        if (this.check(kind, text)) return this.advance() ?? null;
        return null;
    }

    /** Match a reserved keyword by its text. */
    matchReserved(text: string): TokenObject | null {
        return this.match(TokenKind.Reserved, text);
    }

    /** Match a punctuation by its text. */
    matchPunct(text: string): TokenObject | null {
        return this.match(TokenKind.Punctuation, text);
    }

    /** Match an operator by its text. */
    matchOp(text: string): TokenObject | null {
        return this.match(TokenKind.Operator, text);
    }

    /** Match a closing '>' for type-args / template-params, transparently splitting
     *  a '>>' (right-shift) token when the tokenizer merged two consecutive '>'s.
     *  On '>>' we mutate the token in place to a single '>' covering the second
     *  column without advancing — the outer scope's matchCloseAngle()/matchOp('>')
     *  call will then consume the leftover. Returns true if a '>' was matched. */
    matchCloseAngle(): boolean {
        const t = this.peek();
        if (!t || t.kind !== TokenKind.Operator) return false;
        if (t.text === '>') { this.advance(); return true; }
        if (t.text === '>>') {
            const start = t.location.start;
            const end = t.location.end;
            const mid = createPosition(start.line, start.character + 1);
            const second: TokenObject = {
                kind: TokenKind.Operator,
                text: '>',
                location: { uri: t.location.uri, start: mid, end },
            };
            (this._tokens as TokenObject[])[this._pos] = second;
            return true;
        }
        return false;
    }

    /** Check current token text equals the given text (regardless of kind, for keyword-or-op punctuation). */
    checkText(text: string): boolean {
        const t = this.peek();
        return !!t && t.text === text;
    }

    /** Expect a specific token; emit diagnostic if missing, return null. Always advances if matched. */
    expect(kind: TokenKind, text?: string, errMsg?: string): TokenObject | null {
        const t = this.peek();
        if (t && t.kind === kind && (text === undefined || t.text === text)) {
            this.advance();
            return t;
        }
        const msg = errMsg ?? `expected '${text ?? kind}'${t ? `, got '${t.text}'` : ' at end of file'}`;
        this.error(msg, t?.location ?? this.endLocation());
        return null;
    }

    expectPunct(text: string, errMsg?: string): TokenObject | null {
        return this.expect(TokenKind.Punctuation, text, errMsg);
    }

    expectOp(text: string, errMsg?: string): TokenObject | null {
        return this.expect(TokenKind.Operator, text, errMsg);
    }

    expectReserved(text: string, errMsg?: string): TokenObject | null {
        return this.expect(TokenKind.Reserved, text, errMsg);
    }

    expectIdentifier(errMsg?: string): TokenObject | null {
        return this.expect(TokenKind.Identifier, undefined, errMsg ?? 'expected identifier');
    }

    /** Push a diagnostic. */
    error(message: string, location: TextLocation): void {
        this.diagnostics.push({ severity: 'error', message, location });
    }

    warn(message: string, location: TextLocation): void {
        this.diagnostics.push({ severity: 'warning', message, location });
    }

    /** Location at end-of-file (best-effort). */
    endLocation(): TextLocation {
        const last = this._tokens[this._tokens.length - 1];
        if (last) return { uri: this.fileUri, start: last.location.end, end: last.location.end };
        const zero: TextPosition = createPosition(0, 0);
        return { uri: this.fileUri, start: zero, end: zero };
    }

    /** Range covering [startTok, endTok-prev) for AST building. */
    rangeFromTokens(startTok: TokenObject, endTok?: TokenObject): TextRange {
        const end = endTok ? endTok.location.end : (this.prev()?.location.end ?? startTok.location.end);
        return { start: startTok.location.start, end };
    }

    /** Range from a starting position to current cursor. */
    rangeFromPos(startPos: number): TextRange {
        const start = this._tokens[startPos]?.location.start ?? createPosition(0, 0);
        const end = this.prev()?.location.end ?? start;
        return { start, end };
    }

    /** Panic recovery: advance until we hit ';', '}', a top-level keyword, an annotation
     *  opener, or a primitive-type-followed-by-identifier (likely-decl-start), or EOF.
     *  Does NOT bracket-balance through `{...}` — any `}` is a recovery point so the
     *  enclosing scope can resume cleanly. Returns true if a recovery point was found. */
    panicRecover(): boolean {
        while (!this.isEOF) {
            const t = this.peek()!;
            if (t.kind === TokenKind.Punctuation) {
                if (t.text === '}') return true;        // do not consume — caller decides
                if (t.text === ';') {
                    this.advance();                     // consume the ';'
                    return true;
                }
            }
            if (t.kind === TokenKind.AnnotationOpen) return true;
            if (t.kind === TokenKind.Reserved) {
                if (ParserState.TOP_LEVEL_KEYWORDS.has(t.text)) return true;
                // Primitive type followed by identifier looks like a decl start.
                if (isPrimitive(t.text)) {
                    const next = this.peek(1);
                    if (next && (next.kind === TokenKind.Identifier
                        || next.kind === TokenKind.Operator)) {
                        // primitive then ident → decl; primitive then '*' '&' '<' → type+decl
                        return true;
                    }
                }
            }
            this.advance();
        }
        return false;
    }

    /** Skip until a closing delimiter at current depth (for argument-list / paren recovery). */
    skipUntilBalancedClose(closeText: string): boolean {
        let depth = 0;
        while (!this.isEOF) {
            const t = this.peek()!;
            if (t.kind === TokenKind.Punctuation) {
                if (t.text === '(' || t.text === '[' || t.text === '{') {
                    depth++; this.advance(); continue;
                }
                if (t.text === ')' || t.text === ']' || t.text === '}') {
                    if (depth === 0 && t.text === closeText) {
                        this.advance();
                        return true;
                    }
                    if (depth > 0) { depth--; this.advance(); continue; }
                    return false;                       // mismatched delimiter
                }
            }
            this.advance();
        }
        return false;
    }
}

/** Sentinel error used to bail out of the current decl in deep recursion;
 *  caught by the top-level loop which then runs panicRecover. */
export class ParseRecoveryError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ParseRecoveryError';
    }
}
