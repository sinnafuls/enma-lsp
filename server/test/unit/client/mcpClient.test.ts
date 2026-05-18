process.env.ENMA_LSP_TEST = '1';

import * as assert from 'node:assert/strict';
import { buildHeaders, buildInitialize, buildToolCall, resetIdSequence, unwrapResponse } from '../../../../client/src/mcpRequest';
import { McpClient } from '../../../../client/src/mcpClient';

beforeEach(() => resetIdSequence());

describe('mcpRequest payload shape', () => {
    it('buildToolCall produces a JSON-RPC 2.0 tools/call envelope', () => {
        const p = buildToolCall('script/execute', { source: 'void main(){}' });
        assert.equal(p.jsonrpc, '2.0');
        assert.equal(p.method, 'tools/call');
        assert.deepEqual(p.params, { name: 'script/execute', arguments: { source: 'void main(){}' } });
        assert.equal(typeof p.id, 'number');
    });

    it('buildInitialize names this client and a 2025-06-18 protocol', () => {
        const p = buildInitialize('enma-lsp', '1.0.0');
        const params = p.params as { protocolVersion: string; clientInfo: { name: string; version: string } };
        assert.equal(params.protocolVersion, '2025-06-18');
        assert.equal(params.clientInfo.name, 'enma-lsp');
        assert.equal(params.clientInfo.version, '1.0.0');
    });

    it('buildHeaders includes a bearer token when one is provided', () => {
        const headers = buildHeaders('s3cret');
        assert.equal(headers['Authorization'], 'Bearer s3cret');
        assert.equal(headers['Content-Type'], 'application/json');
    });

    it('buildHeaders omits Authorization when no token is given', () => {
        const headers = buildHeaders();
        assert.equal(headers['Authorization'], undefined);
    });

    it('unwrapResponse returns result on ok', () => {
        const r = unwrapResponse({ jsonrpc: '2.0', id: 1, result: { ok: true } });
        assert.deepEqual(r, { ok: true });
    });

    it('unwrapResponse throws on error', () => {
        assert.throws(
            () => unwrapResponse({ jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'no such tool' } }),
            /MCP error -32601: no such tool/,
        );
    });
});

describe('McpClient', () => {
    function makeFakeFetch(impl: (url: string, init: { body?: unknown }) => { status: number; body: string }): typeof fetch {
        const fake = async (url: unknown, init?: unknown): Promise<unknown> => {
            const r = impl(String(url), (init as { body?: unknown }) ?? {});
            return {
                ok: r.status >= 200 && r.status < 300,
                status: r.status,
                statusText: r.status === 200 ? 'OK' : 'Error',
                text: async () => r.body,
            };
        };
        return fake as unknown as typeof fetch;
    }

    it('initialize POSTs an MCP initialize envelope to the configured endpoint', async () => {
        let observedUrl = '';
        let observedBody = '';
        const client = new McpClient({
            endpoint: 'http://127.0.0.1:9077/mcp',
            timeoutMs: 1000,
            fetchImpl: makeFakeFetch((url, init) => {
                observedUrl = url;
                observedBody = String(init.body);
                return { status: 200, body: JSON.stringify({ jsonrpc: '2.0', id: 1, result: { capabilities: {} } }) };
            }),
        });
        await client.initialize();
        assert.equal(observedUrl, 'http://127.0.0.1:9077/mcp');
        const parsed = JSON.parse(observedBody);
        assert.equal(parsed.method, 'initialize');
    });

    it('callTool emits a tools/call payload with the tool name + arguments', async () => {
        let lastBody = '';
        const client = new McpClient({
            endpoint: 'http://127.0.0.1:9077/mcp',
            timeoutMs: 1000,
            fetchImpl: makeFakeFetch((_url, init) => {
                lastBody = String(init.body);
                return { status: 200, body: JSON.stringify({ jsonrpc: '2.0', id: 99, result: { stdout: 'ok' } }) };
            }),
        });
        const result = await client.callTool('script/execute', { source: 'void main(){}' });
        const last = JSON.parse(lastBody);
        assert.equal(last.method, 'tools/call');
        assert.equal(last.params.name, 'script/execute');
        assert.equal(last.params.arguments.source, 'void main(){}');
        assert.deepEqual(result, { stdout: 'ok' });
    });

    it('callTool surfaces HTTP errors with a human-readable message', async () => {
        const client = new McpClient({
            endpoint: 'http://127.0.0.1:9077/mcp',
            timeoutMs: 1000,
            fetchImpl: makeFakeFetch(() => ({ status: 503, body: 'server overloaded' })),
        });
        await assert.rejects(
            client.callTool('script/execute', { source: '' }),
            /HTTP 503/,
        );
    });

    it('callTool surfaces JSON-RPC errors', async () => {
        const client = new McpClient({
            endpoint: 'http://127.0.0.1:9077/mcp',
            timeoutMs: 1000,
            fetchImpl: makeFakeFetch(() => ({
                status: 200,
                body: JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'invalid params' } }),
            })),
        });
        await assert.rejects(
            client.callTool('script/execute', { source: '' }),
            /MCP error -32602: invalid params/,
        );
    });
});
