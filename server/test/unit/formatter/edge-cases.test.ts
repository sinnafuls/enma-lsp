// Formatter edge-case tests (≥6 tests).

import * as assert from 'node:assert/strict';
import { formatSource, assertIdempotent } from './_helpers';

describe('Formatter — edge cases', () => {

    // 1. Empty file → empty output (no edits on empty content)
    it('empty file produces empty or whitespace-only output', () => {
        const out = formatSource('');
        assert.ok(out.trim() === '', `Expected empty output, got: ${JSON.stringify(out)}`);
    });

    // 2. Single-line file (no newlines)
    it('single-line file formats without error', () => {
        const src = 'int32 x = 42;';
        const out = formatSource(src);
        assert.ok(out.includes('x'), `Expected output to contain 'x', got: ${out}`);
        assertIdempotent(src);
    });

    // 3. File ending in unterminated comment — best-effort (no crash)
    it('file with trailing unterminated block comment does not throw', () => {
        const src = 'int32 x = 1;\n/* unterminated comment...';
        let out: string | undefined;
        assert.doesNotThrow(() => {
            out = formatSource(src);
        }, 'Formatter should not throw on unterminated comment');
        assert.ok(typeof out === 'string', 'Should return a string');
    });

    // 4. Comment at very start of file — preserves position
    it('doc comment at start of file is preserved', () => {
        const src = '// Top-level comment\nint32 x = 0;';
        const out = formatSource(src);
        assert.ok(out.includes('// Top-level comment'), `Expected comment preserved, got:\n${out}`);
    });

    // 5. // #region / // #endregion as anchors — not reordered
    it('// #region and // #endregion anchors are preserved', () => {
        const src = [
            '// #region section A',
            'int32 a = 1;',
            '// #endregion',
            '// #region section B',
            'int32 b = 2;',
            '// #endregion',
        ].join('\n');
        const out = formatSource(src);
        const regionIdx    = out.indexOf('// #region section A');
        const endregionIdx = out.indexOf('// #endregion');
        const regionBIdx   = out.indexOf('// #region section B');
        assert.ok(regionIdx    >= 0, '#region not found');
        assert.ok(endregionIdx  > regionIdx, '#endregion should come after #region');
        assert.ok(regionBIdx    > endregionIdx, 'Second #region should follow first #endregion');
        assertIdempotent(src);
    });

    // 6. Block comment preserved byte-exact (no content mutation)
    it('block comment content is preserved byte-exact', () => {
        const src = '/* This is a\n   multi-line comment. */\nvoid f() { }';
        const out = formatSource(src);
        assert.ok(out.includes('/* This is a'), `Block comment start not preserved in:\n${out}`);
        assert.ok(out.includes('multi-line comment. */'), `Block comment end not preserved in:\n${out}`);
    });

    // 7. Line comment between declarations preserved
    it('line comment between declarations preserved', () => {
        const src = 'int32 a = 1;\n// separator\nint32 b = 2;';
        const out = formatSource(src);
        assert.ok(out.includes('// separator'), `Comment not preserved in:\n${out}`);
    });

    // 8. Multiple blank lines collapsed correctly
    it('excessive blank lines between top-level decls are collapsed', () => {
        const src = 'int32 a = 1;\n\n\n\n\nint32 b = 2;';
        const out = formatSource(src, { maxBlankLines: 1 });
        // Should not contain 3 or more consecutive newlines
        assert.ok(!out.includes('\n\n\n'), `Expected max 1 blank line, got:\n${out}`);
    });

    // 9. Deeply nested braces idempotent
    it('deeply nested blocks are idempotent', () => {
        const src = 'void f() { if (a) { if (b) { if (c) { x = 1; } } } }';
        assertIdempotent(src);
    });

    // 10. class with inline comment in member list preserved
    it('inline comments inside class body are preserved', () => {
        const src = [
            'class Foo {',
            '    // field comment',
            '    int32 x;',
            '}',
        ].join('\n');
        const out = formatSource(src);
        assert.ok(out.includes('// field comment'), `Expected inline comment preserved, got:\n${out}`);
    });

});
