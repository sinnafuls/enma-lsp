// Completion in non-symbol token contexts.
//
//   - Caret in comment → return [] (suppress completion).
//   - Caret in plain string literal → return [].
//   - Caret in `import "..."` / `#include "..."` string → glob workspace .em
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
