// Document link provider — turns `#include "path"` targets into clickable links.
//
// The preprocessor already collected every include path token (with its source
// location). We map each to a DocumentLink whose target URI is produced by the
// injected resolver (the inspector's resolveIncludeUri, bound to the includer).

import * as lsp from 'vscode-languageserver';

import { TextLocation } from '../compiler_tokenizer/textLocation';
import { TokenString } from '../compiler_tokenizer/tokenObject';

/** Strip the surrounding `"..."` or `<...>` from an include path token. */
function stripQuotes(raw: string): string {
    if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith('<') && raw.endsWith('>'))) {
        return raw.slice(1, -1);
    }
    return raw;
}

function rangeOf(loc: TextLocation): lsp.Range {
    return {
        start: { line: loc.start.line, character: loc.start.character },
        end: { line: loc.end.line, character: loc.end.character },
    };
}

export function provideDocumentLinks(
    includePathTokens: ReadonlyArray<TokenString>,
    resolve: (relPath: string) => string | undefined,
): lsp.DocumentLink[] {
    const out: lsp.DocumentLink[] = [];
    for (const token of includePathTokens) {
        const relPath = stripQuotes(token.text);
        if (relPath.length === 0) continue;
        const target = resolve(relPath);
        if (target === undefined) continue;
        out.push({
            range: rangeOf(token.location),
            target,
            tooltip: `Open ${relPath}`,
        });
    }
    return out;
}
