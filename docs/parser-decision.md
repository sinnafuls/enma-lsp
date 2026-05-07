# Parser strategy decision (M0.5 outcome)

**Date:** 2026-04-29
**Spike location:** `spike/tree-sitter-enma/`
**Spike file:** `spike/tree-sitter-enma/grammar.js` + `src/scanner.c`
**Corpus:** `samples/showcase.em` (197 lines)

---

## Spike outcome: PASS

| Metric | Result |
|---|---|
| `tree-sitter parse samples/showcase.em` completes without crash | YES |
| Total ERROR nodes in parse tree | 3 (all nested within 1 top-level ERROR node) |
| Top-level ERROR nodes | 1 |
| §A2 f-string boundary contract satisfied | YES |
| Spike acceptance criterion (≤5 ERROR nodes) | MET |

### Error node detail

The single top-level ERROR node spans lines 5–7 of `samples/showcase.em`. The showcase file contains a deliberately "pseudo-nested" block comment:

```
/* ... Including /* nested-looking */ markers ... */
```

Enma block comments are **not nestable** (same as C — first `*/` closes). The text ` markers ...` after the inner `*/` is unparseable at the top level, producing 1 ERROR node with 2 children. This is correct grammar behavior. The showcase file is documenting a TM-grammar limitation, not a real Enma code pattern. No other ERROR nodes exist anywhere in the file.

### §A2 f-string boundary contract

All 4 f-string instances in showcase.em parse with full boundary tokens:

```
(fstring_literal
  (fstring_start)        ← "f\""
  (fstring_text)         ← text segment
  (fstring_expr_open)    ← "{"
  <real expression tree> ← member_expression, binary_expression, etc.
  (fstring_expr_close)   ← "}"
  ...
  (fstring_end))         ← "\""
```

Implementation: external C scanner (`src/scanner.c`) intercepts `f"` before the main lexer can consume `f` as an identifier. The scanner uses a depth counter to track f-string nesting and emits the 5 boundary token types on demand.

Verified instances:
- Line 63: `f"drawing {this.name} hp={this.hp}"` — two interpolations, member access expressions
- Line 126: `f"caught {e}"` — simple identifier interpolation
- Line 189: `f"result: {rc}"` — simple identifier interpolation
- Line 192: `f"sum + 1 = {nums[0] + nums[1] * 2}"` — complex expression with index and binary ops

### Known grammar limitations (spike scope)

1. **`foo<T>(args)` template call syntax** omitted — creates an unresolvable LR conflict with `<` as comparison operator (classic C++ template ambiguity). Template calls in showcase.em (`array<int32>`, `map<string, int64>`) appear only in *type* position (as `generic_type`), not in *call* position, so this does not affect the showcase error count. A production grammar would need an external scanner to disambiguate, similar to tree-sitter-cpp's approach.

2. **Pseudo-nested block comment** (see above) — 1 top-level ERROR node, inherent to the non-nestable comment spec.

---

## Tradeoff matrix

| Axis | Hand-written RD | Tree-sitter |
|---|---|---|
| Error recovery quality | Strong — panic-to-delimiter with partial AST | Moderate — best-effort GLR recovery; ERROR nodes wrap bad spans |
| Incremental re-parse | Manual via §A1 coarse-grain top-level-decl strategy | Free, native CST diff |
| LoC budget | ~3.5–4.5 kLoC TypeScript (per plan estimate) | ~700 LoC grammar.js + ~150 LoC scanner.c = ~850 LoC |
| Multi-editor distribution | Trivial (pure TypeScript, no native dep) | Requires WASM build for non-VSCode editors; native build for VSCode |
| Enma-specific concerns | Full control over every parsing decision | Constrained by GLR/LR(1)-like grammar; template-call ambiguity needs external scanner |
| f-string boundary contract §A2 | Hand-coded in tokenizer.ts per spec | External C scanner — confirmed working in spike |
| Test corpus reuse | Bespoke golden-AST snapshots | tree-sitter's `corpus/` format (standardized, tool-supported) |
| Grammar ambiguity handling | Explicit in parser code | Declared `conflicts:[]` array; GLR resolves at runtime |
| IDE error recovery | Fine-grained position tracking, partial AST robustness | Tree-sitter's error recovery is well-tested but less IDE-tunable |
| Long-term maintainability | One codebase (TypeScript throughout) | Grammar.js + C scanner (two languages, two build steps) |

---

## Recommendation

**Run both as parallel candidates through the week-5 kill-rule.**

The spike is a PASS: Tree-sitter can express the Enma grammar cleanly, the §A2 f-string contract is fully satisfied via external scanner, and the error count (1 top-level ERROR node, caused by a showcase file quirk not real grammar failure) is well within the ≤5 threshold.

The kill-rule at end of week 5 stands: pick whichever approach has fewer red parser-test failures on the §A6 synthetic 800-LoC corpus. Key differentiators to watch:

