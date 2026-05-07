import { TextLocation, TextPosition } from './textLocation';
import { TokenizerState, LexMode } from './tokenizerState';
import { isReserved } from './reservedWord';
import {
    TokenObject, TokenKind,
    TokenIdentifier, TokenReserved, TokenNumber, TokenChar, TokenString,
    TokenFStringStart, TokenFStringText, TokenFStringExprOpen, TokenFStringExprClose, TokenFStringEnd,
    TokenComment, TokenPreprocessor, TokenAnnotationOpen, TokenAnnotationClose,
    TokenOperator, TokenPunctuation, TokenEOF,
    NumericKind, StringKind, CommentKind,
} from './tokenObject';

// Multi-character operators in longest-match order
const MULTI_CHAR_OPERATORS: readonly string[] = [
    '<<=', '>>=',
    '[[', ']]',
    '<<', '>>', '==', '!=', '<=', '>=', '&&', '||',
    '++', '--',
    '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=',
    '->', '=>', '::',
];

const SINGLE_CHAR_OPERATORS = new Set([
    '+', '-', '*', '/', '%', '=', '<', '>', '!', '&', '|', '^', '~', '?', ':', '.', ',', '@',
]);

const PUNCTUATION_CHARS = new Set(['(', ')', '{', '}', '[', ']', ';']);

const PREPROCESSOR_DIRECTIVES = new Set([
    'include', 'define', 'undef', 'ifdef', 'ifndef',
    'if', 'elif', 'else', 'endif', 'pragma',
]);

function makeLoc(uri: string, start: TextPosition, end: TextPosition): TextLocation {
    return { uri, start: { ...start }, end: { ...end } };
}

function makeToken<T extends TokenObject>(obj: T): T { return obj; }

export interface TokenizeResult {
    tokens: TokenObject[];
    diagnostics: string[];
}

export function tokenize(uri: string, content: string): TokenObject[] {
    return tokenizeWithDiagnostics(uri, content).tokens;
}

export function tokenizeWithDiagnostics(uri: string, content: string): TokenizeResult {
    // Strip UTF-8 BOM if present
    const source = content.startsWith('﻿') ? content.slice(1) : content;
    const state = new TokenizerState(source);
    const tokens: TokenObject[] = [];

    while (!state.isEOF) {
        const tok = readNextToken(state, uri);
        if (tok !== null) tokens.push(tok);
    }

    const eofPos = state.currentPos();
    tokens.push(makeToken<TokenEOF>({
        kind: TokenKind.EOF,
        text: '',
        location: makeLoc(uri, eofPos, eofPos),
    }));

    return { tokens, diagnostics: state.diagnostics };
}

function readNextToken(state: TokenizerState, uri: string): TokenObject | null {
    // Skip whitespace (track positions via advance)
    skipWhitespace(state);
    if (state.isEOF) return null;

    if (state.mode === LexMode.FStringText) {
        return readFStringContent(state, uri);
    }

    return readNormalToken(state, uri);
}

function skipWhitespace(state: TokenizerState): void {
    while (!state.isEOF) {
        const ch = state.peek();
        if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
            state.advance();
        } else {
            break;
        }
    }
}

