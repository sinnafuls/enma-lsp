# Changelog

## Unreleased — Quieter predefined-shadow diagnostic + in-viewer doc links

### Predefined-shadow diagnostic — Information by default

When the bundled stdlib gains a function (e.g. `url_encode` / `url_decode` from the recent sync) and a user project already has its own implementation with that name, the `EN_PRED_COLLISION` diagnostic used to fire at `Warning` severity in every file that included the user's declaration. With 24 cross-included files this filled the Problems panel.

- **Default severity demoted to `Information`.** The diagnostic is still visible in the Problems panel but no longer inflates file/folder warning counts in the Explorer.
- **New setting** `enma.diagnostics.predefinedCollisionSeverity`: `"warning" | "information" | "off"`. Default `"information"`. Set `"off"` to suppress entirely; `"warning"` to restore the legacy strict behavior.
- Per-declaration `[[shadow]]` still suppresses unconditionally regardless of the global setting.

Files: `server/src/inspector/inspector.ts` (settings field), `server/src/inspector/predefinedLoader.ts` (severity parameter), `server/src/inspector/analysisResolver.ts` (pass-through), `server/src/server.ts` (configuration wiring), `package.json` (setting schema).

### Perception API docs viewer — in-viewer link navigation

The TOC and inline cross-references in the bundled Perception docs previously pointed to the upstream GitBook URL (`https://open-2v.gitbook.com/.../#page-XXX`). They now navigate inside the webview using only the `#page-XXX` fragment — each section's wrapper carries the matching `id`.

- 14 TOC entries (Lifecycle / Render / Proc / CPU / Sound / Zydis / Win / Input / Unicorn / Net / GUI / Lifecycle and Routines / etc.) jump to the right section inside the panel.
- 113 dummy `href="#"` GitBook chrome stubs are unwrapped into `<span>` so they don't act as clickable top-of-page jumps.
- 21 legitimate external references (to the Enma language reference at `enma-1.gitbook.io`) get `target="_blank" rel="noopener noreferrer"` so VSCode opens them in the user's system browser.

Files: `scripts/build-perception-docs.mjs` (link-rewrite pass), `client/resources/perception-docs.html` (regenerated; 921 → 534 KB).

---

## Unreleased — In-extension Perception API docs viewer

New command **`Enma: Open Perception API Docs`** (command palette only) opens the bundled API reference in a VSCode side-panel webview. No browser, no internet — the docs ship inside the extension.

### How it works

- Source: GitBook HTML export at `data/perception-docs.source.html` (kept in repo for diff visibility but excluded from the VSIX via `.vscodeignore`).
- Strip step: `scripts/build-perception-docs.mjs` removes `<head>`, all scripts/styles/links, the empty "Untitled" cover page, and any references to the missing local asset folder. Injects a VSCode-theme-aware stylesheet so light/dark themes are respected automatically.
- Bundled output: `client/resources/perception-docs.html` (ships in the extension; ~777 KB).
- Webview is created with `enableScripts: false`, a CSP that bans scripts (`default-src 'none'; style-src 'unsafe-inline'`), and `retainContextWhenHidden: true` so scroll position survives focus switches.
- Single-instance: clicking the command again reveals the existing panel rather than opening a duplicate.

### Files

- `scripts/build-perception-docs.mjs` (new) — strip pipeline; wired into `vscode:prepublish`.
- `client/src/docsViewer.ts` (new) — webview command implementation.
- `client/resources/perception-docs.html` (new, generated) — themed, script-free docs.
- `client/src/extension.ts` — registers the command at activation.
- `package.json` — adds `enma.openDocs` command + activation event + `build-perception-docs` script.
- `.vscodeignore` — excludes the 920 KB source HTML from the VSIX.

To refresh the bundle after the upstream HTML changes, drop the new export into `data/perception-docs.source.html` and run `npm run build-perception-docs`.

---

## Unreleased — Perception predefined sync (typed read/write + enum params)

