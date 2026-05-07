process.env.ENMA_LSP_TEST = '1';

import * as assert from 'node:assert/strict';
import { buildFixture } from './_helpers';
import { provideSemanticTokens, semanticTokensLegend } from '../../../src/services/semanticTokens';

const URI = 'file:///sem.em';

describe('semanticTokens service', () => {
    it('legend has variable / function / namespace / class / enum', () => {
        const types = semanticTokensLegend.tokenTypes;
        assert.ok(types.includes('variable'));
        assert.ok(types.includes('function'));
        assert.ok(types.includes('namespace'));
        assert.ok(types.includes('class'));
        assert.ok(types.includes('enum'));
    });

    it('emits tokens for global variable usage', () => {
        const f = buildFixture(URI, 'int32 g = 0;\nvoid f() { g = 1; }\n');
        const r = provideSemanticTokens(f.analyzerScope.globalScope, f.rawTokens);
        // Expect at least one semantic token entry (data.length is multiples of 5).
        assert.ok(r.data.length > 0);
        assert.equal(r.data.length % 5, 0);
    });

    it('emits tokens for class declaration', () => {
        const f = buildFixture(URI, 'class Foo {}\n');
        const r = provideSemanticTokens(f.analyzerScope.globalScope, f.rawTokens);
        assert.ok(r.data.length > 0);
    });

    it('emits no tokens for empty file', () => {
        const f = buildFixture(URI, '\n');
        const r = provideSemanticTokens(f.analyzerScope.globalScope, f.rawTokens);
        assert.equal(r.data.length, 0);
    });
});
