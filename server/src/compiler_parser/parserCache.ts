// §A1 incremental re-parse strategy.
// Coarse-grain top-level-declaration cache keyed by URI then by FNV-1a hash of the
// declaration's token-text stream.

import { TokenObject, TokenKind } from '../compiler_tokenizer/tokenObject';
import { NodeTopLevel } from './nodes';

/** FNV-1a 32-bit. */
export function fnv1a(text: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

export interface CachedDecl {
    readonly hash: number;
    readonly node: NodeTopLevel;
    /** Range of tokens (inclusive) that this decl spanned in the previous tokenization,
     *  used as a hint for caller. */
    readonly tokenStart: number;
    readonly tokenEnd: number;
}

export class ParserCache {
    private readonly perFile: Map<string, Map<number, CachedDecl>> = new Map();

    /** Look up a previously parsed top-level decl by hash. */
    get(uri: string, hash: number): CachedDecl | undefined {
        return this.perFile.get(uri)?.get(hash);
    }

    /** Record a parsed top-level decl for reuse. */
    set(uri: string, entry: CachedDecl): void {
        let m = this.perFile.get(uri);
        if (!m) { m = new Map(); this.perFile.set(uri, m); }
        m.set(entry.hash, entry);
    }

    /** Replace the cache for a URI (called at end of full parse). */
    replaceFile(uri: string, entries: ReadonlyArray<CachedDecl>): void {
        const m = new Map<number, CachedDecl>();
        for (const e of entries) m.set(e.hash, e);
        this.perFile.set(uri, m);
    }

    clearFile(uri: string): void { this.perFile.delete(uri); }
    clear(): void { this.perFile.clear(); }

    /** Diagnostic-only: count cached entries for a file. */
    sizeFor(uri: string): number { return this.perFile.get(uri)?.size ?? 0; }
}

/** Compute a hash for a contiguous token range using only the canonical token text. */
export function hashTokenRange(tokens: ReadonlyArray<TokenObject>, start: number, endExclusive: number): number {
    let h = 0x811c9dc5;
    for (let i = start; i < endExclusive; i++) {
        const t = tokens[i];
        if (!t) continue;
        const txt = t.text;
        for (let j = 0; j < txt.length; j++) {
            h ^= txt.charCodeAt(j);
            h = Math.imul(h, 0x01000193);
        }
        // Separator avoids `ab` and `a` `b` colliding.
        h ^= 0x1f;
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

/** Identify approximate top-level declaration boundaries in a token stream.
 *  Returns [start, endExclusive) indices for each candidate decl chunk. Uses brace-depth
 *  tracking + recognized-keyword starts. Result is approximate but stable for hashing. */
export function findTopLevelBoundaries(tokens: ReadonlyArray<TokenObject>): Array<[number, number]> {
    const result: Array<[number, number]> = [];
    const startKeywords = new Set([
        'namespace', 'class', 'struct', 'interface', 'enum', 'template',
        'import', 'using', 'typedef', 'mixin', 'delegate', 'extern', 'coroutine',
    ]);

    const n = tokens.length;
    let i = 0;
    while (i < n) {
        // Skip throwaway tokens between decls.
        const t = tokens[i];
        if (!t) { i++; continue; }
        // Skip comments/preprocessor leftovers — they are normally already stripped, but be defensive.
        if (t.kind === TokenKind.Comment || t.kind === TokenKind.Preprocessor) {
            i++; continue;
        }

        const declStart = i;
        // Look ahead — does this look like a decl that ends in `;` (single-line) or `}` (block-bodied)?
        let depth = 0;
        let foundEnd = false;
        let j = i;

        // We capture an arbitrary lookahead window; on `[[` annotations advance through them.
        // Skip leading annotations.
        while (j < n && tokens[j].kind === TokenKind.AnnotationOpen) {
            // walk to matching ']]'
            j++;
            while (j < n && tokens[j].kind !== TokenKind.AnnotationClose) j++;
            if (j < n) j++;  // skip ']]'
        }

        // Top-level keyword start? If so we will scan to its end.
        // Otherwise this is a free function or var — also block-bodied or ;-terminated.
        while (j < n) {
            const tj = tokens[j];
            if (tj.kind === TokenKind.Punctuation) {
                if (tj.text === '{') depth++;
                else if (tj.text === '}') {
                    depth--;
                    if (depth === 0) { j++; foundEnd = true; break; }
                } else if (tj.text === ';' && depth === 0) { j++; foundEnd = true; break; }
            }
            j++;
        }

        if (!foundEnd) j = n;
        result.push([declStart, j]);
        i = j;

        // Sanity guard: if we somehow didn't advance, force-step.
        if (i === declStart) i++;

        // We don't enforce startKeywords — we treat every chunk between boundary markers as a decl
        // candidate. The caller may verify it parsed cleanly before storing. The startKeywords set
        // above is exported for callers wanting a hint.
        void startKeywords;
    }
    return result;
}