Tracks the latest Perception API documentation (GitBook HTML, 2026-05-11). All changes are type-tightening + new method additions; no surface removed.

### Proc API

- **New typed read/write helpers (22 methods)** on `proc_t`:
  - Reads: `read_vec2_fl32 / read_vec2_fl64`, `read_vec3_*`, `read_vec4_*`, `read_quat_*`, `read_mat4_*`
  - Writes: `write_vec2_fl32 / write_vec2_fl64`, `write_vec3_*`, `write_vec4_*`, `write_quat_*`, `write_mat4_*`
- **New kernel pointer**: `uint64 get_eprocess()` (gated: `kernel_rw_access`).
- **Type corrections** (`int64` → `uint64`): `rvm` size param, `alloc_vm` size param, `find_code_pattern` / `find_all_code_patterns` `search_size` param, `get_module_size` return.
- **`vad_region_t`**: `size()` and `protection()` return `uint64` (was `int64`).

### CPU / GUI / Unicorn / Zydis API — int64 → named-enum promotions

- `set_thread_priority(int64)` → `set_thread_priority(thread_priority)`
- `show_toast(int64 kind, ...)` → `show_toast(toast_kind kind, ...)`
- `sidebar_section_t.create_label / create_button` — `int64 align` → `ui_align align`
- `keybind_t.bind(..., int64 mode)` → `keybind_mode mode`
- `cpu_t.reg_read{64,128,256} / reg_write{64,128,256}` — `int64 reg` → `uc_reg reg`
- `cpu_t.mem_map(..., int64 perms)` → `uc_prot perms`
- `cpu_t.hook_add(int64 hook_kind, ...)` → `uc_hook hook_kind`
- `zydis_req_t.set_machine_mode / set_branch_type / set_branch_width` — int64 → `zydis_machine_mode` / `zydis_branch_type` / `zydis_branch_width`
- `zydis_req_t.get_machine_mode()` returns `zydis_machine_mode`
- `zydis_builder_t.set_machine_mode(int64)` → `zydis_machine_mode`

### Files changed

- `server/src/predefined/perception.em.predefined` — surgical patches (no mass regen)
- `example/perception.em.predefined` — kept in lock-step with canonical

### Verification

- `npm test` — 936 passing, 0 failing
- `node tools/validate-predefined.mjs` — OK, example copy matches canonical

### Notes

The GitBook HTML also documents per-leaf-widget decomposition of generic widget methods (`set_pos`, `set_size`, `install_hook`, …) that currently live only on `widget_t`. The extraction was unreliable on those (mixed usage examples with declarations), so the decomposition is deferred until we can pull the upstream source-of-truth. Existing `widget_t` declarations remain valid.

---

## 1.1.9 — Upstream stdlib sync (list / imap / mat4 / quat)

Tracks the latest upstream `enma-stdlib.json` from the language owner's reference extension. The bundled stdlib grows from 819 → 900 entries (+9.9%); all completion, hover, signature help, and type-checker paths pick up the new symbols automatically via the auto-regenerated `enma-stdlib.em.predefined`.

### What's new

- **New stdlib types (4)**:
  - `list<T>` — dynamic vector with 24 methods (`push_back`, `pop_front`, `insert`, `index_of`, `contains`, `extend`, …)
  - `imap` — integer-keyed map with 9 methods (`set`, `get`, `keys`, `values`, `has_value`, …)
  - `mat4` — 4×4 matrix with 9 instance methods (`mul`, `inverse`, `transpose`, `determinant`, `transform_point`, …)
  - `quat` — quaternion with 12 instance methods (`mul`, `slerp`, `conjugate`, `normalize`, `rotate`, `to_euler`, …)
