process.env.ENMA_LSP_TEST = '1';

import * as assert from 'node:assert/strict';

interface CatalogueSymbol {
    module: string;
    name: string;
    kind: 'type' | 'function' | 'funcdef' | 'global';
    declaration: string;
    source?: string;
}

interface MergeResult {
    added: CatalogueSymbol[];
    skipped: Array<{ symbol: CatalogueSymbol; reason: string }>;
    nextContent: string;
}

// We pull the merge helper via dynamic import because it lives in a sibling
// .mjs module (so the sync script can run under plain Node without ts-node).
let mergePredefined: (
    existing: string,
    incoming: CatalogueSymbol[],
    today?: string,
) => MergeResult;

before(async () => {
    // ts-node doesn't pick up the sibling .d.ts for .mjs imports, so cast.
    const mod = await import(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        '../../../../scripts/lib/predefinedMerge.mjs' as any
    ) as { mergePredefined: typeof mergePredefined };
    mergePredefined = mod.mergePredefined;
});

const FIXTURE_DATE = '2026-05-18';

describe('predefinedMerge', () => {
    it('appends a new symbol when the identifier is not present', () => {
        const existing = '// shared types\nclass already_here { int32 a; };\n';
        const result = mergePredefined(
            existing,
            [{ module: 'perception', name: 'new_type', kind: 'type', declaration: 'class new_type { };' }],
            FIXTURE_DATE,
        );
        assert.equal(result.added.length, 1);
        assert.equal(result.skipped.length, 0);
        assert.ok(result.nextContent.includes('class new_type'));
        assert.ok(result.nextContent.includes(`Imported via npm run sync-docs ${FIXTURE_DATE}`));
    });

    it('skips a symbol whose identifier is already present', () => {
        const existing = 'class taken_name { int32 a; };\n';
        const result = mergePredefined(
            existing,
            [{ module: 'perception', name: 'taken_name', kind: 'type', declaration: 'class taken_name { float32 b; };' }],
            FIXTURE_DATE,
        );
        assert.equal(result.added.length, 0);
        assert.equal(result.skipped.length, 1);
        assert.equal(result.skipped[0].reason, 'already declared');
        // File contents must NOT change for a skip-only run.
        assert.equal(result.nextContent, existing);
    });

    it('records duplicates within a single batch and only writes the first', () => {
        const existing = '// nothing here\n';
        const result = mergePredefined(
            existing,
            [
                { module: 'perception', name: 'thing', kind: 'function', declaration: 'void thing();' },
                { module: 'perception', name: 'thing', kind: 'function', declaration: 'void thing(int32 x);' },
            ],
            FIXTURE_DATE,
        );
        assert.equal(result.added.length, 1);
        assert.equal(result.skipped.length, 1);
        assert.equal(result.skipped[0].reason, 'duplicate within batch');
    });

    it('keeps each new declaration verbatim (does not paraphrase)', () => {
        const existing = '';
        const declaration = 'class verbatim_t {\n    int32 a;\n    int32 b;\n};';
        const result = mergePredefined(
            existing,
            [{ module: 'perception', name: 'verbatim_t', kind: 'type', declaration }],
            FIXTURE_DATE,
        );
        assert.ok(result.nextContent.includes(declaration));
    });

    it('appends a `// source: <url>` comment when source is provided', () => {
        const result = mergePredefined(
            '',
            [{
                module: 'perception',
                name: 'host_t',
                kind: 'type',
                declaration: 'class host_t {};',
                source: 'https://docs.perception.cx/perception/enma/proc',
            }],
            FIXTURE_DATE,
        );
        assert.ok(result.nextContent.includes('source: https://docs.perception.cx/perception/enma/proc'));
    });

    it('drops symbols with missing name or declaration', () => {
        const result = mergePredefined(
            '',
            [{ module: 'perception', name: '', kind: 'type', declaration: 'class x {};' }],
            FIXTURE_DATE,
        );
        assert.equal(result.added.length, 0);
        assert.equal(result.skipped.length, 1);
    });

    it('returns the original content untouched when the catalogue is empty', () => {
        const existing = '// existing\n';
        const result = mergePredefined(existing, [], FIXTURE_DATE);
        assert.equal(result.nextContent, existing);
        assert.equal(result.added.length, 0);
    });

    it('appends a single dated section header even when multiple symbols are added', () => {
        const result = mergePredefined(
            '',
            [
                { module: 'perception', name: 'a', kind: 'type', declaration: 'class a {};' },
                { module: 'perception', name: 'b', kind: 'type', declaration: 'class b {};' },
                { module: 'perception', name: 'c', kind: 'type', declaration: 'class c {};' },
            ],
            FIXTURE_DATE,
        );
        const headerCount = (result.nextContent.match(/Imported via npm run sync-docs/g) ?? []).length;
        assert.equal(headerCount, 1);
    });
});
