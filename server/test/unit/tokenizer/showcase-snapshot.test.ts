import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { tokenize } from '../../../src/compiler_tokenizer/tokenizer';
import { TokenKind, TokenObject } from '../../../src/compiler_tokenizer/tokenObject';

const SHOWCASE_PATH = path.resolve(__dirname, '../../../../samples/showcase.em');
const SNAPSHOT_PATH = path.resolve(__dirname, '__snapshots__/showcase.snap');

function serializeTokens(tokens: TokenObject[]): string {
    return tokens
        .map(t => {
            const loc = `${t.location.start.line}:${t.location.start.character}-${t.location.end.line}:${t.location.end.character}`;
            const extra = (t as any).numericKind
                ? ` numericKind=${(t as any).numericKind}`
                : (t as any).stringKind
                ? ` stringKind=${(t as any).stringKind}`
                : (t as any).commentKind
                ? ` commentKind=${(t as any).commentKind}`
                : (t as any).directive
                ? ` directive=${(t as any).directive}`
                : '';
            return `${t.kind}${extra} [${loc}] ${JSON.stringify(t.text)}`;
        })
        .join('\n');
}

describe('Tokenizer — showcase snapshot', () => {
    let tokens: TokenObject[];
    let serialized: string;

    before(() => {
        const content = fs.readFileSync(SHOWCASE_PATH, 'utf8');
        tokens = tokenize('file:///samples/showcase.em', content);
        serialized = serializeTokens(tokens);
    });

    it('tokenizes showcase.em without throwing', () => {
        assert.ok(tokens.length > 0);
    });

    it('last token is EOF', () => {
        assert.strictEqual(tokens[tokens.length - 1].kind, TokenKind.EOF);
    });

    it('no undefined token kinds', () => {
        for (const tok of tokens) {
            assert.ok(tok.kind !== undefined, `Token with undefined kind: ${JSON.stringify(tok)}`);
        }
    });

    it('contains expected keywords from showcase', () => {
        const reserved = tokens.filter(t => t.kind === TokenKind.Reserved).map(t => t.text);
        const expected = ['class', 'struct', 'interface', 'enum', 'namespace', 'template',
            'int32', 'int64', 'uint8', 'uint32', 'float32', 'float64', 'string',
            'void', 'null', 'return', 'for', 'while',
            'if', 'try', 'catch', 'throw', 'new', 'delete', 'extern', 'delegate',
            'match', 'defer', 'const', 'override', 'import', 'using'];
        for (const kw of expected) {
            assert.ok(reserved.includes(kw), `Expected keyword '${kw}' in showcase tokens`);
        }
    });

    it('contains f-string boundary tokens', () => {
        assert.ok(tokens.some(t => t.kind === TokenKind.FStringStart), 'Should have FStringStart');
        assert.ok(tokens.some(t => t.kind === TokenKind.FStringEnd), 'Should have FStringEnd');
        assert.ok(tokens.some(t => t.kind === TokenKind.FStringExprOpen), 'Should have FStringExprOpen');
        assert.ok(tokens.some(t => t.kind === TokenKind.FStringExprClose), 'Should have FStringExprClose');
    });

    it('contains annotation tokens', () => {
        assert.ok(tokens.some(t => t.kind === TokenKind.AnnotationOpen), 'Should have [[');
        assert.ok(tokens.some(t => t.kind === TokenKind.AnnotationClose), 'Should have ]]');
    });

    it('contains preprocessor tokens', () => {
        const pps = tokens.filter(t => t.kind === TokenKind.Preprocessor);
        assert.ok(pps.length >= 4, `Expected at least 4 preprocessor tokens, got ${pps.length}`);
    });

    it('contains intrinsic tokens', () => {
        const intrinsics = tokens.filter(t => t.kind === TokenKind.Reserved && t.text.startsWith('__'));
        assert.ok(intrinsics.length > 0, 'Should have intrinsic tokens (__asm_*, __va_*)');
    });

    it('UDL 42_km splits correctly in showcase', () => {
        const numbers = tokens.filter(t => t.kind === TokenKind.Number);
        const km = tokens.find(t => t.kind === TokenKind.Number && t.text === '42');
        assert.ok(km !== undefined, 'Should have number 42 from 42_km');
        const kmIdx = tokens.indexOf(km!);
        assert.strictEqual(tokens[kmIdx + 1].kind, TokenKind.Identifier);
        assert.strictEqual(tokens[kmIdx + 1].text, '_km');
    });

    it('snapshot matches or creates snapshot file', () => {
        if (!fs.existsSync(SNAPSHOT_PATH)) {
            fs.mkdirSync(path.dirname(SNAPSHOT_PATH), { recursive: true });
            fs.writeFileSync(SNAPSHOT_PATH, serialized, 'utf8');
            // First run: snapshot written, test passes trivially
            assert.ok(true, 'Snapshot created');
        } else {
            const existing = fs.readFileSync(SNAPSHOT_PATH, 'utf8');
            assert.strictEqual(serialized, existing,
                'Snapshot mismatch — token stream changed. Update snapshot if intentional by deleting __snapshots__/showcase.snap');
        }
    });

    it('f-string boundaries are balanced in showcase', () => {
        const opens = tokens.filter(t => t.kind === TokenKind.FStringExprOpen);
        const closes = tokens.filter(t => t.kind === TokenKind.FStringExprClose);
        assert.strictEqual(opens.length, closes.length, 'FStringExprOpen/Close should be balanced');
    });

    it('token count is stable (regression gate)', () => {
        // A rough lower bound — if this fails, a major structural change happened
        assert.ok(tokens.length > 400, `Expected >400 tokens, got ${tokens.length}`);
    });
});
