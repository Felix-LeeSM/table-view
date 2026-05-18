# Sprint Contract: sprint-401

## Summary

- Goal: **mongosh AST Rust + WASM migration** — re-implement the four-file TS
  parser at `src/lib/mongo/mongoshAst/` (`index.ts` / `lexer.ts` / `parser.ts` /
  `argList.ts`) as a pure-Rust crate at `src-tauri/mongosh-parser-core/`, compiled
  to `wasm32-unknown-unknown` via `wasm-pack`, with the frontend wrapper lazy-
  loading the WASM. Mirrors the sprint-385 SQL parser foundation pattern.
- Audience: Same callers as today — `src/lib/mongo/runCommandParser.ts`,
  `Toolbar.tsx`, `useQueryExecution.ts`. **The public signature
  `parseMongoshStatement(sql: string): MongoshStatementResult` MUST remain
  synchronous** (see Decision Lock below); only the implementation swaps from
  TS to WASM.
- Owner: Generator (sprint-401).
- Verification Profile: `frontend` (pnpm vitest + pnpm tsc + pnpm lint) +
  `backend` (`cargo test`, `cargo clippy -D warnings`, `cargo build --target
  wasm32-unknown-unknown --release --features wasm`).

## Decision Lock — sync API + eager pre-load

The TS `parseMongoshStatement` is called **synchronously inside a React render
function** (`Toolbar.tsx:90` — `classifyMongoStatement(tab.sql)` runs on every
editor keystroke as part of the Run-button disabled-state computation). Going
async (`Promise<MongoshStatementResult>`) would require restructuring the
toolbar's render path to a `useState` + `useEffect` + debounce pipeline, which:

1. Touches a sync render-path invariant that the test suite (`Toolbar.test.tsx`,
   `runCommandParser.test.ts`, several `useQueryExecution` tests) implicitly
   depends on.
2. Introduces a "stale classification" race during typing — the gate would lag
   the editor text by one render frame, allowing transient enable/disable
   flicker on the Run button.
3. Expands the diff far beyond "swap TS for WASM" — we'd be changing the
   public contract of three modules to fix what is really a build-pipeline
   choice.

The sprint-385 SQL facade is async because its single caller
(`useQueryExecution` SQL path) already lives inside an async `handleExecute`.
Mongo's classification sits in a sync render path, so we pick the dual
strategy:

- **Eager pre-load**: `src/main.tsx` calls `void initMongoshWasm()` immediately
  after `ReactDOM.createRoot().render(...)` (fire-and-forget). The WASM module
  is fetched + instantiated while the user is still reading the first paint;
  by the time they type a mongosh expression and look at the Run button, the
  module is in memory.
- **Sync surface**: `parseMongoshStatement(sql: string): MongoshStatementResult`
  stays sync. If WASM is not yet loaded when called, the function returns the
  same `kind: "error"` shape with `errorKind: "unsupported-syntax"` and a
  message indicating the parser is initializing — the Run button stays
  disabled (correct fail-safe) until the next render cycle re-evaluates with
  the loaded module. In practice, no real user encounters this path because
  React's first render to the QueryTab is gated behind store hydration which
  takes ~50–200ms — far longer than WASM module load.

Trade-off: a 1-frame "parser initializing" window after a *very* cold boot.
This matches today's behavior (the regex-based classifier in sprint-381 had a
similar few-ms delay during JS module parse). Reverting this decision would
require re-architecting the Toolbar to an async classification pipeline —
tracked as a follow-up if cold-boot UX feedback requires it.

## In Scope

- **New Rust crate** at `src-tauri/mongosh-parser-core/`:
  - Library only (`[lib]` with `crate-type = ["cdylib", "rlib"]`).
  - No Tauri / `tokio` / `std::io` dependencies — pure Rust + `serde` so the
    same `.rs` source compiles cleanly to `wasm32-unknown-unknown`.
  - Modules: `lexer.rs`, `parser.rs`, `ast.rs`, `lib.rs`.
  - Output AST: discriminated union mirroring `MongoshStatementResult`:
    - `AdminCommand { command_name: "runCommand" | "adminCommand", body: serde_json::Value }`
    - `CollectionCommand { collection: String, method: String, args: Vec<serde_json::Value> }`
    - `Error { error_kind: ParseErrorKind, message: String }`
  - `serde::Serialize` so the WASM glue can serialize via `serde_wasm_bindgen`.
  - Path-dep is **not** added to `src-tauri/Cargo.toml` — this sprint only
    ships the WASM build path; the backend already accepts the extended-JSON
    shape via `extjson_to_bson_document` (sprint-384). Adding a native Tauri
    command to expose `parse_mongosh_backend` is sprint-402+ if needed.

