# Parser strategy

**Decision:** hand-written recursive-descent parser (TypeScript).
**Tree-sitter:** spike retained at `spike/tree-sitter-enma/` as a v2.0 grammar
candidate; not used at runtime, not packaged in the VSIX.

## Why hand-written

Two candidate parsers were evaluated head to head against a 5,682-LoC fuzz
corpus generated with a deterministic seed. The hand-written parser cleared
the corpus with zero ERROR diagnostics; the tree-sitter grammar cleared 21 of
22 files.

| Metric | Hand-written | Tree-sitter |
|---|---|---|
| Files with 0 ERROR diagnostics | **22 / 22 (100%)** | 21 / 22 (95.5%) |
| Total ERROR nodes across corpus | **0** | 2 |
| `samples/showcase.em` parse | 1 (pseudo-nested block comment) | 1 (same) |
| Incremental cycle median (2kLoC, 100 edits) | **0.84 ms** (30 ms target) | not measured |
| Source size | 4,052 LoC TypeScript | ~850 LoC (`grammar.js` + `scanner.c`) |

Tree-sitter's misses both came from GLR design constraints around the
`generic_type` branch:

1. `(a < keyword_literal)` inside parentheses — `generic_type` branch
   ambiguity.
2. `foo<T>(args)` template-call disambiguation — fundamentally requires an
   external scanner with bounded lookahead (the same approach tree-sitter-cpp
   takes); 15+ scanner iterations did not produce a stable resolution.

The hand-written parser handles both natively via 64-token bounded lookahead
from `<` looking for a `>` followed by `(`, `;`, `,`, `{`, or `=`.

## Tradeoff matrix

| Axis | Hand-written | Tree-sitter |
|---|---|---|
| Error recovery | Panic-to-delimiter with partial AST | Best-effort GLR; ERROR nodes wrap bad spans |
| Incremental re-parse | Explicit cache + coarse-grain top-level-decl strategy | Native CST diff |
| Multi-editor distribution | Pure TypeScript, no native or WASM dependency | WASM build required for non-VS Code editors |
| Enma-specific concerns | Full control over every parsing decision | Constrained by LR(1)/GLR-like grammar; template-call ambiguity needs an external scanner |
| f-string boundary contract | Hand-coded in the tokenizer | External C scanner — works in the spike |
| Long-term maintainability | One language (TypeScript) | grammar.js + C scanner — two languages, two build steps |

## Spike outcome (kept for reference)

The tree-sitter spike was a technical pass:

- `tree-sitter parse samples/showcase.em` ran without crashing.
- 3 ERROR nodes total (all nested within 1 top-level ERROR node).
- The single top-level ERROR node spans lines 5–7 of the showcase, where the
  file deliberately contains a `/* ... /* nested-looking */ markers ... */`
  pseudo-comment. Enma block comments are not nestable (same as C — first
  `*/` closes), so the trailing ` markers ...` is unparseable at the top
  level. This is correct grammar behaviour.

All four f-string instances in the showcase parse with the full §A2 boundary
tokens:

```
(fstring_literal
  (fstring_start)        ← f"
  (fstring_text)         ← text segment
  (fstring_expr_open)    ← {
  <expression tree>      ← member access, binary expression, etc.
  (fstring_expr_close)   ← }
  ...
  (fstring_end))         ← "
```

The boundary tokens are produced by an external C scanner that intercepts
`f"` before the main lexer can consume the `f` as an identifier, using a
depth counter to track nesting and emitting the five boundary token kinds on
demand. The scanner supports nesting up to depth 255; depth-3 nesting is
covered by the kill-rule corpus.

### Block-comment behaviour

Enma block comments are not nestable. Both parser candidates correctly
reproduce this (first `*/` closes); `samples/showcase.em` exercises the
contract as a TM-grammar regression assertion.

## What hand-written gained worth recording

- The incremental-cache strategy delivered a 35× margin under the 30 ms
  AC-22 ceiling (median 0.84 ms on 2 kLoC, 100 edits).
- Multi-inheritance bases captured per source order, with C3 linearization
  handed off cleanly to the analyzer.
- Variadic `...` accepted in both tokenizer shapes (single `Punctuation`
  vs three `'.'` tokens).
- Contextual reserved words (`get`, `set`) accepted as identifiers in
  expression / declaration-name / parameter-name positions, eliminating
  false-positive diagnostics.

## What tree-sitter gained worth recording

- Lower LoC budget (~5×). Cost is the WASM runtime + scanner.c maintenance.
- Free incremental CST diff. Hand-written replicates the equivalent
  capability via an explicit incremental cache.
- `brace_depth[8]` stack pattern for nested f-strings — a correctness win
  that the hand-written tokenizer also encodes as a depth stack.

Neither tree-sitter advantage was decisive against the corpus result.

## Followup status

- **Tree-sitter spike retained** at `spike/tree-sitter-enma/` as the v2.0
  grammar candidate. The directory is excluded from the published `.vsix`
  via `.vscodeignore`.
- **This document is the canonical record of the call.** Future
  considerations append below — do not revise the retrospective.
