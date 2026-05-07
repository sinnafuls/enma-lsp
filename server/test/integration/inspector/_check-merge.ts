process.env.ENMA_LSP_TEST = '1';
import { createGlobalScope } from '../../../src/compiler_analyzer/analyzerScope';
import { setActiveGlobalScope } from '../../../src/compiler_analyzer/symbolScope';
import { registerEnmaTypes } from '../../../src/compiler_analyzer/enmaTypes';
import { loadPredefinedFile, mergePredefinedIntoScope } from '../../../src/inspector/predefinedLoader';

const g = createGlobalScope('file:///x.em', []);
setActiveGlobalScope(g);
registerEnmaTypes(g, { skipStdlib: true });
const pred = loadPredefinedFile('D:/Projects/fortnut/perception.em.predefined', 'workspace');
console.log('pred has T:', pred?.globalScope.symbolTable.has('T'));
console.log('before merge: g has T:', g.symbolTable.has('T'));
if (pred) mergePredefinedIntoScope(g, [pred]);
console.log('after merge: g has T:', g.symbolTable.has('T'));
const T: any = g.symbolTable.get('T');
console.log('T:', T && T.constructor.name, 'linkedNode:', !!T?.linkedNode, 'membersScope:', !!T?.membersScopePath);
