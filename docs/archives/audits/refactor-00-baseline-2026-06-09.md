# Refactor 00 Test And Static Baseline

Issue: #577
Parent: #571
Milestone: 09.00 - Refactor 00 - Test And Static Hardening Baseline
Base: `3da6d4f5182baa4e15e3a667b2ccc9ae85560a3d`

This file is issue evidence for #577. It is not a product/support-claim SOT and
does not update memory policy. Downstream hardening issues should copy the
measured numbers they need into their own issue evidence before changing gates.

## Baseline Table

| Area | Command / source | Result | Runtime | Classification |
|---|---|---:|---:|---|
| ESLint/static | `pnpm exec eslint . --format json` | 0 errors, 22 warnings | 5.36s | Future refactor child: all warnings are `max-lines` debt. |
| TypeScript | `pnpm exec tsc --noEmit` | Pass | 8.31s | Keep as gate. |
| Frontend unit | `pnpm test -- --run --coverage` | 434 files passed, 5008 passed, 3 skipped | 77.41s | Current router command passes, but does not print coverage. |
| Frontend coverage | `pnpm exec vitest run --coverage` | 85.59 stmts, 78.20 branches, 86.55 funcs, 88.09 lines | 88.62s | Coverage child: branch coverage blocks 85+ global target. |
| Frontend build | `pnpm build` | Pass; Vite chunk-size warnings only | 13.26s | Future performance/bundle split if prioritized. |
| Rust check | `cargo check` | Pass | 132.48s | Keep as gate; warm cache still rebuilds several deps. |
| Rust static dependency scan | `cargo deny check` | Pass; 64 warnings | 1.16s to 1.57s | Allowlist-needed/future cleanup: duplicate and stale allow entries. |
| Rust unused dependencies | `cargo machete` | Pass; no unused deps | 0.14s | No action. |
| Rust coverage | `cargo llvm-cov nextest --profile push --lib --test storage_integration --test query_integration --test schema_integration --test fixture_loading --test mongo_integration --test mysql_integration --test duckdb_file_analytics --test mariadb_ddl_preview --test mssql_connection_routing --summary-only --fail-under-lines 79 --fail-under-functions 74 --fail-under-regions 80` | 1753 passed, 4 skipped; 80.53 regions, 75.39 funcs, 81.18 lines | 654.17s | Coverage child: below 85+ target; functions weakest. |
| Hook config | `lefthook validate` | Pass | 0.07s | No action. |
| Hook shell syntax | `bash -n .githooks/pre-push scripts/hooks/*.sh scripts/setup.sh scripts/target-cache.sh scripts/worktree-spawn.sh scripts/worktree-cleanup.sh scripts/worktree-bootstrap-deps.sh` | Pass | <0.01s | No action. |
| Pre-push router tests | `bash scripts/hooks/test-pre-push-path-router.sh` | Pass | 4.40s | No action. |
| E2E workflow cache test | `bash scripts/hooks/test-e2e-smoke-workflow.sh` | Pass | 0.04s | No action. |
| Coverage ratchet tests | `bash scripts/hooks/test-coverage-ratchet.sh` | Pass | 1.04s | No action. |
| Target cache tests | `bash scripts/hooks/test-target-cache.sh` | Pass | 1.34s | No action. |
| CI workflow runtime | GitHub run `27200542455` on base SHA | Success | 6m 41s wall | #582 owns cache/parallel review. |
| E2E workflow runtime | GitHub run `27200542408` on base SHA | Success | 17m 48s wall | #581/#582 own breadth/runtime review. |

## Static Debt

ESLint has 22 warnings, all from `max-lines`:

| Rule | Count | Severity | Classification |
|---|---:|---|---|
| `max-lines` | 22 | warning | Future refactor child. Do not promote to error before decomposition or explicit allowlist. |

Files currently over the 700-line lint threshold:

- `e2e/smoke/_helpers.ts`
- `src/components/connection/ConnectionDialog.test.tsx`
- `src/components/connection/ConnectionGroup.test.tsx`
- `src/components/connection/ConnectionItem.test.tsx`
- `src/components/datagrid/sqlGenerator.test.ts`
- `src/components/datagrid/useDataGridEdit.mixed-batch.test.ts`
- `src/components/document/DocumentTreePanel.test.tsx`
- `src/components/document/DocumentTreePanel.tsx`
- `src/components/layout/MainArea.test.tsx`
- `src/components/layout/TabBar.test.tsx`
- `src/components/query/QueryTab/useQueryExecution.ts`
- `src/components/rdb/DataGrid.editing.test.tsx`
- `src/components/schema/CreateTableDialog.test.tsx`
- `src/components/schema/CreateTableDialog.tsx`
- `src/components/schema/SchemaTree.actions.test.tsx`
- `src/components/shared/QuickLookPanel.test.tsx`
- `src/hooks/useSqlAutocomplete.test.ts`
- `src/lib/mongo/mongoshParser.test.ts`
- `src/lib/sql/sqlAst.test.ts`
- `src/lib/sql/sqlSafety.test.ts`
- `src/stores/connectionStore.test.ts`
- `src/stores/schemaStore.test.ts`

