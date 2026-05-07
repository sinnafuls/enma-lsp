import * as assert from 'assert';
import { tokenize } from '../../../src/compiler_tokenizer/tokenizer';
import { preprocessAfterTokenized } from '../../../src/compiler_parser/parserPreprocess';

const URI = 'file:///test.em';
const URI2 = 'file:///other.em';

function preprocess(src: string, uri = URI) {
    return preprocessAfterTokenized(tokenize(uri, src), { fileUri: uri });
}

describe('Preprocessor — #pragma once', () => {
    it('#pragma once records the file URI in pragmaOnceFiles', () => {
        const out = preprocess('#pragma once');
        assert.ok(out.pragmaOnceFiles.has(URI));
    });

    it('#pragma once is idempotent — second occurrence does not duplicate', () => {
        const out = preprocess('#pragma once\n#pragma once');
        assert.ok(out.pragmaOnceFiles.has(URI));
        assert.strictEqual(out.pragmaOnceFiles.size, 1);
    });

    it('#pragma once with different URI records correct URI', () => {
        const out = preprocess('#pragma once', URI2);
        assert.ok(out.pragmaOnceFiles.has(URI2));
        assert.ok(!out.pragmaOnceFiles.has(URI));
    });

    it('#pragma once inside inactive #ifdef is NOT recorded', () => {
        const out = preprocess('#ifdef ABSENT\n#pragma once\n#endif');
        assert.ok(!out.pragmaOnceFiles.has(URI));
    });

    it('#pragma once inside active block IS recorded', () => {
        const out = preprocess('#define YES\n#ifdef YES\n#pragma once\n#endif');
        assert.ok(out.pragmaOnceFiles.has(URI));
    });
});
