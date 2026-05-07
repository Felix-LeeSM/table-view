# Sprint 230 Evaluation Scorecard

Sprint: `sprint-230` (feature — dynamic Postgres type list, Phase 27 sprint 5).
Evaluator date: 2026-05-07.
Verification profile: `mixed` (command + static).

## Overall Verdict: **PASS**

**Ready to commit: YES.**

| Dimension | Score | Notes |
|-----------|-------|-------|
| Correctness | **9/10** | Dynamic fetch + merge + fallback work end-to-end. Backend SQL filters all five `typtype` arms, excludes auto row types, array element types, and `pg_toast`. Frontend hook correctly merges canonical + live extras with case-sensitive Set dedup; error path falls back to canonical. |
| Completeness | **9/10** | All 13 ACs covered with concrete code + test evidence. 19 new vitest cases (12 hook + 4 combobox + 3 dialog) + 2 Rust unit tests. Exceeds the contract minimum of 9 vitest + 1 Rust. |
| Reliability | **10/10** | Every freeze invariant verified zero-diff. Sprint 226+227+228+229 fixtures pass unchanged. `postgresTypes.ts` is additive-only (`grep "^-"` returns 0 lines). Adapter trait extension uses default `Unsupported` so MySQL/SQLite/Oracle/Mongo placeholders compile without modification. |
| Verification Quality | **9/10** | TDD evidence credible (red-state log captured before green commits). Test cases exercise behavior (cache hit, stale guard, error fallback, concurrent share, defensive drop) — not implementation details. SQL builder fixture is a true byte-for-byte drift gate. |
| **Overall** | **9.25/10** | All four dimensions ≥ 7. Pass threshold met. |

