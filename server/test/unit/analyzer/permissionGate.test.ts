import * as assert from 'node:assert/strict';
import { analyzeSource, errorsOnly } from './_helpers';
import {
    setAnalyzerPermissions,
    getAnalyzerPermissions,
} from '../../../src/compiler_analyzer/permissionGate';

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
