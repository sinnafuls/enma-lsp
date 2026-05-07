# DAP Gate Decision

**Date:** 2026-05-06
**Status:** DEMOTED to v1.1
**Plan reference:** §Phase 9, R4, Pre-mortem 3 (enma-lsp-fullstack.md)

## Decision

Phase 9 (DAP debugger integration) was evaluated against its hard entry gate and did **not** proceed.

The gate criterion is:

> Enma SDK maintainer must commit — in writing, via issue or PR — to exposing the wire protocol
> described in `docs/enma-dap-protocol.md` so that an LSP-side fixture host can drive debug sessions.

No such commitment was found as of the decision date. No upstream issue, PR, or signed-off protocol
document exists. The `docs/enma-dap-protocol.md` protocol specification remains a proposal only.

## Outcome

- Phase 9 work is **entirely deferred**. No `server/src/dap/` code was written.
- No DAP fixture host was built.
- `package.json` does **not** contribute a `debuggers` entry of type `enma-dap`.
- v1.0.0 ships Phases 0–7 (core LSP) plus the v1.0-extended formatter (Phase 8).
- DAP debugger is **scheduled for v1.1**, gated on upstream commitment.

## What must happen before re-evaluation

1. An Enma SDK maintainer opens or comments on a tracking issue explicitly agreeing to expose the
   wire protocol described in `docs/enma-dap-protocol.md`.
2. The protocol document is reviewed and agreed upon by both sides (SDK team + extension maintainer).
3. A fixture host is shown to be viable (proof-of-concept stub that can attach to an Enma process).

When all three conditions are met, Phase 9 may be re-entered. Update this file with a new
`**Status:** COMMITTED` section and a link to the upstream commitment before starting dap/* work.

## Files NOT created (intentionally skipped)

- `server/src/dap/dapServer.ts`
- `server/src/dap/breakpointManager.ts`
- `server/src/dap/sourceMap.ts`
- `server/src/dap/variableEnumerator.ts`
- `server/src/dap/stackTrace.ts`
- `tests/fixtures/dap/` (any fixture files)

This skip is spec-mandated. Do not add these files until the gate is met.
