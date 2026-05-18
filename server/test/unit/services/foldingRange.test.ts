process.env.ENMA_LSP_TEST = '1';

import * as assert from 'node:assert/strict';
import { tokenize } from '../../../src/compiler_tokenizer/tokenizer';
import { provideFoldingRanges } from '../../../src/services/foldingRange';

const URI = 'file:///fold.em';

function rangesFor(src: string) {
    const tokens = tokenize(URI, src);
    return provideFoldingRanges(tokens);
}

describe('foldingRange service', () => {
    it('emits a fold for a multi-line brace pair', () => {
        const r = rangesFor('void f() {\n    int32 a = 1;\n    int32 b = 2;\n}\n');
        const region = r.find(x => x.startLine === 0 && x.endLine === 2);
        assert.ok(region, 'expected a Region fold from line 0 to line 2');
    });

    it('does not emit a fold for a single-line brace pair', () => {
        const r = rangesFor('void f() { int32 a = 1; }\n');
        const region = r.find(x => x.kind === undefined || x.kind === 'region');
        // Single-line braces collapse to start === end and are skipped.
        assert.equal(region, undefined);
    });

    it('emits a comment fold for a multi-line block comment', () => {
        const r = rangesFor('/* hello\n   multi-line\n   block */\nvoid f() {}\n');
        const c = r.find(x => x.kind === 'comment' && x.startLine === 0 && x.endLine === 2);
        assert.ok(c, 'expected a Comment fold for the block comment');
    });

    it('merges consecutive `//` comments into one comment fold', () => {
        const r = rangesFor('// line one\n// line two\n// line three\nvoid f() {}\n');
        const c = r.find(x => x.kind === 'comment' && x.startLine === 0 && x.endLine === 2);
        assert.ok(c, 'expected a Comment fold covering the three-line // run');
    });

    it('emits a region fold for #region / #endregion markers', () => {
        const r = rangesFor('// #region init\nvoid f() {}\n// #endregion\n');
        const region = r.find(x => x.startLine === 0 && x.endLine === 2);
        assert.ok(region, 'expected a region fold from #region to #endregion');
    });

    it('emits nested brace folds in the correct order', () => {
        const src = 'void f() {\n    if (true) {\n        int32 a = 1;\n    }\n}\n';
        const r = rangesFor(src);
        const outer = r.find(x => x.startLine === 0 && x.endLine === 3);
        const inner = r.find(x => x.startLine === 1 && x.endLine === 2);
        assert.ok(outer, 'expected an outer brace fold');
        assert.ok(inner, 'expected an inner brace fold');
    });
});
