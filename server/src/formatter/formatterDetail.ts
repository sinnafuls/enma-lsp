// Per-construct formatting helpers for the Enma formatter.
//
// All public functions take a FormatterState and a target token text (or
// AST node range) and emit TextEdit entries via state.pushEdit().
//
// CRITICAL GUARDS enforced here:
//   1. state.isInFString() → no whitespace edits inside f-strings
//   2. Comment content is never mutated; only surrounding whitespace
//   3. // #region / // #endregion comments are treated as anchors

import * as lsp from 'vscode-languageserver';
import { TokenObject, TokenKind } from '../compiler_tokenizer/tokenObject';
import { TextPosition } from '../compiler_tokenizer/textLocation';
import {
    FormatterState,
    stepPosition,
    walkBackOverWhitespace,
    hasEditedNewlineAt,
} from './formatterState';

// ---- FormatTargetOption ------------------------------------------------

export interface FormatTargetOption {
    /** Condense whitespace on both sides. */
    condenseSides?: boolean;
    /** Remove leading space (attach to previous token). */
    condenseLeft?: boolean;
    /** Remove trailing space (attach to next token). */
    condenseRight?: boolean;
    /** Force a newline+indent before this token. */
    forceWrap?: boolean;
    /** Attach to end of previous logical line (like ';'). */
    connectTail?: boolean;
}

// ---- Low-level space insertion -----------------------------------------

function canInsertSpace(back: TokenObject | undefined, front: TokenObject): boolean {
    if (back === undefined) return false;
    const bt = back.location.end;
    const ft = front.location.start;
    // Tokens already adjacent in source → no space
    if (bt.line === ft.line && bt.character === ft.character) return false;
    return true;
}

function emitSpaceBeforeToken(state: FormatterState, tok: TokenObject): void {
    if (state.isInFString()) return;

    const tokenStart = tok.location.start;
    const spaceEnd: TextPosition   = tokenStart;
    const spaceStart: TextPosition = walkBackOverWhitespace(state.lines, spaceEnd);

    if (spaceStart.character === 0) {
        // At column 0: set indentation
        state.pushEdit(spaceStart, spaceEnd, state.getIndent());
    } else {
        const back = state.map.at({ line: spaceStart.line, character: spaceStart.character - 1 });
        const space = canInsertSpace(back, tok) ? ' ' : '';
        state.pushEdit(spaceStart, spaceEnd, space);
    }

    state.setAfterToken(tok);
}

// ---- formatMoveUntil ---------------------------------------------------

/** Advance cursor to `dest`, flushing comments and collapsing blank lines. */
export function formatMoveUntil(state: FormatterState, dest: TextPosition): void {
    let cur = state.getCursor();
    // lastProcessedLine: the line of the last token we actually processed.
    // Initialise to the line of whatever the cursor was sitting on — this covers
    // the "first token in file" case where we walk from line 0.
    let lastProcessedLine = cur.line;

    while (!state.isFinished()) {
        if (cur.line >= state.lines.length) {
            const lastLine = state.lines.length - 1;
            const lastChar = (state.lines[lastLine] ?? '').length;
            state.pushEdit(state.getCursor(), { line: lastLine, character: lastChar }, '\n');
            return;
        }

        const tok = state.map.at(cur);
        if (tok === undefined) {
            cur = stepPosition(state.lines, cur);
            state.setCursor(cur);
            continue;
        }

        // Blank-line collapse: measure from the line after the last processed token
        // to the line before this token.
        const tokLine = tok.location.start.line;
        const maxGap  = Math.max(0, state.settings.maxBlankLines);
        if (!state.isInFString() && tokLine > lastProcessedLine) {
            const blankCount = tokLine - lastProcessedLine - 1;
            if (blankCount > maxGap) {
                const blankStart = lastProcessedLine + 1;
                const blankEnd   = tokLine - 1;
                collapseBlankLines(state, blankStart, blankEnd, maxGap);
                cur = state.getCursor();
            }
        }

        const reached =
            cur.line > dest.line ||
            (cur.line === dest.line && cur.character >= dest.character);
        if (reached) break;

        // It's a token before dest — emit with spacing rules.
        lastProcessedLine = tok.location.end.line;
        emitSpaceBeforeToken(state, tok);
        cur = state.getCursor();
    }
}

/** Advance cursor to the first character of node.range.start. */
export function formatMoveToNodeStart(state: FormatterState, range: { start: TextPosition }): void {
    formatMoveUntil(state, range.start);
}

// ---- Blank-line collapse -----------------------------------------------

function collapseBlankLines(
    state: FormatterState,
    startLine: number,
    endLine: number,
    maxGap: number,
): void {
    // Only collapse truly blank lines (whitespace-only).
    for (let i = startLine; i <= endLine; i++) {
        if (!(/^\s*$/.test(state.lines[i] ?? ''))) return;
    }
    const keep = '\n'.repeat(Math.max(0, maxGap - 1));
    const rangeEnd: TextPosition = {
        line: endLine,
        character: (state.lines[endLine] ?? '').length - 1,
    };
    state.pushEdit({ line: startLine, character: 0 }, rangeEnd, keep);
    state.setCursor({ line: endLine + 1, character: 0 });
}

// ---- formatMoveToNonComment --------------------------------------------

/**
 * Walk forward, emitting comments with proper spacing, until a non-comment
 * token is found. Returns that token without consuming it.
 */
export function formatMoveToNonComment(state: FormatterState): TokenObject | undefined {
    let cur = state.getCursor();
    while (!state.isFinished()) {
        const tok = state.map.at(cur);
        if (tok === undefined) {
            cur = stepPosition(state.lines, cur);
            state.setCursor(cur);
            continue;
        }
        if (tok.kind === TokenKind.Comment) {
            emitSpaceBeforeToken(state, tok);
            cur = state.getCursor();
            continue;
        }
        return tok;
    }
    return undefined;
}

