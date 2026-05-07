export interface TextPosition {
    line: number;    // 0-based
    character: number; // 0-based
}

export interface TextRange {
    start: TextPosition;
    end: TextPosition;
}

export interface TextLocation {
    uri: string;
    start: TextPosition;
    end: TextPosition;
}

export function createPosition(line: number, character: number): TextPosition {
    return { line, character };
}

export function createRange(start: TextPosition, end: TextPosition): TextRange {
    return { start, end };
}

export function createLocation(uri: string, start: TextPosition, end: TextPosition): TextLocation {
    return { uri, start, end };
}

export function positionEquals(a: TextPosition, b: TextPosition): boolean {
    return a.line === b.line && a.character === b.character;
}

export function positionBefore(a: TextPosition, b: TextPosition): boolean {
    return a.line < b.line || (a.line === b.line && a.character < b.character);
}