function readNormalToken(state: TokenizerState, uri: string): TokenObject | null {
    skipWhitespace(state);
    if (state.isEOF) return null;

    const startPos = state.currentPos();
    const ch = state.peek();

    // Comments: // and /* and /**
    if (ch === '/' && (state.peek(1) === '/' || state.peek(1) === '*')) {
        return readComment(state, uri, startPos);
    }

    // Preprocessor directive: # at start of line
    if (ch === '#' && isAtLineStart(state)) {
        return readPreprocessor(state, uri, startPos);
    }

    // F-string: f"
    if (ch === 'f' && state.peek(1) === '"') {
        return readFStringStart(state, uri, startPos);
    }

    // Heredoc: """
    if (ch === '"' && state.peek(1) === '"' && state.peek(2) === '"') {
        return readHeredoc(state, uri, startPos);
    }

    // Double-quoted string
    if (ch === '"') {
        return readDoubleString(state, uri, startPos);
    }

    // Char literal
    if (ch === "'") {
        return readCharLiteral(state, uri, startPos);
    }

    // Numbers
    if (isDigit(ch)) {
        return readNumber(state, uri, startPos);
    }

    // Identifiers / keywords / intrinsics
    if (isIdentStart(ch)) {
        return readIdentOrKeyword(state, uri, startPos);
    }

    // F-string expression close: } while in f-string expr context
    if (ch === '}' && state.inFString) {
        const frame = state.currentFrame!;
        if (frame.braceDepth > 0) {
            state.advance();
            const endPos = state.currentPos();
            state.exitFStringExpr();
            return makeToken<TokenFStringExprClose>({
                kind: TokenKind.FStringExprClose,
                text: '}',
                location: makeLoc(uri, startPos, endPos),
            });
        }
    }

    // Operators (longest match first)
    const opMatch = matchOperator(state);
    if (opMatch !== null) {
        // Handle [[ and ]] as annotation tokens
        if (opMatch === '[[') {
            state.advanceN(2);
            const endPos = state.currentPos();
            return makeToken<TokenAnnotationOpen>({
                kind: TokenKind.AnnotationOpen,
                text: '[[',
                location: makeLoc(uri, startPos, endPos),
            });
        }
        if (opMatch === ']]') {
            state.advanceN(2);
            const endPos = state.currentPos();
            return makeToken<TokenAnnotationClose>({
                kind: TokenKind.AnnotationClose,
                text: ']]',
                location: makeLoc(uri, startPos, endPos),
            });
        }
        state.advanceN(opMatch.length);
        const endPos = state.currentPos();
        return makeToken<TokenOperator>({
            kind: TokenKind.Operator,
            text: opMatch,
            location: makeLoc(uri, startPos, endPos),
        });
    }

    // Single-char operators
    if (SINGLE_CHAR_OPERATORS.has(ch)) {
        state.advance();
        const endPos = state.currentPos();
        return makeToken<TokenOperator>({
            kind: TokenKind.Operator,
            text: ch,
            location: makeLoc(uri, startPos, endPos),
        });
    }

    // Punctuation
    if (PUNCTUATION_CHARS.has(ch)) {
        // { while in f-string expr opens a nested brace (tracked for depth)
        if (ch === '{' && state.inFString) {
            const frame = state.currentFrame!;
            if (frame.braceDepth > 0) {
                // We're inside an expression already; just track the brace
                state.advance();
                const endPos = state.currentPos();
                // Increment brace depth so we don't prematurely close on }
                frame.braceDepth++;
                return makeToken<TokenPunctuation>({
                    kind: TokenKind.Punctuation,
                    text: ch,
                    location: makeLoc(uri, startPos, endPos),
                });
            }
        }
        // } while in f-string but braceDepth > 1 (nested { in expression)
        if (ch === '}' && state.inFString) {
            const frame = state.currentFrame!;
            if (frame.braceDepth > 1) {
                state.advance();
                const endPos = state.currentPos();
                frame.braceDepth--;
                return makeToken<TokenPunctuation>({
                    kind: TokenKind.Punctuation,
                    text: ch,
                    location: makeLoc(uri, startPos, endPos),
                });
            }
        }
        state.advance();
        const endPos = state.currentPos();
        return makeToken<TokenPunctuation>({
            kind: TokenKind.Punctuation,
            text: ch,
            location: makeLoc(uri, startPos, endPos),
        });
    }

    // Unknown character — skip with diagnostic
    state.addDiagnostic(`Unexpected character '${ch}'`, state.offset);
    state.advance();
    return null;
}

function isAtLineStart(state: TokenizerState): boolean {
    // Check backwards from current offset for only whitespace (not newline)
    const src = state.source;
    let i = state.offset - 1;
    while (i >= 0) {
        const c = src[i];
        if (c === '\n') return true;
        if (c !== ' ' && c !== '\t' && c !== '\r') return false;
        i--;
    }
    return true; // beginning of file
}

function isDigit(ch: string): boolean {
    return ch >= '0' && ch <= '9';
}