## Verification Check Results: **41/41 required PASS** (42 manual UI smoke optional, NOT PERFORMED)

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 1 | `pnpm vitest run src/components/schema/CreateTableDialog.test.tsx` | **PASS** | 55 tests passed (Sprint 229 baseline 52 + 3 new) |
| 2 | `pnpm vitest run src/components/schema/CreateTableTypeCombobox.test.tsx` | **PASS** | 16 tests passed (Sprint 227 baseline 12 + 4 new) |
| 3 | `pnpm vitest run src/hooks/usePostgresTypes.test.ts` | **PASS** | 12 tests passed (≥ 5 contract minimum) |
| 4 | `pnpm vitest run` | **PASS** | 219 files / 2838 tests passed |
| 5 | `pnpm tsc --noEmit` | **PASS** | exit 0 (silent) |
| 6 | `pnpm lint` | **PASS** | exit 0 (silent) |
| 7 | `cargo build --manifest-path src-tauri/Cargo.toml` | **PASS** | "Finished `dev` profile" |
| 8 | `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` | **PASS** | "Finished" no warnings |
| 9 | `cargo test create_table` | **PASS** | 16/16 unchanged |
| 10 | `cargo test create_index` | **PASS** | 11/11 unchanged |
| 11 | `cargo test add_constraint` | **PASS** | 12/12 unchanged |
| 12 | `cargo test list_types` | **PASS** | 2/2 (`list_types_sql_matches_canonical_fixture` + `list_types_without_connection_fails`) |
| 13 | `git diff --stat src/components/structure/useDdlPreviewExecution.ts` | **= 0** | Sprint 214 freeze ✓ |
| 14 | `git diff --stat src/components/structure/SqlPreviewDialog.tsx` | **= 0** | Sprint 227 freeze ✓ |
| 15 | `git diff --stat src/__tests__/cross-window-*.test.tsx src/__tests__/window-lifecycle.ac141.test.tsx` | **= 0** | ✓ |
| 16 | `git diff --stat src/stores/connectionStore.ts src/stores/schemaStore.ts` | **= 0** | Sprint 224 freeze ✓ |
| 17 | `git diff src/lib/sql/postgresTypes.ts \| grep "^-" \| grep -v "^---"` | **= 0** | Additive-only ✓ |
| 18 | `git diff --stat src/lib/tauri/ddl.ts` | **= 0** | New wrapper in `schema.ts` ✓ |
| 19 | `git diff --stat src/lib/tauri/index.ts` | **= 0** | Barrel re-exports `./schema` ✓ |
| 20 | `git diff --stat .../CreateTableDialog/{Header,IndexesTabBody,ForeignKeysTabBody}.tsx` | **= 0** | Sprint 227+228+229 freeze ✓ |
| 21 | `git diff --stat src/hooks/useFkReferencePicker.ts` | **= 0** | Sprint 229 freeze ✓ |
| 22 | `git diff --stat src/components/ui/` | **= 0** | No new shadcn ✓ |
| 23 | `grep -nE 'list_postgres_types' src-tauri/src/lib.rs` | **1 hit** (line 161, in `tauri::generate_handler!`) | ✓ |
| 24 | `grep -n 'pub async fn list_postgres_types' src-tauri/src/commands/rdb/schema.rs` | **1 hit** (line 226) | ✓ |
| 25 | `grep -nE 'pg_type\|pg_namespace' src-tauri/src/db/postgres/schema.rs` | **≥ 2 hits** (lines 52, 53, plus fixture + assertions) | ✓ |
| 26 | `grep -n 'fn list_types' src-tauri/src/db/traits.rs` | **1 hit** (line 292) | ✓ |
| 27 | `grep -n 'fn list_types' src-tauri/src/db/postgres.rs` | **1 hit** (line 356) | ✓ |
| 28 | `grep -n 'export async function listPostgresTypes' src/lib/tauri/schema.ts` | **1 hit** (line 137) | ✓ |
| 29 | `grep -n 'usePostgresTypes' src/components/schema/CreateTableDialog.tsx` | **2 hits** (lines 12, 363) | ✓ |
| 30 | `grep -n 'typesSource' src/components/schema/CreateTableTypeCombobox.tsx` | **5 hits** (lines 48, 57, 70, 71, 73) | ✓ |
| 31 | `grep -n 'filterPostgresTypesAgainst' src/lib/sql/postgresTypes.ts` | **1 hit** (line 84) | ✓ |
| 32 | `grep -n 'export function usePostgresTypes' src/hooks/usePostgresTypes.ts` | **1 hit** (line 163) | ✓ |
| 33 | `grep -n 'invalidatePostgresTypesCache' src/hooks/usePostgresTypes.ts` | **4 hits** (lines 23, 58, 69, 202) | ✓ |
| 34 | No `it.skip` / `it.only` / `xit` / `it.todo` in touched test files | **= 0** | ✓ |
| 35 | No `eslint-disable` lines added | **= 0** | ✓ |
| 36 | No `\bany\b` lines added in src/ | **= 0** | ✓ |
| 37 | No `createCollection` / `create_collection` in tauri/document paths | **= 0** | Mongo path untouched ✓ |
| 38 | Vitest case asserts canonical-list head order preserved | **PASS** | `usePostgresTypes.test.ts:92-106` (AC-230-05 b) |
| 39 | Vitest case asserts error-path fallback + `error` non-null | **PASS** | `usePostgresTypes.test.ts:110-121` (AC-230-05 c) |
| 40 | Vitest case asserts `pg_catalog.varchar → varchar` label | **PASS** | `usePostgresTypes.test.ts:166-185` (AC-230-06) |
| 41 | Vitest case asserts `expandParametricDefault` works with dynamic list | **PASS** | `CreateTableTypeCombobox.test.tsx:309-329` (AC-230-09) |
| 42 | Manual UI smoke (`pnpm tauri dev`) | **NOT PERFORMED** | Optional; e2e dead per ADR 0019. Acceptable risk per Sprint 226-229 precedent. |

## Per-AC Coverage Spot-Check

