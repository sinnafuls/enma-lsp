process.env.ENMA_LSP_TEST = '1';

import * as assert from 'node:assert/strict';
import { buildFixture } from './_helpers';
import { provideDocumentColors, provideColorPresentation } from '../../../src/services/color';

const URI = 'file:///color.em';

describe('color service', () => {
    it('detects color(1.0,0.0,0.0,1.0) as a single red color', () => {
        const f = buildFixture(URI, 'void test() { color(1.0, 0.0, 0.0, 1.0); }\n');
        const results = provideDocumentColors(f.ast, f.content);
        assert.equal(results.length, 1);
        const c = results[0].color;
        assert.equal(c.red,   1);
        assert.equal(c.green, 0);
        assert.equal(c.blue,  0);
        assert.equal(c.alpha, 1);
    });

    it('ignores color(x,0.0,0.0,1.0) — non-literal first arg', () => {
        const f = buildFixture(URI, 'void test() { color(x, 0.0, 0.0, 1.0); }\n');
        const results = provideDocumentColors(f.ast, f.content);
        assert.equal(results.length, 0);
    });

    it('ignores color(1.0,0.0,0.0) — only 3 args', () => {
        const f = buildFixture(URI, 'void test() { color(1.0, 0.0, 0.0); }\n');
        const results = provideDocumentColors(f.ast, f.content);
        assert.equal(results.length, 0);
    });

    it('provideColorPresentation returns formatted label and textEdit', () => {
        const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 24 } };
        const color = { red: 1, green: 0.5, blue: 0, alpha: 1 };
        const presentations = provideColorPresentation(color, range);
        assert.equal(presentations.length, 1);
        assert.equal(presentations[0].label, 'color(1.000, 0.500, 0.000, 1.000)');
        assert.ok(presentations[0].textEdit, 'textEdit must be present');
        assert.equal(presentations[0].textEdit!.newText, 'color(1.000, 0.500, 0.000, 1.000)');
        assert.deepEqual(presentations[0].textEdit!.range, range);
    });
});
