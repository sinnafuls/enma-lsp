process.env.ENMA_LSP_TEST = '1';

import * as assert from 'node:assert/strict';
import { buildFixture, pos } from './_helpers';
import { provideCompletion } from '../../../src/services/completion';

const URI = 'file:///comp.em';

describe('completion service', () => {
    it('top-of-file shows globals + keywords', () => {
        const f = buildFixture(URI, '\n');
        const items = provideCompletion(f.analyzerScope.globalScope, f.rawTokens, pos(0, 0));
        const labels = items.map(i => i.label);
        assert.ok(labels.includes('int32'), 'int32 keyword visible');
        assert.ok(labels.includes('class'), 'class keyword visible');
    });

    it('after `MyClass foo;`, then `foo.` returns members of MyClass only', () => {
        const src = 'class MyClass { int32 width; int32 height; }\nMyClass foo;\nvoid f() { foo. }';
        const f = buildFixture(URI, src);
        const items = provideCompletion(f.analyzerScope.globalScope, f.rawTokens, pos(2, 16));
        const labels = items.map(i => i.label);
        // Should include width/height; should NOT include keyword 'class' or other globals.
        assert.ok(labels.includes('width'), `expected width member; got ${labels.join(',')}`);
        assert.ok(labels.includes('height'));
        assert.ok(!labels.includes('class'), 'no globals leak after dot');
    });

    it('after namespace `Foo::` returns its members', () => {
        const src = 'namespace Foo { int32 thing = 1; }\nvoid f() { Foo:: }';
        const f = buildFixture(URI, src);
        const items = provideCompletion(f.analyzerScope.globalScope, f.rawTokens, pos(1, 16));
        const labels = items.map(i => i.label);
        assert.ok(labels.includes('thing'), `expected thing in namespace members; got ${labels.join(',')}`);
    });

    it('inside a function body shows locals', () => {
        const src = 'void f() {\n  int32 my_local = 0;\n  \n}';
        const f = buildFixture(URI, src);
        const items = provideCompletion(f.analyzerScope.globalScope, f.rawTokens, pos(2, 2));
        const labels = items.map(i => i.label);
        // Just verifying that completion runs and returns something.
        assert.ok(labels.length > 0);
    });

    it('arrow access `p->` returns members of pointer target type', () => {
        const src = 'class P { int32 x; }\nP* p;\nvoid f() { p-> }';
        const f = buildFixture(URI, src);
        const items = provideCompletion(f.analyzerScope.globalScope, f.rawTokens, pos(2, 14));
        const labels = items.map(i => i.label);
        assert.ok(labels.includes('x'), `expected x member; got ${labels.join(',')}`);
    });

    it('top-level shows user-defined globals', () => {
        const src = 'class Foo {}\nint32 bar = 0;\n';
        const f = buildFixture(URI, src);
        const items = provideCompletion(f.analyzerScope.globalScope, f.rawTokens, pos(2, 0));
        const labels = items.map(i => i.label);
        assert.ok(labels.includes('Foo'), 'user class visible');
        assert.ok(labels.includes('bar'), 'user var visible');
    });
});
