# DAP debugger status

**Status:** Attach proxy ships in v1.1+. Server-side DAP adapter deferred.

## What ships

The extension contributes a thin attach-only proxy that connects VS Code's
debugger UI to a TCP DAP server provided by the Enma host:

- `enma-lsp-dap` debug type (attach only) in `package.json`.
- `breakpoints` registration for the `enma` language.
- `client/src/dap.ts` — a `DebugAdapterDescriptorFactory` that maps an attach
  configuration onto a TCP `DebugAdapterServer`. Default `localhost:27979`,
  matching the Enma SDK's published default.

If no DAP server is listening on the configured address/port, VS Code surfaces
the `ECONNREFUSED` in the Debug Console — no false sense of support.

```jsonc
// .vscode/launch.json
{
  "type": "enma-lsp-dap",
  "request": "attach",
  "name": "Attach to Enma DAP server",
  "address": "localhost",
  "port": 27979
}
```

## What does not ship

The LSP does not run its own DAP server. The following are intentionally not
created:

- `server/src/dap/dapServer.ts`
- `server/src/dap/breakpointManager.ts`
- `server/src/dap/sourceMap.ts`
- `server/src/dap/variableEnumerator.ts`
- `server/src/dap/stackTrace.ts`

A native DAP implementation needs cooperation from the Enma host — at minimum
a documented wire protocol for breakpoints, stepping, and variable enumeration.
Until that protocol is published and stable, the attach proxy is the right
boundary.

## Re-evaluating

A server-side DAP implementation becomes worth building when:

1. The Enma host publishes a wire protocol for breakpoint and variable
   inspection that the LSP can drive.
2. A proof-of-concept fixture host demonstrates the protocol working end to
   end on a real script.

Until both are true, debugging remains an attach-only flow against whichever
host the user is running.