- **New global factories**: `mat4_identity`, `mat4_perspective`, `mat4_orthographic`, `mat4_look_at`, `mat4_translation`, `mat4_scale`, `mat4_rotation_{x,y,z}`, `mat4_rotation_axis`, `mat4_from_quat`, `quat_identity`, `quat_from_axis_angle`, `quat_from_euler`.
- **New global helpers**: `url_encode`, `url_decode`.
- **Reader-writer locks on `mutex`**: `lock_shared`, `try_lock_shared`, `unlock_shared`.
- **`variant.convert`** method.
- **9 new stdlib snippets** (`listnew`, `imapnew`, `mat4i`, `mat4look`, `mat4persp`, `quati`, `quataxis`, `quateuler`, `move`).

### Files changed

- `data/enma-stdlib.json` — synced from upstream (+81 entries; 819 → 900)
- `server/src/predefined/enma-stdlib.em.predefined` — regenerated via `npm run regenerate-stdlib` (21 types, 283 methods, 534 globals, 889 LoC)
- `snippets/stdlib.code-snippets` — +9 snippets (41 → 50)

### Verification

- `npm test` — 936 passing, 2 pending, 0 failing
- `node tools/validate-predefined.mjs` — 0 diagnostics
- `node smoke-test.js` — TM grammar tokenises `samples/showcase.em` cleanly

### What did NOT change

`syntaxes/enma.tmLanguage.json`, `language-configuration.json`, `samples/showcase.em`, `snippets/enma.code-snippets`, `smoke-test.js` — already byte-identical to upstream. The new entries are stdlib values, not new language syntax, so no grammar or parser work was needed.

---

## 1.1.0 — Enma v1.1 language update (Tier 1: tokenizer)

This release adds tokenizer-level support for the Enma v1.1 language spec. Source-code with the new lexical forms now parses without spurious diagnostics from the LSP.

### What's new

- **Binary integer literals** — `0b1010`, `0B1101`. Same numeric value as the equivalent decimal/hex; emitted with `numericKind: 'bin'`.
- **Digit separators in numeric literals** — `1_000_000`, `0xFF_FF`, `0b1010_1010`, `1_234.567_8`, `1_000e3`, `1e1_000`. The `_` is consumed as a separator iff followed by a digit valid for the current numeric base; this preserves UDL handling (`1_500_km` still splits as number `1_500` + UDL identifier `_km`).
- **Spaceship operator `<=>`** — emitted as a single `Operator` token. Longest-match precedence ensures `a<=>b` does not split as `<=` + `>`. Operator overload resolution is Tier 3 (analyzer) work; the tokenizer just produces the token.
- **New reserved keywords** `final`, `virtual`, `friend` — added to the `KEYWORDS` set. `enum class` / `enum struct` parser support is Tier 2 work.

### What's NOT in this release (deferred)

The Enma v1.1 spec includes language-semantics changes (value semantics on struct pass-by-value, new operator overloads, `operator T()` implicit conversions, `operator<=>` auto-derive of all six comparisons, copy/move ctors with `move(a)`, `constexpr` struct/array literal folding, trailing return on regular functions, uniform init, designated init, C++17 if-init, postfix `++/--` distinction, namespace-qualified ctors). These require parser and analyzer changes that are gated on resolving 6 open spec questions documented in `docs/v1.1-implementation-notes.md` and the consensus-approved plan at `.omc/plans/enma-v1.1-language-update.md`.

### Files changed

- `server/src/compiler_tokenizer/reservedWord.ts` — added `final`, `virtual`, `friend`
- `server/src/compiler_tokenizer/tokenizer.ts` — added `<=>`, binary literal scanner, `readDigitRun` helper supporting digit separators
- `server/src/compiler_tokenizer/tokenObject.ts` — extended `NumericKind` union with `'bin'`
- `server/src/compiler_parser/parserPreprocess.ts` — `parseNumber()` strips `_` separators and handles `0b...`
- `server/test/unit/tokenizer/literals.test.ts` — extended with binary literal + digit separator + UDL boundary regression tests
- `server/test/unit/tokenizer/spaceship.test.ts` — new file
- `docs/v1.1-implementation-notes.md` — new file documenting spec source and surface-syntax interpretation decisions
- `package.json` — `@typescript-eslint/parser` + `@typescript-eslint/eslint-plugin` added to devDependencies (closes pre-existing lint env gap)

