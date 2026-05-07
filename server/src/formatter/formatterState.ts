// Formatter state — indent tracker, blank-line tracker, brace-style,
// and f-string verbatim guard.
//
// Design: token-stream cursor walks the original rawTokens array. The
// FormatterState emits TextEdit[] (incremental replacements) so the LSP
// can return them directly to the client.  AST nodes provide structural
// context (what kind of construct we're in); token positions provide the
// exact byte ranges that need editing.

import * as lsp from 'vscode-languageserver';
import { TokenObject, TokenKind } from '../compiler_tokenizer/tokenObject';
import { TextPosition } from '../compiler_tokenizer/textLocation';

// ---- Settings (passed in from server) ----------------------------------

export interface FormatterSettings {
    enabled: boolean;
    indentSpaces: number;
    useTabIndent: boolean;
    maxBlankLines: number;
    bracePosition: 'sameLine' | 'nextLine';
    spaceAfterComma: boolean;
    spaceAroundBinaryOp: boolean;
    alignDesignatedInit: boolean;
    fStringPreserveVerbatim: boolean;
}

export const defaultFormatterSettings: FormatterSettings = {
    enabled: true,
    indentSpaces: 4,
    useTabIndent: false,
    maxBlankLines: 1,
    bracePosition: 'sameLine',
    spaceAfterComma: true,
    spaceAroundBinaryOp: true,
    alignDesignatedInit: false,
    fStringPreserveVerbatim: true,
};

// ---- Line utilities ----------------------------------------------------

/** Split content preserving line-ending chars so character offsets stay correct. */
export function splitLines(content: string): string[] {
    const parts = content.split(/(\r?\n)/);
    const result: string[] = [];
    for (let i = 0; i < parts.length; i += 2) {
        const text = parts[i];
        const nl = i + 1 < parts.length ? parts[i + 1] : '';
        result.push(text + nl);
    }
    return result;
}

// ---- TokensMap ---------------------------------------------------------

/** Maps each (line, character) position to the token that covers it. */
export class TokensMap {
    private readonly map: (TokenObject | undefined)[][] = [];

    constructor(lines: string[], tokens: ReadonlyArray<TokenObject>) {
        for (const line of lines) {
            this.map.push(new Array<TokenObject | undefined>(line.length).fill(undefined));
        }
        for (const tok of tokens) {
            const s = tok.location.start;
            const e = tok.location.end;
            for (let li = s.line; li <= e.line; li++) {
                const row = this.map[li];
                if (row === undefined) continue;
                const colStart = li === s.line ? s.character : 0;
                const colEnd   = li === e.line ? e.character : row.length;
                for (let ci = colStart; ci < colEnd; ci++) {
                    row[ci] = tok;
                }
            }
        }
    }

    at(pos: TextPosition): TokenObject | undefined {
        return this.map[pos.line]?.[pos.character];
    }
}

// ---- FormatterState ----------------------------------------------------

interface IndentFrame {
    line: number;
    applied: boolean;
}

export class FormatterState {
    readonly lines: string[];
    readonly map: TokensMap;
    readonly settings: FormatterSettings;

    private edits: lsp.TextEdit[] = [];
    private cursor: TextPosition = { line: 0, character: 0 };

    private indentStack: IndentFrame[] = [];
    private indentBuf: string = '';
    private readonly indentUnit: string;

    private condenseNext = false;
    private wrapPending  = false;

    /** When > 0 we are inside an f-string and must not emit whitespace edits. */
    private fstringDepth = 0;

    constructor(
        readonly content: string,
        readonly tokens: ReadonlyArray<TokenObject>,
        settings: FormatterSettings,
    ) {
        this.settings = settings;
        this.lines    = splitLines(content);
        this.map      = new TokensMap(this.lines, tokens);
        this.indentUnit = settings.useTabIndent
            ? '\t'
            : ' '.repeat(Math.max(1, settings.indentSpaces));
    }

    // ---- cursor --------------------------------------------------------

    getCursor(): TextPosition { return { line: this.cursor.line, character: this.cursor.character }; }
    setCursor(p: TextPosition): void { this.cursor.line = p.line; this.cursor.character = p.character; }
    setAfterToken(tok: { location: { end: TextPosition } }): void { this.setCursor(tok.location.end); }

    isFinished(): boolean { return this.cursor.line >= this.lines.length; }

    advance(): void {
        this.cursor.character++;
        if (this.cursor.character >= (this.lines[this.cursor.line]?.length ?? 0)) {
            this.cursor.line++;
            this.cursor.character = 0;
        }
    }

    textAt(pos: TextPosition, len = 1): string {
        return (this.lines[pos.line] ?? '').substring(pos.character, pos.character + len);
    }

    // ---- indentation ---------------------------------------------------

    getIndent(): string { return this.indentBuf; }

    pushIndent(): void {
        this.indentStack.push({ line: this.cursor.line, applied: true });
        this.indentBuf += this.indentUnit;
    }

    popIndent(): void {
        const frame = this.indentStack.pop();
        if (frame?.applied) {
            this.indentBuf = this.indentBuf.slice(0, -this.indentUnit.length);
        }
    }

    // ---- condense / wrap flags ----------------------------------------

    pushCondense(): void { this.condenseNext = true; }
    popCondense(): boolean { const v = this.condenseNext; this.condenseNext = false; return v; }

    pushWrap(): void { this.wrapPending = true; }
    popWrap(): boolean { const v = this.wrapPending; this.wrapPending = false; return v; }

    // ---- f-string guard -----------------------------------------------

    enterFString(): void { this.fstringDepth++; }
    exitFString(): void  { this.fstringDepth = Math.max(0, this.fstringDepth - 1); }
    isInFString(): boolean { return this.fstringDepth > 0; }

    // ---- edit emission -------------------------------------------------

    pushEdit(start: TextPosition, end: TextPosition, newText: string): void {
        if (this.isInFString()) return;   // GUARD: never mutate f-string internals
        this.edits.push({ range: { start, end }, newText });
    }

    getEdits(): lsp.TextEdit[] { return this.edits; }
}

// ---- Helpers used by formatterDetail ----------------------------------

export function stepPosition(lines: string[], p: TextPosition): TextPosition {
    const result = { line: p.line, character: p.character + 1 };
    if (result.character >= (lines[result.line]?.length ?? 0)) {
        result.line++;
        result.character = 0;
    }
    return result;
}

export function walkBackOverWhitespace(lines: string[], p: TextPosition): TextPosition {
    const line = p.line;
    let ch = p.character;
    while (ch > 0) {
        const c = (lines[line] ?? '').charAt(ch - 1);
        if (!/\s/.test(c)) break;
        ch--;
    }
    return { line, character: ch };
}

export function hasEditedNewlineAt(edits: lsp.TextEdit[], line: number): boolean {
    for (const e of edits) {
        if (e.range.start.line === line && e.newText.includes('\n')) return true;
    }
    return false;
}
