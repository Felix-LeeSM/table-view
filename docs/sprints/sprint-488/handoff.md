# Sprint 488 Handoff: Detected PostgreSQL Extension Completion Packs

## Result

- Added `(connectionId, db)` PostgreSQL extension inventory caching to
  `schemaStore`, including connection/workspace eviction and DbMismatch sync.
- Wired PostgreSQL query tabs to fetch installed extension inventory in the
  background and pass it through the SQL completion context.
- Extended the TypeScript -> WASM completion bridge with installed extension
  inventory.
- Added curated PostgreSQL extension completion packs for `pgcrypto`,
  `uuid-ossp`, `postgis`, `pgvector`, `citext`, `hstore`, and `pg_trgm`.
- Fixed operator-pack completions so typed operator prefixes such as `<` and
  `%` are replaced instead of appended.
- Kept unknown extensions as inventory only; they do not create completion
  candidates.
- Regenerated SQL parser WASM and updated product-facing query-language docs.

## Evidence

- RED log: `docs/sprints/sprint-488/red-state.log`
- RED patch: `docs/sprints/sprint-488/red-test.patch`

## Verification

- `cargo test --manifest-path src-tauri/sql-parser-core/Cargo.toml ac_488 --quiet`
  - passed: 4 focused tests
- `cargo test --manifest-path src-tauri/sql-parser-core/Cargo.toml --quiet`
  - passed: 547 tests
- `pnpm vitest run src/lib/sql/sqlHybridCompletionSource.test.ts src/stores/schemaStore.test.ts src/stores/schemaStore.db-aware.test.ts src/stores/schemaStore.dbMismatch.test.ts src/stores/schemaStore.clearForConnection.test.ts src/stores/schemaStore.scope.test.ts src/lib/sql/sqlCompletionContext.test.ts src/lib/sql/sqlCompletionRequest.test.ts src/lib/sql/sqlCompletionWasm.test.ts src/components/query/QueryTab.dialect.test.tsx --reporter=dot`
  - passed: 84 tests across 10 files
  - re-run after stubbing QueryHistoryPanel in QueryTab.dialect: passed with no
    stderr noise.
- `pnpm build:sql-wasm`
  - passed
- `pnpm exec tsc -b --pretty false`
  - passed
- `bash scripts/check-wasm-size.sh`
  - passed: SQL wasm gzip 86132 bytes, Mongo wasm gzip 52169 bytes
- `git diff --check`
  - passed

## Boundaries

- No extension install/load management.
- No UI surface for installed extensions.
- No semantic validation that SQL uses only installed extension symbols.
- No catalog-backed enumeration of every extension-provided symbol.
