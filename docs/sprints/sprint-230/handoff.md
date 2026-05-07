# Sprint 230 — Handoff

Sprint: `sprint-230` (feature — dynamic Postgres type list).
Date: 2026-05-07.
Status: Generator complete.
Type: feature (Phase 27 sprint 5).

## Generator Handoff

### Changed Files

#### Backend (Rust)

| 파일 | LOC delta | Purpose |
|------|-----------|---------|
| **MOD** `src-tauri/src/models/schema.rs` | +18 | New `pub struct PostgresTypeInfo { pub schema: String, pub name: String, pub type_kind: String }` (`#[derive(Debug, Clone, Serialize, Deserialize)]`). `type_kind` is the closed whitelist `"base" \| "domain" \| "enum" \| "range" \| "composite"` — the SQL `CASE` expression maps PG `pg_type.typtype` accordingly. |
| **MOD** `src-tauri/src/models/mod.rs` | +1 | Re-export `PostgresTypeInfo` alongside the other schema types. |
| **MOD** `src-tauri/src/db/postgres/schema.rs` | +97 | (a) Module-level `pub(crate) const LIST_TYPES_SQL: &str` capturing the canonical PG SQL byte-string (`pg_catalog.pg_type ⨝ pg_catalog.pg_namespace`, `typtype IN ('b','d','e','r','c')`, `typname NOT LIKE '\_%' ESCAPE '\'`, `nspname NOT IN ('pg_toast')`, `NOT EXISTS pg_class.reltype`, `ORDER BY n.nspname, t.typname`). (b) New inherent method `pub async fn list_types(&self) -> Result<Vec<PostgresTypeInfo>, AppError>` — runs `sqlx::query_as(LIST_TYPES_SQL)` against `self.active_pool().await?`, maps rows → `PostgresTypeInfo`. (c) Two new unit tests: `list_types_sql_matches_canonical_fixture` (asserts the const byte-equivalent + spot-checks the canonical filter substrings — drift gate) and `list_types_without_connection_fails` (asserts graceful "Not connected" propagation). |
| **MOD** `src-tauri/src/db/traits.rs` | +12 | Add new `RdbAdapter::list_types` trait method with default `Err(AppError::Unsupported(...))` impl. Keeps non-PG adapters compiling without changes (Phase 17+ adapters fill in their dialect-specific impl later). |
| **MOD** `src-tauri/src/db/postgres.rs` | +9 | Override `RdbAdapter::list_types` for `PostgresAdapter` — delegates to the inherent `self.list_types().await`. Pattern matches the surrounding `list_views` / `list_functions` overrides. |
| **MOD** `src-tauri/src/commands/rdb/schema.rs` | +20 | New `#[tauri::command] pub async fn list_postgres_types(state, connection_id) -> Result<Vec<PostgresTypeInfo>, AppError>` — resolves the connection via `state.active_connections.lock().await` + `as_rdb()?`, dispatches `list_types().await`. Read-only — no cancel-token (small payload, < 100 ms expected). Pattern matches `list_views` / `list_functions`. |
| **MOD** `src-tauri/src/lib.rs` | +1 | Register `commands::rdb::schema::list_postgres_types` in `tauri::generate_handler!`. |

#### Frontend (TS / React)

