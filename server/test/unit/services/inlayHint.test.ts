process.env.ENMA_LSP_TEST = '1';

import * as assert from 'node:assert/strict';
import { buildFixture } from './_helpers';
import { provideInlayHint } from '../../../src/services/inlayHint';

const URI = 'file:///inlay.em';

describe('inlayHint service', () => {
    it('emits parameter-name chips at call sites', () => {
        const src = 'void foo(int32 a, int32 b) {}\nvoid use() { foo(1, 2); }';
        const f = buildFixture(URI, src);
        const hints = provideInlayHint(
            f.analyzerScope.globalScope,
            f.analyzerScope,
            f.ast,
            { start: { line: 0, character: 0 }, end: { line: 99, character: 0 } },
        );
        const labels = hints.map(h => typeof h.label === 'string' ? h.label : '');
        assert.ok(labels.some(l => l.startsWith('a')), `expected parameter hint 'a:'; got ${labels.join(',')}`);
    });

    it('emits no hints for empty file', () => {
        const f = buildFixture(URI, '\n');
        const hints = provideInlayHint(
            f.analyzerScope.globalScope,
            f.analyzerScope,
            f.ast,
            { start: { line: 0, character: 0 }, end: { line: 99, character: 0 } },
        );
        assert.equal(hints.length, 0);
    });
});
