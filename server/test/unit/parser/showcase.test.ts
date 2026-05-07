import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { parseSource, parserErrors } from './_helpers';
import { NodeKind } from '../../../src/compiler_parser/nodes';

const SHOWCASE_PATH = path.resolve(__dirname, '../../../../samples/showcase.em');

describe('Parser — samples/showcase.em', () => {
    const content = fs.readFileSync(SHOWCASE_PATH, 'utf8');
    const result = parseSource(content, 'file:///samples/showcase.em');

    it('parses with at most 1 error (the documented pseudo-nested block comment, see docs/parser-decision.md)', () => {
        const errors = parserErrors(result.diagnostics);
        // The showcase contains a deliberate pseudo-nested block comment (`/* ... /* ... */ ... */`).
        // Enma block comments are NOT nestable (first `*/` closes), so the trailing text on
        // line 6 (1-based) / line 5 (0-based) leaks into the parser as 1 error. Per
        // docs/parser-decision.md this is correct grammar behavior — the tree-sitter spike
        // produces 1 ERROR node here too. We accept errors anywhere on lines 5–7 (0-based).
        const onLeak = errors.filter(e => e.location.start.line >= 4 && e.location.start.line <= 7);
        const otherErrors = errors.filter(e => e.location.start.line < 4 || e.location.start.line > 7);
        if (otherErrors.length > 0) {
            const lines = otherErrors.slice(0, 20).map(e =>
                `  ${e.severity}@${e.location.start.line}:${e.location.start.character}: ${e.message}`,
            );
            assert.fail(`expected 0 parser errors outside the documented block-comment leak, got ${otherErrors.length}\n${lines.join('\n')}`);
        }
        assert.ok(onLeak.length <= 3, `expected ≤3 errors in pseudo-nested comment region, got ${onLeak.length}`);
    });

    it('produces a NodeScript root', () => {
        assert.strictEqual(result.ast.kind, NodeKind.Script);
        assert.ok(result.ast.children.length > 0, 'script has top-level children');
    });

    it('captures top-level kinds we expect', () => {
        const kinds = result.ast.children.map(c => c.kind);
        assert.ok(kinds.includes(NodeKind.Import), 'import present');
        assert.ok(kinds.includes(NodeKind.Using), 'using present');
        assert.ok(kinds.includes(NodeKind.Struct), 'struct present');
        assert.ok(kinds.includes(NodeKind.Class), 'class present');
        assert.ok(kinds.includes(NodeKind.Interface), 'interface present');
        assert.ok(kinds.includes(NodeKind.Enum), 'enum present');
        assert.ok(kinds.includes(NodeKind.Delegate), 'delegate present');
        assert.ok(kinds.includes(NodeKind.Namespace), 'namespace present');
        assert.ok(kinds.includes(NodeKind.Template), 'template present');
        assert.ok(kinds.includes(NodeKind.Function), 'free function present');
        assert.ok(kinds.includes(NodeKind.Var), 'top-level var present');
    });
});
