// Completion in non-symbol token contexts.
//
//   - Caret in comment → return [] (suppress completion).
//   - Caret in `import "..."` string → return stdlib module name completions.
//   - Caret in plain string literal → return [].
//   - Caret in `#include "..."` string → glob workspace .em
//     files relative to the file's directory; emit File completions.

import * as lsp from 'vscode-languageserver';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { TextPosition } from '../compiler_tokenizer/textLocation';
import { TokenObject, TokenKind } from '../compiler_tokenizer/tokenObject';
import { findTokenAtPosition } from './utils';

export function provideCompletionOfToken(
    rawTokens: ReadonlyArray<TokenObject>,
    caret: TextPosition,
): lsp.CompletionItem[] | undefined {
    const at = findTokenAtPosition(rawTokens, caret);
    if (at === undefined) return undefined;

    const t = at.token;

    if (t.kind === TokenKind.Comment) {
        return [];
    }

    if (t.kind === TokenKind.String) {
        if (isImportKeywordBefore(rawTokens, at.index)) {
            return MODULE_COMPLETIONS;
        }
        if (isIncludePathString(rawTokens, at.index)) {
            return globIncludeCompletions(t.location.uri, t.text);
        }
        return [];
    }

    return undefined;
}

function isIncludePathString(rawTokens: ReadonlyArray<TokenObject>, idx: number): boolean {
    for (let i = idx - 1; i >= 0 && i >= idx - 4; i--) {
        const t = rawTokens[i];
        if (t.kind === TokenKind.Comment) continue;
        if (t.kind === TokenKind.Preprocessor && /include/.test(t.text)) return true;
        if (t.kind === TokenKind.Reserved && t.text === 'import') return true;
        if (t.kind === TokenKind.Identifier && t.text === 'include') return true;
        if (t.kind === TokenKind.Punctuation && t.text === '#') continue;
        break;
    }
    return false;
}

// ---- Module completions -------------------------------------------------

const MODULE_COMPLETIONS: lsp.CompletionItem[] = [
    { label: 'arrays',     kind: lsp.CompletionItemKind.Module, insertText: 'arrays',     detail: 'array operations (sort, find, fill, map, filter, reduce)' },
    { label: 'atomic',     kind: lsp.CompletionItemKind.Module, insertText: 'atomic',     detail: 'atomic operations and memory barriers' },
    { label: 'bits',       kind: lsp.CompletionItemKind.Module, insertText: 'bits',       detail: 'bit manipulation (popcount, clz, ctz, byteswap)' },
    { label: 'fs',         kind: lsp.CompletionItemKind.Module, insertText: 'fs',         detail: 'filesystem I/O (read, write, list files/dirs)' },
    { label: 'hash_set',   kind: lsp.CompletionItemKind.Module, insertText: 'hash_set',   detail: 'unordered hash set' },
    { label: 'json',       kind: lsp.CompletionItemKind.Module, insertText: 'json',       detail: 'JSON serializer/deserializer' },
    { label: 'list',       kind: lsp.CompletionItemKind.Module, insertText: 'list',       detail: 'doubly-linked list' },
    { label: 'math',       kind: lsp.CompletionItemKind.Module, insertText: 'math',       detail: 'math functions (sin, cos, sqrt, pow, abs, floor, ceil, random)' },
    { label: 'math3d',     kind: lsp.CompletionItemKind.Module, insertText: 'math3d',     detail: '3D math (vec2/3/4, mat4, quat)' },
    { label: 'net',        kind: lsp.CompletionItemKind.Module, insertText: 'net',        detail: 'HTTP and WebSocket client' },
    { label: 'regex',      kind: lsp.CompletionItemKind.Module, insertText: 'regex',      detail: 'regular expressions' },
    { label: 'simd',       kind: lsp.CompletionItemKind.Module, insertText: 'simd',       detail: 'SIMD vector operations' },
    { label: 'sorted_map', kind: lsp.CompletionItemKind.Module, insertText: 'sorted_map', detail: 'sorted key-value map' },
    { label: 'string',     kind: lsp.CompletionItemKind.Module, insertText: 'string',     detail: 'string manipulation (split, join, trim, replace, format, parse)' },
    { label: 'thread',     kind: lsp.CompletionItemKind.Module, insertText: 'thread',     detail: 'threading (spawn, join, mutex, condition_variable)' },
    { label: 'time',       kind: lsp.CompletionItemKind.Module, insertText: 'time',       detail: 'time functions (now, sleep, format)' },
    { label: 'variant',    kind: lsp.CompletionItemKind.Module, insertText: 'variant',    detail: 'type-safe tagged union' },
    { label: 'vec',        kind: lsp.CompletionItemKind.Module, insertText: 'vec',        detail: 'vector math (dot, cross, normalize, lerp)' },
    { label: 'core',       kind: lsp.CompletionItemKind.Module, insertText: 'core',       detail: '(auto-registered) core built-ins (println, format, assert, sleep_ms)' },
];

function isImportKeywordBefore(rawTokens: ReadonlyArray<TokenObject>, idx: number): boolean {
    for (let i = idx - 1; i >= 0; i--) {
        const prev = rawTokens[i];
        if (prev.kind === TokenKind.Comment) continue;
        return prev.kind === TokenKind.Reserved && prev.text === 'import';
    }
    return false;
}

function globIncludeCompletions(uri: string, _stringText: string): lsp.CompletionItem[] {
    let baseDir: string;
    try {
        const fsPath = fileURLToPath(uri);
        baseDir = path.dirname(fsPath);
    } catch {
        // Synthetic URI (e.g. file:///fake/a.em in tests). Best effort: strip.
        const stripped = uri.replace(/^file:\/\//, '');
        baseDir = path.dirname(stripped.replace(/^\/([A-Za-z]:)/, '$1'));
    }

    const results: lsp.CompletionItem[] = [];
    const collect = (dir: string, prefix: string, depth: number): void => {
        if (depth > 4) return;
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const e of entries) {
            if (e.name.startsWith('.')) continue;
            if (e.isDirectory()) {
                collect(path.join(dir, e.name), prefix + e.name + '/', depth + 1);
            } else if (e.isFile() && e.name.endsWith('.em')) {
                results.push({
                    label: prefix + e.name,
                    kind: lsp.CompletionItemKind.File,
                });
            }
        }
    };
    collect(baseDir, '', 0);
    return results;
}
