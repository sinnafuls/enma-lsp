process.env.ENMA_LSP_TEST = '1';
import { loadPredefinedFile } from '../../../src/inspector/predefinedLoader';

const r = loadPredefinedFile('D:/Projects/fortnut/perception.em.predefined', 'workspace');
console.log('record:', !!r);
if (r) {
    console.log('parser diags:', r.diagnostics.length);
    r.diagnostics.slice(0, 30).forEach(d =>
        console.log('  sev=', d.severity, d.message, '@line', d.range?.start?.line));
    console.log('symbols in scope:', r.globalScope.symbolTable.size);
    const names = [...r.globalScope.symbolTable.keys()];
    console.log('first 50 names:', names.slice(0, 50).join(','));
    console.log('total:', names.length);
    for (const n of ['button_t','menu_t','sidebar_section_t','proc_t','keybind_t','inline_button_t','create_menu','ref_process','T']) {
        const sym: any = r.globalScope.symbolTable.get(n);
        console.log(`  has ${n}:`, !!sym, sym ? `kind=${sym.constructor.name} linkedNode=${!!sym.linkedNode} membersScope=${!!sym.membersScopePath}` : '');
    }
}
