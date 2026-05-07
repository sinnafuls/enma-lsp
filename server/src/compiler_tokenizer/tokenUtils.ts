import { TokenObject, TokenKind, TokenNumber, TokenReserved, TokenIdentifier } from './tokenObject';
import { isReserved, isPrimitive, isIntrinsic } from './reservedWord';

export function isIdentifierToken(token: TokenObject): token is TokenIdentifier {
    return token.kind === TokenKind.Identifier;
}

export function isReservedToken(token: TokenObject): token is TokenReserved {
    return token.kind === TokenKind.Reserved;
}

export function isNumberToken(token: TokenObject): token is TokenNumber {
    return token.kind === TokenKind.Number;
}

export function isEOF(token: TokenObject): boolean {
    return token.kind === TokenKind.EOF;
}

export function isComment(token: TokenObject): boolean {
    return token.kind === TokenKind.Comment;
}

export function isFStringBoundary(token: TokenObject): boolean {
    return (
        token.kind === TokenKind.FStringStart ||
        token.kind === TokenKind.FStringText ||
        token.kind === TokenKind.FStringExprOpen ||
        token.kind === TokenKind.FStringExprClose ||
        token.kind === TokenKind.FStringEnd
    );
}

export function isOperatorText(token: TokenObject, text: string): boolean {
    return token.kind === TokenKind.Operator && token.text === text;
}

export function isPunctuationText(token: TokenObject, text: string): boolean {
    return token.kind === TokenKind.Punctuation && token.text === text;
}

export function isReservedWord(name: string): boolean {
    return isReserved(name);
}

export function isPrimitiveType(name: string): boolean {
    return isPrimitive(name);
}

export function isIntrinsicName(name: string): boolean {
    return isIntrinsic(name);
}

export function filterComments(tokens: TokenObject[]): TokenObject[] {
    return tokens.filter(t => t.kind !== TokenKind.Comment);
}

export function tokenText(token: TokenObject): string {
    return token.text;
}
