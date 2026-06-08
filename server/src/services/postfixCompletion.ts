// Postfix completion provider.
//
// Detects the pattern `<expr>.` (dot just typed, caret immediately after)
// and returns structural snippet templates: .if, .for, .while, .not,
// .return, .null, .nnull.
//
// Returns undefined (not an empty array) when outside a postfix context so
// the caller can fall through to the regular member/scope provider.

import * as lsp from 'vscode-languageserver';

import { TextPosition } from '../compiler_tokenizer/textLocation';
import { TokenObject, TokenKind } from '../compiler_tokenizer/tokenObject';
import { positionLess, positionEq } from './utils';

interface PostfixEntry {
    readonly label: string;
    readonly insertText: string;
    readonly detail: string;
}

const POSTFIX_ENTRIES: ReadonlyArray<PostfixEntry> = [
    { label: 'if',     insertText: 'if ($0) { $1 }',   detail: 'if statement'     },
    { label: 'for',    insertText: 'for ($0) { $1 }',  detail: 'for loop'         },
    { label: 'while',  insertText: 'while ($0) { $1 }',detail: 'while loop'       },
    { label: 'not',    insertText: '!($0)',             detail: 'logical not'      },
    { label: 'return', insertText: 'return $0;',        detail: 'return statement' },
    { label: 'null',   insertText: '== null',           detail: 'null check'       },
    { label: 'nnull',  insertText: '!= null',           detail: 'non-null check'   },
];

export function providePostfixCompletions(
    rawTokens: ReadonlyArray<TokenObject>,
    caret: TextPosition,
): lsp.CompletionItem[] | undefined {
    // Accumulate meaningful tokens (non-comment, non-EOF) whose range fully
    // precedes or ends exactly at caret. Tokens that straddle the caret are
    // a partial word being typed — skip them rather than breaking.
    const meaningful: TokenObject[] = [];
    for (let i = 0; i < rawTokens.length; i++) {
        const t = rawTokens[i];
        if (t.kind === TokenKind.EOF) break;
        if (t.kind === TokenKind.Comment) continue;

        const endAtOrBefore =
            positionLess(t.location.end, caret) || positionEq(t.location.end, caret);
        const startsBefore = positionLess(t.location.start, caret);

        if (endAtOrBefore) {
            meaningful.push(t);
        } else if (startsBefore) {
            // Token straddles caret — partial token being typed; skip it.
            continue;
        } else {
            break;
        }
    }

    if (meaningful.length === 0) return undefined;

    // If the last token is an identifier (or reserved word typed so far),
    // skip it: the user is refining a postfix label that was already
    // triggered on the dot keystroke.
    let dotCandidate = meaningful[meaningful.length - 1];
    if (
        dotCandidate.kind === TokenKind.Identifier ||
        dotCandidate.kind === TokenKind.Reserved
    ) {
        if (meaningful.length < 2) return undefined;
        dotCandidate = meaningful[meaningful.length - 2];
    }

    // Require a `.` operator immediately before the caret (or the partial
    // identifier above). `->` and `::` are member/namespace access — not
    // postfix context.
    if (
        (dotCandidate.kind !== TokenKind.Operator &&
            dotCandidate.kind !== TokenKind.Punctuation) ||
        dotCandidate.text !== '.'
    ) {
        return undefined;
    }

    // Must have at least one non-dot token before the dot (a receiver).
    let hasReceiver = false;
    const dotPos = meaningful.indexOf(dotCandidate);
    for (let i = dotPos - 1; i >= 0; i--) {
        if (meaningful[i].kind !== TokenKind.Comment) {
            hasReceiver = true;
            break;
        }
    }
    if (!hasReceiver) return undefined;

    return POSTFIX_ENTRIES.map(e => ({
        label: e.label,
        kind: lsp.CompletionItemKind.Snippet,
        detail: e.detail,
        insertText: e.insertText,
        insertTextFormat: lsp.InsertTextFormat.Snippet,
    }));
}
