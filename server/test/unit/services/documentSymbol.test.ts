process.env.ENMA_LSP_TEST = '1';

import * as assert from 'node:assert/strict';
import { buildFixture } from './_helpers';
import { provideDocumentSymbol } from '../../../src/services/documentSymbol';

const URI = 'file:///docsym.em';

describe('documentSymbol service', () => {
    it('outline has class with field', () => {
        const f = buildFixture(URI, 'class Entity { int32 hp; void tick() {} }\n');
        const tree = provideDocumentSymbol(f.ast);
        assert.ok(tree.length >= 1);
        const cls = tree.find(s => s.name === 'Entity');
        assert.ok(cls, 'Entity in outline');
        const memberNames = (cls!.children ?? []).map(c => c.name);
        assert.ok(memberNames.includes('hp'));
        assert.ok(memberNames.includes('tick'));
    });

    it('empty file produces empty outline', () => {
        const f = buildFixture(URI, '\n');
        const tree = provideDocumentSymbol(f.ast);
        assert.equal(tree.length, 0);
    });
});
