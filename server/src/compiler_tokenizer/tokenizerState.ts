import { TextPosition } from './textLocation';

export const enum LexMode {
    Normal      = 'normal',
    FStringText = 'fstring_text',
}

export interface FStringFrame {
    depth: number;       // nesting depth (1 = outermost f-string)
    braceDepth: number;  // brace depth within the current expression context
}

export class TokenizerState {
    private _source: string;
    private _offset: number;
    private _line: number;
    private _character: number;
    private _fstringStack: FStringFrame[];
    public readonly diagnostics: string[];

    constructor(source: string) {
        this._source = source;
        this._offset = 0;
        this._line = 0;
        this._character = 0;
        this._fstringStack = [];
        this.diagnostics = [];
    }

    get offset(): number { return this._offset; }
    get line(): number { return this._line; }
    get character(): number { return this._character; }
    get source(): string { return this._source; }
    get length(): number { return this._source.length; }
    get isEOF(): boolean { return this._offset >= this._source.length; }

    get fstringDepth(): number { return this._fstringStack.length; }
    get inFString(): boolean { return this._fstringStack.length > 0; }

    get currentFrame(): FStringFrame | undefined {
        return this._fstringStack[this._fstringStack.length - 1];
    }

    get mode(): LexMode {
        const frame = this.currentFrame;
        if (!frame) return LexMode.Normal;
        return frame.braceDepth === 0 ? LexMode.FStringText : LexMode.Normal;
    }

    currentPos(): TextPosition {
        return { line: this._line, character: this._character };
    }

    peek(ahead = 0): string {
        return this._source[this._offset + ahead] ?? '';
    }

    peekStr(len: number): string {
        return this._source.slice(this._offset, this._offset + len);
    }

    advance(): string {
        const ch = this._source[this._offset] ?? '';
        this._offset++;
        if (ch === '\n') {
            this._line++;
            this._character = 0;
        } else {
            this._character++;
        }
        return ch;
    }

    advanceN(n: number): string {
        let result = '';
        for (let i = 0; i < n; i++) result += this.advance();
        return result;
    }

    pushFString(): void {
        this._fstringStack.push({ depth: this._fstringStack.length + 1, braceDepth: 0 });
    }

    popFString(): void {
        this._fstringStack.pop();
    }

    enterFStringExpr(): void {
        const frame = this.currentFrame;
        if (frame) frame.braceDepth++;
    }

    exitFStringExpr(): void {
        const frame = this.currentFrame;
        if (frame && frame.braceDepth > 0) frame.braceDepth--;
    }

    addDiagnostic(message: string, offset: number): void {
        this.diagnostics.push(`offset ${offset}: ${message}`);
    }
}
