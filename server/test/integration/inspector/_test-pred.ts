process.env.ENMA_LSP_TEST = '1';
import { loadPredefinedFile } from '../../../src/inspector/predefinedLoader';
const r = loadPredefinedFile('D:/Projects/fortnut/perception.em.predefined', 'workspace');
if (!r) { console.log('LOAD FAIL'); process.exit(1); }
console.log('diags:', r.diagnostics.length);
for (const d of r.diagnostics.slice(0,8)) console.log('  ', d.severity, d.range.start.line+1, d.message);
const names: string[] = [];
for (const [n,_] of r.globalScope.symbolTable) names.push(n);
console.log('symbols:', names.length);
console.log('has sidebar_section_t?', names.includes('sidebar_section_t'));
console.log('has color?', names.includes('color'));
console.log('has vec2?', names.includes('vec2'));
console.log('has menu_t?', names.includes('menu_t'));
console.log('first 30 symbols:', names.slice(0, 30));
