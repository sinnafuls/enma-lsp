process.env.ENMA_LSP_TEST = '1';

import * as assert from 'node:assert/strict';
import { buildFixture, pos } from './_helpers';
import { provideDefinition } from '../../../src/services/definition';

const URI = 'file:///def.em';

describe('definition service', () => {
    it('jumps to user variable decl', () => {
        const src = 'int32 my_var = 7;\nint32 use() { return my_var; }';
        const f = buildFixture(URI, src);
        // `my_var` use is on line 1, char 21.
        const locs = provideDefinition(f.analyzerScope.globalScope, f.rawTokens, pos(1, 22));
        assert.ok(locs.length > 0, 'expected at least 1 location');
        assert.equal(locs[0].uri, URI);
        assert.equal(locs[0].range.start.line, 0);
    });

    it('jumps to function decl', () => {
        const src = 'int32 add(int32 a, int32 b) { return a; }\nint32 use() { return add(1, 2); }';
        const f = buildFixture(URI, src);
        const locs = provideDefinition(f.analyzerScope.globalScope, f.rawTokens, pos(1, 23));
        assert.ok(locs.length > 0);
        assert.equal(locs[0].range.start.line, 0);
    });

    it('returns empty for unknown identifier', () => {
        const src = 'int32 use() { return totally_unknown_name; }';
        const f = buildFixture(URI, src);
        const locs = provideDefinition(f.analyzerScope.globalScope, f.rawTokens, pos(0, 25));
        assert.equal(locs.length, 0);
    });
});