### AC-230-01 — New Tauri command + struct (deep-read)
- **PASS**. Verified at:
  - `src-tauri/src/lib.rs:161` — `commands::rdb::schema::list_postgres_types,` registered in `tauri::generate_handler!`.
  - `src-tauri/src/commands/rdb/schema.rs:225-235` — `#[tauri::command] pub async fn list_postgres_types(state, connection_id) -> Result<Vec<PostgresTypeInfo>, AppError>`. Uses `state.active_connections.lock().await` + `as_rdb()?` + `list_types().await` (read-only, no cancel-token, matches `list_views`/`list_functions`).
  - `src-tauri/src/models/schema.rs:267-271` — `pub struct PostgresTypeInfo { pub schema: String, pub name: String, pub type_kind: String }` with `#[derive(Debug, Clone, Serialize, Deserialize)]`.
  - `cargo build` exit 0 confirms compile-time registration.

### AC-230-02 — PG SQL filters (deep-read)
- **PASS**. `LIST_TYPES_SQL` const at `src-tauri/src/db/postgres/schema.rs:44-61` contains all required clauses:
  - `FROM pg_catalog.pg_type t` (line 52) ✓
  - `JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace` (line 53) ✓
  - `WHERE t.typtype IN ('b', 'd', 'e', 'r', 'c')` (line 54) ✓
  - `AND t.typname NOT LIKE '\\_%' ESCAPE '\\'` (line 55) — array element type filter ✓
  - `AND n.nspname NOT IN ('pg_toast')` (line 56) ✓
  - `AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c WHERE c.reltype = t.oid)` (lines 57-60) — auto row type filter ✓
  - `ORDER BY n.nspname, t.typname` (line 61) ✓
- Drift gate `list_types_sql_matches_canonical_fixture` at `schema.rs:888-920` does both `assert_eq!` byte-comparison and 8 substring spot-checks. PASS verified.

### AC-230-05 — Hook behavior (deep-read)
- **PASS**. `src/hooks/usePostgresTypes.ts`:
  - **Cache shape**: `Map<string, CacheEntry>` at line 60. Entry = `{ types, raw, error, inFlight, fetchedAt }` (lines 44-55). Module-level (not zustand) per Decisions §1. ✓
  - **In-flight sharing**: `fetchTypes` at line 123 returns `existing.inFlight` if present (lines 124-127); concurrent calls share one Promise. Verified by test case at `usePostgresTypes.test.ts:263-284`.
  - **Stale connectionId guard**: `latestConnectionIdRef` at line 168 + comparison at lines 192, 204. Verified by `stale connectionId` test at `usePostgresTypes.test.ts:218-259`.
  - **Loading-canonical-first**: lines 217-235 return `[...POSTGRES_COMMON_TYPES]` while `inFlight !== null` or no cached entry yet.
  - **Error fallback**: lines 144-152 set `entry.types = [...POSTGRES_COMMON_TYPES]` + `entry.error = message`. NOT a silent catch (documented load-bearing recovery, line 145-147).
  - **5+ vitest cases**: 12 cases in `usePostgresTypes.test.ts` (mount fetch, merge order, error fallback, reload, cache hit, label rule, empty result, dup name, stale connectionId, concurrent share, cache invalidation, defensive drop).

### AC-230-06 — `typesSource` prop default (deep-read)
- **PASS**. `src/components/schema/CreateTableTypeCombobox.tsx:48` — `typesSource?: readonly string[]` (optional, no default value). Branch at line 70-73:
  ```ts
  typesSource ? filterPostgresTypesAgainst(typesSource, value) : filterPostgresTypes(value)
  ```
  When `undefined`, falsy branch → canonical fallback path. Sprint 227 baseline 12 cases pass byte-for-byte (verified by Check 2 → 16 = 12 + 4).

