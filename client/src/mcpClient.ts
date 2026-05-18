// HTTP/1.1 streamable JSON-RPC client for the Perception engine MCP server.
//
// The MCP protocol over Streamable HTTP is JSON-RPC 2.0 with optional SSE
// streaming for partial results. We use plain request/response — the engine
// returns the full result in a single response body for the script tools we
// care about (`script/execute`, `script/validate`, `script/get_context`).
//
// All pure payload-shape logic lives in `mcpRequest.ts` so it can be unit-
// tested without standing up the extension host.

import {
    buildHeaders,
    buildInitialize,
    buildToolCall,
    unwrapResponse,
} from './mcpRequest';

export interface McpClientOptions {
    readonly endpoint: string;
    readonly timeoutMs: number;
    readonly authToken?: string;
    /** Override for unit tests; defaults to globalThis.fetch. */
    readonly fetchImpl?: typeof fetch;
    /** Plugin-name reported during the initialize handshake. */
    readonly clientName?: string;
    readonly clientVersion?: string;
}

export class McpClient {
    private readonly endpoint: string;
    private readonly timeoutMs: number;
    private readonly authToken?: string;
    private readonly fetchImpl: typeof fetch;
    private readonly clientName: string;
    private readonly clientVersion: string;
    private initialized = false;

    constructor(opts: McpClientOptions) {
        this.endpoint = opts.endpoint;
        this.timeoutMs = opts.timeoutMs;
        this.authToken = opts.authToken;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.fetchImpl = opts.fetchImpl ?? (globalThis as any).fetch;
        this.clientName = opts.clientName ?? 'enma-lsp';
        this.clientVersion = opts.clientVersion ?? '1.0.0';
    }

    public async initialize(): Promise<void> {
        if (this.initialized) return;
        const payload = buildInitialize(this.clientName, this.clientVersion);
        await this.send(payload);
        this.initialized = true;
    }

    public async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
        await this.initialize();
        const payload = buildToolCall(name, args);
        return await this.send(payload);
    }

    private async send(payload: unknown): Promise<unknown> {
        if (typeof this.fetchImpl !== 'function') {
            throw new Error('No fetch implementation available. Node 18+ or a polyfill is required.');
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        let res: Response;
        try {
            res = await this.fetchImpl(this.endpoint, {
                method: 'POST',
                headers: buildHeaders(this.authToken),
                body: JSON.stringify(payload),
                signal: controller.signal,
            });
        } catch (e) {
            const err = e as Error & { name?: string };
            if (err.name === 'AbortError') {
                throw new Error(`MCP request timed out after ${this.timeoutMs}ms`);
            }
            throw new Error(`MCP request failed: ${err.message}`);
        } finally {
            clearTimeout(timer);
        }

        if (!res.ok) {
            throw new Error(`MCP server returned HTTP ${res.status} ${res.statusText}`);
        }
        const text = await res.text();
        let json: unknown;
        try { json = JSON.parse(text); }
        catch {
            throw new Error(`MCP server returned non-JSON body: ${text.slice(0, 80)}`);
        }
        return unwrapResponse(json);
    }
}
