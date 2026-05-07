process.env.ENMA_LSP_TEST = '1';

import * as assert from 'node:assert/strict';
import { buildInspectorFixture, pos } from './_helpers';
import { provideReferences } from '../../../src/services/reference';

describe('rename / references-driven workspace edit', () => {
    it('multi-file rename: collecting references across files yields enough sites', () => {
        const aUri = 'file:///fake/a.em';
        const bUri = 'file:///fake/b.em';
        const fx = buildInspectorFixture({
            [aUri]: 'class Counter {\n  int32 count;\n  int32 inc() { count = count + 1; return count; }\n}\n',
            [bUri]: '#include "a.em"\nvoid use() { Counter c; c.inc(); c.inc(); }\n',
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
            // position of `inc` decl name on line 2
            pos(2, 9),
        );
        assert.ok(refs.length >= 3, `expected ≥3 refs; got ${refs.length}`);
        const uris = new Set(refs.map(r => r.uri));
        assert.ok(uris.has(bUri));
    });

    it('rename with no symbol resolution still returns literal-text matches', () => {
        const aUri = 'file:///fake/a.em';
        const fx = buildInspectorFixture({
            [aUri]: 'int32 x = 0;\nvoid f() { x = 1; }\n',
        });
        const a = fx.records[aUri];
        const refs = provideReferences(
            a.analyzerScope.globalScope,
            a.rawTokens,
            [{ uri: aUri, rawTokens: a.rawTokens }],
            pos(0, 7),
        );
        assert.ok(refs.length >= 2);
    });

    it('build a workspace edit shape from references', () => {
        const aUri = 'file:///fake/a.em';
        const fx = buildInspectorFixture({
            [aUri]: 'int32 my_var = 0;\nvoid f() { my_var = 1; }\n',
        });
        const a = fx.records[aUri];
        const refs = provideReferences(
            a.analyzerScope.globalScope,
            a.rawTokens,
            [{ uri: aUri, rawTokens: a.rawTokens }],
            pos(0, 7),
        );
        const changes: Record<string, { range: { start: { line: number; character: number }; end: { line: number; character: number } }; newText: string }[]> = {};
        for (const r of refs) {
            if (!changes[r.uri]) changes[r.uri] = [];
            changes[r.uri].push({ range: r.range, newText: 'renamed' });
        }
        assert.ok(Object.keys(changes).includes(aUri));
        assert.ok(changes[aUri].length >= 1);
    });
});
