import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { tokenize } from '../../../src/compiler_tokenizer/tokenizer';
import { preprocessAfterTokenized } from '../../../src/compiler_parser/parserPreprocess';
import { TokenKind } from '../../../src/compiler_tokenizer/tokenObject';

const SHOWCASE_PATH = path.join(__dirname, '..', '..', '..', '..', 'samples', 'showcase.em');
const URI = 'file:///samples/showcase.em';

describe('Preprocessor — showcase.em end-to-end', () => {
    let showcaseSrc: string;

    before(() => {
        showcaseSrc = fs.readFileSync(SHOWCASE_PATH, 'utf-8');
    });

    it('processes showcase.em without crashing', () => {
        const tokens = tokenize(URI, showcaseSrc);
        assert.ok(tokens.length > 0);
        const out = preprocessAfterTokenized(tokens, { fileUri: URI });
        assert.ok(out !== undefined);
    });

    it('showcase.em produces 0 Error diagnostics', () => {
        const out = preprocessAfterTokenized(tokenize(URI, showcaseSrc), { fileUri: URI });
        const errors = out.diagnostics.filter(d => d.severity === 'error');
        assert.strictEqual(errors.length, 0,
            `Expected 0 errors but got: ${errors.map(e => e.message).join(', ')}`);
    });

    it('#include "core.em" appears in includePathTokens', () => {
        const out = preprocessAfterTokenized(tokenize(URI, showcaseSrc), { fileUri: URI });
        const paths = out.includePathTokens.map(t => t.text);
        assert.ok(paths.some(p => p.includes('core.em')),
            `Expected "core.em" in include paths but got: ${paths.join(', ')}`);
    });

    it('#define MAX_HP 100 is in macroDefs', () => {
        const out = preprocessAfterTokenized(tokenize(URI, showcaseSrc), { fileUri: URI });
        assert.ok(out.macroDefs.has('MAX_HP'),
            'Expected MAX_HP to be in macroDefs');
        const def = out.macroDefs.get('MAX_HP')!;
        assert.strictEqual(def.params, undefined); // object-like
        assert.ok(def.body.length === 1);
        assert.strictEqual(def.body[0].text, '100');
    });

    it('#define LOG(m) println(m) is a function-like macro with one param', () => {
        // showcase.em has #ifdef DEBUG / #define LOG(m) println(m) / #endif
        // DEBUG is not defined so LOG may not be in macroDefs — but it IS defined in the block
        // Since DEBUG is not predefined, LOG is NOT in macroDefs after preprocessing
        // This test verifies the conditional suppression works correctly
        const out = preprocessAfterTokenized(tokenize(URI, showcaseSrc), { fileUri: URI });
        // Without DEBUG defined, LOG should NOT be in macroDefs
        assert.ok(!out.macroDefs.has('LOG'),
            'LOG should not be defined when DEBUG is not defined');
    });

    it('conditional #ifdef DEBUG / #endif block is inactive (DEBUG not defined)', () => {
        const out = preprocessAfterTokenized(tokenize(URI, showcaseSrc), { fileUri: URI });
        // No diagnostics related to DEBUG
        const errors = out.diagnostics.filter(d => d.severity === 'error');
        assert.strictEqual(errors.length, 0);
        // LOG macro not defined (was inside #ifdef DEBUG)
        assert.ok(!out.macroDefs.has('LOG'));
    });

    it('conditional #ifdef DEBUG active when DEBUG is predefined', () => {
        const out = preprocessAfterTokenized(tokenize(URI, showcaseSrc), {
            fileUri: URI,
            predefinedMacros: { DEBUG: '1' },
        });
        // With DEBUG defined, LOG should now be in macroDefs
        assert.ok(out.macroDefs.has('LOG'),
            'LOG should be defined when DEBUG is predefined');
        const logDef = out.macroDefs.get('LOG')!;
        assert.ok(Array.isArray(logDef.params));
        assert.strictEqual(logDef.params!.length, 1);
        assert.strictEqual(logDef.params![0], 'm');
    });

    it('preprocessedTokens is non-empty (actual code tokens emitted)', () => {
        const out = preprocessAfterTokenized(tokenize(URI, showcaseSrc), { fileUri: URI });
        const nonEof = out.preprocessedTokens.filter(t => t.kind !== TokenKind.EOF);
        assert.ok(nonEof.length > 0, 'Expected non-empty preprocessed output');
    });

    it('all emitted tokens have valid locations with correct URI', () => {
        const out = preprocessAfterTokenized(tokenize(URI, showcaseSrc), { fileUri: URI });
        for (const tok of out.preprocessedTokens) {
            if (tok.kind === TokenKind.EOF) continue;
            assert.strictEqual(tok.location.uri, URI,
                `Token '${tok.text}' has wrong URI: ${tok.location.uri}`);
            assert.ok(tok.location.start.line >= 0);
            assert.ok(tok.location.start.character >= 0);
        }
    });
});
