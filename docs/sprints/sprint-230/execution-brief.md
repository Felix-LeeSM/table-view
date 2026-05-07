# Sprint Execution Brief: sprint-230

## Objective

Replace the static `POSTGRES_COMMON_TYPES` source for the `CreateTableTypeCombobox` with a **server-fetched live type list** from `pg_catalog.pg_type` so that extension types (PostGIS `geometry` / `geography`, `citext`, etc.) and user-defined `CREATE TYPE` enums / composites / domains / ranges show up as suggestions. The canonical 29-entry list is **kept** as the offline / pre-fetch fallback (instant typing experience). Combobox API and AC-227-03 behaviour are unchanged from the user's perspective; the only observable change is **more entries** appear in the dropdown when the server has more types.

## Task Why

User feedback (2026-05-07): "가능한 data type 은 plugin 등에 따라 달라질 수 있으니 동적으로 서버에서 가져오는 게 좋을 것 같다." — "Possible data types depend on plugins, so dynamic server-fetch is preferable." The static list locks users out of declaring columns of types like PostGIS `geometry` or their own enums in the CREATE TABLE flow without using free-text fallback (which works but is undiscoverable). Sprint 227's combobox was scoped to canonical built-ins; Sprint 230 makes it real.

## Scope Boundary

**In scope** (this sprint, Phase 27 sprint 5):
- Backend: new Tauri command `list_postgres_types(connection_id)` + `RdbAdapter::list_types` trait method (default `Unsupported`) + PG override + `LIST_TYPES_SQL` const querying `pg_catalog.pg_type ⋈ pg_namespace` with the canonical filter set + 1 Rust SQL-builder unit test.
- Frontend: `tauri.listPostgresTypes` wrapper in `src/lib/tauri/schema.ts` + new `usePostgresTypes(connectionId)` hook in `src/hooks/` (module-memo cache) + `CreateTableTypeCombobox` accepts optional `typesSource?: string[]` prop (back-compat default = canonical list) + `CreateTableDialog` wires the hook → prop + `filterPostgresTypesAgainst` additive helper in `src/lib/sql/postgresTypes.ts`.
- Test: ≥ 5 vitest cases for the hook + ≥ 2 for the combobox prop + ≥ 1 for dialog wiring + ≥ 1 Rust SQL-fixture test.

**Out of scope** (deferred to Sprint 231):
- Reorder ↑/↓ buttons (column / index / FK / CHECK / UNIQUE rows).
- Table-level `COMMENT ON TABLE`.
- Schema picker position move.
- Type combobox color coding (consumes the `type_kind` field this sprint introduces).
- Cross-tab visual feedback / empty column-name handling.
- Schema-qualified label rendering polish (e.g. dim schema prefix styling).
- MySQL / MariaDB / SQLite / Oracle adapters (Phase 17+).
- Auto-refresh on connection disconnect (would require a `connectionStore` body diff — invariant). `invalidatePostgresTypesCache` is exported for Sprint 231 to wire.
- DEFERRABLE / INITIALLY DEFERRED for FK (Sprint 232+).

## Invariants

- Sprint 226 + 227 + 228 + 229 backend fixtures (`composite_pk_byte_equivalent`, COMMENT ON, `create_index_*`, `add_constraint_*` incl. ON DELETE/UPDATE) all pass **unmodified** with no `mutations.rs` source diff.
- `useDdlPreviewExecution.ts` body diff = 0 (Sprint 214 freeze).
- `SqlPreviewDialog.tsx` body diff = 0 (Sprint 227 freeze).
- `cross-window-*.test.tsx`, `window-lifecycle.ac141.test.tsx` diff = 0.
- `connectionStore.ts`, `schemaStore.ts` body diff = 0.
- `src/lib/sql/postgresTypes.ts` canonical list + `expandParametricDefault` helper byte-equivalent (no removals; only additive `filterPostgresTypesAgainst`).
- `src/lib/tauri/ddl.ts` diff = 0 (new wrapper goes in `schema.ts`).
- `src/lib/tauri/index.ts` (barrel) diff = 0.
- `CreateTableDialog/Header.tsx`, `IndexesTabBody.tsx`, `ForeignKeysTabBody.tsx` diff = 0.
- `useFkReferencePicker.ts` diff = 0 (Sprint 229 freeze).
- `src/components/ui/` diff = 0 (no new shadcn primitive).
- All Sprint 226+227+228+229 vitest cases pass byte-for-byte (no assertion-text flips). Combobox tests using the static list keep using it (back-compat default).
- No new `it.skip` / `eslint-disable` / `any` / silent `catch {}`.
- Mongo path untouched.

## Done Criteria

