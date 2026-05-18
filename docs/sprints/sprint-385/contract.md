# Sprint Contract: sprint-385

## Summary

- Goal: **SQL parser Rust + WASM foundation** — set up a pure-Rust SQL parser crate
  (`src-tauri/sql-parser-core/`) that compiles to both native (Tauri backend) and
  `wasm32-unknown-unknown` (frontend), and prove the dual-target pipeline works
  end-to-end on the smallest possible grammar slice. This sprint is
  **infrastructure-heavy, grammar-light** — further grammar work is sprint-386+.
- Audience: Future sprints that will replace the regex-based
  `src/lib/sql/sqlSafety.ts` analyzer / `cursorClause.ts` / `cteColumnCompletion.ts`
  with a real AST. None of those replacements happen in this sprint.
- Owner: Generator (sprint-385).
- Verification Profile: `frontend` (pnpm vitest + pnpm tsc + pnpm lint) +
  `backend` (`cargo test`, `cargo clippy --all-targets --all-features -D warnings`,
  `cargo build --target wasm32-unknown-unknown --release`).

## In Scope

- **New Rust crate** at `src-tauri/sql-parser-core/`:
  - Library only (`[lib]` with `crate-type = ["cdylib", "rlib"]`).
  - No Tauri / `tokio` / `std::io` dependencies — pure Rust + `serde` so the same
    `.rs` source compiles cleanly to `wasm32-unknown-unknown`.
  - Modules: `lexer.rs`, `parser.rs`, `ast.rs`, `lib.rs`.
  - Output AST: discriminated union (`ParseResult::Select(SelectStatement)` /
    `ParseResult::Error(ParseError)`). `serde::Serialize` so the WASM glue can
    serialize via `serde_wasm_bindgen`.
  - Path-dependency referenced from `src-tauri/Cargo.toml` (NOT a Cargo
    workspace member — keeps `cargo llvm-cov --lib` for `table-view` isolated
    from the new crate's coverage profile).
- **Grammar slice (one only)**:
  - `SELECT <column-list> FROM <table-ref> [WHERE <expression>]`
  - `<column-list>`: `*` OR comma-separated identifiers.
  - `<table-ref>`: single identifier. No schema-qualified (`public.users`),
    no JOIN.
  - `<expression>` (WHERE only): `<identifier> <op> <literal>` where
    op ∈ `=`, `<`, `>`, `<=`, `>=`, `<>`, `!=` and literal ∈ integer / single-
    quoted string. No AND / OR / NOT / parentheses.
  - Everything else → `ParseError`.
- **WASM wrapper** at `src-tauri/sql-parser-core/` itself, gated behind the
  `wasm` Cargo feature (so the same crate yields both rlib for backend and
  cdylib for `wasm-pack`). Exports a single function:
  `parse_sql(sql: &str) -> JsValue`.
- **pnpm script** `build:sql-wasm` that runs `wasm-pack build --target web --out-dir ../../src/lib/sql/wasm` from `src-tauri/sql-parser-core/`.
- **Frontend facade** at `src/lib/sql/sqlAst.ts`:
  - Lazy `import()` of the generated WASM module (NOT eagerly imported anywhere
    in the main bundle).
  - `export async function parseSql(sql: string): Promise<SqlParseResult>`
  - TS types mirror the Rust `serde::Serialize` output (tagged union).
- **Frontend test** at `src/lib/sql/sqlAst.test.ts`:
  - One vitest that exercises the WASM-via-facade path on
    `SELECT id FROM users WHERE name = 'felix'` and asserts the AST shape.
- **Backend integration** at `src-tauri/src/commands/sql_parser.rs`:
  - New Tauri command `parse_sql_backend(sql: String) -> Result<SqlParseResult, String>`
    using the native-compiled `sql-parser-core` crate.
  - Registered in `lib.rs` next to the other `invoke_handler!` entries.
- **Backend integration test** at `src-tauri/tests/parse_sql_backend.rs`:
  - One Rust test asserting the IPC round-trips a SELECT statement.
- **Vite config**: add `vite-plugin-wasm` (devDep) + `vite-plugin-top-level-await`
  if needed so the dynamic import resolves at runtime.

## Out of Scope (sprint-386+)

- INSERT / UPDATE / DELETE / DDL grammar.
- JOIN / subquery / CTE / window functions.
- AND / OR / NOT in WHERE; parenthesized expressions.
- Schema-qualified table refs (`public.users`).
- Multi-statement SQL (only one statement per `parse_sql` call).
- Dialect differences (PG vs MySQL vs SQLite vs MSSQL).
- Replacing `sqlSafety.analyzeStatement` regex (downstream once grammar widens).
- Replacing `cursorClause.ts` / `cteColumnCompletion.ts`.
- Quoted / backtick / double-quoted identifiers.
- Floating-point literals; numeric expressions in WHERE.
- NULL literal.
- Statement terminator `;` handling (we accept trailing semicolon but no
  multi-statement parsing).

## Invariants

- The Rust crate has zero Tauri / DB / async dependency — verified by
  `cargo build --target wasm32-unknown-unknown --release` succeeding.
- No `unwrap()` / `expect()` on user-input paths in the parser.
- TS facade uses `unknown` + type guards; no `any`.
- WASM file added to `src/lib/sql/wasm/` is dynamic-imported only — production
  bundle (`pnpm build` → `dist/`) must show the WASM as a separate chunk, not
  inlined into the main JS bundle.
- Bundle size budget: combined `.wasm` + glue.js MUST be < 1.5 MB compressed
  delta vs. `origin/main` `dist/`.

## Acceptance Criteria

### Rust crate — lexer

- `AC-385-L1` Lexer tokenizes `SELECT` / `FROM` / `WHERE` as keyword tokens
  case-insensitively (`select` / `Select` / `SELECT` all yield `Token::Select`).
- `AC-385-L2` Lexer tokenizes identifiers (`users`, `id`, `user_id`).
- `AC-385-L3` Lexer tokenizes integer literals (`42`, `0`, `1234567890`).
- `AC-385-L4` Lexer tokenizes single-quoted strings (`'felix'`, `''`, `'with spaces'`).
- `AC-385-L5` Lexer tokenizes punctuation (`*`, `,`, `=`, `<`, `>`, `<=`, `>=`,
  `<>`, `!=`).
- `AC-385-L6` Lexer ignores whitespace and trailing semicolons.
- `AC-385-L7` Lexer returns `LexError` on unterminated string / unknown char.

### Rust crate — parser

- `AC-385-P1` `SELECT * FROM users` → `Select { columns: Star, table: "users", where: None }`.
- `AC-385-P2` `SELECT id, name FROM users` → 2-column SELECT.
- `AC-385-P3` `SELECT id FROM users WHERE id = 42` → WHERE with integer literal.
- `AC-385-P4` `SELECT id FROM users WHERE name = 'felix'` → WHERE with string literal.
- `AC-385-P5` All 7 ops (`=`, `<`, `>`, `<=`, `>=`, `<>`, `!=`) parse correctly.
- `AC-385-P6` Missing FROM (`SELECT * users`) → ParseError.
- `AC-385-P7` Missing table after FROM (`SELECT * FROM`) → ParseError.
- `AC-385-P8` Non-SELECT statement (`INSERT INTO ...`) → ParseError with
  `kind: "unsupported-statement"`.
- `AC-385-P9` Empty input → ParseError.
- `AC-385-P10` Trailing semicolon (`SELECT * FROM users;`) accepted.

### WASM build

- `AC-385-W1` `cargo build --target wasm32-unknown-unknown --release --features wasm`
  inside `src-tauri/sql-parser-core/` succeeds.
- `AC-385-W2` `pnpm build:sql-wasm` produces a `.wasm` + JS glue under
  `src/lib/sql/wasm/`.

### Frontend integration

- `AC-385-F1` `parseSql("SELECT id FROM users WHERE name = 'felix'")` resolves
  to `{ kind: "select", columns: [...], table: "users", where: {...} }`.
- `AC-385-F2` WASM is dynamically imported (not present in the main entry bundle).

### Backend integration

- `AC-385-B1` Tauri command `parse_sql_backend("SELECT * FROM users")` returns
  a `Select` AST.
- `AC-385-B2` Tauri command on invalid SQL returns the `ParseError` variant
  (does NOT panic, does NOT return `Err`).

## Design Bar / Quality Bar

- Hand-written recursive-descent parser (no `nom`/`pest`/`logos` dep — keeps
  WASM bundle small; sprint-386 may revisit).
- All Rust functions on user-input paths return `Result<_, ParseError>` or a
  union variant; no `unwrap`/`expect`.
- `wasm-opt -Oz` post-processing (handled automatically by `wasm-pack`) to
  shrink the `.wasm` output.

## Verification Plan

### Required Checks

1. `cd src-tauri/sql-parser-core && cargo test` — all unit tests pass.
2. `cd src-tauri/sql-parser-core && cargo build --target wasm32-unknown-unknown --release --features wasm` — succeeds.
3. `pnpm build:sql-wasm` — produces `src/lib/sql/wasm/*.wasm` + glue.
4. `pnpm vitest run src/lib/sql/sqlAst.test.ts` — green.
5. `pnpm tsc --noEmit` — 0 errors.
6. `pnpm lint` — 0 errors.
7. `cd src-tauri && cargo test parse_sql_backend` — green.
8. `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings` — clean.
9. `pnpm build` — succeeds, WASM appears as a separate chunk.

### Required Evidence

- Rust unit test count (≥ 15 covering AC-385-L1..L7 + P1..P10).
- `.wasm` file size after `wasm-pack` (with `wasm-opt -Oz`) — primary metric,
  budget < 1.5 MB compressed.
- `dist/` directory size delta before/after.

## Test Requirements

- Rust unit tests: ≥ 15 (lexer + parser).
- Rust integration test: 1 (`parse_sql_backend.rs`).
- Vitest: 1 new test in `sqlAst.test.ts`.
- Vitest baseline before sprint: tracked from full run; expected delta `+1`.

## Test Script / Repro Script

```bash
cd src-tauri/sql-parser-core && cargo test
cd src-tauri/sql-parser-core && cargo build --target wasm32-unknown-unknown --release --features wasm
pnpm build:sql-wasm
pnpm vitest run src/lib/sql/sqlAst.test.ts
pnpm tsc --noEmit && pnpm lint
cd src-tauri && cargo test parse_sql_backend
pnpm build  # measure dist/ size
```

## Ownership

- Generator: general-purpose Agent (sprint-385).
- Write scope: In Scope.
- Merge order: independent — no upstream sprint blocks this.

## Exit Criteria

- Open P1/P2: 0
- AC 24/24 PASS (7 lexer + 10 parser + 2 wasm-build + 2 frontend + 2 backend + 1 bundle-size invariant)
- Pre-commit + pre-push hooks green
- PR open + linked
