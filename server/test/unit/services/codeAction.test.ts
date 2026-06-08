process.env.ENMA_LSP_TEST = '1';

import * as assert from 'node:assert/strict';
import { buildFixture } from './_helpers';
import { provideCodeAction } from '../../../src/services/codeAction';

const URI = 'file:///ca.em';

describe('codeAction service', () => {
    it('proposes Did-you-mean for typo of float64', () => {
        const f = buildFixture(URI, 'flojat64 x = 0.0;\n');
        const actions = provideCodeAction(
            f.analyzerScope.globalScope,
            { start: { line: 0, character: 0 }, end: { line: 0, character: 8 } },
            {
                uri: URI,
                diagnostics: [{
                    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 8 } },
                    message: "Unknown type 'flojat64'",
                    code: 'EN_UNKNOWN_TYPE',
                    severity: 1,
                }],
            },
        );
        const titles = actions.map(a => a.title);
        assert.ok(titles.some(t => /float64/.test(t)), `expected float64 quickfix, got ${titles.join(',')}`);
    });

    it('proposes -> swap for dot-on-pointer diagnostic', () => {
        const f = buildFixture(URI, 'int32 x = 0;\n');
        const actions = provideCodeAction(
            f.analyzerScope.globalScope,
            { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
            {
                uri: URI,
                diagnostics: [{
                    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
                    message: 'Use -> on pointer',
                    code: 'EN_DOT_ON_POINTER',
                    severity: 1,
                }],
            },
        );
        assert.ok(actions.length >= 1);
        assert.ok(actions[0].title.includes('->'));
    });

    it('proposes inserting `override` for missing-override diagnostic', () => {
        const f = buildFixture(URI, 'class B { void m() {} }\nclass D : B { void m() {} }\n');
        const actions = provideCodeAction(
            f.analyzerScope.globalScope,
            { start: { line: 1, character: 14 }, end: { line: 1, character: 14 } },
            {
                uri: URI,
                diagnostics: [{
                    range: { start: { line: 1, character: 14 }, end: { line: 1, character: 14 } },
                    message: 'Method missing override',
                    code: 'EN_MISSING_OVERRIDE',
                    severity: 1,
                }],
            },
        );
        assert.ok(actions.length >= 1);
        assert.ok(actions[0].title.toLowerCase().includes('override'));
    });

    it('suggests Add import for known catalogue identifier', () => {
        const f = buildFixture(URI, 'vec2 v;\n');
        const actions = provideCodeAction(
            f.analyzerScope.globalScope,
            { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } },
            {
                uri: URI,
                diagnostics: [{
                    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } },
                    message: "Unknown type 'vec2'",
                    code: 'EN_UNKNOWN_TYPE',
                    severity: 1,
                }],
            },
        );
        const titles = actions.map(a => a.title);
        assert.ok(titles.some(t => t.includes('Add import "vec"')),
            `expected 'Add import "vec"' quickfix, got: ${titles.join(', ')}`);
    });
});
