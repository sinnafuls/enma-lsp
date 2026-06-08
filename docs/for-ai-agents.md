# AGENTS.md — Contributor guide for AI agents

## Overview

`enma-lsp` is a VS Code extension that provides full IDE support for the **Enma** language via the Language Server Protocol. The repo has two cleanly separated layers:

- **`server/`** — pure TypeScript LSP; no VS Code dependency; runs as a standalone Node.js process over stdio
- **`client/`** — VS Code extension host glue; launches the server process and wires the `vscode-languageclient` transport

All language intelligence lives in `server/`. The client is thin.

---

## Repository layout

```
server/src/
  compiler_tokenizer/     Token kinds, TextLocation, lexer
  compiler_parser/        TokenStream → AST; nodes.ts is the canonical
                          NodeKind enum + node shapes; preprocessor
                          handles #define / #ifdef / #include
  compiler_analyzer/      hoist.ts (first pass), analyze.ts (second pass),
                          expression + statement analyzers, symbolScope,
                          builtinType, typeConversion, functionCall, etc.
  services/               One file per LSP capability:
                          hover.ts, completion.ts, callHierarchy.ts, …
  inspector/              Analysis session manager; tracks open files,
                          manages hoist/analyze queues, predefined loading
  predefined/             perception.em.predefined  — Perception host API
                          enma-stdlib.em.predefined — Enma stdlib
                          These are the source of truth for IntelliSense.
  server.ts               LSP protocol wiring; registers all capability handlers

client/src/
  extension.ts            VS Code entry point; spawns the server

server/test/
  unit/                   Mocha + ts-node unit tests
  integration/            Real-corpus tests (22 Perception scripts)

snippets/                 VS Code snippet JSON
```

---

## Build and test

```sh
npm install            # root install (hoists workspaces)
npm run compile        # tsc -b + esbuild bundle
npm test               # server-side mocha suite (~1078 tests)
npx tsc --noEmit       # type-check server only (no emit)
```

Client TypeScript is NOT covered by the server test suite. Check it separately:

```sh
npx tsc -p client/tsconfig.json --noEmit
```

Both checks must pass before a PR is ready.

---

## Analysis pipeline

Passes run in this order for every file open in the editor:

1. **Tokenize** — lex source into `Token[]` with `TextLocation`
2. **Preprocess** — expand `#define`, resolve `#ifdef`, follow `#include`; records include paths
3. **Parse** — `TokenStream` → `NodeScript` (AST); emits structural diagnostics
4. **Hoist** — first pass: register all top-level names (types, functions, namespaces, enums) into `SymbolScope` WITHOUT analyzing bodies; allows forward references
5. **Analyze** — second pass: walk function bodies; resolve expressions, emit conversion/overload diagnostics, record `ScopeRegion` entries for local navigation

Hoisting uses two ordered queues:

- **`hq`** (hoist queue) — type registrations; deferred to allow forward-refs
- **`aq`** (analyze queue) — function body analysis; runs after all hoisting is complete

**Key invariant:** `analyzeFunctionBody` is always called with the function's scope ALREADY containing its parameters. Parameters are inserted during hoisting. The analyze pass only adds block-level locals.

---

## Adding a new LSP service

1. Create `server/src/services/<name>.ts`. Export a `provide<Name>(record, params): LSPResult` function.
2. Register the capability in `server/src/server.ts` under the matching `onCapability` handler. Follow the existing handler patterns exactly.
3. Declare the server capability in the `serverCapabilities` object near the top of `server.ts`.
4. Add unit tests in `server/test/unit/services/<name>.test.ts`.

---

## Updating predefined files

`server/src/predefined/perception.em.predefined` — Perception host API
`server/src/predefined/enma-stdlib.em.predefined` — Enma stdlib

These are valid Enma source with **declaration-only** constructs (no bodies).

Adding a function:

```em
// Comment describing it.
returnType functionName(ParamType param);
```

Adding a class:

```em
class ClassName {
    ReturnType methodName(ParamType param);
    // ...
}
```

Run `npm test` after any predefined change. The `AC-23 regenerated stdlib predefined` test and the real-corpus integration tests are the safety nets.

---

## Code conventions

- `import type` for type-only imports — enforced by `ts-import-type`
- No `as any` — use `unknown`, type guards, or domain types — enforced by `ts-no-any`
- Static lookup tables: `Record<string, true>`, not `Set` — enforced
- One-expression helpers: inline at the call site unless reused 3+ times
- `analyzeType(scope, node)` inside a body walker **MUST** pass `quiet = true` as the third argument — body-level type resolution must not emit `EN_UNKNOWN_TYPE` (stdlib may not be loaded in test setups)
- Diagnostics are conservative: only emit when both operand types are fully resolved and concrete; undefined types skip all checks
- `conversionCost` is the canonical source of truth for implicit conversion legality; `implicitConversionError` is for assignment-site diagnostic messages only

---

## Common pitfalls

| Pitfall | Correct approach |
|---|---|
| Using `scope.lookupSymbol` for identifier resolution | Use `findSymbolWithParent` — it traverses up to global scope |
| Comparing `SymbolType` objects with `===` | Use `SymbolType.equals` — compares by `identifierText` + `scopePath`, not identity |
| Walking a new construct without emitting scope info | Call `pushScopeRegion` — required for go-to-def / hover / find-refs on locals |
| Emitting type/conversion diagnostics from the parser or hoist pass | Only the analyzer second pass may emit type/conversion/overload diagnostics |
| Expecting predefined functions to have no `linkedNode` | Functions loaded from `.em.predefined` have `linkedNode` set (parsed AST); bundled `enmaTypes` entries do NOT. The `trustworthy` flag in `resolveCall` depends on this distinction. |

---

## Running the extension locally

Press **F5** in VS Code with the repo open. A new **Extension Development Host** window launches with the extension active.

---

## PR checklist

- [ ] `npx tsc --noEmit` passes for `server/`
- [ ] `npx tsc -p client/tsconfig.json --noEmit` passes for `client/`
- [ ] `npm test` green (1078+ passing, 0 failing)
- [ ] Real-corpus integration: ≤ 3 analyzer errors across 22 Perception scripts
- [ ] New LSP feature has a unit test in `server/test/unit/services/`
- [ ] Predefined additions use declaration-only format (no bodies)
- [ ] No `as any`, no inline `import(...)` type annotations