1. **Backend Tauri command** `list_postgres_types(connection_id) -> Result<Vec<PostgresTypeInfo>, AppError>` lives in `src-tauri/src/commands/rdb/schema.rs`, registered in `src-tauri/src/lib.rs`. Read-only, no cancel-token (pattern: `list_views`/`list_functions`).
2. **PG SQL** captured in a `const LIST_TYPES_SQL: &str` (or `build_list_types_sql() -> &'static str`) in `src-tauri/src/db/postgres/schema.rs`. Filter set: `typtype IN ('b','d','e','r','c')`, `typname NOT LIKE '\_%' ESCAPE '\'`, `nspname NOT IN ('pg_toast')`, `NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.reltype = t.oid)`, `ORDER BY n.nspname, t.typname`. Schema scope includes `pg_catalog`, `public`, all user schemas.
3. **Adapter contract**: `RdbAdapter::list_types(&self) -> BoxFuture<Result<Vec<PostgresTypeInfo>, AppError>>` with default `Err(AppError::Unsupported(...))`. PG overrides; non-PG adapters compile unchanged.
4. **Frontend wrapper** `tauri.listPostgresTypes(connectionId)` in `src/lib/tauri/schema.ts` (NOT `ddl.ts`, NOT a new `types.ts`).
5. **Frontend hook** `usePostgresTypes(connectionId)` in `src/hooks/usePostgresTypes.ts`. Returns `{ types: string[] | null, loading: boolean, error: string | null, reload: () => void }`. Module-memo cache keyed by `connectionId`. On error, falls back to canonical + surfaces error string. On success, MERGES canonical first + non-duplicate live extras at end. Display label: `name` for `pg_catalog`, `${schema}.${name}` otherwise. Concurrent calls share one in-flight Promise. `invalidatePostgresTypesCache(connectionId)` exported alongside for Sprint 231 wiring.
6. **Combobox integration**: `CreateTableTypeCombobox` accepts optional `typesSource?: string[]` prop. Default `undefined` → canonical-list path (back-compat). When supplied, filters via new `filterPostgresTypesAgainst(list, value)` helper.
7. **Dialog wiring**: `CreateTableDialog` invokes `usePostgresTypes(connectionId)` and passes `typesSource={pgTypes ?? undefined}` to the existing combobox.
8. **Filter / expand parity**: `filterPostgresTypesAgainst` is case-insensitive substring (matches AC-227-03). `expandParametricDefault("varchar") === "varchar(255)"` still works because canonical bare types are at the head of the merged list.
9. **Loading UX**: canonical list shown instantly on mount (no spinner inside the combobox); merged list silently replaces on resolve.
10. **Cache invalidation surface**: `invalidatePostgresTypesCache(connectionId)` exported (Sprint 231 will wire it into disconnect / reconnect).
11. **No regression**: Sprint 226+227+228+229 vitest + cargo fixtures pass unchanged. Combobox carry-over Sprint 227 cases pass byte-for-byte (`typesSource` default undefined).
12. **Test coverage**: ≥ 1 Rust SQL-builder fixture + ≥ 5 vitest cases for `usePostgresTypes` + ≥ 2 for combobox `typesSource` prop + ≥ 1 for dialog wiring.
13. **Edge cases tested**: connection-not-found error → fallback; empty result → canonical only; duplicate name (`pg_catalog.varchar` + canonical `varchar`) → no double; concurrent connectionId switch → stale response dropped; `expandParametricDefault` works with dynamic list.

## Verification Plan

