import { TextLocation } from './textLocation';

export const enum TokenKind {
    Identifier      = 'identifier',
    Reserved        = 'reserved',
    Number          = 'number',
    Char            = 'char',
    String          = 'string',
    FStringStart    = 'fstring_start',
    FStringText     = 'fstring_text',
    FStringExprOpen = 'fstring_expr_open',
    FStringExprClose= 'fstring_expr_close',
    FStringEnd      = 'fstring_end',
    Comment         = 'comment',
    Preprocessor    = 'preprocessor',
    AnnotationOpen  = 'annotation_open',
    AnnotationClose = 'annotation_close',
    Operator        = 'operator',
    Punctuation     = 'punctuation',
    EOF             = 'eof',
}

export type NumericKind = 'int' | 'hex' | 'bin' | 'float' | 'udl-number-part';
export type StringKind  = 'single' | 'double' | 'heredoc';
export type CommentKind = 'line' | 'block' | 'doc';

export interface TokenBase {
    readonly location: TextLocation;
    readonly text: string;
}

export interface TokenIdentifier extends TokenBase {
    readonly kind: TokenKind.Identifier;
}

export interface TokenReserved extends TokenBase {
    readonly kind: TokenKind.Reserved;
}

export interface TokenNumber extends TokenBase {
    readonly kind: TokenKind.Number;
    readonly numericKind: NumericKind;
}

export interface TokenChar extends TokenBase {
    readonly kind: TokenKind.Char;
}

export interface TokenString extends TokenBase {
    readonly kind: TokenKind.String;
    readonly stringKind: StringKind;
}

export interface TokenFStringStart extends TokenBase {
    readonly kind: TokenKind.FStringStart;
}

export interface TokenFStringText extends TokenBase {
    readonly kind: TokenKind.FStringText;
}

export interface TokenFStringExprOpen extends TokenBase {
    readonly kind: TokenKind.FStringExprOpen;
}

export interface TokenFStringExprClose extends TokenBase {
    readonly kind: TokenKind.FStringExprClose;
}

export interface TokenFStringEnd extends TokenBase {
    readonly kind: TokenKind.FStringEnd;
}

export interface TokenComment extends TokenBase {
    readonly kind: TokenKind.Comment;
    readonly commentKind: CommentKind;
}

export interface TokenPreprocessor extends TokenBase {
    readonly kind: TokenKind.Preprocessor;
    readonly directive: string;
}

export interface TokenAnnotationOpen extends TokenBase {
    readonly kind: TokenKind.AnnotationOpen;
}

export interface TokenAnnotationClose extends TokenBase {
    readonly kind: TokenKind.AnnotationClose;
}

export interface TokenOperator extends TokenBase {
    readonly kind: TokenKind.Operator;
}

export interface TokenPunctuation extends TokenBase {
    readonly kind: TokenKind.Punctuation;
}

export interface TokenEOF extends TokenBase {
    readonly kind: TokenKind.EOF;
}

export type TokenObject =
    | TokenIdentifier
    | TokenReserved
    | TokenNumber
    | TokenChar
    | TokenString
    | TokenFStringStart
    | TokenFStringText
    | TokenFStringExprOpen
    | TokenFStringExprClose
    | TokenFStringEnd
    | TokenComment
    | TokenPreprocessor
    | TokenAnnotationOpen
    | TokenAnnotationClose
    | TokenOperator
    | TokenPunctuation
    | TokenEOF;

export function isTokenKind<K extends TokenKind>(
    token: TokenObject,
    kind: K,
): token is Extract<TokenObject, { kind: K }> {
    return token.kind === kind;
}
