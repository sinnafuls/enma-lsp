process.env.ENMA_LSP_TEST = '1';

import * as assert from 'node:assert/strict';
import { buildFixture, buildInspectorFixture, pos } from './_helpers';
import { provideReferences } from '../../../src/services/reference';

const URI = 'file:///ref.em';

describe('reference service', () => {
    it('finds all uses of a user variable', () => {
        const src = 'int32 my_var = 0;\nvoid f() { my_var = 1; }\nvoid g() { int32 b = my_var; }';
        const f = buildFixture(URI, src);
        const refs = provideReferences(
            f.analyzerScope.globalScope,
            f.rawTokens,
            [{ uri: URI, rawTokens: f.rawTokens }],
            pos(0, 7),
        );
        assert.ok(refs.length >= 3, `expected ≥3 references; got ${refs.length}`);
    });

    it('finds method references', () => {
        const src = 'class Foo {\n  int32 draw() { return 0; }\n}\nint32 use() { Foo f; return f.draw(); }';
        const f = buildFixture(URI, src);
        const refs = provideReferences(
            f.analyzerScope.globalScope,
            f.rawTokens,
            [{ uri: URI, rawTokens: f.rawTokens }],
            pos(1, 9),
        );
        assert.ok(refs.length >= 2);
    });

    it('multi-file refs span all files', () => {
        const aUri = 'file:///fake/a.em';
        const bUri = 'file:///fake/b.em';
        const fx = buildInspectorFixture({
            [aUri]: 'int32 shared = 1;\n',
            [bUri]: '#include "a.em"\nvoid use() { int32 z = shared; }\n',
        });
        const a = fx.records[aUri];
        const b = fx.records[bUri];
        const refs = provideReferences(
            a.analyzerScope.globalScope,
            a.rawTokens,
            [
                { uri: aUri, rawTokens: a.rawTokens },
                { uri: bUri, rawTokens: b.rawTokens },
            ],
            pos(0, 7),
        );
        const uris = new Set(refs.map(r => r.uri));
        assert.ok(uris.has(aUri), 'refs include file a');
        assert.ok(uris.has(bUri), `refs include file b; got uris=${[...uris]}`);
    });

    it('unused symbol returns just the decl', () => {
        const src = 'int32 unused_var = 0;\n';
        const f = buildFixture(URI, src);
        const refs = provideReferences(
            f.analyzerScope.globalScope,
            f.rawTokens,
            [{ uri: URI, rawTokens: f.rawTokens }],
            pos(0, 7),
        );
        // At least the decl token; possibly its position appears once.
        assert.ok(refs.length >= 1);
    });
});
