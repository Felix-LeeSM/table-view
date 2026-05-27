# Sprint 486 Handoff: PostgreSQL Extension Operator/Type Tolerance

## Result

- Added bounded PostgreSQL extension/operator-class token tolerance for
  predicates such as `title % 'table'`.
- Preserved extension predicates as a distinct Rust/TypeScript AST shape:
  `ExtensionOperatorComparison` / `extension-operator-comparison`.
- Added known extension DDL type tolerance for `citext`, `hstore`, `vector`,
  `halfvec`, `sparsevec`, `geometry`, and `geography`.
- Preserved extension type names and modifiers as `ColumnType::Extension` /
  `kind: "extension"`.
- Kept Safe Mode tiers unchanged:
  - extension operator SELECT: `select` / `info`
  - extension type CREATE TABLE: `ddl-create` / `info`
- Updated query language support docs and regenerated SQL parser WASM.

## Evidence

- RED log: `docs/sprints/sprint-486/red-state.log`
- RED patch: `docs/sprints/sprint-486/red-test.patch`
- RED commit: `679cafb1 test: RED postgres extension tolerance`
- GREEN commit: `a817b268 feat(sql): tolerate postgres extension operators and types`

## Verification

- `cargo test --manifest-path src-tauri/sql-parser-core/Cargo.toml ac_486 --quiet`
  - passed: 3 focused tests
- `pnpm vitest run src/lib/sql/sqlAst.test.ts src/lib/sql/sqlSafety.test.ts -t "486"`
  - passed: 4 focused tests
- `cargo test --manifest-path src-tauri/sql-parser-core/Cargo.toml --quiet`
  - passed: 543 tests
- `pnpm vitest run src/lib/sql/sqlAst.test.ts src/lib/sql/sqlSafety.test.ts`
  - passed: 201 tests
- `pnpm exec tsc -b --pretty false`
  - passed
- `pnpm build:sql-wasm`
  - passed
- `bash scripts/check-wasm-size.sh`
  - passed
  - SQL wasm: raw 237017 bytes, gzip 84778 bytes, budget 204800 bytes
  - Mongo wasm: raw 104916 bytes, gzip 52169 bytes, budget 54272 bytes
- `git diff --check origin/main...HEAD`
  - passed

## Boundaries

- No installed extension detection.
- No completion-pack enablement.
- No full PostgreSQL operator precedence.
- No `ORDER BY embedding <-> '[...]'` expression ordering.
- No runtime execution changes.
