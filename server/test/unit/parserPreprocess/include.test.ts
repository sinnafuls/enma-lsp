import * as assert from 'assert';
import { tokenize } from '../../../src/compiler_tokenizer/tokenizer';
import { preprocessAfterTokenized } from '../../../src/compiler_parser/parserPreprocess';

const URI = 'file:///test.em';

function preprocess(src: string, opts = {}) {
    return preprocessAfterTokenized(tokenize(URI, src), { fileUri: URI, ...opts });
}

describe('Preprocessor — #include', () => {
    it('#include records path in includePathTokens', () => {
        const out = preprocess('#include "core.em"');
        assert.strictEqual(out.includePathTokens.length, 1);
        assert.strictEqual(out.includePathTokens[0].text, '"core.em"');
    });

    it('multiple #includes record all paths', () => {
        const out = preprocess('#include "a.em"\n#include "b.em"\n#include "c.em"');
        assert.strictEqual(out.includePathTokens.length, 3);
        const paths = out.includePathTokens.map(t => t.text);
        assert.ok(paths.includes('"a.em"'));
        assert.ok(paths.includes('"b.em"'));
        assert.ok(paths.includes('"c.em"'));
    });

    it('#include inside inactive #ifdef is NOT recorded', () => {
        const out = preprocess('#ifdef ABSENT\n#include "hidden.em"\n#endif');
        assert.strictEqual(out.includePathTokens.length, 0);
    });

    it('#include inside active #ifdef IS recorded', () => {
        const out = preprocess('#define YES\n#ifdef YES\n#include "found.em"\n#endif');
        assert.strictEqual(out.includePathTokens.length, 1);
        assert.strictEqual(out.includePathTokens[0].text, '"found.em"');
    });

    it('#include without string literal emits error', () => {
        const out = preprocess('#include core.em');
        const errors = out.diagnostics.filter(d => d.severity === 'error');
        assert.ok(errors.length > 0);
        assert.strictEqual(out.includePathTokens.length, 0);
    });

    it('cycle detection: same path in active chain emits error with full chain', () => {
        const activeSet = new Set(['file:///a.em', 'file:///b.em']);
        const tokens = tokenize(URI, '#include "file:///a.em"');
        const out = preprocessAfterTokenized(tokens, {
            fileUri: URI,
            activeIncludePaths: activeSet,
            includeChain: ['file:///a.em', 'file:///b.em', URI],
        });
        const errors = out.diagnostics.filter(d => d.severity === 'error');
        assert.ok(errors.length > 0);
        assert.ok(errors[0].message.includes('#include cycle'));
        assert.ok(errors[0].message.includes('→'));
    });

    it('cycle detection: 3-file cycle emits error with full path chain', () => {
        // Simulate: A includes B includes C, and C tries to include A
        const chainA = 'file:///a.em';
        const chainB = 'file:///b.em';
        const chainC = 'file:///c.em';
        const tokens = tokenize(chainC, `#include "${chainA}"`);
        const activeSet = new Set([chainA, chainB]);
        const out = preprocessAfterTokenized(tokens, {
            fileUri: chainC,
            activeIncludePaths: activeSet,
            includeChain: [chainA, chainB, chainC],
        });
        const errors = out.diagnostics.filter(d => d.severity === 'error');
        assert.ok(errors.length > 0);
        const msg = errors[0].message;
        assert.ok(msg.includes('#include cycle') || msg.includes('cycle'));
        assert.ok(msg.includes(chainA));
    });

    it('max depth exceeded emits error with chain', () => {
        // Set maxIncludeDepth=2, chain already has 2 entries
        const tokens = tokenize(URI, '#include "deep.em"');
        const out = preprocessAfterTokenized(tokens, {
            fileUri: URI,
            maxIncludeDepth: 2,
            includeChain: ['file:///root.em', URI],
        });
        const errors = out.diagnostics.filter(d => d.severity === 'error');
        assert.ok(errors.length > 0);
        assert.ok(errors[0].message.includes('depth limit'));
    });

    it('no cycle detection when active set is empty', () => {
        const out = preprocess('#include "safe.em"');
        const errors = out.diagnostics.filter(d => d.severity === 'error');
        assert.strictEqual(errors.length, 0);
        assert.strictEqual(out.includePathTokens.length, 1);
    });

    it('#include does NOT load or process the included file (inspector responsibility)', () => {
        // Only the path token should be recorded; no tokens from the included file appear
        const out = preprocess('#include "other.em"');
        assert.strictEqual(out.includePathTokens.length, 1);
        // No additional content tokens from "other.em" since we don't load it
        const nonEof = out.preprocessedTokens.filter(t => t.kind !== 'eof');
        assert.strictEqual(nonEof.length, 0);
    });
});