- **Grammar slice = current TS coverage** (parity, no widening):
  - `db.runCommand({...})` and `db.adminCommand({...})`.
  - `db.<coll>.<method>(...)` including chain methods (`.sort({...}).limit(N)`).
  - Object literals with unquoted ident keys + quoted string keys.
  - String literals (single- and double-quoted, with escape sequences).
  - Interpolation-free template literals (treated as plain strings; `${...}`
    rejected with `unsupported-syntax`).
  - Number literals (integers, floats, exponent notation, negatives).
  - Array literals.
  - Boolean / null literals.
  - Line comments (`// ...`) and block comments (`/* ... */`, non-nested).
  - BSON literals — `ObjectId(...)`, `ISODate(...)`, `NumberLong(...)`,
    `Decimal128(...)`, `UUID(...)` — emitted as extended-JSON placeholders
    (`{"$oid": "..."}`, `{"$date": "..."}`, `{"$numberLong": "..."}`,
    `{"$numberDecimal": "..."}`, `{"$uuid": "..."}`). Backend converts these
    to real BSON via the existing `extjson_to_bson_document` path.
  - Differentiated rejection error kinds: `unsupported-syntax`,
    `bson-literal`, `multiple-statements`, `variable-declaration`,
    `function-declaration`, `non-db-statement`.
  - Head-keyword sniff before tokenization (so `let x = 1` returns
    `variable-declaration` instead of a generic lex error).
  - Bare-expression heads (`1 + 1`, `"hello"`, `ObjectId(...)`) classified as
    `non-db-statement`.

- **WASM wrapper** at `src-tauri/mongosh-parser-core/` itself, gated behind
  the `wasm` Cargo feature. Exports a single function:
  `parse_mongosh(input: &str) -> JsValue`.

- **pnpm script** `build:mongosh-wasm` mirroring `build:sql-wasm`.

- **Frontend wrapper rewrite** at `src/lib/mongo/mongoshAst/`:
  - `index.ts` becomes the WASM-backed implementation (no longer a re-export
    shim).
  - **`lexer.ts` / `parser.ts` / `argList.ts` DELETED** — the lexer + parser +
    argList logic now lives in Rust.
  - Public exports preserved exactly:
    `parseMongoshStatement(input: string): MongoshStatementResult` plus the
    five type exports (`MongoshErrorKind`, `MongoshAdminCommand`,
    `MongoshCollectionCommand`, `MongoshParseError`, `MongoshStatementResult`).
  - Eager-init helper `initMongoshWasm(): Promise<void>` for boot wiring.
  - Test-only escape hatch `__resetMongoshWasmModuleForTests()` symmetric with
    `__resetSqlWasmModuleForTests`.

- **Boot wiring** at `src/main.tsx`:
  - `void initMongoshWasm()` after `ReactDOM.createRoot().render(...)` —
    fire-and-forget, no boot-summary milestone (single internal stat).

- **Frontend test** at `src/lib/mongo/mongoshAst.test.ts` — existing 47 cases
  must pass unchanged against the WASM-backed implementation (regression 0).
  Three new cases:
  - `AC-401-W1` — WASM module instantiates via `initMongoshWasm()` without
    throwing.
  - `AC-401-W2` — `parseMongoshStatement` returns a synthetic
    `unsupported-syntax` "parser initializing" error before WASM loads.
  - `AC-401-W3` — `parseMongoshStatement` round-trips after `await
    initMongoshWasm()`.

## Out of Scope (sprint-402+)

- Grammar widening: regex literals, multi-statement, variable references,
  interpolated templates, arrow-function callbacks (`forEach(d => d.x)`).
- New BSON literals (`BinData`, `NumberInt`, `Timestamp`, ...).
- Native Tauri command `parse_mongosh_backend` (backend already accepts the
  extended-JSON shape via `extjson_to_bson_document`).
- Replacing `mongoshParser.ts` (Phase 28 method-whitelist parser) — that's a
  separate downstream consumer, not the AST module.
- Replacing the autocomplete tokenizer (`mongoTokenize.ts`) — different
  grammar/perf profile.

## Invariants

- The Rust crate has zero Tauri / DB / async dependency — verified by
  `cargo build --target wasm32-unknown-unknown --release --features wasm`
  succeeding.
- No `unwrap()` / `expect()` on user-input paths in the parser.
- TS facade uses `unknown` + type guards; no `any`.
- WASM file added to `src/lib/mongo/wasm/` is dynamic-imported only (the boot
  wiring uses `void import("...").then(m => m.init...)` so it lands in a
  Vite-split chunk).
- Bundle size budget: combined `.wasm` + glue.js MUST be < 50 KB compressed
  (mongo grammar is smaller than SQL — sprint-385 was ~20 KB gzipped).
- All 47 existing `mongoshAst.test.ts` cases pass unchanged (regression 0).

## Acceptance Criteria

### Rust crate — lexer

