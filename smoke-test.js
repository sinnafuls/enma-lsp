// Tokenize the sample showcase.em through the grammar to verify it parses.
// Run: node smoke-test.js

const fs = require('fs');
const path = require('path');
const vsctm = require('vscode-textmate');
const oniguruma = require('vscode-oniguruma');

(async () => {
  const wasmPath = require.resolve('vscode-oniguruma/release/onig.wasm');
  const wasm = fs.readFileSync(wasmPath);
  await oniguruma.loadWASM(wasm);

  const registry = new vsctm.Registry({
    onigLib: Promise.resolve({
      createOnigScanner: (patterns) => new oniguruma.OnigScanner(patterns),
      createOnigString: (s) => new oniguruma.OnigString(s)
    }),
    loadGrammar: async (scopeName) => {
      if (scopeName !== 'source.enma') return null;
      const data = fs.readFileSync(
        path.join(__dirname, 'syntaxes', 'enma.tmLanguage.json'),
        'utf8'
      );
      return vsctm.parseRawGrammar(data, 'enma.tmLanguage.json');
    }
  });

  const grammar = await registry.loadGrammar('source.enma');
  if (!grammar) {
    console.error('Failed to load grammar');
    process.exit(1);
  }

  const source = fs.readFileSync(
    path.join(__dirname, 'samples', 'showcase.em'),
    'utf8'
  );

  let ruleStack = vsctm.INITIAL;
  const lines = source.split(/\r?\n/);
  let totalTokens = 0;
  let unknownTokens = 0;
  const scopeFreq = new Map();
  const interestingLines = [];

  // Lines we want to inspect specifically — pick examples that exercise edge cases.
  const targets = new Set([
    'p->hp = p->hp - 10;',
    'e.hp = 50;',
    'string s = f"sum + 1 = {nums[0] + nums[1] * 2}";',
    'const int64 DIST_KM    = 42_km;',
    '[[align(16)]]',
    'template<typename T>',
    'BinOp add = [](int32 a, int32 b) -> int32 { return a + b; };'
  ]);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const result = grammar.tokenizeLine(line, ruleStack);
    ruleStack = result.ruleStack;

    for (const tok of result.tokens) {
      totalTokens++;
      const slice = line.slice(tok.startIndex, tok.endIndex);
      const scope = tok.scopes[tok.scopes.length - 1];
      scopeFreq.set(scope, (scopeFreq.get(scope) || 0) + 1);
      if (scope === 'source.enma' && slice.trim().length > 0) unknownTokens++;
    }

    const trimmed = line.trim();
    if (targets.has(trimmed)) {
      interestingLines.push({ line: trimmed, tokens: result.tokens.map(t => ({
        text: line.slice(t.startIndex, t.endIndex),
        scopes: t.scopes
      })) });
    }
  }

  console.log(`Tokenized ${lines.length} lines, ${totalTokens} tokens.`);
  console.log(`Unscoped (only source.enma) non-whitespace tokens: ${unknownTokens}`);
  console.log('');
  console.log('Top scopes:');
  const sorted = [...scopeFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
  for (const [scope, n] of sorted) {
    console.log(`  ${n.toString().padStart(4)}  ${scope}`);
  }

  console.log('');
  console.log('Spot checks:');
  for (const ex of interestingLines) {
    console.log('---');
    console.log(ex.line);
    for (const t of ex.tokens) {
      if (t.text.trim().length === 0) continue;
      const lastScope = t.scopes[t.scopes.length - 1];
      console.log(`   ${JSON.stringify(t.text).padEnd(20)} -> ${lastScope}`);
    }
  }
})();
