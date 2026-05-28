---
review-profile: code
---

# Sprint 488 Contract: Detected PostgreSQL Extension Completion Packs

## Goal

Consume Sprint 487's installed PostgreSQL extension inventory in the SQL
completion hot path, enabling curated extension completion packs only when the
matching extension is installed.

## Dependencies

- Depends on: Sprint 487 PostgreSQL installed extension inventory.
- Phase: 32 PostgreSQL lane.
- Blocks: richer catalog-backed function/type/operator candidates from
  installed extensions.

## Scope

- Add installed PostgreSQL extensions to the frontend SQL completion context.
- Fetch and cache PostgreSQL extension inventory for PostgreSQL query tabs.
- Pass extension inventory through the TypeScript -> WASM completion boundary.
- Add curated WASM completion packs for the initial Phase 32 extension set:
  `pgcrypto`, `uuid-ossp`, `postgis`, `pgvector`, `citext`, `hstore`, and
  `pg_trgm`.
- Keep packs opt-in by detected extension name; unknown extensions remain
  detected inventory only and do not invent candidates.
- Update product-facing support docs to narrow the previous unsupported
  completion-pack boundary.

## Acceptance Criteria

- AC-488-01: PostgreSQL extension inventory is cached by `(connectionId, db)`
  and evicted with the existing connection/workspace cache paths.
- AC-488-02: PostgreSQL query tabs trigger a background extension inventory
  fetch; non-PostgreSQL tabs do not call the PostgreSQL-only IPC.
- AC-488-03: SQL completion context and request payload include installed
  extension names without making an IPC call on the completion hot path.
- AC-488-04: WASM completion suggests curated pack candidates only when the
  matching extension is present.
- AC-488-05: Unknown installed extensions do not create candidates.
- AC-488-06: Existing built-in completion remains available and duplicate
  labels are deduped.

## Out of Scope

- Catalog-backed introspection of every function/operator/type provided by an
  extension.
- UI badges or extension panels.
- Extension install/load management.
- Semantic validation that a query uses only installed extension symbols.
- Non-PostgreSQL extension/module/plugin completion packs.

## Required Checks

1. `cargo test --manifest-path src-tauri/sql-parser-core/Cargo.toml ac_488 --quiet`
2. `cargo test --manifest-path src-tauri/sql-parser-core/Cargo.toml --quiet`
3. `pnpm vitest run src/stores/schemaStore.test.ts src/stores/schemaStore.db-aware.test.ts src/stores/schemaStore.dbMismatch.test.ts src/stores/schemaStore.clearForConnection.test.ts src/stores/schemaStore.scope.test.ts src/lib/sql/sqlCompletionContext.test.ts src/lib/sql/sqlCompletionRequest.test.ts src/lib/sql/sqlCompletionWasm.test.ts src/components/query/QueryTab.dialect.test.tsx --reporter=dot`
4. `pnpm build:sql-wasm`
5. `pnpm exec tsc -b --pretty false`
6. `bash scripts/check-wasm-size.sh`
7. `git diff --check origin/main...HEAD`
