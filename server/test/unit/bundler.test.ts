// Tests for the standalone bundler at scripts/bundler.mjs.
//
// The bundler is pure ESM; ts-node + CJS mocha can't dynamically import it
// reliably, so we invoke `node scripts/bundler.mjs <srcDir> --json` and parse
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

function runBundler(srcDir: string, opts: { strip?: boolean } = {}): BundleResult {
    const args = [BUNDLER_PATH, srcDir, '--json'];
    if (opts.strip) args.push('--strip');
    const r = spawnSync(process.execPath, args, { encoding: 'utf8' });
    // --json mode exits 1 if errors are present; we still parse stdout to inspect them.
    if (r.status !== 0 && !r.stdout) {
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

    it('bundles every .em file under the source directory', () => {
        fs.writeFileSync(path.join(dir, 'main.em'), `int32 g = 1;\n`);
        fs.writeFileSync(path.join(dir, 'lib.em'),  `int32 lib_v = 42;\n`);

        const r = runBundler(dir);
        assert.equal(r.errors.length, 0, r.errors.join('\n'));
        assert.ok(r.output.includes('lib_v = 42'), 'lib content present');
        assert.ok(r.output.includes('g = 1'), 'main content present');
        assert.equal(r.manifest.length, 2);
    });

    it('walks subdirectories recursively', () => {
        const sub = path.join(dir, 'features');
        fs.mkdirSync(sub, { recursive: true });
        fs.writeFileSync(path.join(dir, 'main.em'), `int32 a;\n`);
        fs.writeFileSync(path.join(sub, 'feature.em'), `int32 b;\n`);

        const r = runBundler(dir);
        assert.equal(r.errors.length, 0, r.errors.join('\n'));
        assert.equal(r.manifest.length, 2);
    });

    it('orders files topologically — includes emitted before includer', () => {
        fs.writeFileSync(path.join(dir, 'a.em'), `#include "b.em"\nint32 a_v;\n`);
        fs.writeFileSync(path.join(dir, 'b.em'), `#include "c.em"\nint32 b_v;\n`);
        fs.writeFileSync(path.join(dir, 'c.em'), `int32 c_v;\n`);

        const r = runBundler(dir);
        assert.equal(r.errors.length, 0, r.errors.join('\n'));
        const idxC = r.output.indexOf('c_v');
        const idxB = r.output.indexOf('b_v');
        const idxA = r.output.indexOf('a_v');
        assert.ok(idxC >= 0 && idxB >= 0 && idxA >= 0, 'all symbols present');
        assert.ok(idxC < idxB && idxB < idxA, 'includes emitted before their includer');
    });

    it('strips #include lines from the bundled output', () => {
        fs.writeFileSync(path.join(dir, 'a.em'), `#include "b.em"\nint32 a_v;\n`);
        fs.writeFileSync(path.join(dir, 'b.em'), `int32 b_v;\n`);

        const r = runBundler(dir);
        assert.equal(r.errors.length, 0, r.errors.join('\n'));
        assert.ok(!/^[ \t]*#include\b/m.test(r.output),
            `expected no #include lines in output, got:\n${r.output}`);
    });

    it('reports a fatal error on circular #include', () => {
        fs.writeFileSync(path.join(dir, 'a.em'), `#include "b.em"\nint32 a_v;\n`);
        fs.writeFileSync(path.join(dir, 'b.em'), `#include "a.em"\nint32 b_v;\n`);

        const r = runBundler(dir);
        assert.ok(
            r.errors.some(e => /circular/i.test(e)),
            `expected a circular-include error, got: ${r.errors.join('|')}`,
        );
    });

    it('reports a clear error on a missing #include path', () => {
        fs.writeFileSync(path.join(dir, 'main.em'), `#include "nope.em"\n`);
        const r = runBundler(dir);
        assert.ok(r.errors.length >= 1, 'expected at least one error');
        assert.ok(r.errors.some(e => /nope\.em/.test(e)),
            `expected error to name the missing path, got: ${r.errors.join('|')}`);
    });

    it('strips line + block comments while preserving strings (--strip)', () => {
        fs.writeFileSync(path.join(dir, 'main.em'),
            `int32 a = 1; // tail\n` +
            `/* block */ int32 b = 2;\n` +
            `string s = "// not a comment /* still not */";\n`);

        const r = runBundler(dir, { strip: true });
        assert.equal(r.errors.length, 0, r.errors.join('\n'));
        assert.ok(!r.output.includes('// tail'), 'line comment removed');
        assert.ok(!r.output.includes('/* block */'), 'block comment removed');
        assert.ok(r.output.includes('"// not a comment /* still not */"'),
            'string literal preserved verbatim');
    });

    it('emits a warning when the source directory is empty', () => {
        const r = runBundler(dir);
        assert.equal(r.errors.length, 0, r.errors.join('\n'));
        assert.ok(
            r.warnings.some(w => /no \.em files/i.test(w)),
            `expected an empty-dir warning, got: ${r.warnings.join('|')}`,
        );
    });

    it('errors out on a missing source directory', () => {
        const missing = path.join(dir, 'nope');
        const r = runBundler(missing);
        assert.ok(r.errors.some(e => /not found/i.test(e)),
            `expected a not-found error, got: ${r.errors.join('|')}`);
    });
});