- Profile: `mixed` (command + static).
- Required checks (1-42 in `contract.md` Verification Plan §Required Checks):
  1. `pnpm vitest run src/components/schema/CreateTableDialog.test.tsx` PASS.
  2. `pnpm vitest run src/components/schema/CreateTableTypeCombobox.test.tsx` PASS.
  3. `pnpm vitest run src/hooks/usePostgresTypes.test.ts` PASS (≥ 5 cases).
  4. `pnpm vitest run` PASS (file count ≥ 219).
  5. `pnpm tsc --noEmit` exit 0.
  6. `pnpm lint` exit 0.
  7. `cargo build --manifest-path src-tauri/Cargo.toml` exit 0.
  8. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` exit 0.
  9. `cargo test --manifest-path src-tauri/Cargo.toml create_table` PASS (16/16 unchanged).
  10. `cargo test --manifest-path src-tauri/Cargo.toml create_index` PASS (11/11 unchanged).
  11. `cargo test --manifest-path src-tauri/Cargo.toml add_constraint` PASS (12/12 unchanged).
  12. `cargo test --manifest-path src-tauri/Cargo.toml list_types` PASS (≥ 1 SQL fixture).
  13-22. Freeze diffs (useDdlPreviewExecution / SqlPreviewDialog / cross-window / stores / postgresTypes additive-only / ddl.ts / index.ts / Header / IndexesTabBody / ForeignKeysTabBody / useFkReferencePicker / ui/) all = 0 (or additive-only).
  23-33. grep evidence — `list_postgres_types` registered, `pg_type|pg_namespace` in PG SQL, `fn list_types` in traits + postgres.rs, frontend wrapper + hook + helper landed.
  34-37. No `it.skip` / `eslint-disable` / `any` / Mongo regression.
  38-41. AC-named vitest cases (canonical-head merge order, error fallback, label transform, parametric expand parity).
  42. Optional manual UI smoke.
- Required evidence:
  - Changed files table (path → purpose → LOC delta).
  - Test counts (vitest before/after + cargo test before/after).
  - AC-230-01..AC-230-13 coverage table — each AC cited with test file:line + assertion or grep output.
  - Verification check 1-41 results (exit code + key output).
  - Decisions: cache layer (module memo vs zustand), `tauri.ts` location (`schema.ts`), `typesSource` default (`undefined` → canonical-list), display-label rule (`pg_catalog` strip), PG SQL constant location, `reload()` semantics.
  - Edge cases tested: connection-not-found, empty result, duplicate-name handling, stale connectionId concurrency, parametric default with dynamic list.
  - Assumptions made during implementation.
  - Residual risks (cache stale on disconnect — Sprint 231 polish; SQL `\_` ESCAPE syntax verified for PG 14+).
  - TDD red-state evidence in `docs/sprints/sprint-230/tdd-evidence/red-state.log`.

## Evidence To Return

- Changed files and purpose (file → purpose → LOC delta).
- Checks run and outcomes (table form, exit codes + key output).
- Done criteria coverage with evidence (AC-230-01..AC-230-13 each cited).
- Decisions table (cache layer, wrapper location, prop default semantics, label rule, SQL const location, reload semantics).
- Edge cases tested (connection-not-found, empty, duplicate, stale-connectionId, parametric expand).
- Assumptions made during implementation.
- Residual risks / verification gaps.

## References

- Contract: `docs/sprints/sprint-230/contract.md`
- Findings: `docs/sprints/sprint-230/findings.md` (Generator writes after green commits)
- TDD evidence: `docs/sprints/sprint-230/tdd-evidence/red-state.log`
- Sprint 229 baseline: `docs/sprints/sprint-229/handoff.md` + `docs/sprints/sprint-229/findings.md`
- Sprint 228 chain pattern: `docs/sprints/sprint-228/handoff.md`
- Sprint 227 combobox hot-fix history: `docs/sprints/sprint-227/findings.md` (combobox + parametric expand origin)
- Sprint 227 spec lines 52-55: original Sprint 230 polish list — all 4 items reassigned to Sprint 231.
- Relevant files (Sprint 230):
  - `src-tauri/src/commands/rdb/schema.rs` — pattern for read-only Tauri commands; new `list_postgres_types` lands here.
  - `src-tauri/src/db/postgres/schema.rs` — pattern for `pg_catalog` SELECT; new `list_types` inherent method + `LIST_TYPES_SQL` const land here.
  - `src-tauri/src/db/traits.rs` — `RdbAdapter` trait; new `list_types` default impl lands here.
  - `src-tauri/src/db/postgres.rs` — `impl RdbAdapter for PostgresAdapter`; new `list_types` override lands here.
  - `src-tauri/src/models/schema.rs` — new `PostgresTypeInfo` struct.
  - `src-tauri/src/lib.rs` — `tauri::generate_handler!` registration line.
  - `src/lib/tauri/schema.ts` — new wrapper line.
  - `src/types/schema.ts` — new `PostgresTypeInfo` interface.
  - `src/hooks/usePostgresTypes.ts` — new hook + module memo + `invalidatePostgresTypesCache` export.
  - `src/hooks/usePostgresTypes.test.ts` — ≥ 5 vitest cases.
  - `src/lib/sql/postgresTypes.ts` — additive `filterPostgresTypesAgainst` helper; canonical list byte-equivalent.
  - `src/components/schema/CreateTableTypeCombobox.tsx` — surgical `typesSource` prop + branch (~+12 LOC).
  - `src/components/schema/CreateTableTypeCombobox.test.tsx` — ≥ 2 new vitest cases.
  - `src/components/schema/CreateTableDialog.tsx` — surgical `usePostgresTypes` + prop pass (~+8 LOC).
  - `src/components/schema/CreateTableDialog.test.tsx` — ≥ 1 new vitest case + mock surface extension.
