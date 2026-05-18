process.env.ENMA_LSP_TEST = '1';

import * as assert from 'node:assert/strict';
import {
    getProjectForUri,
    hasFullLsp,
    resolveProjects,
    setResolvedProjects,
} from '../../../src/core/projectScope';

const ROOT = 'file:///c:/proj/';

beforeEach(() => setResolvedProjects([]));

describe('projectScope.resolveProjects', () => {
    it('produces sourceDirUri ending in / and prefixed by workspace root', () => {
        const resolved = resolveProjects(
            [{ name: 'main', sourceDirectory: 'src/main' }],
            ROOT,
        );
        assert.equal(resolved.length, 1);
        assert.equal(resolved[0].sourceDirUri, 'file:///c:/proj/src/main/');
    });

    it('skips entries missing name or sourceDirectory', () => {
        const resolved = resolveProjects(
            [
                { name: '', sourceDirectory: 'a' },
                { name: 'main', sourceDirectory: '' },
            ],
            ROOT,
        );
        assert.equal(resolved.length, 0);
    });

    it('returns empty array when no workspace root is known', () => {
        const resolved = resolveProjects(
            [{ name: 'main', sourceDirectory: 'src' }],
            undefined,
        );
        assert.equal(resolved.length, 0);
    });
});

describe('projectScope.hasFullLsp', () => {
    it('returns true when no projects are declared (single-project mode)', () => {
        assert.equal(hasFullLsp('file:///c:/proj/main.em'), true);
    });

    it('returns true for files inside a `full` project', () => {
        setResolvedProjects(resolveProjects(
            [{ name: 'main', sourceDirectory: 'src', lspMode: 'full' }],
            ROOT,
        ));
        assert.equal(hasFullLsp('file:///c:/proj/src/main.em'), true);
    });

    it('returns false for files inside a `syntaxOnly` project', () => {
        setResolvedProjects(resolveProjects(
            [{ name: 'ref', sourceDirectory: 'reference', lspMode: 'syntaxOnly' }],
            ROOT,
        ));
        assert.equal(hasFullLsp('file:///c:/proj/reference/api.em'), false);
    });

    it('returns true for files outside every project (fall-through)', () => {
        setResolvedProjects(resolveProjects(
            [{ name: 'ref', sourceDirectory: 'reference', lspMode: 'syntaxOnly' }],
            ROOT,
        ));
        assert.equal(hasFullLsp('file:///c:/proj/other/main.em'), true);
    });

    it('always returns true for .em.predefined files', () => {
        setResolvedProjects(resolveProjects(
            [{ name: 'ref', sourceDirectory: 'reference', lspMode: 'syntaxOnly' }],
            ROOT,
        ));
        assert.equal(hasFullLsp('file:///c:/proj/reference/types.em.predefined'), true);
    });

    it('matches case-insensitively (Windows drive-letter case differences)', () => {
        setResolvedProjects(resolveProjects(
            [{ name: 'ref', sourceDirectory: 'reference', lspMode: 'syntaxOnly' }],
            ROOT,
        ));
        // Same URI with different drive-letter case.
        assert.equal(hasFullLsp('file:///C:/Proj/reference/api.em'), false);
    });
});

describe('projectScope.getProjectForUri', () => {
    it('returns the owning project when the URI is inside its source dir', () => {
        setResolvedProjects(resolveProjects(
            [{ name: 'main', sourceDirectory: 'src' }],
            ROOT,
        ));
        const p = getProjectForUri('file:///c:/proj/src/main.em');
        assert.ok(p);
        assert.equal(p.config.name, 'main');
    });

    it('returns undefined when the URI is outside every project', () => {
        setResolvedProjects(resolveProjects(
            [{ name: 'main', sourceDirectory: 'src' }],
            ROOT,
        ));
        assert.equal(getProjectForUri('file:///c:/proj/other.em'), undefined);
    });
});
