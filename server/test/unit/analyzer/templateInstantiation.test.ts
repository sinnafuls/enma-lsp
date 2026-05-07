import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    instantiate,
    computeMroFingerprint,
    _resetInstantiationCache,
    _instantiationCacheSize,
} from '../../../src/compiler_analyzer/templateInstantiation';
import { analyzeSource } from './_helpers';
import { ResolvedType } from '../../../src/compiler_analyzer/resolvedType';
import { SymbolType } from '../../../src/compiler_analyzer/symbolObject';
import { builtinInt32, builtinFloat32 } from '../../../src/compiler_analyzer/builtinType';

describe('templateInstantiation', () => {
    beforeEach(() => _resetInstantiationCache());

    it('uses (template, typeArgs, scopeUri, mroFingerprint) — different scope-URIs produce distinct entries', () => {
        const r = analyzeSource(`class Box {}`);
        const tmpl = r.analyzerScope.globalScope.lookupSymbol('Box') as SymbolType;
        instantiate(tmpl, [new ResolvedType(builtinInt32)], 'file:///a.em', null);
        instantiate(tmpl, [new ResolvedType(builtinInt32)], 'file:///b.em', null);
        assert.equal(_instantiationCacheSize(), 2);
    });

    it('same scope + different mro-fingerprint produce distinct entries', () => {
        const r = analyzeSource(`class Box {}`);
        const tmpl = r.analyzerScope.globalScope.lookupSymbol('Box') as SymbolType;
        instantiate(tmpl, [new ResolvedType(builtinInt32)], 'file:///a.em', 'aaaaaaaa');
        instantiate(tmpl, [new ResolvedType(builtinInt32)], 'file:///a.em', 'bbbbbbbb');
        assert.equal(_instantiationCacheSize(), 2);
    });

    it('same key → cache hit (1 entry)', () => {
        const r = analyzeSource(`class Box {}`);
        const tmpl = r.analyzerScope.globalScope.lookupSymbol('Box') as SymbolType;
        instantiate(tmpl, [new ResolvedType(builtinInt32)], 'file:///a.em', null);
        instantiate(tmpl, [new ResolvedType(builtinInt32)], 'file:///a.em', null);
        assert.equal(_instantiationCacheSize(), 1);
    });

    it('different typeArgs → distinct entries', () => {
        const r = analyzeSource(`class Box {}`);
        const tmpl = r.analyzerScope.globalScope.lookupSymbol('Box') as SymbolType;
        instantiate(tmpl, [new ResolvedType(builtinInt32)], 'file:///a.em', null);
        instantiate(tmpl, [new ResolvedType(builtinFloat32)], 'file:///a.em', null);
        assert.equal(_instantiationCacheSize(), 2);
    });

    it('computeMroFingerprint returns null for free-function context', () => {
        assert.equal(computeMroFingerprint(null), null);
    });

    it('computeMroFingerprint returns stable hex for the same class', () => {
        const r = analyzeSource(`class A {} class B : A {}`);
        const B = r.analyzerScope.globalScope.lookupSymbol('B') as SymbolType;
        const fp1 = computeMroFingerprint(B);
        const fp2 = computeMroFingerprint(B);
        assert.equal(fp1, fp2);
        assert.match(fp1!, /^[0-9a-f]{8}$/);
    });

    it('source verifies "mro-fingerprint" mention (non-paraphrasable spec)', () => {
        const src = fs.readFileSync(path.resolve(__dirname, '..', '..', '..', 'src', 'compiler_analyzer', 'templateInstantiation.ts'), 'utf8');
        assert.ok(src.includes('mro-fingerprint'));
    });
});
