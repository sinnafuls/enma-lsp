// Service tests — documentHighlight, typeDefinition, implementation, selectionRange.
//
// Drives the real pipeline through the Inspector so the providers receive the
// same rawTokens / analyzer scope they get at runtime.

process.env.ENMA_LSP_TEST = '1';

import * as assert from 'node:assert/strict';

import { Inspector } from '../../../src/inspector/inspector';
import { provideDocumentHighlight } from '../../../src/services/documentHighlight';
import { provideTypeDefinition, provideImplementation } from '../../../src/services/navigation';
import { provideSelectionRanges } from '../../../src/services/selectionRange';
import * as lsp from 'vscode-languageserver';

function recordFor(source: string) {
    const inspector = new Inspector();
    const uri = 'file:///fake/test.em';
    inspector.inspectFile(uri, source, { isOpen: true });
    inspector.flush();
    const r = inspector.getRecord(uri);
    assert.ok(r, 'record exists');
    return r!;
}

/** Line/character of the `n`-th (1-based) occurrence of `needle`, pointing inside it. */
function posOf(source: string, needle: string, n = 1) {
    const lines = source.split('\n');
    let count = 0;
    for (let line = 0; line < lines.length; line++) {
        let from = 0;
        for (;;) {
            const idx = lines[line].indexOf(needle, from);
            if (idx < 0) break;
            count++;
            if (count === n) return { line, character: idx };
            from = idx + needle.length;
        }
    }
    throw new Error(`occurrence ${n} of "${needle}" not found`);
}

describe('service: documentHighlight', () => {
    const src = [
        'int32 counter = 0;',
        'int32 main() {',
        '  counter = counter + 1;',
        '  counter++;',
        '  return counter;',
        '}',
    ].join('\n');

    it('highlights every occurrence of the identifier under the caret', () => {
        const r = recordFor(src);
        const hl = provideDocumentHighlight(r.rawTokens, posOf(src, 'counter', 5));
        // 5 occurrences: decl + assign-lhs + assign-rhs + ++ + return.
        assert.equal(hl.length, 5, `expected 5 highlights, got ${hl.length}`);
    });

    it('classifies assignment and ++ as Write, reads as Read', () => {
        const r = recordFor(src);
        const hl = provideDocumentHighlight(r.rawTokens, posOf(src, 'counter', 5));
        const writes = hl.filter((h) => h.kind === lsp.DocumentHighlightKind.Write).length;
        const reads = hl.filter((h) => h.kind === lsp.DocumentHighlightKind.Read).length;
        // decl(=), assign-lhs(=), ++  -> 3 writes; rhs + return -> 2 reads.
        assert.equal(writes, 3, `expected 3 writes, got ${writes}`);
        assert.equal(reads, 2, `expected 2 reads, got ${reads}`);
    });

    it('returns nothing when caret is not on an identifier', () => {
        const r = recordFor(src);
        const hl = provideDocumentHighlight(r.rawTokens, { line: 0, character: 0 });
        assert.equal(hl.length, 0);
    });
});

describe('service: typeDefinition', () => {
    // NOTE: the analyzer does not yet emit scope-region info, so only globally
    // resolvable symbols (globals, types) are reachable — the same limitation
    // the `definition` provider has for locals. We test the supported cases.
    const src = [
        'struct Vec { int64 x; int64 y; }',
        'Vec g_v;',
        'int32 main() { return 0; }',
    ].join('\n');

    it('jumps from a (global) variable to its type declaration', () => {
        const r = recordFor(src);
        const locs = provideTypeDefinition(r.analyzerScope.globalScope, r.rawTokens, posOf(src, 'g_v'));
        assert.equal(locs.length, 1, 'one type-definition location');
        assert.equal(locs[0].range.start.line, 0, 'points at the Vec declaration line');
    });

    it('a type identifier resolves to its own declaration', () => {
        const r = recordFor(src);
        const locs = provideTypeDefinition(r.analyzerScope.globalScope, r.rawTokens, posOf(src, 'Vec', 2));
        assert.equal(locs.length, 1);
        assert.equal(locs[0].range.start.line, 0);
    });
});

describe('service: implementation', () => {
    const src = [
        'interface Shape { }',
        'class Circle : Shape { }',
        'class Square : Shape { }',
    ].join('\n');

    it('lists concrete types deriving from the interface under the caret', () => {
        const r = recordFor(src);
        const locs = provideImplementation(r.analyzerScope.globalScope, r.rawTokens, posOf(src, 'Shape', 1));
        const lines = locs.map((l) => l.range.start.line).sort((a, b) => a - b);
        assert.deepEqual(lines, [1, 2], `expected implementors on lines 1,2; got ${JSON.stringify(lines)}`);
    });
});

describe('service: selectionRange', () => {
    const src = [
        'int32 main() {',
        '  foo(bar(1));',
        '  return 0;',
        '}',
    ].join('\n');

    it('expands from token through enclosing brackets to the document', () => {
        const r = recordFor(src);
        const [chain] = provideSelectionRanges(r.rawTokens, [posOf(src, '1')]);
        assert.ok(chain, 'a selection range was returned');
        // Walk parent chain; ranges must strictly grow (by span).
        const spans: number[] = [];
        let node: lsp.SelectionRange | undefined = chain;
        while (node) {
            const r0 = node.range;
            spans.push((r0.end.line - r0.start.line) * 100000 + (r0.end.character - r0.start.character));
            node = node.parent;
        }
        assert.ok(spans.length >= 3, `expected >=3 levels, got ${spans.length}`);
        for (let i = 1; i < spans.length; i++) {
            assert.ok(spans[i] >= spans[i - 1], `level ${i} should be >= inner level`);
        }
    });
});
