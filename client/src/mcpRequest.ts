// Pure JSON-RPC payload builders for the engine MCP client.
//
// Lives in its own module (no `vscode` import) so mocha can exercise the
// request-shape logic without standing up the extension host.

export interface JsonRpcCall {
    readonly jsonrpc: '2.0';
    readonly id: number;
    readonly method: string;
    readonly params: unknown;
}

export interface JsonRpcOk {
    readonly jsonrpc: '2.0';
    readonly id: number;
    readonly result: unknown;
}

export interface JsonRpcErr {
    readonly jsonrpc: '2.0';
    readonly id: number;
    readonly error: { code: number; message: string; data?: unknown };
}

export type JsonRpcResponse = JsonRpcOk | JsonRpcErr;

let s_nextId = 1;

/** Reset the per-process JSON-RPC id sequence (test-only). */
export function resetIdSequence(): void {
    s_nextId = 1;
}

export function nextRequestId(): number {
    return s_nextId++;
}

/** Build a `tools/call` JSON-RPC payload — the standard MCP tool-invocation
 *  shape. The tool name and its arguments are passed verbatim. */
export function buildToolCall(name: string, args: Record<string, unknown>): JsonRpcCall {
    return {
        jsonrpc: '2.0',
        id: nextRequestId(),
        method: 'tools/call',
        params: { name, arguments: args },
    };
}

/** Build an MCP `initialize` handshake payload. */
export function buildInitialize(clientName: string, clientVersion: string): JsonRpcCall {
    return {
        jsonrpc: '2.0',
        id: nextRequestId(),
        method: 'initialize',
        params: {
            protocolVersion: '2025-06-18',
            clientInfo: { name: clientName, version: clientVersion },
            capabilities: {},
        },
    };
}

/** Build a `tools/list` discovery payload. */
export function buildToolsList(): JsonRpcCall {
    return {
        jsonrpc: '2.0',
        id: nextRequestId(),
        method: 'tools/list',
        params: {},
    };
}

/** Compose the HTTP headers for an MCP request, including an optional bearer
 *  token. Returns a plain record so callers can hand the value straight to
 *  `fetch`. */
export function buildHeaders(authToken?: string): Record<string, string> {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept':       'application/json, text/event-stream',
    };
    if (authToken && authToken.length > 0) {
        headers['Authorization'] = `Bearer ${authToken}`;
    }
    return headers;
}

/** Coerce a JSON-RPC response object: throws on `error`, returns `result` on ok. */
export function unwrapResponse(resp: unknown): unknown {
    if (typeof resp !== 'object' || resp === null) {
        throw new Error('MCP server returned a non-object response');
    }
    const r = resp as Partial<JsonRpcOk & JsonRpcErr>;
    if (r.error !== undefined) {
        throw new Error(`MCP error ${r.error.code}: ${r.error.message}`);
    }
    if (!('result' in r)) {
        throw new Error('MCP server response missing both `result` and `error`');
    }
    return r.result;
}
