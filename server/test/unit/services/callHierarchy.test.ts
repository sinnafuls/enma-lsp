// Service tests — call hierarchy (prepare / incoming / outgoing).

process.env.ENMA_LSP_TEST = '1';

import * as assert from 'node:assert/strict';
import { Inspector } from '../../../src/inspector/inspector';
import {
    prepareCallHierarchy,
    provideIncomingCalls,
    provideOutgoingCalls,
} from '../../../src/services/callHierarchy';
import { ReferenceTokens } from '../../../src/services/reference';

function recordFor(source: string, uri = 'file:///fake/test.em') {
    const inspector = new Inspector();
    inspector.inspectFile(uri, source, { isOpen: true });
    inspector.flush();
    return inspector.getRecord(uri)!;
}

function posOf(src: string, needle: string) {
    const lines = src.split('\n');
    for (let line = 0; line < lines.length; line++) {
        const idx = lines[line].indexOf(needle);
        if (idx >= 0) return { line, character: idx };
    }
    throw new Error(`"${needle}" not found`);
}

describe('service: callHierarchy', () => {
    const src = [
        'int32 helper() { return 1; }',
        'int32 main() { return helper(); }',
    ].join('\n');

    it('prepare resolves a function identifier to a CallHierarchyItem', () => {
        const r = recordFor(src);
        const items = prepareCallHierarchy(r.analyzerScope.globalScope, r.rawTokens, posOf(src, 'helper'));
        assert.equal(items.length, 1);
        assert.equal(items[0].name, 'helper');
    });

    it('prepare returns nothing for a non-function identifier', () => {
        const r = recordFor(src);
        // 'return' is a keyword, not a function
        const items = prepareCallHierarchy(r.analyzerScope.globalScope, r.rawTokens, { line: 0, character: 0 });
        assert.equal(items.length, 0);
    });

    it('incomingCalls finds call sites in token stream', () => {
        const r = recordFor(src);
        const allFiles: ReferenceTokens[] = [{ uri: 'file:///fake/test.em', rawTokens: r.rawTokens }];
        const [item] = prepareCallHierarchy(r.analyzerScope.globalScope, r.rawTokens, posOf(src, 'helper'));
        const incoming = provideIncomingCalls(allFiles, item);
        // helper() is called from main() on line 1.
        assert.ok(incoming.length >= 1, `expected ≥1 incoming call, got ${incoming.length}`);
    });

    it('outgoingCalls finds calls made inside the function body', () => {
        const r = recordFor(src);
        const allFiles: ReferenceTokens[] = [{ uri: 'file:///fake/test.em', rawTokens: r.rawTokens }];
        // Prepare on 'main'
        const mainItems = prepareCallHierarchy(r.analyzerScope.globalScope, r.rawTokens, posOf(src, 'main'));
        assert.ok(mainItems.length >= 1, 'main item prepared');
        const outgoing = provideOutgoingCalls(allFiles, mainItems[0]);
        // main() calls helper() — should appear
        const names = outgoing.map((o) => o.to.name);
        assert.ok(names.includes('helper'), `expected 'helper' in outgoing calls; got ${JSON.stringify(names)}`);
    });
});