- **Tree-sitter advantage:** free incremental CST diff, standardized corpus test format, ~5× less grammar code.
- **Hand-written advantage:** no native/WASM build dependency for multi-editor distribution, stronger IDE error recovery, full TypeScript codebase.
- **Watch item:** the `foo<T>(args)` template-call ambiguity. If Enma uses template calls heavily in real code (beyond the showcase's type-position generics), tree-sitter will need an external scanner to handle it — adding complexity. The hand-written parser handles this naturally with lookahead.

---

## Open questions for team-lead

1. **Template call frequency**: Does real Enma code use `foo<T>(args)` call syntax (as opposed to just `array<T>` in type declarations)? If yes, the tree-sitter external scanner needs to be extended before week 5.

2. **WASM build pipeline**: Is a WASM build step acceptable for the Neovim/Helix/Zed standalone CLI distribution? If the answer is no, hand-written wins by default on the multi-editor distribution axis regardless of corpus coverage.

3. **f-string nesting depth**: The spike scanner supports depth up to 255. The plan mentions testing up to depth 3 — should the corpus include nested f-strings (`f"a={f"b={x}"}"`) as a week-5 gate condition?

4. **Block comment pseudo-nesting**: The showcase file's block comment with an inner `/* ... */` produces 1 ERROR node. Is this the intended parse behavior per the Enma spec, or should block comments be nestable?

---

## Team-lead answers (2026-04-29)

**On Q1 (template call frequency).** Yes, extend the external scanner before week-5 kill-rule. The Enma docs explicitly show `template<typename T> T id(T x) { return x; }` and `template<typename T> T max(T a, T b)` (showcase line 70) — these are inevitably called as `max<int32>(a, b)` in real code, even if `samples/showcase.em` happens to only show generics in type position. Heavy template use is also implied by the stdlib (`array<T>`, `map<K,V>`, `hash_set<T>`, `sorted_map<K,V>`, `variant<T>`). Use the tree-sitter-cpp disambiguation pattern: lookahead from `<` for a `>` followed by `(`, `;`, `,`, `{`, or end-of-statement to commit to template-arg-list interpretation; otherwise treat `<` as binary comparison. Cover this in the spike before week 5; otherwise hand-written wins by default on the corpus.

**On Q2 (WASM build acceptable for standalone CLI).** Acceptable, but **only if it doesn't bloat the standalone-CLI ship size unreasonably**. Use `web-tree-sitter` (the WASM-loader package) so we ship one `.wasm` binary cross-platform instead of separate native builds per OS/arch. The §9 ADR's "no native dep" advantage for hand-written is partially preserved by WASM (no compiler needed at install time on user machines), but adds ~1MB of WASM runtime to the npm tarball. **Decision rule:** Tree-sitter must win on grammar/test merits at week 5, not on distribution convenience. If hand-written is within 10% of Tree-sitter's red-test count, hand-written wins on the multi-editor-simplicity tiebreaker.

**On Q3 (f-string nesting depth in week-5 corpus).** Yes — corpus includes nested f-strings up to depth 3. Specifically: `f"a={f"b={x}"}"` (depth 2), `f"x={f"y={f"z={n}"}"}"` (depth 3), and a mixed case `f"sum={a + nums[f"key={k}"]}"` (depth 2 with index). Both candidates must parse all three with the §A2 boundary tokens correctly emitted. This is non-negotiable for the kill-rule; failure = corpus regression.

**On Q4 (block comment pseudo-nesting).** Confirmed: Enma block comments are **not nestable** per docs and current TM grammar (`syntaxes/enma.tmLanguage.json`). The 1 ERROR node on showcase.em lines 5–7 is correct behavior — `samples/showcase.em` is using it as a TM-grammar regression assertion, not requesting nesting. Both parser candidates must reproduce this behavior (first `*/` closes). The hand-written tokenizer already specs this in its task brief. No grammar change.

---

## Status

- **Spike:** PASS (verified 2026-04-29)
- **Parallel candidate track:** ACTIVE — both hand-written and Tree-sitter run as parser candidates through week 5
- **Week-5 kill-rule:** binding. Pick whichever has fewer red parser-test failures on the §A6 synthetic ≥5kLoC corpus (with the f-string-depth-3 cases above).
- **Tree-sitter pre-kill-rule extension work:** owner = worker-treesitter. Tasks listed below.

### worker-treesitter Phase-3 marching orders (queued for activation when T5 unblocks)

1. Extend `spike/tree-sitter-enma/src/scanner.c` to disambiguate `foo<T>(args)` template-call syntax. Adopt the tree-sitter-cpp pattern (lookahead from `<` for a `>` followed by `(`, `;`, `,`, `{`, or `=`).
2. Add nested f-string corpus tests at depths 2 and 3 — exact strings above.
3. Extend grammar to cover the full §A6 synthetic corpus (parser-decision-relevant: structs with methods, multi-inheritance C3 bases, match expressions with `=>` arms, defer blocks, designated initializers, lambda bracket + arrow forms, intrinsics, `[[annotations]]` with arg type-checking position, preprocessor directives — though the parser sees post-preprocessed token stream so directives may be a no-op for tree-sitter's grammar).
4. Run `tree-sitter test` against the corpus weekly; the lead tracks coverage % alongside hand-written's parser-test pass rate.

Activation trigger: SendMessage from team-lead when T5 (Phase 3 parser) unblocks (~week 3). Worker is on standby until then.

---

## Week-5 kill-rule outcome (2026-04-29)

**Verdict: hand-written wins T5 outright.**

### Head-to-head benchmark on the §A6 fuzz corpus

Both candidates parsed the canonical kill-rule corpus: `.omc/corpus/corpus_000.em` through `corpus_021.em` (22 files / 5,682 LoC, deterministic seed `0x1337C0DE`).

| Metric | Hand-written | Tree-sitter | Winner |
|---|---|---|---|
| Files with 0 ERROR diagnostics | **22 / 22 (100%)** | 21 / 22 (95.5%) | hand-written |
| Total ERROR nodes across corpus | **0** | 2 | hand-written |
| `samples/showcase.em` | 1 (documented pseudo-nested block comment lines 5–7) | 1 (same) | tie |
| AC-22 incremental cycle median (2kLoC, 100 edits) | **0.84ms** (target <30ms) | not measured | hand-written |
| Hand-written corpus tests | n/a | 26 / 26 (100%) | tree-sitter (qualitative coverage proof) |
| Source LoC | 4,052 (TypeScript) | ~850 (grammar.js + scanner.c) | tree-sitter (lower LoC) |

### Tiebreaker not invoked

The 10% tiebreaker (multi-editor-distribution simplicity) was reserved for a near-tie. Hand-written wins outright on both primary metrics:
- 0-ERROR file count: 22 vs 21 (4.5% gap; not a tie but if it were, tiebreaker also favors hand-written).
- Total ERROR nodes: 0 vs 2 (decisive).

### Tree-sitter known limitations at kill-rule

1. `(a < keyword_literal)` in parens (corpus_005:215) — GLR `generic_type` branch ambiguity, same family as #2.
2. `foo<T>(args)` template-call disambiguation — documented v1.1 followup; reverted after 15+ scanner iterations.

Both rooted in GLR design constraints. Hand-written handles both natively via 64-token bounded lookahead from `<` for `> (` pattern (worker-parser-handwritten's strategy note #7).

### Hand-written wins worth recording

- §A1 incremental strategy delivered and demonstrated 35× under AC-22 target (0.84ms vs 30ms ceiling).
- §A3 multi-inheritance: ordered `bases: NodeType[]` captured per source order; C3 linearization handed off cleanly to Phase 4 analyzer.
- Variadic `...` accepted in both tokenizer shapes (single Punctuation vs three `'.'`) — robustness corner case.
- Contextual reserved words (`get`/`set`) accepted as identifiers in expression/decl-name/param-name positions — eliminates a real false-positive corner.
- Pseudo-nested block comment behavior matches tree-sitter spike exactly (1 error per design); both candidates correctly reflect Enma's non-nestable comment spec.

### Tree-sitter wins worth recording (not enough to flip the verdict)

- `brace_depth[8]` stack fix for nested f-strings — a correctness win that hand-written would also need to encode in tokenizer state if not already present (worker-tokenizer's f-string nesting is implemented via a stack — equivalent design).
- Lower LoC (~5× less). Cost is the WASM runtime + scanner.c maintenance burden.
- Free incremental CST diff. Hand-written replicated the equivalent capability via §A1 explicit incremental cache and proved it under AC-22.

### v2.0 / followup status

- **Tree-sitter spike retained** at `D:/Projects/enma-lsp/spike/tree-sitter-enma/` — not deleted. Becomes the v2.0 grammar candidate per plan §8 ("Tree-sitter grammar (defer to v2.0 if/when downstream editors want CST highlighting independent of the LSP)").
- **`docs/parser-decision.md` (this file)** is the canonical record of the call. Should not be revised retroactively; future considerations append below.
- **worker-treesitter** moves to long-term standby; will be reactivated for v2.0 work or any tokenizer-level corner cases that benefit from external-scanner expertise.

### Phase 4 (Task #6) unblocked

Hand-written parser delivers `parseAfterPreprocessed(preprocessed, options): { ast: NodeScript; diagnostics: Diagnostic[] }` with full §A5 AST coverage. Multi-inheritance bases captured in source order; f-string parts split via §A2 boundary tokens; all Enma-specific productions (defer, match, lambdas both forms, designated init, intrinsics, UDL, annotations) emit their own node kinds. Analyzer can now walk via `forEachNode`.