// ---- formatTargetBy ----------------------------------------------------

/**
 * Advance to the next non-comment token, assert it has text `target`,
 * apply spacing/wrap options, then consume it.
 * Returns true if the token was found and consumed, false otherwise.
 */
export function formatTargetBy(
    state: FormatterState,
    target: string,
    option: FormatTargetOption,
): boolean {
    let cur = state.getCursor();
    while (!state.isFinished()) {
        const tok = state.map.at(cur);
        if (tok === undefined) {
            cur = stepPosition(state.lines, cur);
            state.setCursor(cur);
            continue;
        }
        if (tok.kind === TokenKind.Comment) {
            emitSpaceBeforeToken(state, tok);
            cur = state.getCursor();
            continue;
        }

        // Not a comment — check if it's the target.
        if (state.textAt(cur, target.length) !== target) {
            return false;
        }

        executeFormatTarget(state, target, option, cur, tok);
        return true;
    }
    return false;
}

function executeFormatTarget(
    state: FormatterState,
    target: string,
    option: FormatTargetOption,
    cur: TextPosition,
    tok: TokenObject,
): void {
    if (state.isInFString()) {
        // Inside f-string: just advance cursor, no edits.
        state.setCursor({ line: cur.line, character: cur.character + target.length });
        return;
    }

    const isCondenseLeft  = state.popCondense() || option.condenseSides === true || option.condenseLeft === true;
    const isCondenseRight = option.condenseSides === true || option.condenseRight === true;
    if (isCondenseRight) state.pushCondense();

    const forceWrap = state.popWrap() || option.forceWrap === true;
    const frontSpace = isCondenseLeft ? '' : ' ';
    const tokStart: TextPosition = tok.location.start;

    if (!forceWrap && option.connectTail === true) {
        // Attach to the end of the current logical "line" (no preceding newline).
        const editStart = walkBackOverWhitespace(state.lines, state.getCursor());
        const leadingSpace = editStart.character === 0 ? state.getIndent() : '';
        state.pushEdit(editStart, tokStart, leadingSpace + frontSpace);
    } else {
        const gapStart = state.getCursor();
        const maxGap   = Math.max(0, state.settings.maxBlankLines);
        if (!state.isInFString() && cur.line - gapStart.line > 1 + maxGap) {
            collapseBlankLines(state, gapStart.line + 1, cur.line - 1, maxGap);
        }

        const editStart = state.getCursor();
        const walkedBack = walkBackOverWhitespace(state.lines, editStart);
        if (walkedBack.character === 0) {
            state.pushEdit(walkedBack, tokStart, state.getIndent());
        } else {
            const sameLine = editStart.line === tokStart.line;
            const from = sameLine
                ? walkedBack
                : walkBackOverWhitespace(state.lines, tokStart);
            const newText = sameLine
                ? (forceWrap ? '\n' + state.getIndent() : frontSpace)
                : state.getIndent();
            state.pushEdit(from, tokStart, newText);
        }
    }

    state.setCursor({ line: cur.line, character: cur.character + target.length });
}

// ---- Brace / paren / bracket block helpers ----------------------------

export function formatBraceBlock(
    state: FormatterState,
    action: () => void,
    bracePosition: 'sameLine' | 'nextLine' = 'sameLine',
    doIndent = true,
): void {
    const forceWrap = bracePosition === 'nextLine';
    if (!formatTargetBy(state, '{', { connectTail: !forceWrap, forceWrap })) return;

    const startLine = state.getCursor().line;

    if (doIndent) state.pushIndent();
    action();
    if (doIndent) state.popIndent();

    const endWrap =
        startLine !== state.getCursor().line ||
        hasEditedNewlineAt(state.getEdits(), startLine);
    formatTargetBy(state, '}', { forceWrap: endWrap });
}

export function formatParenBlock(
    state: FormatterState,
    action: () => void,
    condenseLeft = true,
): void {
    if (!formatTargetBy(state, '(', { condenseLeft, condenseRight: true })) return;
    state.pushIndent();
    action();
    state.popIndent();
    formatTargetBy(state, ')', { condenseLeft: true });
}

export function formatBracketBlock(
    state: FormatterState,
    action: () => void,
): void {
    if (!formatTargetBy(state, '[', { condenseSides: true })) return;
    state.pushIndent();
    action();
    state.popIndent();
    formatTargetBy(state, ']', { condenseLeft: true });
}

export function formatChevronBlock(
    state: FormatterState,
    action: () => void,
): void {
    if (!formatTargetBy(state, '<', { condenseSides: true })) return;
    state.pushIndent();
    action();
    state.popIndent();
    formatTargetBy(state, '>', { condenseLeft: true });
}

// ---- Comma list --------------------------------------------------------

export function formatCommaList(
    state: FormatterState,
    items: ReadonlyArray<unknown>,
    formatItem: (i: number) => void,
): void {
    for (let i = 0; i < items.length; i++) {
        if (i > 0) {
            formatTargetBy(state, ',', {
                condenseLeft: true,
                condenseRight: !state.settings.spaceAfterComma,
            });
        }
        formatItem(i);
    }
}

// ---- Binary operator spacing -------------------------------------------

export function formatBinaryOp(state: FormatterState, opText: string): void {
    const tight = !state.settings.spaceAroundBinaryOp;
    formatTargetBy(state, opText, {
        condenseLeft:  tight,
        condenseRight: tight,
    });
}
