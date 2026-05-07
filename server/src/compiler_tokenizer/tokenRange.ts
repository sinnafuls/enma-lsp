import { TextRange, TextPosition } from './textLocation';
import { TokenObject } from './tokenObject';

export interface TokenRange {
    first: TokenObject;
    last: TokenObject;
}

export function tokenRangeToTextRange(range: TokenRange): TextRange {
    return {
        start: range.first.location.start,
        end: range.last.location.end,
    };
}

export function spanTokens(tokens: TokenObject[]): TextRange | null {
    if (tokens.length === 0) return null;
    return {
        start: tokens[0].location.start,
        end: tokens[tokens.length - 1].location.end,
    };
}

export function containsPosition(range: TextRange, pos: TextPosition): boolean {
    const afterStart =
        pos.line > range.start.line ||
        (pos.line === range.start.line && pos.character >= range.start.character);
    const beforeEnd =
        pos.line < range.end.line ||
        (pos.line === range.end.line && pos.character <= range.end.character);
    return afterStart && beforeEnd;
}