function isHexDigit(ch: string): boolean {
    return (ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F');
}

function isIdentStart(ch: string): boolean {
    return (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || ch === '_';
}

function isIdentPart(ch: string): boolean {
    return isIdentStart(ch) || isDigit(ch);
}

function matchOperator(state: TokenizerState): string | null {
    for (const op of MULTI_CHAR_OPERATORS) {
        if (state.peekStr(op.length) === op) return op;
    }
    return null;
}

// ---- Comment ----

function readComment(state: TokenizerState, uri: string, startPos: TextPosition): TokenComment {
    const ch1 = state.peek(1);
    if (ch1 === '/') {
        // Line comment
        let text = '';
        while (!state.isEOF && state.peek() !== '\n') {
            text += state.advance();
        }
        const endPos = state.currentPos();
        return { kind: TokenKind.Comment, text, commentKind: 'line', location: makeLoc(uri, startPos, endPos) };
    } else {
        // Block or doc comment
        state.advance(); // /
        state.advance(); // *
        const isDoc = state.peek() === '*' && state.peek(1) !== '/';
        let text = isDoc ? '/**' : '/*';
        if (isDoc) state.advance(); // consume extra *

        while (!state.isEOF) {
            if (state.peek() === '*' && state.peek(1) === '/') {
                text += state.advance(); // *
                text += state.advance(); // /
                break;
            }
            text += state.advance();
        }
        const endPos = state.currentPos();
        const commentKind: CommentKind = isDoc ? 'doc' : 'block';
        return { kind: TokenKind.Comment, text, commentKind, location: makeLoc(uri, startPos, endPos) };
    }
}

// ---- Preprocessor ----

function readPreprocessor(state: TokenizerState, uri: string, startPos: TextPosition): TokenPreprocessor {
    state.advance(); // consume #
    // Skip spaces after #
    while (!state.isEOF && (state.peek() === ' ' || state.peek() === '\t')) state.advance();
    // Read directive name
    let directive = '';
    while (!state.isEOF && isIdentPart(state.peek())) {
        directive += state.advance();
    }
    const endPos = state.currentPos();
    // Validate directive
    if (!PREPROCESSOR_DIRECTIVES.has(directive)) {
        state.addDiagnostic(`Unknown preprocessor directive '#${directive}'`, state.offset);
    }
    return {
        kind: TokenKind.Preprocessor,
        text: `#${directive}`,
        directive,
        location: makeLoc(uri, startPos, endPos),
    };
}

// ---- Strings ----

function readEscapeSequence(state: TokenizerState): string {
    if (state.isEOF) return '';
    const ch = state.peek();
    switch (ch) {
        case 'n': state.advance(); return '\\n';
        case 't': state.advance(); return '\\t';
        case 'r': state.advance(); return '\\r';
        case '\\': state.advance(); return '\\\\';
        case '"': state.advance(); return '\\"';
        case "'": state.advance(); return "\\'";
        case '0': state.advance(); return '\\0';
        case 'x': {
            state.advance();
            let hex = '\\x';
            for (let i = 0; i < 2 && !state.isEOF && isHexDigit(state.peek()); i++) hex += state.advance();
            return hex;
        }
        case 'u': {
            state.advance();
            let hex = '\\u';
            for (let i = 0; i < 4 && !state.isEOF && isHexDigit(state.peek()); i++) hex += state.advance();
            return hex;
        }
        default:
            return state.advance();
    }
}

function readDoubleString(state: TokenizerState, uri: string, startPos: TextPosition): TokenString {
    state.advance(); // "
    let text = '"';
    let closed = false;
    while (!state.isEOF) {
        const ch = state.peek();
        if (ch === '"') {
            text += state.advance();
            closed = true;
            break;
        }
        if (ch === '\n') {
            state.addDiagnostic('Unterminated string literal', state.offset);
            text += state.advance();
            break;
        }
        if (ch === '\\') {
            state.advance();
            text += '\\' + readEscapeSequence(state);
        } else {
            text += state.advance();
        }
    }
    if (!closed && !text.endsWith('\n')) {
        // EOF reached without closing quote and without newline break
        state.addDiagnostic('Unterminated string literal', state.offset);
    }
    const endPos = state.currentPos();
    return { kind: TokenKind.String, text, stringKind: 'double', location: makeLoc(uri, startPos, endPos) };
}

function readHeredoc(state: TokenizerState, uri: string, startPos: TextPosition): TokenString {
    state.advanceN(3); // """
    let text = '"""';
    while (!state.isEOF) {
        if (state.peekStr(3) === '"""') {
            text += state.advanceN(3);
            break;
        }
        text += state.advance();
    }
    const endPos = state.currentPos();
    return { kind: TokenKind.String, text, stringKind: 'heredoc', location: makeLoc(uri, startPos, endPos) };
}

function readCharLiteral(state: TokenizerState, uri: string, startPos: TextPosition): TokenChar {
    state.advance(); // '
    let text = "'";
    while (!state.isEOF) {
        const ch = state.peek();
        if (ch === "'") {
            text += state.advance();
            break;
        }
        if (ch === '\n') {
            state.addDiagnostic('Unterminated char literal', state.offset);
            break;
        }
        if (ch === '\\') {
            state.advance();
            text += '\\' + readEscapeSequence(state);
        } else {
            // Allow multi-byte UTF-8 by just collecting the char
            text += state.advance();
        }
    }
    const endPos = state.currentPos();
    return { kind: TokenKind.Char, text, location: makeLoc(uri, startPos, endPos) };
}

// ---- Numbers ----

function readNumber(state: TokenizerState, uri: string, startPos: TextPosition): TokenNumber {
    // Hex: 0x...
    if (state.peek() === '0' && (state.peek(1) === 'x' || state.peek(1) === 'X')) {
        let text = state.advanceN(2);
        while (!state.isEOF && isHexDigit(state.peek())) text += state.advance();
        const endPos = state.currentPos();
        return { kind: TokenKind.Number, text, numericKind: 'hex', location: makeLoc(uri, startPos, endPos) };
    }

    // Decimal integer or float
    let text = '';
    while (!state.isEOF && isDigit(state.peek())) text += state.advance();

    let isFloat = false;
    // Fractional part
    if (!state.isEOF && state.peek() === '.' && isDigit(state.peek(1))) {
        isFloat = true;
        text += state.advance(); // .
        while (!state.isEOF && isDigit(state.peek())) text += state.advance();
    }

    // Exponent
    if (!state.isEOF && (state.peek() === 'e' || state.peek() === 'E')) {
        isFloat = true;
        text += state.advance();
        if (!state.isEOF && (state.peek() === '+' || state.peek() === '-')) text += state.advance();
        while (!state.isEOF && isDigit(state.peek())) text += state.advance();
    }

    // float32 'f' suffix — consume 'f' even if followed by '_' (UDL: 1.5f_meter → number=1.5f, ident=_meter)
    if (!state.isEOF && state.peek() === 'f') {
        const nextCh = state.peek(1);
        // Consume 'f' if: end of input, whitespace/punctuation/operator follows, or '_' (UDL suffix)
        if (!nextCh || !isIdentPart(nextCh) || nextCh === '_') {
            text += state.advance();
            isFloat = true;
        }
    }

    // UDL check: if immediately followed by _ (e.g. 42_km → stop here, let identifier be next token)
    // The identifier starting with _ will be tokenized naturally on next iteration

    const endPos = state.currentPos();
    const numericKind: NumericKind = isFloat ? 'float' : 'int';
    return { kind: TokenKind.Number, text, numericKind, location: makeLoc(uri, startPos, endPos) };
}

// ---- Identifiers / Keywords ----

function readIdentOrKeyword(state: TokenizerState, uri: string, startPos: TextPosition): TokenIdentifier | TokenReserved {
    let text = '';
    while (!state.isEOF && isIdentPart(state.peek())) text += state.advance();
    const endPos = state.currentPos();
    const loc = makeLoc(uri, startPos, endPos);
    if (isReserved(text)) {
        return { kind: TokenKind.Reserved, text, location: loc };
    }
    return { kind: TokenKind.Identifier, text, location: loc };
}

// ---- F-strings ----

function readFStringStart(state: TokenizerState, uri: string, startPos: TextPosition): TokenFStringStart {
    state.advance(); // f
    state.advance(); // "
    state.pushFString();
    const endPos = state.currentPos();
    return { kind: TokenKind.FStringStart, text: 'f"', location: makeLoc(uri, startPos, endPos) };
}

function readFStringContent(state: TokenizerState, uri: string): TokenObject | null {
    if (state.isEOF) return null;
    const startPos = state.currentPos();

    const ch = state.peek();

    // End of f-string
    if (ch === '"') {
        state.advance();
        const endPos = state.currentPos();
        state.popFString();
        return makeToken<TokenFStringEnd>({
            kind: TokenKind.FStringEnd,
            text: '"',
            location: makeLoc(uri, startPos, endPos),
        });
    }

    // Expression open
    if (ch === '{') {
        state.advance();
        const endPos = state.currentPos();
        state.enterFStringExpr();
        return makeToken<TokenFStringExprOpen>({
            kind: TokenKind.FStringExprOpen,
            text: '{',
            location: makeLoc(uri, startPos, endPos),
        });
    }

    // Text segment — accumulate until { or " (handling escapes)
    let text = '';
    while (!state.isEOF) {
        const c = state.peek();
        if (c === '{' || c === '"') break;
        if (c === '\\') {
            state.advance();
            text += '\\' + readEscapeSequence(state);
        } else {
            text += state.advance();
        }
    }

    if (text.length === 0) return null;

    const endPos = state.currentPos();
    return makeToken<TokenFStringText>({
        kind: TokenKind.FStringText,
        text,
        location: makeLoc(uri, startPos, endPos),
    });
}
