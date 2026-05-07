import * as assert from 'assert';
import { tokenize } from '../../../src/compiler_tokenizer/tokenizer';
import { TokenKind } from '../../../src/compiler_tokenizer/tokenObject';

describe('Tokenizer — operators (longest match)', () => {

    function onlyOp(src: string): string {
        const toks = tokenize('test.em', src);
        const ops = toks.filter(t => t.kind === TokenKind.Operator);
        assert.strictEqual(ops.length, 1, `Expected 1 operator in '${src}', got ${ops.length}: ${ops.map(o => o.text).join(', ')}`);
        return ops[0].text;
    }

    // Multi-char operators
    it('<<=', () => assert.strictEqual(onlyOp('<<='), '<<='));
    it('>>=', () => assert.strictEqual(onlyOp('>>='), '>>='));
    it('<<', () => assert.strictEqual(onlyOp('<<'), '<<'));
    it('>>', () => assert.strictEqual(onlyOp('>>'), '>>'));
    it('==', () => assert.strictEqual(onlyOp('=='), '=='));
    it('!=', () => assert.strictEqual(onlyOp('!='), '!='));
    it('<=', () => assert.strictEqual(onlyOp('<='), '<='));
    it('>=', () => assert.strictEqual(onlyOp('>='), '>='));
    it('&&', () => assert.strictEqual(onlyOp('&&'), '&&'));
    it('||', () => assert.strictEqual(onlyOp('||'), '||'));
    it('++', () => assert.strictEqual(onlyOp('++'), '++'));
    it('--', () => assert.strictEqual(onlyOp('--'), '--'));
    it('+=', () => assert.strictEqual(onlyOp('+='), '+='));
    it('-=', () => assert.strictEqual(onlyOp('-='), '-='));
    it('*=', () => assert.strictEqual(onlyOp('*='), '*='));
    it('/=', () => assert.strictEqual(onlyOp('/='), '/='));
    it('%=', () => assert.strictEqual(onlyOp('%='), '%='));
    it('&=', () => assert.strictEqual(onlyOp('&='), '&='));
    it('|=', () => assert.strictEqual(onlyOp('|='), '|='));
    it('^=', () => assert.strictEqual(onlyOp('^='), '^='));
    it('->', () => assert.strictEqual(onlyOp('->'), '->'));
    it('=>', () => assert.strictEqual(onlyOp('=>'), '=>'));
    it('::', () => assert.strictEqual(onlyOp('::'), '::'));

    // Critical longest-match cases
    it('-> is NOT -- followed by >', () => {
        const toks = tokenize('test.em', '->');
        const ops = toks.filter(t => t.kind === TokenKind.Operator);
        assert.strictEqual(ops.length, 1);
        assert.strictEqual(ops[0].text, '->');
    });

    it('=> is NOT = followed by >', () => {
        const toks = tokenize('test.em', '=>');
        const ops = toks.filter(t => t.kind === TokenKind.Operator);
        assert.strictEqual(ops.length, 1);
        assert.strictEqual(ops[0].text, '=>');
    });

    it(':: is NOT : followed by :', () => {
        const toks = tokenize('test.em', '::');
        const ops = toks.filter(t => t.kind === TokenKind.Operator);
        assert.strictEqual(ops.length, 1);
        assert.strictEqual(ops[0].text, '::');
    });

    it('<< is not < < (two operators)', () => {
        const toks = tokenize('test.em', '<<');
        const ops = toks.filter(t => t.kind === TokenKind.Operator);
        assert.strictEqual(ops.length, 1);
        assert.strictEqual(ops[0].text, '<<');
    });

    it('p->hp uses -> operator', () => {
        const toks = tokenize('test.em', 'p->hp');
        const ops = toks.filter(t => t.kind === TokenKind.Operator);
        assert.strictEqual(ops.length, 1);
        assert.strictEqual(ops[0].text, '->');
    });

    it('geom::Point uses :: operator', () => {
        const toks = tokenize('test.em', 'geom::Point');
        const ops = toks.filter(t => t.kind === TokenKind.Operator);
        assert.strictEqual(ops.length, 1);
        assert.strictEqual(ops[0].text, '::');
    });

    it('lambda -> int32 return type', () => {
        const toks = tokenize('test.em', '[](int32 a) -> int32');
        const arrow = toks.find(t => t.kind === TokenKind.Operator && t.text === '->');
        assert.ok(arrow !== undefined);
    });

    it('match arm => value', () => {
        const toks = tokenize('test.em', '0 => 100');
        const fat = toks.find(t => t.kind === TokenKind.Operator && t.text === '=>');
        assert.ok(fat !== undefined);
    });

    // Single-char operators still work
    it('+ single char', () => assert.strictEqual(onlyOp('+'), '+'));
    it('- single char', () => assert.strictEqual(onlyOp('-'), '-'));
    it('* single char', () => assert.strictEqual(onlyOp('*'), '*'));
    it('/ single char', () => assert.strictEqual(onlyOp('/'), '/'));
    it('= single char', () => assert.strictEqual(onlyOp('='), '='));
    it('@ single char', () => assert.strictEqual(onlyOp('@'), '@'));
    it('. single char', () => assert.strictEqual(onlyOp('.'), '.'));
    it('~ single char', () => assert.strictEqual(onlyOp('~'), '~'));
    it('? single char', () => assert.strictEqual(onlyOp('?'), '?'));
});
