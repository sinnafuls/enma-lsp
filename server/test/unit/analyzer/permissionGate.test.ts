import * as assert from 'node:assert/strict';
import { analyzeSource, errorsOnly } from './_helpers';
import {
    setAnalyzerPermissions,
    getAnalyzerPermissions,
    isFileStdlibName,
    checkBudgetAnnotation,
} from '../../../src/compiler_analyzer/permissionGate';
import { analyzerDiagnostic } from '../../../src/compiler_analyzer/analyzerDiagnostic';
import { NodeAnnotation, NodeExprLiteralInt, NodeKind } from '../../../src/compiler_parser/nodes';
import { TokenKind } from '../../../src/compiler_tokenizer/tokenObject';
import { TextLocation, TextRange } from '../../../src/compiler_tokenizer/textLocation';

// ---- Minimal AST fixtures ------------------------------------------------

const ZERO_POS = { line: 0, character: 0 };
const ZERO_RANGE: TextRange  = { start: ZERO_POS, end: ZERO_POS };
const ZERO_LOC: TextLocation = { uri: '', start: ZERO_POS, end: ZERO_POS };

function mkAnnotation(name: string, args: ReadonlyArray<NodeExprLiteralInt> = []): NodeAnnotation {
    return {
        kind: NodeKind.Annotation,
        range: ZERO_RANGE,
        name: { kind: TokenKind.Identifier, text: name, location: ZERO_LOC },
        args,
    };
}

function mkIntArg(): NodeExprLiteralInt {
    return {
        kind: NodeKind.ExprLiteralInt,
        range: ZERO_RANGE,
        token: { kind: TokenKind.Number, numericKind: 'int', text: '42', location: ZERO_LOC },
    };
}

// ---- permissionGate (AC-9) -----------------------------------------------

describe('permissionGate (AC-9)', () => {
    afterEach(() => setAnalyzerPermissions({ ffi: false, file: false }));

    it('emits errorForce for [[dll]] on extern when ffi=false', () => {
        setAnalyzerPermissions({ ffi: false });
        const r = analyzeSource(`
            [[dll("kernel32.dll")]]
            extern int32 ExitProcess(int32 code);
        `);
        const errs = errorsOnly(r.analyzerDiagnostics);
        assert.ok(errs.some(e => e.code === 'EN_PERM_DLL'));
    });

    it('emits 0 EN_PERM_DLL when ffi=true', () => {
        setAnalyzerPermissions({ ffi: true });
        const r = analyzeSource(`
            [[dll("kernel32.dll")]]
            extern int32 ExitProcess(int32 code);
        `);
        const errs = errorsOnly(r.analyzerDiagnostics);
        assert.ok(!errs.some(e => e.code === 'EN_PERM_DLL'));
    });

    it('exposes the current permissions snapshot via getter', () => {
        setAnalyzerPermissions({ ffi: true, file: false });
        const p = getAnalyzerPermissions();
        assert.equal(p.ffi, true);
        assert.equal(p.file, false);
    });

    it('does not gate non-dll annotations', () => {
        setAnalyzerPermissions({ ffi: false });
        const r = analyzeSource(`
            [[align(16)]]
            class Vec3 {
                int32 x;
            }
        `);
        const errs = errorsOnly(r.analyzerDiagnostics);
        assert.ok(!errs.some(e => e.code === 'EN_PERM_DLL'));
    });
});

// ---- FILE_STDLIB_NAMES Record lookup ------------------------------------

describe('isFileStdlibName (Record-backed)', () => {
    it('returns true for known file-stdlib names', () => {
        assert.ok(isFileStdlibName('fopen'));
        assert.ok(isFileStdlibName('fclose'));
        assert.ok(isFileStdlibName('fread'));
        assert.ok(isFileStdlibName('fwrite'));
        assert.ok(isFileStdlibName('file_read'));
        assert.ok(isFileStdlibName('file_write'));
    });

    it('returns false for unknown names', () => {
        assert.ok(!isFileStdlibName('printf'));
        assert.ok(!isFileStdlibName(''));
        assert.ok(!isFileStdlibName('__proto__'));
    });
});

// ---- checkBudgetAnnotation ----------------------------------------------

describe('checkBudgetAnnotation', () => {

    it('emits EN_BAD_BUDGET for [[budget]] with no argument', () => {
        analyzerDiagnostic.beginSession();
        checkBudgetAnnotation(mkAnnotation('budget'));
        const diags = analyzerDiagnostic.endSession();
        assert.ok(diags.some(d => d.code === 'EN_BAD_BUDGET'));
    });

    it('emits EN_BAD_BUDGET for [[memory_budget]] with no argument', () => {
        analyzerDiagnostic.beginSession();
        checkBudgetAnnotation(mkAnnotation('memory_budget'));
        const diags = analyzerDiagnostic.endSession();
        assert.ok(diags.some(d => d.code === 'EN_BAD_BUDGET'));
    });

    it('emits no EN_BAD_BUDGET for [[budget(N)]] with integer literal arg', () => {
        analyzerDiagnostic.beginSession();
        checkBudgetAnnotation(mkAnnotation('budget', [mkIntArg()]));
        const diags = analyzerDiagnostic.endSession();
        assert.ok(!diags.some(d => d.code === 'EN_BAD_BUDGET'));
    });

    it('emits no EN_BAD_BUDGET for [[memory_budget(N)]] with integer literal arg', () => {
        analyzerDiagnostic.beginSession();
        checkBudgetAnnotation(mkAnnotation('memory_budget', [mkIntArg()]));
        const diags = analyzerDiagnostic.endSession();
        assert.ok(!diags.some(d => d.code === 'EN_BAD_BUDGET'));
    });

    it('ignores non-budget annotations entirely', () => {
        analyzerDiagnostic.beginSession();
        checkBudgetAnnotation(mkAnnotation('align'));
        const diags = analyzerDiagnostic.endSession();
        assert.ok(!diags.some(d => d.code === 'EN_BAD_BUDGET'));
    });
});