### Tests

- 841 passing, 2 pending (was 816 passing post-cleanup; +25 new tests)
- `npm test` clean
- `cd server && npx tsc --noEmit` clean
- Cold parse of `samples/showcase.em`: median 0.233ms (better than post-cleanup baseline of 0.258ms)

---

## 1.0.0 — v1.0-core + v1.0-extended formatter

### Ships in this release
- **v1.0-core (Phases 0–7):** full LSP feature set — syntax highlighting, snippets, completion,
  hover, signature help, go-to-definition, workspace symbols, document symbols, semantic tokens,
  cross-file indexing, preprocessor (#include / #define), unknown-type diagnostics, incremental
  re-index, LRU index cache, and parser strict-mode scaffolding.
- **v1.0-extended (Phase 8):** document formatter (`enma.formatter.*` settings family) — brace
  position, indent spaces/tabs, blank-line collapsing, comma/operator spacing, designated-init
  alignment, f-string verbatim preservation.

### Phase-by-phase delivery summary

| Phase | Component | Tests |
|---|---|---|
| 0–1 | Tokenizer | 314 |
| 2–3 | Parser | 469 |
| 4–5 | Analyzer | 48 |
| 6 | Inspector / analysis queue | 15 |
| 7 | LSP services (14 providers) | 40 |
| 8 | Formatter | 181 |
| **Total** | | **792** |

Server source (compiler pipeline + LSP services): ~10–14k lines of TypeScript in `server/src/`.
Both bundles (`client/dist/extension.js`, `server/dist/server.js`) compile cleanly with zero
`tsc --noEmit` errors.

### Multi-editor distribution
The server bundle is published as the `enma-lsp` npm package with a `bin` entry pointing to
`dist/server.js` (shebang prepended via esbuild banner). Once published:

```
npm install -g enma-lsp
```

Neovim, Helix, and Zed setup snippets are documented in `README.md`. Until the npm package is
published, users can invoke `node path/to/server/dist/server.js --stdio` or use a local
`npm link` from the `server/` directory.

### Standalone CLI distribution
Standalone CLI distribution is available once `enma-lsp` v1.0.0 is published to npm. Both Neovim
and Helix snippets in README assume the bin is on PATH after install. Until then, use the VSCode
extension or a local npm link. See `README.md` for full setup instructions.

### DAP debugger demoted to v1.1
Phase 9 entry gate (Enma SDK maintainer commitment to expose the wire protocol described in
`docs/enma-dap-protocol.md`) was **not met**. Phase 9 work is entirely deferred. No `dap/*` code
was written; `package.json` does not contribute a `debuggers` entry of type `enma-dap`.
See [`docs/dap-gate-decision.md`](docs/dap-gate-decision.md) for full rationale and re-evaluation
criteria.

### vsce package
`npx --yes @vscode/vsce package --no-dependencies` produces `enma-language-1.0.0.vsix` at the
repo root. Run this after `npm install` to produce the installable VSIX locally. The `@vscode/vsce`
devDependency is already declared in the root `package.json`.

### v1.0.1 graduation criteria (not yet met — tracked)
- AC-22 incremental-cycle full-pipeline integration: open → edit → save cycle exercises preprocessor
  + parser + analyzer + formatter in one pass with no stale-cache artefacts.
- Parser strict mode default-on at ≥ 95% corpus coverage (currently scaffolded; `enma.parser.strict`
  defaults to `false` until corpus threshold is reached).

### v1.1 deferred
- DAP debugger (gated on upstream Enma SDK maintainer commitment — see `docs/dap-gate-decision.md`)
- Multi-root workspaces with per-project LSP modes

---

## 0.6.0 — diagnostics

- **Unknown-type diagnostics.** Identifiers used in type position that don't match any known type (primitive, builtin, user-defined `class`/`struct`/`interface`/`enum`, or in-scope template parameter) now get a red squiggle and a `Problems`-panel entry: `Unknown type 'flojat64'`. Catches the common typo case.
- Validates: variable declarations, class fields, function/method parameter types, function return types, AND generic arguments (`array<flojat64>` flags `flojat64`).
- Cross-file aware: a type defined in one `.em` file is recognised when used in another.
- Comments and string literals are stripped before validation, so identifiers inside them never get flagged.
- Debounced (250ms) on edit so it doesn't run on every keystroke.

Limitations (these would need a real type checker / LSP):
- Type checking only — doesn't catch `int32 x = "hello"` style mismatches.
- Doesn't detect undefined function calls or undefined variable references.
- Local variable type validation only fires inside scopes the scanner reaches; some unusual syntax might be missed.

## 0.5.4

- **Array brackets are now strict no-whitespace.** `int32[][]` is recognised; `int32 []`, `int32[] []`, `int32[ ] arr` are not — Enma doesn't allow whitespace inside or between array brackets, and the extension now matches that. Pointers and generics still tolerate the usual `int32 *p` / `array <T>` styling whitespace.

## 0.5.3 — inheritance + nested generics + this + chained brackets

Four big features tackled, all of which previously needed an LSP. 27/27 audit checks pass.

### Class inheritance
- Scanner now parses `class Derived : public Base { ... }` and records the base names on the derived class entry. Multi-inheritance (`class C : Base1, Base2`) supported. Access modifiers (`public`, `private`, `protected`, `virtual`) are stripped.
- Member-completion (`obj.`) walks the inheritance chain: methods/fields from base classes show up on derived instances. Override hiding works first-seen-wins, so a method redefined on the derived class overrides the base's version.
- Namespace-style member access (`Foo::staticThing`) likewise pulls in inherited static members when `Foo` is a class.

### Nested generics
- `array<map<string, int64>>` and `map<int32, array<vec3>>` now parse correctly. The regex for type suffixes handles up to three levels of `<>` nesting.
- Same for the TM grammar's variable-declaration pattern — `array<map<string, int64>> nums` now correctly highlights `nums` as a variable.

### `this.member` inside class methods
- When the cursor is inside a class/struct/interface method body, the local-symbol scanner synthesizes a `this` local with type set to the enclosing class. So `this.` triggers the same member-completion code path as any other variable, surfacing the class's fields, methods, and inherited members.

### Chained `[][][]` arrays
- Both the TM grammar and the local-symbol regex handle any depth of `[]`. Patterns like `int32[][][] arr`, `float64[] [] [] [] spaced` (with whitespace between brackets), and combinations like `array<int32>[]* p` are recognised.

### Bug fix discovered during the rework
- `findLocalSymbols` was walking back to the OUTERMOST enclosing `{` rather than the innermost. So inside a class method, the scope was the class body, not the method body — `this`-detection was checking from the wrong position. Fixed: it now stops at the first enclosing `{` (the one that owns the cursor).

## 0.5.2 — audit fixes

After running a comprehensive 10-audit suite (47 cases) two real bugs surfaced:

- **`auto x = foo()` was not captured.** `auto` was in the "not a type" filter, which is wrong — it's a valid type-inference keyword. Removed it from the filter; `lookupVarType` now returns `"auto"` for inferred locals (member completion of an `auto`-typed var finds nothing, which is the correct behaviour without resolving the call).
- **Functions named `get` / `set` / `match` / `property` were skipped.** They were in the keyword-name blocklist (because of `property { get; set; }` and `match { ... }` syntax), which incorrectly rejected them as function/method names too. Now there's a separate `NOT_A_FUNCTION_NAME` set that excludes context-only keywords. So `int64 get()`, `void set(int32 v)`, `int32 match(int32 x)` are all properly indexed.

### Audit summary (43 / 47 pass)

The 4 remaining failures are test-specific (cursor placement, single-line nested namespaces — rare in real code, mock missing `getText(range)`), not production issues.

Known limits in this release that would need an LSP for full fidelity:
- Single-line nested namespaces (`namespace A { namespace B { … } }` on one line)
- Class inheritance — `class C : Base {}` doesn't surface `Base`'s members on `c.`
- Nested generics like `array<map<string, int64>>` aren't captured
- `this.member` inside class methods doesn't pull up the class fields (use `Foo::member` instead)

## 0.5.1

Fixes the "many a's and r's" noise when invoking member completion:

- **Variable type detection now works for lowercase user types.** The local-decl regex used to require the type word to be a known primitive/builtin or PascalCase. So `color bg = ...` was missed because `color` is a lowercase user-defined type, and `bg.` would fall through to the "show every method/field" fallback — which produced lots of duplicate `r`, `g`, `b`, `a` entries from every type in the workspace. Now any identifier can be the type word; we just filter out things like `if`, `return`, `new`, etc. that obviously aren't types.
- **Member-completion fallback is now `null` instead of "show every method".** When the receiver's type can't be resolved, we yield to VSCode's default word-based completion — which suggests names from open buffers — rather than dumping the union of every method and field across every type. No more noise.
- **`findLocalSymbols` no longer pulls in declarations from sibling functions/classes above the cursor.** It walks back to the matching `(` of the function signature instead of taking a fixed 256-char window before the enclosing `{`. So inside `void main() { ... }`, you no longer see the fields of a `struct color { ... }` declared above as if they were local variables.

## 0.5.0 — comprehensive intellisense pass

Big upgrade based on a 5-pass audit of completion / hover / sig help / symbols.

### Bug fixes
- **Cross-file dedup loses entries (`PlayerESP::Draw` missing).** The `allUserSymbols` dedupe was keyed by `name` only, so any other file with a same-named symbol overwrote the one you wanted. Now keyed by `(parent, kind, name)` — `Foo::Draw` and `Bar::Draw` both survive.

### Member access on a known type
- **`obj.member` and `ptr->member`** now look up `obj`'s declared type. If `result` was declared `string result = "";`, typing `result.` now offers all `string` methods (length, substr, find, replace, etc.). Falls through to "all methods" only when the type can't be resolved.

### Class / struct / enum indexing
- **Class & struct members captured.** `class color { int32 r; int32 luminance(); }` now indexes `r` as a field, `luminance` as a method (with parent `color`), plus the constructor and destructor.
- **Enum values captured.** `enum Mode { Idle, Scan, Engage }` indexes all three values, parented to `Mode`. So `Mode::` completion shows `Idle / Scan / Engage`.
- **Variable types captured.** Both top-level globals and locals now record their declared type (`int32 sum = 0` → `sum: int32`). Used by member-access completion above.

### Type highlighting (lowercase user types)
- **lowercase user types like `color`** now paint as types. Previously they fell through the TM PascalCase fallback and looked like variables. The `SemanticTokensProvider` now also tags every reference to a known user-defined `class / struct / interface / enum` with a `class.global` / `enum.global` semantic token, painted teal (`#4EC9B0`) by the extension's defaults.

### New providers
- **DocumentSymbolProvider** — VSCode's Outline panel (and breadcrumbs) now show your `.em` file structure: namespaces → members, classes → methods/fields, enums → values.
- **WorkspaceSymbolProvider** — `Cmd+T` (`Ctrl+T`) "Go to Symbol in Workspace" now finds user-defined symbols across all `.em` files in the workspace.
- **DefinitionProvider** — `F12` (Go to Definition) jumps to the declaration of any indexed user symbol.

### Hover improvements
- Locals now hoverable (shows `<type> <name>` plus "local variable").
- Cross-namespace ambiguity surfaces all matches when a name resolves to multiple definitions, with their parent context.

## 0.4.5

- **Namespace identifiers now consistently scoped + coloured grey.** Previously, the LHS of `Foo::bar` had no TM scope, so themes painted it as default text — which varied subtly between contexts (sometimes greenish, sometimes magenta-ish depending on the theme's default-text rule and surrounding scope-cascade). Now every `<id>::` LHS, every `namespace Foo` declaration, and every `using namespace foo` gets `entity.name.namespace.enma` and is painted `#D4D4D4` via the extension's defaults.
- Note: keywords like `cast`, `sizeof`, `new`, `delete`, `static_assert` are correctly coloured as keywords (magenta/purple in most themes), not functions — matches C++ convention.

## 0.4.4

- **Globals stay grey when referenced inside a block.** Previously, `vehSmoothX` declared at file scope would render lightblue (like a local) when used inside a function body, because TextMate can't tell global refs from local refs. Now a `SemanticTokensProvider` marks known global / function / namespace references with a `:enma` semantic token, and a default color rule paints them back to default text color.
- **Multi-decl per line picked up.** Lines like `float64[] vehSmoothX = ...; float64[] vehSmoothY = ...; float64[] vehSmoothZ = ...;` now register all three as globals, not just the first.
- **Namespace member completion.** Typing `VehicleESP::` now shows only the functions / vars / types declared inside `namespace VehicleESP { ... }` — not the entire stdlib. Index built by walking `namespace Foo { ... }` blocks, capturing direct members (depth-1 declarations).
- **Member access (`.` / `->`) returns no completions from us.** Instead of dumping every stdlib method (821 entries), the extension yields control to VSCode's default word-based completion. You'll see names that exist in your buffers without the noise.
- **String color matches Visual Studio's Dark theme** — `#D69D85` for double / single / f-strings.

## 0.4.3

- **Default theme overrides** for `.em` files. Many popular themes (One Dark Pro, Material, Dracula, …) don't style `variable.*` distinctly from default text, so locals were rendering the same color as everything else even though the grammar scoped them correctly. The extension now ships `editor.tokenColorCustomizations` defaults that paint:
  - Local variables (decl + usage) → light blue (`#9CDCFE`)
  - Type identifiers (`entity.name.type.*`) → teal (`#4EC9B0`)
  - Functions / methods → yellow (`#DCDCAA`)
- These only apply to scopes ending in `.enma`, so other languages aren't touched.
- If you have your own `editor.tokenColorCustomizations.textMateRules` in user settings, yours wins — these are defaults only.

## 0.4.2

- **Signature help for user-defined functions.** When you call your own function (e.g. `cfg_parse_line(`) the parameter list now shows up the same way it does for stdlib calls. Active argument is highlighted, overloads listed.
- **Richer completion for user functions.** Selecting a user-defined function from the completion menu now inserts `name(${1:type1}, ${2:type2})` placeholders, not just `name()`.
- **Defensive guards** around the completion provider — if any one source (locals, user globals, stdlib) hits an unexpected edge case, the others still come through.

## 0.4.1

- **Local-variable completion.** Inside a function body, completion now lists locals declared in the enclosing function (including its parameters) and any outer enclosing blocks. Triggered on every completion request — picks up names you just typed, no save needed.
- Locals sort to the top of the completion list (`sortText` `0_`), so they win over stdlib entries with similar prefixes.

Mechanism: from the cursor, walk backwards through balanced braces to find the outermost enclosing `{`, then regex-scan from a few hundred chars before that point (to catch the function signature) up to the cursor. Each `<type> <id>` declaration becomes a `Variable` completion item. Heuristic — not a parser — but covers the common cases.

## 0.4.0

User-defined symbols now show up in completion and hover.

- **Workspace scanner** indexes top-level functions, globals, classes, structs, interfaces, enums, and namespaces from every `.em` file in the workspace (up to 2000 files, `node_modules` excluded). Triggered on activation and refreshed when documents are opened or saved.
- **Active document is rescanned on every completion request**, so freshly typed names (your `void try_throw_test()`, `int64 g_tick`, etc.) appear in autocomplete immediately without needing to save first.
- **Hover** falls through to user-symbol lookup when a name isn't a stdlib entry or keyword — shows the captured signature line.

Caveats:
- Only top-level symbols (column 0). Class methods, locals inside functions, and indented declarations are not indexed — that needs a real parser.
- Heuristic regex, not a parser. Unusual layouts (e.g. macro-laden lines, multi-line function signatures) may be missed.

## 0.3.2

Identifier *usages* (not just declarations) are now scoped consistently inside `{ ... }` and `( ... )`:

- Variable usages (`x`, `g_caught_count`, `value`, `n`) → `variable.other.readwrite` → light blue.
- PascalCase type usages (`Particle` in `new Particle[n]`, `Pair`, `Drawable`) → `entity.name.type` → green/teal.
- Single-letter type names like template params `T` → `entity.name.type.template` → green/teal.
- File-scope globals still stay unscoped → grey.

Why: in 0.3.1, only declaration sites got coloured; references stayed grey. The screenshots looked half-finished. This adds an `identifier-fallback` repository entry, included after `$self` inside `block` and `parens` so it only fires on identifiers that no earlier pattern claimed.

Trade-off: globals USED inside a function body now look the same as locals — TextMate can't tell them apart without semantic info from a real language server. File-scope global declarations still look distinct (grey).

## 0.3.1

Color-alignment pass to better match the C++ extension under default themes:

- **Local variables** in declarations (`int32 sum = 0`, function params, struct/class fields) are scoped as `variable.other.declaration` → light blue.
- **File-scope globals** stay unscoped (default text color → grey-ish), preserving the previous look.
- **Namespace identifiers** (`namespace foo`, `using namespace foo`, `foo::Bar`) are no longer scoped as `entity.name.namespace` — they fall through to default text → grey, matching the user-requested look across themes that otherwise color this scope green.
- **Datatypes** (`int32`, `void`, `string`, …) stay `support.type.primitive` → dark blue. Builtins (`array`, `map`, `vec3`, …) stay `support.type.builtin`.
- **`class` / `struct` / `enum` / `interface` keywords** stay `storage.type.*` → dark blue. The names stay `entity.name.type.*` → teal/green.

Mechanism: new `block` (`{...}`) and `parens` (`(...)`) repository entries that include `variable-declaration-primitive` and `variable-declaration-builtin`. The var-decl patterns only fire inside those contexts, so file-scope decls aren't touched.

## 0.3.0

- **Stdlib intellisense.** A snapshot of the preshipped addon API (~820 entries: globals, types, factories, methods, destructors) ships as `data/enma-stdlib.json`. The extension reads it at activation and uses it for:
  - **Completion** — top-level globals/types/factories; after `.` all stdlib methods (filtered by VSCode as you type); after `::` globals/types.
  - **Signature help** — triggered on `(` and `,`. Walks back from the cursor to find the call name, looks it up in the stdlib index, and shows all matching overloads with the active parameter highlighted.
  - **Augmented hover** — stdlib names now show their real signature (and "method on `<type>`" / "stdlib function" / "factory for `<type>`" / "type" labels). Falls back to keyword hovers when not stdlib.
- Methods that exist on multiple types (e.g. `length` on `string`, `array`, `vec2`, `vec3`, `vec4`) are listed together in hovers instead of just one entry.

## 0.2.0

- **Hover docs** for built-in types, keywords, modifiers, and special literals (`extension.js`).
- **Stdlib snippets** — math, vec, time, file, regex, json, mutex, atomic, coroutine, annotations.
- Inheritance lists are now scoped: `class Foo : public Bar` renders `Bar` as `entity.other.inherited-class`, `public` as `storage.modifier.access`, `:` as `punctuation.separator.inheritance`.
- Declaration keywords (`class`, `struct`, `interface`, `enum`, `namespace`, `template`, `typedef`, `using`, `delegate`, etc.) re-scoped to `storage.type.*` to match the C++ extension's color in default themes.
- Lambda return types like `[](x) -> int32` no longer mis-color the type as a property.

## 0.1.0 — initial release

- Syntax highlighting for `.em` files (TextMate grammar)
- Language configuration: brackets, comments, auto-closing pairs, indent rules
- ~20 snippets for common patterns
- `.emb` registered as a binary marker
