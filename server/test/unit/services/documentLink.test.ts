// Service test — documentLink turns #include paths into clickable links.

process.env.ENMA_LSP_TEST = '1';

import * as assert from 'node:assert/strict';

import { Inspector, resolveIncludeUri } from '../../../src/inspector/inspector';
import { provideDocumentLinks } from '../../../src/services/documentLink';

describe('service: documentLink', () => {
    it('links #include "b.em" to the resolved target URI', () => {
        const inspector = new Inspector();
        const aUri = 'file:///fake/a.em';
        const bUri = 'file:///fake/b.em';
        inspector.inspectFile(bUri, 'int32 b_val = 7;', { isOpen: true });
        inspector.inspectFile(aUri, '#include "b.em"\nint32 a_val = 3;', { isOpen: true });
        inspector.flush();

        const r = inspector.getRecord(aUri)!;
        const links = provideDocumentLinks(
            r.preprocessedOutput.includePathTokens,
            (rel) => resolveIncludeUri(aUri, rel, undefined),
        );
        assert.equal(links.length, 1, 'one include link');
        assert.equal(links[0].target, bUri, 'target resolves to b.em');
        assert.equal(links[0].range.start.line, 0, 'link is on the include line');
    });

    it('returns no links when there are no includes', () => {
        const inspector = new Inspector();
        const uri = 'file:///fake/solo.em';
        inspector.inspectFile(uri, 'int32 main() { return 0; }', { isOpen: true });
        inspector.flush();
        const r = inspector.getRecord(uri)!;
        const links = provideDocumentLinks(
            r.preprocessedOutput.includePathTokens,
            (rel) => resolveIncludeUri(uri, rel, undefined),
        );
        assert.equal(links.length, 0);
    });
});