### AC-230-07 — `filterPostgresTypesAgainst` parity (deep-read)
- **PASS**. `src/lib/sql/postgresTypes.ts:84-91`:
  ```ts
  export function filterPostgresTypesAgainst(list, query) {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return [...list];
    return list.filter((t) => t.toLowerCase().includes(q));
  }
  ```
  Mirrors `filterPostgresTypes` semantics (lines 49-53) byte-for-byte except the `list` parameter substitutes for the canonical const. Both use `q.trim().toLowerCase()` + `includes()` — confirmed AC-227-03 case-insensitive substring contract preserved.

### AC-230-08 — Dialog wires hook (deep-read)
- **PASS**. `src/components/schema/CreateTableDialog.tsx`:
  - Line 12: `import { usePostgresTypes } from "@hooks/usePostgresTypes";` ✓
  - Line 363: `const { types: pgTypes } = usePostgresTypes(connectionId);` ✓
  - Line 944: `<CreateTableTypeCombobox typesSource={pgTypes} ... />` ✓
- Vitest case at `CreateTableDialog.test.tsx:2271-2282` asserts `mockListPostgresTypes` called once with `"conn-1"` after mount.

## Top 3 Concerns

### P3 — Manual UI smoke not performed
- **Severity**: P3 (informational, acceptable per ADR 0019 / Sprint 226-229 precedent).
- **Risk**: Live PG connection with PostGIS is not exercised end-to-end. The mock-based test surface verifies the wire shape and merge behavior but not the actual `sqlx` execution against a live `pg_catalog`.
- **Mitigation**: The `LIST_TYPES_SQL` const is byte-for-byte verified against the canonical filter set at `cargo test list_types`. The runtime executes the same byte string. Risk surfaces only if PG returns unexpected rows for a future PG major version; the trait default + `unwrap_or_else("base")` mapper at `schema.rs:541` handles unknown `typtype` gracefully.
- **Action**: Document manual test in `findings.md`. Defer to Sprint 231 if a tester is available.

### P3 — `usePostgresTypes` returns new array reference per render
- **Severity**: P3 (documented in `findings.md` §5 — known minor cost).
- **Risk**: `[...POSTGRES_COMMON_TYPES]` fallback (lines 219, 231, 238) creates a new array every render. The combobox `useMemo` at `CreateTableTypeCombobox.tsx:68-74` has `typesSource` in deps → recomputes filter every dialog render. Cost is negligible (filter over ≤ 500 strings) but technically excessive.
- **Mitigation**: Documented in residual risks. Sprint 231 polish could memoize the fallback at module load (single shared frozen reference).
- **Action**: No required action. Note for Sprint 231.

### P3 — `reload()` immediately bumps version state without StrictMode protection
- **Severity**: P3 (correct under React 18 batching, but worth noting).
- **Risk**: `reload()` at `usePostgresTypes.ts:201-211` calls `setVersion((v) => v + 1)` twice (once after `then()` resolves, once unconditionally in the same callback at line 210). Under React StrictMode, the dual-mount + double-effect-call might surface unexpected fetch counts.
- **Mitigation**: Test case `reload() refetches and updates cache` at `usePostgresTypes.test.ts:125-143` passes — `mockListPostgresTypes` called exactly twice (initial + reload), not four times.
- **Action**: No action required. The behavior is correct.

## Feedback for Generator

None — sprint passes all required checks with concrete evidence. Optional polish suggestions for Sprint 231:

1. **(Optional)** Memoize the canonical fallback reference at module load so `pgTypes` returns a stable identity when no fetch has resolved. Reduces re-render churn in the combobox `useMemo`.
2. **(Optional)** Wire `invalidatePostgresTypesCache(connectionId)` into `connectionStore.disconnect` lifecycle in Sprint 231 (requires Sprint 224 freeze relaxation).
3. **(Optional)** Surface `type_kind` for Sprint 231 type-coloring via an additive accessor on the hook (e.g. `rawByLabel: Map<string, "base"|"domain"|"enum"|"range"|"composite">`). Existing `types: string[]` consumers stay unchanged.

## Regression Verification (Frozen Files)

All 13 freeze invariants verified zero-diff:

