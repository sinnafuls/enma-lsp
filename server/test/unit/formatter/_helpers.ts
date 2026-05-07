// Test helpers for formatter unit tests.
// Builds the full tokenize→parse pipeline and applies formatFile.

process.env.ENMA_LSP_TEST = '1';

import * as lsp from 'vscode-languageserver';
import { tokenize } from '../../../src/compiler_tokenizer/tokenizer';
import { preprocessAfterTokenized } from '../../../src/compiler_parser/parserPreprocess';
import { parseAfterPreprocessed } from '../../../src/compiler_parser/parser';
import { formatFile } from '../../../src/formatter/formatter';
import { FormatterSettings, defaultFormatterSettings } from '../../../src/formatter/formatterState';

export const TEST_URI = 'file:///test.em';

export function formatSource(
    src: string,
    settings: Partial<FormatterSettings> = {},
    uri = TEST_URI,
): string {
    const effectiveSettings: FormatterSettings = { ...defaultFormatterSettings, ...settings };
    const tokens  = tokenize(uri, src);
    const pre     = preprocessAfterTokenized(tokens, { fileUri: uri });
    const parsed  = parseAfterPreprocessed(pre, { fileUri: uri });
    const edits   = formatFile(src, tokens, parsed.ast, effectiveSettings);
    return applyTextEdits(src, edits);
}

/** Apply LSP TextEdit[] to a string, producing the formatted output. */
export function applyTextEdits(content: string, edits: lsp.TextEdit[]): string {
    if (edits.length === 0) return content;

    const lines = content.split('\n');

    // Sort edits in reverse document order so applying them doesn't shift positions.
    const sorted = [...edits].sort((a, b) => {
        const lineDiff = b.range.start.line - a.range.start.line;
        if (lineDiff !== 0) return lineDiff;
        return b.range.start.character - a.range.start.character;
    });

    // Convert to offset-based for simpler application.
    const offsets = buildOffsets(content);

    let result = content;
    for (const edit of sorted) {
        const start = posToOffset(offsets, edit.range.start.line, edit.range.start.character);
        const end   = posToOffset(offsets, edit.range.end.line,   edit.range.end.character);
        if (start < 0 || end < 0 || start > result.length || end > result.length) continue;
        result = result.slice(0, start) + edit.newText + result.slice(end);
    }

    return result;
}

function buildOffsets(content: string): number[] {
    const offsets: number[] = [0];
    for (let i = 0; i < content.length; i++) {
        if (content[i] === '\n') offsets.push(i + 1);
    }
    return offsets;
}

function posToOffset(offsets: number[], line: number, character: number): number {
    if (line >= offsets.length) return offsets[offsets.length - 1] ?? 0;
    return (offsets[line] ?? 0) + character;
}

/** Format twice and assert idempotency. Returns the once-formatted string. */
export function assertIdempotent(src: string, settings: Partial<FormatterSettings> = {}): string {
    const once  = formatSource(src, settings);
    const twice = formatSource(once, settings);
    if (once !== twice) {
        throw new Error(
            `Idempotency failure!\n--- first format ---\n${once}\n--- second format ---\n${twice}`
        );
    }
    return once;
}

/** Extract the verbatim bytes of f-string tokens from formatted output. */
export function extractFStrings(content: string, uri = TEST_URI): string[] {
    const tokens = tokenize(uri, content);
    // Collect contiguous runs from FStringStart to FStringEnd
    const result: string[] = [];
    const lines = content.split('\n');

    let i = 0;
    while (i < tokens.length) {
        const t = tokens[i];
        if (t.kind === 'fstring_start') {
            // Find the matching end
            let depth = 0;
            let j = i;
            while (j < tokens.length) {
                if (tokens[j].kind === 'fstring_start') depth++;
                if (tokens[j].kind === 'fstring_end') {
                    depth--;
                    if (depth === 0) break;
                }
                j++;
            }
            // Extract text from i start to j end
            const startTok = tokens[i];
            const endTok   = tokens[j];
            const fstr = extractSpan(content, startTok.location.start, endTok.location.end);
            result.push(fstr);
            i = j + 1;
        } else {
            i++;
        }
    }
    return result;
}

function extractSpan(
    content: string,
    start: { line: number; character: number },
    end:   { line: number; character: number },
): string {
    const lines = content.split('\n');
    if (start.line === end.line) {
        return lines[start.line].slice(start.character, end.character);
    }
    const parts: string[] = [];
    parts.push(lines[start.line].slice(start.character));
    for (let l = start.line + 1; l < end.line; l++) {
        parts.push(lines[l]);
    }
    parts.push(lines[end.line].slice(0, end.character));
    return parts.join('\n');
}
