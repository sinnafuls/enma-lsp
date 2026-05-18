process.env.ENMA_LSP_TEST = '1';

import * as assert from 'node:assert/strict';
import {
    AUTO_IMPORT_MODULES,
    findMissingImports,
    moduleForIdentifier,
    parseImportedModules,
    preambleEndLine,
    stripCommentsAndStrings,
} from '../../../../client/src/autoImportCatalogue';

describe('autoImportCatalogue', () => {
    it('catalogue has the seed modules', () => {
        for (const m of ['vec', 'color', 'math3d']) {
            assert.ok(AUTO_IMPORT_MODULES.has(m), `${m} missing from catalogue`);
        }
    });

    it('moduleForIdentifier maps catalogue names', () => {
        assert.equal(moduleForIdentifier('vec3'), 'vec');
        assert.equal(moduleForIdentifier('color_from_hex'), 'color');
        assert.equal(moduleForIdentifier('mat4_perspective'), 'math3d');
    });

    it('moduleForIdentifier returns undefined for non-catalogue names', () => {
        assert.equal(moduleForIdentifier('Player'), undefined);
        assert.equal(moduleForIdentifier('main'), undefined);
    });

    it('stripCommentsAndStrings blanks line comments + block comments + strings', () => {
        const src = '"vec3"; // vec3\n/* vec3 */\nvec3 v;';
        const clean = stripCommentsAndStrings(src);
        // The literal vec3 mentions in strings and comments must be gone, but
        // the bare `vec3 v;` use on line 2 must survive.
        const lines = clean.split('\n');
        assert.ok(!lines[0].includes('vec3'), 'string contents not stripped');
        assert.ok(!lines[1].includes('vec3'), 'block comment not stripped');
        assert.ok(lines[2].includes('vec3'), 'real use stripped by accident');
    });

    it('parseImportedModules picks up plain imports', () => {
        const imports = parseImportedModules('import "vec";\nimport "color";\nvoid f() {}\n');
        assert.ok(imports.has('vec'));
        assert.ok(imports.has('color'));
    });

    it('parseImportedModules ignores import keyword inside comments', () => {
        const imports = parseImportedModules('// import "vec";\nvoid f() {}\n');
        assert.equal(imports.has('vec'), false);
    });

    it('findMissingImports returns one entry per (module,name)', () => {
        const src = 'void f() { vec3 a = vec3(1,2,3); vec3 b = a; }\n';
        const missing = findMissingImports(src);
        // vec3 appears 3 times but should be reported once.
        const vec3Hits = missing.filter(m => m.name === 'vec3');
        assert.equal(vec3Hits.length, 1);
        assert.equal(vec3Hits[0].module, 'vec');
    });

    it('findMissingImports skips identifiers whose module is already imported', () => {
        const src = 'import "vec";\nvoid f() { vec3 a; }\n';
        const missing = findMissingImports(src);
        const vec3Hits = missing.filter(m => m.name === 'vec3');
        assert.equal(vec3Hits.length, 0);
    });

    it('findMissingImports ignores identifiers buried in comments + strings', () => {
        const src = '// vec3 in a comment\n"vec3 in a string";\nvoid f() {}\n';
        const missing = findMissingImports(src);
        assert.equal(missing.length, 0);
    });

    it('findMissingImports detects multiple modules in one pass', () => {
        const src = 'void f() { vec3 v; color c; mat4 m; }\n';
        const missing = findMissingImports(src);
        const mods = new Set(missing.map(m => m.module));
        assert.ok(mods.has('vec'));
        assert.ok(mods.has('color'));
        assert.ok(mods.has('math3d'));
    });

    it('preambleEndLine lands after #include + import lines', () => {
        const src = '#include "shared.em"\nimport "vec";\nimport "color";\n\nvoid f() {}\n';
        const line = preambleEndLine(src);
        // Lines 0-2 are preamble, line 3 is blank but counts as preamble, line 4 is `void f()`.
        assert.equal(line, 4);
    });

    it('preambleEndLine returns 0 when the first line is code', () => {
        const src = 'void f() {}\n';
        assert.equal(preambleEndLine(src), 0);
    });
});
