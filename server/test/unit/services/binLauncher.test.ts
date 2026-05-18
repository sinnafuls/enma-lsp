process.env.ENMA_LSP_TEST = '1';

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('bin/enma-language-server launcher', () => {
    const launcher = path.resolve(__dirname, '../../../../bin/enma-language-server.js');

    it('exists on disk', () => {
        assert.ok(fs.existsSync(launcher), `expected launcher at ${launcher}`);
    });

    it('starts with a shebang line', () => {
        const src = fs.readFileSync(launcher, 'utf8');
        assert.ok(src.startsWith('#!/usr/bin/env node'), 'missing #!/usr/bin/env node shebang');
    });

    it('injects --stdio when no transport flag is present', () => {
        const src = fs.readFileSync(launcher, 'utf8');
        assert.ok(src.includes("'--stdio'"), '--stdio default-injection logic missing');
        assert.ok(src.includes('TRANSPORT_FLAGS'), 'transport-flag detection missing');
    });

    it('points at the built server bundle under server/dist/', () => {
        const src = fs.readFileSync(launcher, 'utf8');
        assert.ok(src.includes("'server', 'dist', 'server.js'"), 'server bundle path missing');
    });
});
