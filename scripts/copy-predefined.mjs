import * as fs from 'node:fs';
import * as path from 'node:path';
import {fileURLToPath} from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const src = path.join(repoRoot, 'server', 'src', 'predefined');
const dsts = [
  path.join(repoRoot, 'server', 'out', 'predefined'),  // tsc-emit dev mode
  path.join(repoRoot, 'server', 'dist', 'predefined'), // esbuild-bundle production mode (.vsix)
];

if (!fs.existsSync(src)) {
  console.log(`copy-predefined: skipped (no ${path.relative(repoRoot, src)} directory yet — Phase 6 generates it).`);
  process.exit(0);
}

const files = fs.readdirSync(src).filter(f => fs.statSync(path.join(src, f)).isFile());
let count = 0;
for (const dst of dsts) {
  fs.mkdirSync(dst, {recursive: true});
  for (const f of files) {
    fs.copyFileSync(path.join(src, f), path.join(dst, f));
    console.log(`copy-predefined: ${path.relative(repoRoot, dst)}/${f}`);
    count++;
  }
}

console.log(`copy-predefined: copied ${files.length} file(s) to ${dsts.length} target(s) (${count} total).`);
