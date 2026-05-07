import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { parseSource, parserErrors } from './_helpers';

const CORPUS_DIR = path.resolve(__dirname, '../../../../.omc/corpus');

function listCorpusFiles(): string[] {
    if (!fs.existsSync(CORPUS_DIR)) return [];
    return fs.readdirSync(CORPUS_DIR)
        .filter(f => f.endsWith('.em'))
        .map(f => path.join(CORPUS_DIR, f))
        .sort();
}

describe('Parser — §A6 corpus pass-rate', () => {
    const files = listCorpusFiles();

    it('corpus directory has files (run `npm run corpus` if missing)', () => {
        assert.ok(files.length > 0, `no corpus files at ${CORPUS_DIR}`);
        assert.ok(files.length >= 20, `expected ≥20 corpus files, got ${files.length}`);
    });

    it('corpus pass-rate meets week-6 gate (≥70% files-with-zero-errors)', function () {
        if (files.length === 0) this.skip();
        let zeroErrorFiles = 0;
        let totalErrors = 0;
        const failingFiles: { uri: string; errCount: number; first: string }[] = [];
        for (const file of files) {
            const src = fs.readFileSync(file, 'utf8');
            const result = parseSource(src, `file:///${path.basename(file)}`);
            const errors = parserErrors(result.diagnostics);
            totalErrors += errors.length;
            if (errors.length === 0) zeroErrorFiles++;
            else failingFiles.push({
                uri: path.basename(file),
                errCount: errors.length,
                first: errors[0] ? `${errors[0].location.start.line}:${errors[0].location.start.character} ${errors[0].message}` : '',
            });
        }
        const passRate = zeroErrorFiles / files.length;
        const message = `corpus pass-rate: ${zeroErrorFiles}/${files.length} (${(passRate * 100).toFixed(1)}%) — totalErrors=${totalErrors}`;
        // Print details on first 5 failing files
        if (failingFiles.length > 0) {
            console.log(message);
            for (const f of failingFiles.slice(0, 5)) {
                console.log(`  ${f.uri}: ${f.errCount} errors; first: ${f.first}`);
            }
        }
        assert.ok(passRate >= 0.70, `${message} (expected ≥70%)`);
    });
});
