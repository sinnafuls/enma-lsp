// Tests for the standalone bundler at scripts/bundler.mjs.
//
// The bundler is pure ESM; ts-node + CJS mocha can't dynamically import it
// reliably, so we invoke `node scripts/bundler.mjs --json <entry>` and parse
// the structured result.

process.env.ENMA_LSP_TEST = '1';

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const BUNDLER_PATH = path.resolve(__dirname, '..', '..', '..', 'scripts', 'bundler.mjs');

interface BundleResult {
    output: string;
    manifest: string[];
    warnings: string[];
    errors: string[];
}

function runBundler(entry: string, opts: { strip?: boolean } = {}): BundleResult {
    const args = [BUNDLER_PATH, entry, '--json'];
    if (opts.strip) args.push('--strip');
    const r = spawnSync(process.execPath, args, { encoding: 'utf8' });
    if (r.status !== 0) {
        throw new Error(`bundler exited ${r.status}: ${r.stderr || r.stdout}`);
    }
    return JSON.parse(r.stdout) as BundleResult;
}

function makeFixtureDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'enma-bundler-'));
}

function rmrf(p: string): void {
    try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* best effort */ }
}

describe('bundler', () => {
    let dir: string;

    beforeEach(() => { dir = makeFixtureDir(); });
    afterEach(() => { rmrf(dir); });

    it('resolves a simple two-file include', () => {
        fs.writeFileSync(path.join(dir, 'main.em'),
            `#include "lib.em"\nint32 g = 1;\n`, 'utf8');
        fs.writeFileSync(path.join(dir, 'lib.em'),
            `int32 lib_v = 42;\n`, 'utf8');

        const r = runBundler(path.join(dir, 'main.em'));
        assert.equal(r.errors.length, 0, r.errors.join('\n'));
        assert.ok(r.output.includes('lib_v = 42'), 'lib content inlined');
        assert.ok(r.output.includes('g = 1'), 'main content present');
        assert.equal(r.manifest.length, 2);
    });

    it('resolves three levels of nested includes in dependency order', () => {
        fs.writeFileSync(path.join(dir, 'a.em'), `#include "b.em"\nint32 a_v;\n`);
        fs.writeFileSync(path.join(dir, 'b.em'), `#include "c.em"\nint32 b_v;\n`);
        fs.writeFileSync(path.join(dir, 'c.em'), `int32 c_v;\n`);

        const r = runBundler(path.join(dir, 'a.em'));
        assert.equal(r.errors.length, 0, r.errors.join('\n'));
        const idxC = r.output.indexOf('c_v');
        const idxB = r.output.indexOf('b_v');
        const idxA = r.output.indexOf('a_v');
        assert.ok(idxC >= 0 && idxB >= 0 && idxA >= 0);
        assert.ok(idxC < idxB && idxB < idxA, 'nested includes inline before their includer');
    });

    it('emits a warning + halts on a circular include (no infinite loop)', () => {
        fs.writeFileSync(path.join(dir, 'a.em'), `#include "b.em"\nint32 a_v;\n`);
        fs.writeFileSync(path.join(dir, 'b.em'), `#include "a.em"\nint32 b_v;\n`);

        const r = runBundler(path.join(dir, 'a.em'));
        assert.ok(
            r.warnings.some(w => /circular include/i.test(w)),
            `expected a circular-include warning, got: ${r.warnings.join('|')}`,
        );
        assert.equal(r.manifest.length, 2);
    });

    it('deduplicates files marked with `#pragma once`', () => {
        fs.writeFileSync(path.join(dir, 'shared.em'),
            `#pragma once\nint32 shared_v;\n`);
        fs.writeFileSync(path.join(dir, 'a.em'),
            `#include "shared.em"\n#include "shared.em"\nint32 a_v;\n`);

        const r = runBundler(path.join(dir, 'a.em'));
        const occurrences = r.output.split('shared_v').length - 1;
        assert.equal(occurrences, 1,
            `expected shared content once, found ${occurrences} occurrence(s)`);
    });

    it('strips line + block comments while preserving strings (--strip)', () => {
        fs.writeFileSync(path.join(dir, 'main.em'),
            `int32 a = 1; // tail\n` +
            `/* block */ int32 b = 2;\n` +
            `string s = "// not a comment /* still not */";\n`);

        const r = runBundler(path.join(dir, 'main.em'), { strip: true });
        assert.equal(r.errors.length, 0, r.errors.join('\n'));
        assert.ok(!r.output.includes('// tail'), 'line comment removed');
        assert.ok(!r.output.includes('/* block */'), 'block comment removed');
        assert.ok(r.output.includes('"// not a comment /* still not */"'),
            'string literal preserved verbatim');
    });

    it('emits a clear error on a missing include path', () => {
        fs.writeFileSync(path.join(dir, 'main.em'), `#include "nope.em"\n`);
        const r = runBundler(path.join(dir, 'main.em'));
        assert.ok(r.errors.length >= 1, 'expected at least one error');
        assert.ok(/nope\.em/.test(r.errors[0]), 'error message names the missing path');
    });
});
