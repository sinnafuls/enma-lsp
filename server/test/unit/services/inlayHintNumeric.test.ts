// Tests for provideNumericInlayHints — hex/binary decimal annotation.

process.env.ENMA_LSP_TEST = '1';

import * as assert from 'node:assert/strict';
import * as lsp from 'vscode-languageserver';
import { Inspector } from '../../../src/inspector/inspector';
import { provideNumericInlayHints } from '../../../src/services/inlayHint';

const FULL: lsp.Range = { start: { line: 0, character: 0 }, end: { line: 999, character: 0 } };

function rawFor(src: string) {
    const inspector = new Inspector();
    const uri = 'file:///fake/test.em';
    inspector.inspectFile(uri, src, { isOpen: true });
    inspector.flush();
    return inspector.getRecord(uri)!.rawTokens;
}

describe('service: provideNumericInlayHints', () => {
    it('emits decimal hint for hex literal 0xFF', () => {
        const hints = provideNumericInlayHints(rawFor('int64 x = 0xFF;'), FULL);
        assert.equal(hints.length, 1);
        assert.ok(hints[0].label.toString().includes('255'), `label=${JSON.stringify(hints[0].label)}`);
    });

    it('emits decimal hint for binary literal 0b1010', () => {
        const hints = provideNumericInlayHints(rawFor('int64 x = 0b1010;'), FULL);
        assert.equal(hints.length, 1);
        assert.ok(hints[0].label.toString().includes('10'), `label=${JSON.stringify(hints[0].label)}`);
    });

    it('handles digit separators in hex (0xFF_FF)', () => {
        const hints = provideNumericInlayHints(rawFor('int64 x = 0xFF_FF;'), FULL);
        assert.equal(hints.length, 1);
        assert.ok(hints[0].label.toString().includes('65535'));
    });

    it('emits no hint for plain decimal literal', () => {
        const hints = provideNumericInlayHints(rawFor('int64 x = 255;'), FULL);
        assert.equal(hints.length, 0);
    });

    it('emits no hint for float literal', () => {
        const hints = provideNumericInlayHints(rawFor('float32 x = 1.5f;'), FULL);
        assert.equal(hints.length, 0);
    });

    it('multiple hex literals in range all get hints', () => {
        const src = 'int64 a = 0xA; int64 b = 0xB;';
        const hints = provideNumericInlayHints(rawFor(src), FULL);
        assert.equal(hints.length, 2);
    });
});