| 파일 | LOC delta | Purpose |
|------|-----------|---------|
| **MOD** `src/types/schema.ts` | +21 | New `PostgresTypeInfo` interface (`schema`, `name`, `type_kind` — snake_case `type_kind` mirrors Rust serde default). |
| **MOD** `src/lib/tauri/schema.ts` | +21 | New `export async function listPostgresTypes(connectionId)` — thin `invoke<PostgresTypeInfo[]>` wrapper, **lives in `schema.ts` (NOT `ddl.ts`)** per contract Decisions §2. The barrel `src/lib/tauri/index.ts` already re-exports `./schema`, so call sites get the wrapper via `tauri.listPostgresTypes(connectionId)` with no barrel diff. |
| **MOD** `src/lib/sql/postgresTypes.ts` | +18 | New `export function filterPostgresTypesAgainst(list, query)` — additive helper (case-insensitive substring filter against an arbitrary list). Existing exports (`POSTGRES_COMMON_TYPES`, `filterPostgresTypes`, `PARAMETRIC_TYPE_DEFAULTS`, `expandParametricDefault`) byte-equivalent — `git diff postgresTypes.ts \| grep "^-" \| grep -v "^---"` outputs 0 lines. |
| **NEW** `src/hooks/usePostgresTypes.ts` | +198 | New hook — module-level `Map<connectionId, CacheEntry>` memo, in-flight Promise sharing (concurrent mounts collapse to one fetch), stale-connectionId guard via `latestConnectionIdRef`, error fallback (canonical list + non-null `error` string surfaced). Display label rule: `pg_catalog.X` strips to `X`; non-`pg_catalog` schemas keep the `<schema>.<name>` form. Free helper `invalidatePostgresTypesCache(connectionId)` exported alongside for Sprint 231 wiring. `reload()` punches the cache + refetches. |
| **NEW** `src/hooks/usePostgresTypes.test.ts` | +275 | Vitest suite with 12 cases covering AC-230-05 (mount fetch / merge order / error fallback / reload / cache hit), AC-230-06 (label rule), AC-230-11 (cache invalidation), and contract edge cases (empty result, duplicate name, stale connectionId, concurrent share, defensive empty-name / pg_toast drop). |
| **MOD** `src/components/schema/CreateTableTypeCombobox.tsx` | +14 | Optional prop `typesSource?: readonly string[]` added to `CreateTableTypeComboboxProps` + branch in `useMemo`: when supplied, `filterPostgresTypesAgainst(typesSource, value)`; when omitted, `filterPostgresTypes(value)` (Sprint 227 baseline). All Sprint 227 carry-over tests pass byte-for-byte unchanged because `typesSource` defaults to `undefined`. |
| **MOD** `src/components/schema/CreateTableTypeCombobox.test.tsx` | +96 | New `describe("CreateTableTypeCombobox (Sprint 230 — typesSource prop)")` block with 4 cases — dynamic-source filter, back-compat fallback, parametric expansion parity (AC-230-09), non-parametric verbatim commit. Sprint 227 baseline 12 cases unchanged. |
| **MOD** `src/components/schema/CreateTableDialog.tsx` | +9 | (a) Import `usePostgresTypes` from `@hooks/usePostgresTypes`. (b) Single-line hook invocation `const { types: pgTypes } = usePostgresTypes(connectionId);` next to `useFkReferencePicker(connectionId)`. (c) Pass `typesSource={pgTypes}` to the per-row `<CreateTableTypeCombobox>` invocation inside the column repeater. No other dialog logic changes. |
| **MOD** `src/components/schema/CreateTableDialog.test.tsx` | +110 | (a) Extend `vi.hoisted` mock surface with `mockListPostgresTypes` (default returns `[]`). (b) New `describe("Sprint 230 — CreateTableDialog wires dynamic PG type list")` block with 3 cases — mount-fetch (AC-230-08), merged-suggestions (AC-230-08), loading-canonical-first (AC-230-10). All Sprint 226+227+228+229 carry-over cases unchanged (52 → 55 total). |

#### Docs

| 파일 | Purpose |
|------|---------|
| **MOD** `docs/PLAN.md` | Row 5 → Sprint 230 ✓; row 6 (TBD) seeded with the Sprint 231 polish list (6 items: reorder / table COMMENT / schema picker move / type coloring / cross-tab visual / `invalidatePostgresTypesCache` wire). |
| **NEW** `docs/sprints/sprint-230/handoff.md` | This file. |
| **NEW** `docs/sprints/sprint-230/findings.md` | Decisions + tradeoffs + residual risks. |
| **NEW** `docs/sprints/sprint-230/tdd-evidence/red-state.log` | TDD red-state evidence — vitest cases authored before implementation; pre-impl logs captured. |

총: 6 backend MOD + 3 frontend MOD + 1 hook NEW + 1 hook test NEW + 1 type MOD + 2 frontend test MOD + 4 docs.

### Checks Run