- `useDdlPreviewExecution.ts` ✓ (Sprint 214)
- `SqlPreviewDialog.tsx` ✓ (Sprint 227)
- Cross-window test suite ✓
- `connectionStore.ts` / `schemaStore.ts` ✓ (Sprint 224)
- `tauri/ddl.ts` ✓ / `tauri/index.ts` ✓
- `Header.tsx` / `IndexesTabBody.tsx` / `ForeignKeysTabBody.tsx` ✓ (Sprint 227-229)
- `useFkReferencePicker.ts` ✓ (Sprint 229)
- `components/ui/` ✓ (no new shadcn)
- `mutations.rs` body unchanged ✓ (Sprint 226-229 backend fixtures byte-equivalent)
- `postgresTypes.ts` additive-only ✓ (`grep "^-"` returns 0 lines)

## Backend SQL Builder Fixture Verification

Two-layer drift gate at `src-tauri/src/db/postgres/schema.rs:888-920`:
1. `assert_eq!(LIST_TYPES_SQL, EXPECTED)` — byte-for-byte equality.
2. 8 substring assertions covering each canonical filter clause.

`cargo test list_types` PASS (2/2). The test names are `list_types_sql_matches_canonical_fixture` (synchronous, fixture compare) and `list_types_without_connection_fails` (async, runtime no-pool failure path).

## Frontend Hook Contract Verification

- **Loading-canonical-first**: ✓ Lines 217-235 of `usePostgresTypes.ts`. `types: [...POSTGRES_COMMON_TYPES]` returned synchronously while `inFlight !== null` or no cached entry.
- **Silent merge replace**: ✓ `setVersion((v) => v + 1)` at line 193 fires only after the fetch settles; consumers see the new merged list without an intermediate flash.
- **Error fallback**: ✓ Lines 144-152 set `error` non-null + `types = canonical` simultaneously.
- **Module-memo cache**: ✓ Map<string, CacheEntry> at line 60. Hook reads it synchronously at render-time (line 216).
- **Concurrent share**: ✓ Lines 124-127 return `existing.inFlight` if present.
- **Stale connectionId drop**: ✓ Lines 192, 204 — `latestConnectionIdRef.current !== connectionId` early-returns without `setVersion`.

## `typesSource` Prop Back-Compat Verification

- Default `undefined` → falsy branch → canonical-list path verified at `CreateTableTypeCombobox.tsx:70-73`.
- Sprint 227 baseline 12 carry-over cases pass byte-for-byte (Check 2 → 16 total = 12 baseline + 4 Sprint 230 new).
- AC-227-03 substring filter (`int` → `integer/bigint/smallint/interval`) verified in baseline test at `CreateTableTypeCombobox.test.tsx:43-62`.

## Decisions Confirmation

All Generator decisions match the contract:
- ✓ Cache layer = module memo (NOT zustand). Justified in `usePostgresTypes.ts:14-31` doc-comment.
- ✓ Wrapper file = `schema.ts` (NOT `ddl.ts`). Verified via `git diff --stat src/lib/tauri/ddl.ts` = 0.
- ✓ `typesSource` default = `undefined` → canonical path. Verified via Sprint 227 carry-over passing.
- ✓ Display label rule = `pg_catalog.X → X`; non-`pg_catalog` qualified. Verified via test case `display label rule (AC-230-06)`.
- ✓ PG SQL const location = module-level `LIST_TYPES_SQL` in `schema.rs:44`. Both runtime + test cite the same string.
- ✓ `reload()` semantics = invalidate cache + refetch + immediate version bump (loading=true visible). Verified via `reload() refetches` test case.

## Summary

Sprint 230 implementation is production-ready. All 41 required verification checks pass, all 13 ACs covered with concrete file:line evidence, all 13 freeze invariants verified zero-diff. TDD evidence credible. Test cases exercise behavior end-to-end (cache hit, stale guard, error fallback, concurrent share, defensive drop, parametric expansion parity). Score 9.25/10. **Ready to commit: YES.**