- `AC-401-L1` Tokenizes idents, strings (`"..."`, `'...'`), numbers (int /
  float / exp / negative), punctuation.
- `AC-401-L2` Strips line comments (`// ...`).
- `AC-401-L3` Strips block comments (`/* ... */`, non-nested).
- `AC-401-L4` Tokenizes template literals (interpolation-free) as strings.
- `AC-401-L5` Rejects interpolated templates (`${...}`).
- `AC-401-L6` Rejects arrow `=>`.
- `AC-401-L7` Rejects unterminated strings / templates / block comments.

### Rust crate — parser

- `AC-401-P1` `db.runCommand({ping: 1})` → admin-command.
- `AC-401-P2` `db.adminCommand({serverStatus: 1})` → admin-command.
- `AC-401-P3` `db.users.find({})` → collection-command.
- `AC-401-P4` `db.users.find({}, {limit: 10})` → 2-arg collection-command.
- `AC-401-P5` Mixed ident + quoted keys in object literal.
- `AC-401-P6` Nested objects + arrays.
- `AC-401-P7` All 5 BSON literals emit correct extended-JSON placeholders.
- `AC-401-P8` BSON `NumberLong(123)` (number arg) coerces to `{$numberLong: "123"}`.
- `AC-401-P9` `let x = 1` → `variable-declaration` errorKind.
- `AC-401-P10` `function foo() {}` → `function-declaration` errorKind.
- `AC-401-P11` `1 + 1` / `"hello"` → `non-db-statement` errorKind.
- `AC-401-P12` Multi-statement `;`-separated → `multiple-statements`.
- `AC-401-P13` Empty input → `unsupported-syntax`.
- `AC-401-P14` BSON literal call with non-primitive arg → `unsupported-syntax`.

### WASM build

- `AC-401-W1` `cargo build --target wasm32-unknown-unknown --release --features wasm`
  inside `src-tauri/mongosh-parser-core/` succeeds.
- `AC-401-W2` `pnpm build:mongosh-wasm` produces `.wasm` + JS glue under
  `src/lib/mongo/wasm/`.
- `AC-401-W3` WASM file (with `wasm-opt -Oz`) under 50 KB gzipped.

### Frontend integration

- `AC-401-F1` All 47 existing `mongoshAst.test.ts` cases pass against the
  WASM-backed `parseMongoshStatement` (regression 0).
- `AC-401-F2` `lexer.ts` / `parser.ts` / `argList.ts` are deleted; only
  `index.ts` remains in `src/lib/mongo/mongoshAst/`.
- `AC-401-F3` `runCommandParser.test.ts` + `Toolbar.test.tsx` +
  `useQueryExecution` tests still green.

## Design Bar / Quality Bar

- Hand-written recursive-descent parser (no `nom`/`pest`/`logos` dep — keeps
  WASM bundle small).
- All Rust functions on user-input paths return a `ParseResult` variant; no
  `unwrap`/`expect` outside `#[cfg(test)]`.
- `wasm-opt -Oz` post-processing (handled automatically by `wasm-pack`).

## Verification Plan

### Required Checks

1. `cd src-tauri/mongosh-parser-core && cargo test` — all unit tests pass.
2. `cd src-tauri/mongosh-parser-core && cargo build --target wasm32-unknown-unknown --release --features wasm` — succeeds.
3. `pnpm build:mongosh-wasm` — produces `src/lib/mongo/wasm/*.wasm` + glue.
4. `pnpm vitest run src/lib/mongo/mongoshAst.test.ts` — green, regression 0.
5. `pnpm vitest run` — full suite green (no regressions in
   `runCommandParser.test.ts`, `Toolbar.test.tsx`, `useQueryExecution.*.test.tsx`).
6. `pnpm tsc --noEmit` — 0 errors.
7. `pnpm lint` — 0 errors.
8. `pnpm build` — production build succeeds, WASM appears as a separate chunk.

### Required Evidence

- Rust unit test count (≥ 20 covering AC-401-L1..L7 + P1..P14).
- `.wasm` file size after `wasm-pack` (with `wasm-opt -Oz`) — primary metric,
  budget < 50 KB compressed.
- vitest delta: +3 new (W1..W3); existing 47 cases unchanged.

## Test Requirements

- Rust unit tests: ≥ 20 (lexer + parser).
- Vitest baseline before sprint: full-suite count; expected delta `+3`.

## Ownership

- Generator: general-purpose Agent (sprint-401).
- Write scope: In Scope.
- Merge order: independent — depends only on sprint-385's `vite-plugin-wasm`
  + `wasm-pack` infra which is already on `main`.

## Exit Criteria

- Open P1/P2: 0
- AC 23/23 PASS (7 lexer + 14 parser + 3 wasm-build/integration + 3 frontend)
- Pre-commit + pre-push hooks green
- PR open + linked