| # | Check | Result |
|---|-------|--------|
| 1 | `pnpm vitest run src/components/schema/CreateTableDialog.test.tsx` | **PASS** — 55/55 (Sprint 229 baseline 52 + 3 new) |
| 2 | `pnpm vitest run src/components/schema/CreateTableTypeCombobox.test.tsx` | **PASS** — 16/16 (Sprint 227 baseline 12 + 4 new) |
| 3 | `pnpm vitest run src/hooks/usePostgresTypes.test.ts` | **PASS** — 12/12 (≥ 5 contract minimum) |
| 4 | `pnpm vitest run` | **PASS** — 219 files / 2838 tests (Sprint 229 baseline 218 / 2819; Sprint 230 +1 file + 19 cases) |
| 5 | `pnpm tsc --noEmit` | **PASS** — exit 0 |
| 6 | `pnpm lint` | **PASS** — exit 0 |
| 7 | `cargo build --manifest-path src-tauri/Cargo.toml` | **PASS** — exit 0 |
| 8 | `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` | **PASS** — exit 0 |
| 9 | `cargo test --manifest-path src-tauri/Cargo.toml create_table` | **PASS** — 16/16 (Sprint 226+227 fixtures intact) |
| 10 | `cargo test --manifest-path src-tauri/Cargo.toml create_index` | **PASS** — 11/11 (Sprint 228 fixtures intact) |
| 11 | `cargo test --manifest-path src-tauri/Cargo.toml add_constraint` | **PASS** — 12/12 (Sprint 229 fixtures intact) |
| 12 | `cargo test --manifest-path src-tauri/Cargo.toml list_types` | **PASS** — 2/2 (`list_types_sql_matches_canonical_fixture` + `list_types_without_connection_fails`) |
| 13 | `git diff --stat src/components/structure/useDdlPreviewExecution.ts` | **= 0** ✓ (Sprint 214 freeze) |
| 14 | `git diff --stat src/components/structure/SqlPreviewDialog.tsx` | **= 0** ✓ (Sprint 227 freeze) |
| 15 | `git diff --stat src/__tests__/cross-window-*.test.tsx src/__tests__/window-lifecycle.ac141.test.tsx` | **= 0** ✓ |
| 16 | `git diff --stat src/stores/connectionStore.ts src/stores/schemaStore.ts` | **= 0** ✓ |
| 17 | `git diff src/lib/sql/postgresTypes.ts \| grep "^-" \| grep -v "^---"` | **= 0** lines ✓ (additive-only) |
| 18 | `git diff --stat src/lib/tauri/ddl.ts` | **= 0** ✓ |
| 19 | `git diff --stat src/lib/tauri/index.ts` | **= 0** ✓ (barrel re-exports `./schema`) |
| 20 | `git diff --stat src/components/schema/CreateTableDialog/{Header,IndexesTabBody,ForeignKeysTabBody}.tsx` | **= 0** ✓ |
| 21 | `git diff --stat src/hooks/useFkReferencePicker.ts` | **= 0** ✓ |
| 22 | `git diff --stat src/components/ui/` | **= 0** ✓ |
| 23 | `grep -n 'list_postgres_types' src-tauri/src/lib.rs` | **= 1 hit** (line 161) ✓ |
| 24 | `grep -n 'pub async fn list_postgres_types' src-tauri/src/commands/rdb/schema.rs` | **= 1 hit** (line 226) ✓ |
| 25 | `grep -nE 'pg_type\|pg_namespace' src-tauri/src/db/postgres/schema.rs` | **≥ 2 hits** (52, 53, plus Sprint 230 fixture) ✓ |
| 26 | `grep -n 'fn list_types' src-tauri/src/db/traits.rs` | **= 1 hit** (line 292) ✓ |
| 27 | `grep -n 'fn list_types' src-tauri/src/db/postgres.rs` | **= 1 hit** (line 356) ✓ |
| 28 | `grep -n 'export async function listPostgresTypes' src/lib/tauri/schema.ts` | **= 1 hit** (line 137) ✓ |
| 29 | `grep -n 'usePostgresTypes' src/components/schema/CreateTableDialog.tsx` | **= 2 hits** (import + invocation) ✓ |
| 30 | `grep -n 'typesSource' src/components/schema/CreateTableTypeCombobox.tsx` | **≥ 1 hit** (5 across prop type, destructure, useMemo branch) ✓ |
| 31 | `grep -n 'filterPostgresTypesAgainst' src/lib/sql/postgresTypes.ts` | **= 1 hit** (line 84) ✓ |
| 32 | `grep -n 'export function usePostgresTypes' src/hooks/usePostgresTypes.ts` | **= 1 hit** (line 163) ✓ |
| 33 | `grep -n 'invalidatePostgresTypesCache' src/hooks/usePostgresTypes.ts` | **≥ 1 hit** (line 69 — `export function`) ✓ |
| 34 | `grep -nE 'it\.only\|it\.skip\|describe\.skip\|xit\|it\.todo' …` | **= 0** ✓ |
| 35 | `git diff src/ src-tauri/ \| grep "^+.*eslint-disable"` | **= 0** ✓ |
| 36 | `git diff src/ \| grep -E "^\+.*\bany\b"` | **= 0** ✓ |
| 37 | `grep -rnE 'createCollection\|create_collection' src/lib/tauri/ src-tauri/src/commands/document/` | **= 0** ✓ (Mongo path untouched) |
| 38 | Vitest case asserts canonical-list head order preserved in merge | **PASS** — `success merge preserves canonical order at the head + appends non-duplicate live entries (AC-230-05 b)` (`usePostgresTypes.test.ts`) |
| 39 | Vitest case asserts error-path fallback to canonical + `error` non-null | **PASS** — `fetch error surfaces error + falls back to canonical + loading false (AC-230-05 c)` |
| 40 | Vitest case asserts `pg_catalog.varchar → varchar` label + `public.my_enum` qualified | **PASS** — `display label rule — pg_catalog.X strips to X; <schema>.<name> for non-pg_catalog (AC-230-06)` |
| 41 | Vitest case asserts `expandParametricDefault` works with dynamic list | **PASS** — `parametric default expansion intact when canonical bare 'varchar' is in the dynamic list (AC-230-09)` (`CreateTableTypeCombobox.test.tsx`) |
| 42 | Manual UI smoke (`pnpm tauri dev`) | **NOT PERFORMED** — optional; e2e dead per ADR 0019 / lefthook 5_e2e skip:true since 2026-05-01. |

