process.env.ENMA_LSP_TEST = '1';

import * as assert from 'node:assert/strict';
import { buildFixture, pos } from './_helpers';
import { provideHover } from '../../../src/services/hover';

const URI = 'file:///hover.em';

describe('hover service', () => {
    it('hover on int32 keyword returns primitive doc', () => {
        const f = buildFixture(URI, 'int32 x = 0;');
        const h = provideHover(f.analyzerScope.globalScope, f.rawTokens, pos(0, 2));
        assert.ok(h, 'hover should be defined');
        assert.match((h!.contents as { value: string }).value, /Signed 32-bit/);
    });

    it('hover on user variable returns its signature', () => {
        const f = buildFixture(URI, 'int32 my_var = 5;');
        // Position at the variable name `my_var` (col 6).
        const h = provideHover(f.analyzerScope.globalScope, f.rawTokens, pos(0, 7));
        assert.ok(h, 'hover should be defined');
        assert.match((h!.contents as { value: string }).value, /my_var/);
    });

    it('hover on user class declaration returns class signature', () => {
        const f = buildFixture(URI, 'class Foo { int32 a; }');
        const h = provideHover(f.analyzerScope.globalScope, f.rawTokens, pos(0, 7));
        assert.ok(h, 'hover should be defined');
        assert.match((h!.contents as { value: string }).value, /Foo/);
    });

    it('hover on whitespace returns undefined', () => {
        const f = buildFixture(URI, 'int32 x = 0;');
        // Past EOL, in nothing.
        const h = provideHover(f.analyzerScope.globalScope, f.rawTokens, pos(5, 100));
        assert.equal(h, undefined);
    });

    it('hover on if keyword returns control-flow doc', () => {
        const f = buildFixture(URI, 'void f() { if (true) {} }');
        // Position at `if` keyword.
        const h = provideHover(f.analyzerScope.globalScope, f.rawTokens, pos(0, 12));
        assert.ok(h, 'hover should be defined');
        assert.match((h!.contents as { value: string }).value, /Conditional|if/);
    });

    it('hover on class type keyword returns the class doc', () => {
        const f = buildFixture(URI, 'class Foo {}');
        const h = provideHover(f.analyzerScope.globalScope, f.rawTokens, pos(0, 1));
        assert.ok(h, 'hover should be defined');
        assert.match((h!.contents as { value: string }).value, /Reference type/);
    });
});