`cargo deny check` passes with warnings:

| Warning category | Count | Classification |
|---|---:|---|
| `duplicate` | 61 | Allowlist-needed or dependency graph cleanup. |
| `license-not-encountered` | 2 | Small cleanup if allowances are stale. |
| `license-exception-not-encountered` | 1 | Small cleanup if the `ring` exception is stale. |

## Coverage Debt

Current frontend global coverage is already above 85 for statements, functions,
and lines. Branches are 78.20%, so a global 85+ raise is blocked until #579 adds
contract-level tests. `vite.config.ts` still gates `lines/functions/branches` at
70. Do not raise thresholds in #577.

Notable frontend weak spots from the coverage table:

- Tauri API wrappers and runtime boundary modules include several 0% files
  (`src/lib/tauri/connection.ts`, `ddl.ts`, `document.ts`, `export.ts`,
  `schema.ts`, `src/lib/api/*` ops helpers).
- Connection DBMS-specific form fields have low coverage for non-Postgres
  variants.
- Query toolbar/favorites/log and document bulk paths have low branch/function
  coverage.

Current Rust coverage passes the push gate but remains far from 85+:

| Metric | Current | Push gate | 85+ gap |
|---|---:|---:|---:|
| Regions | 80.53% | 80% | 4.47pp |
| Functions | 75.39% | 74% | 9.61pp |
| Lines | 81.18% | 79% | 3.82pp |

Notable Rust weak spots from the coverage table:

- Entrypoint/runtime wrappers: `lib.rs`, `main.rs`, `commands/registry.rs`,
  `commands/connection/sqlite_file.rs`.
- Source-specific low areas: `db/sqlite.rs`, `db/sqlite/connection.rs`,
  `db/duckdb/value.rs`, `db/oracle/catalog.rs`, `db/mssql/catalog.rs`,
  `db/mysql.rs`, `db/mysql/connection.rs`, `db/mongodb/schema.rs`.
- Command/session paths: `commands/connection/session.rs`,
  `commands/persist_settings.rs`, `commands/search.rs`.

## Hook And CI Runtime Notes

Pre-push routing always runs signed-commit and coverage-ratchet checks, then
routes by outgoing paths:

- docs-only: skips TS/Rust gates.
- frontend: `npx tsc --noEmit`, `npm run lint`, `npm run test -- --run --coverage`.
- Rust: `cargo check`, `cargo deny check`, `cargo machete`, Rust llvm-cov nextest.
- workflow/unknown: full frontend and Rust gates.
- hook changes: shell syntax, lefthook validation, nextest push profile,
  ratchet/router/target-cache tests.

`PRE_PUSH_PATH_ROUTER_PARALLEL_GATES` defaults to `0`, so mixed frontend+Rust
routes are sequential unless explicitly enabled. #582 owns any cache or parallel
execution change.

GitHub CI timing on base SHA:

| Workflow job | Runtime |
|---|---:|
| Frontend Checks | 398s |
| Rust Unit And Storage Tests | 223s |
| Integration Tests (Docker) | 275s |

GitHub E2E timing on base SHA:

| Workflow job | Runtime |
|---|---:|
| Prepare E2E runtime artifacts | 256s |
| Runtime Happy Path matrix specs | 175s to 286s each |
| Required summary job | 3s |

The E2E workflow runs 16 matrix specs with `max-parallel: 5`. The workflow uses
pnpm cache, Rust cache, a shared Linux E2E Rust cache key, a cached
`tauri-driver`, and a prepared debug binary artifact.

## Downstream Routing

| Gap | Owner issue | Action |
|---|---|---|
| `max-lines` 22 warnings | #578 | Measure before error promotion; decompose or create explicit allowlist/removal policy. |
| Frontend branches below 85 | #579, then #580 | Add meaningful contract tests before ratcheting `vite.config.ts`. |
| Rust functions below 85 | #579, then #580 | Add focused Rust unit/integration tests before raising llvm-cov cutoffs. |
| E2E breadth/runtime expansion | #581 | Use current 17m 48s workflow baseline before adding specs. |
| Hook/CI cache and parallelism | #582 | Use current local and GitHub runtimes before changing cache keys or parallel gates. |
| Docs/memory policy SOT | Later docs/memory child under #571 | Do not update memory/docs policy from #577. |

## Deferred By Scope

- No thresholds raised.
- No source structure refactor.
- No broad ignores added.
- No child issues edited, per task constraint to keep this PR to #577 only.