### Done Criteria Coverage (AC-230-01..13)

| AC | Evidence |
|----|----------|
| **AC-230-01** Tauri command registered + invokable | `grep -n 'list_postgres_types' src-tauri/src/lib.rs` = 1 hit (line 161 inside `tauri::generate_handler!`); `pub async fn list_postgres_types(state, connection_id)` defined at `src-tauri/src/commands/rdb/schema.rs:226`; `cargo build` exit 0. |
| **AC-230-02** PG SQL canonical filter set | `LIST_TYPES_SQL` const at `src-tauri/src/db/postgres/schema.rs:52` contains `pg_catalog.pg_type t`, `pg_catalog.pg_namespace n ON n.oid = t.typnamespace`, `t.typtype IN ('b', 'd', 'e', 'r', 'c')`, `t.typname NOT LIKE '\\_%' ESCAPE '\\'`, `n.nspname NOT IN ('pg_toast')`, `NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c WHERE c.reltype = t.oid)`, `ORDER BY n.nspname, t.typname`. Rust unit test `list_types_sql_matches_canonical_fixture` asserts byte-for-byte. |
| **AC-230-03** `RdbAdapter::list_types` default `Unsupported` + PG override | `src-tauri/src/db/traits.rs:292` adds `fn list_types` with default returning `Err(AppError::Unsupported("This adapter does not list types"))`. `src-tauri/src/db/postgres.rs:356` overrides for `PostgresAdapter`, delegating to inherent `self.list_types().await`. `cargo clippy -D warnings` exit 0 (no other adapter broken). |
| **AC-230-04** Wrapper `tauri.listPostgresTypes` in `schema.ts` | `src/lib/tauri/schema.ts:137` exports `listPostgresTypes(connectionId)`. `git diff --stat src/lib/tauri/ddl.ts` = 0 (NOT in ddl.ts). `git diff --stat src/lib/tauri/index.ts` = 0 (barrel re-exports `./schema` already). `pnpm tsc --noEmit` exit 0. |
| **AC-230-05** Hook contract | 12 vitest cases in `src/hooks/usePostgresTypes.test.ts`, ≥ 5 contract minimum. (a) mount-triggers-fetch case asserts `mockListPostgresTypes` called once with `connectionId`. (b) merge-order case asserts canonical entries occupy positions 0..N-1, then live extras tail. (c) error-fallback case asserts `error` non-null + `types` = canonical. (d) reload case asserts mock called twice + new types observed. (e) cache-hit case asserts mock called once across two mounts on same connectionId. |
| **AC-230-06** Display label rule | `display label rule — pg_catalog.X strips to X; <schema>.<name> for non-pg_catalog (AC-230-06)` case in `usePostgresTypes.test.ts`. Hook helper `toLabel(info)` strips `pg_catalog`, qualifies others, and rejects `pg_toast` / empty-name entries (defense-in-depth). |
| **AC-230-07** Combobox `typesSource?: string[]` prop | `CreateTableTypeComboboxProps.typesSource?: readonly string[]` at `src/components/schema/CreateTableTypeCombobox.tsx:48`. `useMemo` branch at line 70: `typesSource ? filterPostgresTypesAgainst(typesSource, value) : filterPostgresTypes(value)`. 4 vitest cases under `Sprint 230 — typesSource prop` describe. `filterPostgresTypesAgainst` exported from `src/lib/sql/postgresTypes.ts:84`. |
| **AC-230-08** Dialog wires `usePostgresTypes` → `typesSource` | `usePostgresTypes` imported at `src/components/schema/CreateTableDialog.tsx:12`, invoked at line 363. `typesSource={pgTypes}` passed to `<CreateTableTypeCombobox>` inside the column repeater. 2 vitest cases (mount-fetch + merged-suggestions) under `Sprint 230 — CreateTableDialog wires dynamic PG type list` describe. |
| **AC-230-09** Filter / expand parity with dynamic list | `parametric default expansion intact when canonical bare 'varchar' is in the dynamic list (AC-230-09)` case in `CreateTableTypeCombobox.test.tsx` — `typesSource={["varchar","varchar(255)","geometry","public.my_enum"]}` + Enter on `varchar` row triggers `onChange("varchar(255)")`. AC-227-03 case-insensitive substring (`int` → `integer/bigint/smallint/interval`) preserved by Sprint 227 baseline carry-over (`typing 'int' filters to integer/bigint/smallint/interval (case-insensitive substring)` case). |
| **AC-230-10** Loading UX — canonical instant + silent merge replace | `loading-canonical-first — combobox shows canonical entries instantly with no spinner (AC-230-10)` case in `CreateTableDialog.test.tsx` — defers the `mockListPostgresTypes` Promise, asserts `varchar` / `uuid` appear in the listbox immediately on focus + no `role="status"` element inside the combobox subtree. Hook implementation at `usePostgresTypes.ts:175-187` returns canonical list while `inFlight !== null`. |
| **AC-230-11** `invalidatePostgresTypesCache` exposed | Free function exported from `src/hooks/usePostgresTypes.ts:69`. `invalidatePostgresTypesCache(connectionId) — fresh fetch on next mount (AC-230-11)` vitest case asserts cache punch + remount triggers fresh `listPostgresTypes` call. `reload()` callback calls the same helper internally then refetches. |
| **AC-230-12** No regression | All Sprint 226+227+228+229 vitest carry-over cases pass byte-for-byte (Sprint 229 baseline 218 files / 2819 tests → Sprint 230 219 / 2838; only additions). `cargo test create_table create_index add_constraint` PASS unchanged (16/11/12). `git diff src/lib/sql/postgresTypes.ts \| grep "^-"` = 0 lines (additive-only). `git diff --stat` = 0 for every freeze invariant (see Checks 13-22). |
| **AC-230-13** Test coverage targets | 1 Rust SQL fixture (`list_types_sql_matches_canonical_fixture`). 12 vitest cases in `usePostgresTypes.test.ts` (≥ 5). 4 vitest cases in `CreateTableTypeCombobox.test.tsx` Sprint 230 describe (≥ 2). 3 vitest cases in `CreateTableDialog.test.tsx` Sprint 230 describe (≥ 1). Total new cases = 19 frontend + 2 Rust. |

### Decisions

- **Cache layer**: module-level `Map<connectionId, CacheEntry>` memo in `src/hooks/usePostgresTypes.ts`. NOT zustand. Justification (contract Decisions §1): data is small (~200-500 strings per connection), pure-derived from PG state (no cross-window sync), `schemaStore.ts` body is a Sprint 224 frozen invariant. The free helper `invalidatePostgresTypesCache(connectionId)` gives Sprint 231 the single hook point it needs.
- **Wrapper file location**: `src/lib/tauri/schema.ts`. NOT `ddl.ts` (mutations only) and NOT a new `types.ts` (one wrapper doesn't justify a new domain file). Pattern matches `listSchemas` / `listTables` / `getTableColumns`.
- **`typesSource` prop default**: `undefined` → canonical-list path. Existing combobox tests using the static list pass byte-for-byte.
- **Display label rule**: `pg_catalog.X` → `X` (strip prefix); non-`pg_catalog` keep `<schema>.<name>`. Defense-in-depth — `pg_toast` and empty-name entries dropped before merge (backend should never emit these but the hook double-checks).
- **PG SQL constant location**: `pub(crate) const LIST_TYPES_SQL: &str` in `src-tauri/src/db/postgres/schema.rs`. Both runtime and test cite the same const — drift is caught by `cargo test list_types`.
- **`reload()` semantics**: calls `invalidatePostgresTypesCache(connectionId)` then refetches. Bumps the version state immediately so consumers observe `loading=true` while the refetch runs (cached merged list stays visible — silent replace UX).
- **Merge order**: canonical first (preserves `expandParametricDefault` semantics — bare `varchar` / `char` / `numeric` are guaranteed-present in the merged head), then non-duplicate live extras at the tail. Case-sensitive `Set` dedup.
- **Concurrency contract**: in-flight Promise stored in cache entry; concurrent mounts on the same connectionId share one fetch (mock invocation count = 1 verified). Stale-connectionId guard via `latestConnectionIdRef.current` compare drops late resolutions when the parent re-renders with a different id.

### Edge Cases Tested

- **connection-not-found error** — mock rejects with `"Connection 'conn-error' not found"`. Hook surfaces the error string and falls back to canonical. Combobox stays usable.
- **empty result** — mock resolves `[]`. Merged list = canonical exactly.
- **duplicate name** — mock returns `[{schema:"pg_catalog",name:"varchar",...}]`. Merged list contains `varchar` exactly once (canonical entry preserved; live duplicate dropped via `Set` dedup).
- **stale connectionId concurrency** — hook re-renders with `conn2` mid-flight; original `conn1` Promise resolves last. Drops the stale response (no state mutation visible for `conn2`).
- **concurrent share** — two `renderHook` mounts on `conn-1` while a fetch is in flight → `mockListPostgresTypes` invoked once.
- **parametric expansion intact** — `typesSource={["varchar","varchar(255)",...]}` + Enter on `varchar` row → `onChange("varchar(255)")`.
- **defensive drop** — `pg_toast.pg_toast_1234` and empty-name entries filtered out before merge.

### Assumptions

1. **Hook reuse, not bypass**: `useDdlPreviewExecution.ts` body unchanged. `git diff --stat` = 0 verified.
2. **`SqlPreviewDialog` body unchanged**: Sprint 227 already removed the import; `git diff --stat` = 0 verified.
3. **`tauri.ddl.ts` body unchanged**: new wrapper goes in `schema.ts` per contract Decisions §2. `git diff --stat src/lib/tauri/ddl.ts` = 0 verified.
4. **`tauri.index.ts` body unchanged**: barrel already re-exports `./schema`, so the new wrapper is auto-exported. `git diff --stat src/lib/tauri/index.ts` = 0 verified.
5. **`schemaStore.ts` body unchanged**: cache lives in module memo, NOT a zustand slice. `git diff --stat src/stores/schemaStore.ts` = 0 verified.
6. **Sprint 226+227+228+229 vitest assertion text frozen**: no changes to existing case names or assertion strings. The new Sprint 230 describe block is appended; the new mock surface (`mockListPostgresTypes`) defaults to `[]` so non-Sprint-230 cases see canonical-only merged list (= canonical exactly).
7. **Combobox API back-compat**: `typesSource?: readonly string[]` is optional with `undefined` default semantics. All Sprint 227 carry-over combobox tests (12 cases) pass byte-for-byte.
8. **Backend trait extension is additive**: every other adapter (Mongo, future MySQL/SQLite) inherits the default `Unsupported` impl and continues to compile without code changes.
9. **PG SQL `\_` ESCAPE syntax**: verified against PG 14+. The string literal `'\_%'` paired with `ESCAPE '\'` correctly interprets `\_` as a literal underscore (so the `LIKE` predicate matches typenames starting with literal `_`, i.e. PG's array-type convention).

### Residual Risk

- **Manual UI smoke not performed.** `pnpm tauri dev` smoke deferred (e2e dead since 2026-05-01). Same risk as Sprints 226–229.
- **Cache stale on disconnect.** `invalidatePostgresTypesCache(connectionId)` is exported but NOT wired into `connectionStore.disconnect` (would require a store body diff — Sprint 224 frozen invariant). Sprint 231 polish item (f) covers this. Worst case: a user installs PostGIS mid-session and the new `geometry` type only appears after the user clicks `Refresh types` (Sprint 231 button) or restarts the app.
- **Parent dialog `pgTypes` cycling**: `usePostgresTypes` returns a new array reference on each render via the `[...POSTGRES_COMMON_TYPES]` fallback path. This causes the combobox `useMemo` to recompute every render in the dialog. The cost is negligible (filter over ≤ 500 strings) but a future polish could memoize the fallback at module load.
- **`typesSource` prop type is `readonly string[]`**: existing callers passing `string[]` work via TypeScript's covariance — no breakage observed during type-check.
- **No `reload` UI surface**: the hook exposes `reload` but the dialog doesn't render a button. Sprint 231 may add a "Refresh types" button next to the schema picker (covered by polish item (a)).

## Required checks (재현)

```sh
pnpm vitest run src/hooks/usePostgresTypes.test.ts
pnpm vitest run src/components/schema/CreateTableTypeCombobox.test.tsx
pnpm vitest run src/components/schema/CreateTableDialog.test.tsx
pnpm vitest run
pnpm tsc --noEmit
pnpm lint
cargo build --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml create_table
cargo test --manifest-path src-tauri/Cargo.toml create_index
cargo test --manifest-path src-tauri/Cargo.toml add_constraint
cargo test --manifest-path src-tauri/Cargo.toml list_types
```

기대값: 모두 zero error. 자세한 결과는 위 표 참조.

## 다음 sprint 가 알아야 할 것

### Sprint 231 (UX 종합 polish)

- Reorder ↑/↓ buttons (column / index / FK / CHECK / UNIQUE rows).
- Table-level `COMMENT ON TABLE`.
- Schema picker position move (header → form section).
- Type combobox color coding — consume the `type_kind` field that Sprint 230 already surfaces in `PostgresTypeInfo`. The hook currently merges only the `string` label; Sprint 231 needs the raw list. Consider extending the hook return surface with a `rawByLabel: Map<string, "base"|"domain"|"enum"|"range"|"composite">` accessor (additive — existing `types: string[]` consumers stay unchanged).
- Cross-tab visual feedback / empty column-name handling.
- Wire `invalidatePostgresTypesCache(connectionId)` into `connectionStore.disconnect` lifecycle. Will need a store body diff (Sprint 224 freeze relaxation). Alternatively add a `useCleanupOnDisconnect` listener in `App.tsx`.

### Notes for Sprint 232+

- `DEFERRABLE / INITIALLY DEFERRED` for FK — deferred to Sprint 232+.
- MySQL / MariaDB / SQLite / Oracle adapters — Phase 17+. The trait default `Unsupported` keeps non-PG adapters compiling without code change; their `list_types` overrides will need to query each dialect's catalog (`information_schema.user_defined_types` etc.).

## Refs

- `docs/sprints/sprint-230/contract.md` — sprint contract (42 verification checks, 13 ACs).
- `docs/sprints/sprint-230/findings.md` — decisions / tradeoffs / residual risks.
- `docs/sprints/sprint-230/tdd-evidence/red-state.log` — TDD red-state.
- `docs/sprints/sprint-229/handoff.md` — Sprint 229 baseline.
- `docs/sprints/sprint-227/findings.md` — combobox / hook reuse patterns.
