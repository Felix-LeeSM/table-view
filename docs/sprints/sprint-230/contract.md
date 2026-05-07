# Sprint Contract: sprint-230

## Summary

- Goal: Phase 27 sprint 5 — replace the **static** PG type list source for the `CreateTableTypeCombobox` with a **server-fetched live list**, while keeping the canonical `POSTGRES_COMMON_TYPES` (29 entries from Sprint 227) intact as the **offline / pre-fetch fallback**. A new read-only Tauri command `list_postgres_types(connection_id)` queries `pg_catalog.pg_type` joined with `pg_catalog.pg_namespace` and returns the full type list (built-ins from `pg_catalog` + extension types like PostGIS `geometry` + user-defined enum/composite/domain/range from `CREATE TYPE`). A new frontend hook `usePostgresTypes(connectionId)` lazily fetches + caches the list per-connection, falls back to `POSTGRES_COMMON_TYPES` on error, and merges (canonical first, live extras appended) on success. `CreateTableTypeCombobox` gains an optional `typesSource?: string[]` prop — when omitted it uses the canonical list (back-compat for tests + non-DB consumers); when supplied (from `CreateTableDialog` wired with `usePostgresTypes`) it filters from the dynamic list. `filterPostgresTypes` and `expandParametricDefault` (Sprint 227 hot-fix) keep working against the dynamic list because `varchar` / `char` / `numeric` are guaranteed to be in the merged head from the canonical list.

  **User feedback (2026-05-07)**: "가능한 data type 은 plugin 등에 따라 달라질 수 있으니 동적으로 서버에서 가져오는 게 좋을 것 같다." (Possible data types depend on plugins, so dynamic server-fetch is preferable.)

  **Combobox API and AC-227-03 behaviour stay identical from the user's perspective** — typing `int` still surfaces `integer | bigint | smallint | interval`; `varchar` still expands to `varchar(255)`; the chevron, popover, ↑/↓/Enter/Esc keys, free-text fallback (`numeric(10,4)`) all unchanged. The only observable behaviour change is the **set of filterable suggestions grows** when a connection has extension or user-defined types.

  **Important (sprint scope clarification)** — the Sprint 227 spec lines 52-55 originally listed Sprint 230 as a polish-only sprint (reorder, table COMMENT, schema picker move, type coloring, cross-tab visual feedback). All four polish items are **explicitly deferred to Sprint 231**. Sprint 230 is now exclusively the dynamic-type-list sprint.

- Audience: Generator + Evaluator (multi-agent harness, post-229 cycle, Phase 27 sprint 5 — dynamic PG type list).
- Owner: harness skill orchestrator.
- Verification Profile: `mixed` (command + static).

## In Scope

Backend (Rust) — new read-only command + adapter contract extension:
- **NEW** `src-tauri/src/models/schema.rs` (~+10 LOC): add `PostgresTypeInfo` struct with `#[derive(Debug, Clone, Serialize, Deserialize)]` + fields `pub schema: String`, `pub name: String`, `pub type_kind: String` (the latter ∈ `"base" | "domain" | "enum" | "range" | "composite"`). `serde(rename_all = "snake_case")` not required — fields are already snake_case. Re-export from `models/mod.rs` if needed.
- **NEW** `src-tauri/src/commands/rdb/schema.rs` (~+20 LOC inside the existing file, **NOT** a new file): add Tauri command `pub async fn list_postgres_types(state, connection_id) -> Result<Vec<PostgresTypeInfo>, AppError>`. Resolves connection via `state.active_connections.lock().await` + `as_rdb()?`, dispatches to the trait method `list_types`. Read-only — no cancel-token (the call is small, < 100 ms expected) — pattern-matches `list_views` / `list_functions` shape (no `query_id` arg).
- **MOD** `src-tauri/src/db/traits.rs` (~+8 LOC): extend `RdbAdapter` trait with a new method:
  ```rust
  fn list_types<'a>(
      &'a self,
  ) -> BoxFuture<'a, Result<Vec<PostgresTypeInfo>, AppError>> {
      Box::pin(async {
          Err(AppError::Unsupported(
              "This adapter does not list types".into(),
          ))
      })
  }
  ```
  Default impl returns `Unsupported` so MySQL/SQLite/Mongo placeholder adapters compile without changes (Phase 17+ will fill in). PG overrides.
- **MOD** `src-tauri/src/db/postgres.rs` (~+8 LOC inside the `impl RdbAdapter for PostgresAdapter` block, near `list_functions`): override `list_types` to delegate to a new inherent method `self.list_types()` on `PostgresAdapter`.
- **MOD** `src-tauri/src/db/postgres/schema.rs` (~+50 LOC): new inherent method `pub async fn list_types(&self) -> Result<Vec<PostgresTypeInfo>, AppError>`. Runs the `pg_catalog.pg_type` SELECT below via `sqlx::query_as` against `self.active_pool().await?`. Maps rows → `PostgresTypeInfo`.

  **PG SQL (canonical, byte-stable for unit-test fixture)**:
  ```sql
  SELECT n.nspname AS schema, t.typname AS name,
         CASE t.typtype
              WHEN 'b' THEN 'base'
              WHEN 'd' THEN 'domain'
              WHEN 'e' THEN 'enum'
              WHEN 'r' THEN 'range'
              WHEN 'c' THEN 'composite'
         END AS type_kind
    FROM pg_catalog.pg_type t
    JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
   WHERE t.typtype IN ('b', 'd', 'e', 'r', 'c')
     AND t.typname NOT LIKE '\_%' ESCAPE '\'
     AND n.nspname NOT IN ('pg_toast')
     AND NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_class c
          WHERE c.reltype = t.oid
     )
   ORDER BY n.nspname, t.typname
  ```
  Filters:
  - `typtype IN ('b','d','e','r','c')` — base / domain / enum / range / composite (exclude pseudo `'p'` like `any`, multirange `'m'`).
  - `typname NOT LIKE '\_%'` — array element types (`_int4` etc.) are excluded; only the bare element name is surfaced.
  - `nspname NOT IN ('pg_toast')` — exclude TOAST internal types.
  - `NOT EXISTS (...pg_class.reltype...)` — exclude auto-generated row types backing every table; only types created via `CREATE TYPE` survive on the composite arm.
  - `pg_catalog` is **kept in scope** so built-ins (`varchar`, `int4`, `uuid`) appear; the frontend hook strips the `pg_catalog.` prefix from labels (see hook contract below).
  - `public` + any other user schema kept.
- **MOD** `src-tauri/src/db/postgres/schema.rs#[cfg(test)] mod tests` (~+45 LOC): add **≥ 1 SQL builder fixture** test that asserts the generated SQL string matches the canonical block above byte-for-byte (whitespace-normalized line-by-line). The pattern matches existing `create_table` builder fixtures — no live DB needed. Refactor the SQL into a module-level `const LIST_TYPES_SQL: &str = "..."` (or a `fn build_list_types_sql() -> &'static str`) so the unit test asserts against the same string the runtime executes. Test name: `list_types_sql_matches_canonical_fixture`.
- **MOD** `src-tauri/src/lib.rs` (~+1 LOC): register `commands::rdb::schema::list_postgres_types` in the `tauri::generate_handler!` macro list (insert next to `list_views` / `list_functions`).

Frontend (TS/TSX) — wrapper + hook + combobox prop + dialog wiring:
- **NEW** `src/lib/tauri/schema.ts` (~+9 LOC inside the existing file, **NOT** a new file): add `export async function listPostgresTypes(connectionId: string): Promise<PostgresTypeInfo[]> { return invoke<PostgresTypeInfo[]>("list_postgres_types", { connectionId }); }`. **Decision (locked)**: lives in `src/lib/tauri/schema.ts` (NOT `ddl.ts`, NOT a new `types.ts`). Rationale: the call is a **read-only catalog query** — same paradigm as `listSchemas` / `listTables` / `getTableColumns` / `listSchemaColumns` already in `schema.ts`. Adding a new `types.ts` file for one wrapper would fragment the domain barrel without benefit. `ddl.ts` is reserved for **mutation** wrappers (`createTable`, `addConstraint`, `dropIndex`, etc.) — a read-only fetch doesn't belong there. The barrel `src/lib/tauri/index.ts` already re-exports `./schema`, so call sites get the new wrapper via `import * as tauri from "@lib/tauri"; await tauri.listPostgresTypes(connectionId);` with no barrel diff.
- **NEW** `src/types/schema.ts` (~+6 LOC): add the matching frontend type:
  ```ts
  export interface PostgresTypeInfo {
    schema: string;
    name: string;
    type_kind: "base" | "domain" | "enum" | "range" | "composite";
  }
  ```
  snake_case `type_kind` mirrors Rust serde default. No other type changes.
- **NEW** `src/hooks/usePostgresTypes.ts` (~+90 LOC): new hook with the contract:
  ```ts
  export interface UsePostgresTypesResult {
    types: string[] | null;       // null while loading + before first fetch
    loading: boolean;              // true while fetch in flight
    error: string | null;          // non-null if last fetch rejected (and we fell back)
    reload: () => void;            // imperative refetch (cache-bust)
  }
  export function usePostgresTypes(connectionId: string): UsePostgresTypesResult;
  ```
  Behaviour:
  1. On mount (and when `connectionId` changes), call `tauri.listPostgresTypes(connectionId)`.
  2. **Cache layer = module-level `Map<connectionId, CacheEntry>` memo** (NOT zustand). See "Decisions" — module-memo is justified because (a) the data is tiny per connection (~200-500 strings) and pure-derived from PG state, (b) no other consumer needs the raw `PostgresTypeInfo[]` (combobox only consumes the merged `string[]`), (c) zustand slice would require a new `typesByConnection` field + cache-invalidation wiring on disconnect/reconnect — store body is a **frozen invariant** for Sprint 230, (d) module memo with `Map.delete(connectionId)` invalidation called from the connection-disconnect lifecycle hook is a **single-line cache punch**. Cache entry shape: `{ types: string[]; raw: PostgresTypeInfo[]; fetchedAt: number; }`.
  3. **Merge rule**: `merged = [...POSTGRES_COMMON_TYPES, ...liveExtras]` where `liveExtras` filters out names already in the canonical list (case-sensitive `Set` lookup). Each live entry's display label is `name` (when `schema === "pg_catalog"`) or `${schema}.${name}` (otherwise). This keeps `varchar` / `int4` / `uuid` as their bare names while surfacing user-defined types like `public.my_enum` or `extensions.geometry`.
  4. **On error**: set `error: <message>`, set `types: [...POSTGRES_COMMON_TYPES]` (canonical fallback), set `loading: false`. Combobox stays usable. Error is surfaced for telemetry but no toast / no blocking dialog.
  5. **Loading UX**: while `loading: true`, expose `types: [...POSTGRES_COMMON_TYPES]` (instant typing experience — the user sees the canonical list immediately on mount). On success, the merged list **silently replaces** the canonical list. **No spinner inside the combobox** (prevents flicker — user-visible only as new entries appearing in the dropdown).
  6. **`reload()`**: deletes the connection's cache entry + re-runs the fetch; useful for "I just installed PostGIS" scenarios.
  7. **Concurrency**: in-flight fetch promise is stored in the cache entry so concurrent `usePostgresTypes` calls on the same connection share one fetch. AbortController NOT needed (the call is small + idempotent); a stale response is dropped if a new `connectionId` was set in the interim (compare against a ref-stored `latestConnectionIdRef.current`).
- **NEW** `src/hooks/usePostgresTypes.test.ts` (~+180 LOC): vitest cases — see Test Requirements (≥ 5 cases minimum).
- **MOD** `src/components/schema/CreateTableTypeCombobox.tsx` (~+12 LOC, surgical): add optional prop `typesSource?: string[]` to `CreateTableTypeComboboxProps`. When `typesSource` is supplied, the combobox runs `filterPostgresTypes` against `typesSource` (case-insensitive substring); when omitted, falls back to the canonical list via the existing `filterPostgresTypes(value)`. Implementation: replace the single line `const suggestions = useMemo(() => filterPostgresTypes(value), [value]);` with:
  ```ts
  const suggestions = useMemo(
    () => (typesSource
      ? filterPostgresTypesAgainst(typesSource, value)
      : filterPostgresTypes(value)),
    [typesSource, value],
  );
  ```
  where `filterPostgresTypesAgainst(list, query)` is a new exported helper in `src/lib/sql/postgresTypes.ts` (~+8 LOC additive — see below). The Sprint 227 hot-fix for `expandParametricDefault` stays unchanged because the canonical bare types (`varchar`, `char`, `numeric`) are guaranteed-present in the merged head. **Existing combobox test cases that use the canonical list keep working** because `typesSource` defaults to `undefined` → canonical-list path.
- **MOD** `src/lib/sql/postgresTypes.ts` (~+8 LOC, additive only — the canonical list MUST stay byte-equivalent): export a new pure helper:
  ```ts
  /** Case-insensitive substring filter against an arbitrary type list.
   *  Sprint 230 — used by the combobox when a dynamic `typesSource`
   *  prop is supplied. Empty `query` returns the full list. */
  export function filterPostgresTypesAgainst(
    list: readonly string[],
    query: string,
  ): string[] {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return [...list];
    return list.filter((t) => t.toLowerCase().includes(q));
  }
  ```
  `POSTGRES_COMMON_TYPES`, `filterPostgresTypes`, `PARAMETRIC_TYPE_DEFAULTS`, `expandParametricDefault` all **byte-equivalent** — `git diff --stat src/lib/sql/postgresTypes.ts` shows only additive lines.
- **MOD** `src/components/schema/CreateTableDialog.tsx` (~+8 LOC, surgical): add `const { types: pgTypes } = usePostgresTypes(connectionId);` inside the modal body; pass `typesSource={pgTypes ?? undefined}` to the existing `<CreateTableTypeCombobox …/>` invocation around line 936. No other modal logic changes; the new prop's `?? undefined` keeps the canonical-list fallback active before the first fetch resolves.
- **MOD** `src/components/schema/CreateTableTypeCombobox.test.tsx` (~+45 LOC): add **≥ 2** new vitest cases under a `describe("Sprint 230 — typesSource prop", …)` block:
  - Case 1 — when `typesSource={["geometry", "public.my_enum", "varchar", "uuid"]}`, typing `geo` surfaces `geometry` + filters out `varchar`.
  - Case 2 — when `typesSource={undefined}` (default), behaviour matches Sprint 227 baseline (canonical list). All Sprint 227 carry-over cases pass byte-for-byte unchanged.
- **MOD** `src/components/schema/CreateTableDialog.test.tsx` (~+30 LOC): extend the `vi.mock("@lib/tauri")` shim with a `listPostgresTypes` mock + add **1** new vitest case asserting the dialog calls `tauri.listPostgresTypes(connectionId)` once on mount and merges the result into the combobox suggestions list. Sprint 226+227+228+229 carry-over cases pass byte-for-byte unchanged (no assertion-text flips).

Docs:
- `docs/PLAN.md` (≤ +3 LOC): row 5 added to post-225 feature cycle table for sprint-230 (replacing the placeholder seeded in Sprint 229's handoff).
- `docs/sprints/sprint-230/handoff.md` (new): Generator handoff.
- `docs/sprints/sprint-230/findings.md` (new): decisions + tradeoffs + residual risks.
- `docs/sprints/sprint-230/tdd-evidence/red-state.log` (new) — TDD red-state captured before green commits.

## Out of Scope

Cite Sprint 229 handoff "다음 sprint" §"Sprint 230 (polish)" — those four polish items are **all reassigned to Sprint 231**:

- **Reorder ↑/↓ buttons** for column rows / index rows / FK rows / CHECK rows / UNIQUE rows — Sprint 231.
- **Table-level `COMMENT ON TABLE`** — Sprint 231.
- **Schema picker position move** (header → form section) — Sprint 231.
- **Type combobox color coding** (per type-kind: base / domain / enum / range / composite — would consume the `type_kind` field that this sprint introduces) — Sprint 231. Generator should NOT add color rendering or type-kind display in the combobox UI body in Sprint 230 — keep raw name in the suggestions list.
- **Cross-tab visual feedback / empty column-name handling** — Sprint 231.
- **Schema-qualified type display labels in the combobox UI** (e.g. `myschema.my_enum` rendering with a `.` separator + dim schema styling) — keep raw name in this sprint; the hook merges using `${schema}.${name}` notation for non-`pg_catalog` types but the combobox renders the merged string verbatim with no special styling.
- **DEFERRABLE / INITIALLY DEFERRED** for FK — Sprint 232+.
- **MySQL / MariaDB / SQLite / Oracle adapters** — Phase 17+. The trait default returns `Unsupported` so non-PG adapters compile without code change.
- **MongoDB type-list** — irrelevant (document paradigm, no SQL types). The Tauri command `list_postgres_types` rejects non-RDB connections via the existing `as_rdb()?` dispatch.
- **Column type combobox auto-refresh on extension install** — the `reload()` callback is exposed but the dialog does not wire a UI button for it in Sprint 230. Manual close-and-reopen of the modal triggers a fresh fetch (cache key tied to `connectionId`, but module-memo persists for the session). Sprint 231 may add a "Refresh types" button next to the schema picker.
- **`useDdlPreviewExecution.ts` body changes** — Sprint 214 freeze.
- **`SqlPreviewDialog.tsx` body changes** — Sprint 227 freeze.
- **`schemaStore` / `connectionStore` body changes** — Sprint 224 baseline. The cache for PG types lives in a **module-level memo** in `usePostgresTypes.ts`, NOT a zustand slice (see Decisions).
- **`SYNCED_KEYS` extension** of any store — type list stays window-local; no cross-window broadcast.
- **`attachZustandIpcBridge` modification** — no new IPC channel beyond the new `list_postgres_types` Tauri command.
- **Sprint 226 + 227 + 228 + 229 backend fixtures** — must remain byte-equivalent; assertions unchanged. The new Tauri command does **NOT** touch `create_table` / `create_index` / `add_constraint` code paths.
- **Sprint 226 + 227 + 228 + 229 vitest cases** — pass byte-for-byte unchanged. No assertion-text flips. The new combobox `typesSource` prop defaults to `undefined`, preserving Sprint 227's combobox behaviour for tests that don't supply it.
- **Sprint 227 hot-fix files frozen** — `src/components/schema/CreateTableDialog/Header.tsx`, `src/components/schema/CreateTableDialog/IndexesTabBody.tsx`, `src/components/schema/CreateTableDialog/ForeignKeysTabBody.tsx` `git diff --stat` = 0.
- **`src/hooks/useFkReferencePicker.ts`** — Sprint 229 freeze. Diff = 0.
- **Cross-window invariant suite** — `git diff --stat src/__tests__/cross-window-*.test.tsx src/__tests__/window-lifecycle.ac141.test.tsx` = 0.
- **New shadcn primitives** — none. The combobox already uses `Popover` + raw `<input>` + raw `<button>`. No new `src/components/ui/*` files.
- **Auto-refresh on connection switch / disconnect** — module memo `Map.delete(connectionId)` is provided as a free function `invalidatePostgresTypesCache(connectionId)` exported alongside the hook, but **wiring it into `connectionStore.disconnect` is OUT of scope** for Sprint 230 (would require a connectionStore body diff which is invariant). Document as residual risk; Sprint 231 polish may wire the cleanup. The stale entry has no correctness impact — the worst case is a user installs PostGIS mid-session and the new `geometry` type only appears after the user clicks the modal's `Refresh types` button (which Sprint 231 adds) or restarts the app.

## Invariants

- **Sprint 226 + 227 + 228 + 229 byte-equivalence preserved** — Rust fixtures (`create_table_preview_three_column_composite_pk_byte_equivalent`, Sprint 227 comment fixtures, Sprint 228 `create_index` fixtures, Sprint 229 `add_constraint_*` fixtures including the FK ON DELETE/UPDATE additions) all pass **unmodified** with no source diff.
- **`useDdlPreviewExecution.ts` body unchanged** — `git diff --stat src/components/structure/useDdlPreviewExecution.ts` = 0. Sprint 214 freeze.
- **`SqlPreviewDialog.tsx` body unchanged** — `git diff --stat src/components/structure/SqlPreviewDialog.tsx` = 0. Sprint 227 freeze.
- **Cross-window invariant suite unchanged** — `git diff --stat src/__tests__/cross-window-*.test.tsx src/__tests__/window-lifecycle.ac141.test.tsx` = 0.
- **`schemaStore` / `connectionStore` body unchanged** — `git diff --stat src/stores/schemaStore.ts src/stores/connectionStore.ts` = 0.
- **`src/lib/sql/postgresTypes.ts` canonical list + helpers byte-equivalent** — `POSTGRES_COMMON_TYPES`, `filterPostgresTypes`, `PARAMETRIC_TYPE_DEFAULTS`, `expandParametricDefault` source lines unchanged. Only **additive** line(s) for the new `filterPostgresTypesAgainst` helper. `git diff src/lib/sql/postgresTypes.ts | grep -E "^-"` outputs 0 lines (no removals).
- **`src/lib/tauri/ddl.ts` body unchanged** — `git diff --stat src/lib/tauri/ddl.ts` = 0 (the new wrapper goes in `schema.ts`, not `ddl.ts`).
- **Sprint 227 hot-fix files frozen** — `git diff --stat src/components/schema/CreateTableDialog/Header.tsx src/components/schema/CreateTableDialog/IndexesTabBody.tsx src/components/schema/CreateTableDialog/ForeignKeysTabBody.tsx` = 0. The dialog's modal body (`CreateTableDialog.tsx`) gains only the surgical `usePostgresTypes` + `typesSource` prop wiring; the sub-components' bodies are not touched.
- **`useFkReferencePicker.ts` body unchanged** — Sprint 229 freeze.
- **Combobox API back-compat** — `CreateTableTypeComboboxProps.typesSource` is **optional** with `undefined` default semantics → canonical-list path. All Sprint 227 combobox tests using the static list keep working byte-for-byte. AC-227-03 `int` → `integer/bigint/smallint/interval` filter test passes unchanged.
- **`expandParametricDefault` parametric defaults still work** — `varchar` → `varchar(255)`, `char` → `char(1)`, `numeric` → `numeric(10,2)` because the canonical list is the **head** of the merged dynamic list (MERGE order: canonical first, then non-duplicate live extras). The hook MUST preserve canonical-first ordering.
- **`pg_catalog.varchar` → `varchar` label** — the hook strips `pg_catalog.` prefix from label so users see `varchar` not `pg_catalog.varchar`. Backend SQL keeps `pg_catalog` rows; the frontend mapper transforms.
- **Tauri command is read-only** — `list_postgres_types` does NOT write, does NOT alter session state, does NOT register a cancel-token (the call is < 100 ms). Pattern matches `list_views` / `list_functions` (no `query_id`).
- **PG SQL whitelist / canonical filter fixed** — `typtype IN ('b','d','e','r','c')`; `typname NOT LIKE '\_%'` (array element types excluded); `nspname NOT IN ('pg_toast')`; `NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.reltype = t.oid)` (auto row types excluded). The SQL string is captured in a const + a Rust unit-test fixture so any future tweak requires updating both.
- **No new `it.skip` / `describe.skip` / `it.todo` / `xit` / `this.skip()` / `it.only`** in any touched test file.
- **No new `eslint-disable*` lines.**
- **No new silent `catch {}` blocks** — `usePostgresTypes`'s catch surfaces the error string + falls back to canonical list (load-bearing recovery; documented in code).
- **No new `any` in TS, no new `unwrap()` in production Rust paths** (tests may use `unwrap`).
- **Mongo / non-RDB path untouched** — `grep -rnE 'createCollection|create_collection' src/lib/tauri/ src-tauri/src/commands/document/` matches 0. The new `list_postgres_types` command rejects non-RDB connections at the `as_rdb()?` dispatch site.
- **Module-memo concurrency safety** — concurrent `usePostgresTypes(connectionId)` calls on the same connection share one in-flight Promise (stored in the cache entry). A connectionId change between mount and resolution is detected via `latestConnectionIdRef.current` compare and the stale response is dropped without state mutation.

## Acceptance Criteria

- `AC-230-01` **New backend Tauri command `list_postgres_types(connection_id)` registered and invokable.** The command is added in `src-tauri/src/commands/rdb/schema.rs` next to `list_views` / `list_functions` (no new file). Registered in `src-tauri/src/lib.rs`'s `tauri::generate_handler!` macro. Returns `Vec<PostgresTypeInfo>` where `PostgresTypeInfo = { schema: String, name: String, type_kind: String }` and `type_kind ∈ {"base","domain","enum","range","composite"}`. Read-only — no cancel-token. **Testable:** `grep -nE 'list_postgres_types' src-tauri/src/lib.rs` ≥ 1 hit; `grep -n 'pub async fn list_postgres_types' src-tauri/src/commands/rdb/schema.rs` = 1 hit; `cargo build --manifest-path src-tauri/Cargo.toml` exit 0; the registered command shows up in the `tauri::generate_handler!` list (Generator may run `grep -A 80 'tauri::generate_handler' src-tauri/src/lib.rs | grep list_postgres_types` for evidence).

- `AC-230-02` **PG SQL queries `pg_catalog.pg_type` JOIN `pg_catalog.pg_namespace` with the canonical filter set.** The SQL builder produces a string equal to the `LIST_TYPES_SQL` const (or `build_list_types_sql()` return) byte-for-byte. The string contains `pg_catalog.pg_type t`, `pg_catalog.pg_namespace n ON n.oid = t.typnamespace`, `t.typtype IN ('b', 'd', 'e', 'r', 'c')`, `t.typname NOT LIKE '\_%' ESCAPE '\'`, `n.nspname NOT IN ('pg_toast')`, `NOT EXISTS (...pg_class c WHERE c.reltype = t.oid)`, and `ORDER BY n.nspname, t.typname`. **Testable:** Rust unit test `list_types_sql_matches_canonical_fixture` asserts `assert_eq!(LIST_TYPES_SQL, "<expected fixture>")` (whitespace-normalized line-by-line) — passes against a `const` fixture in the same file. `grep -nE 'pg_type|pg_namespace' src-tauri/src/db/postgres/schema.rs` ≥ 2 hits.

- `AC-230-03` **`RdbAdapter` trait extended with `list_types` (default = `Unsupported`); PG override returns the live list.** The trait method is added in `src-tauri/src/db/traits.rs` next to `list_functions`. Default impl returns `Err(AppError::Unsupported(...))` so MySQL/SQLite/Mongo adapters compile without code change. `impl RdbAdapter for PostgresAdapter` (in `src-tauri/src/db/postgres.rs`) overrides `list_types` to delegate to `PostgresAdapter::list_types` (inherent method on the schema sub-module). **Testable:** `grep -n 'fn list_types' src-tauri/src/db/traits.rs` = 1 hit; `grep -n 'fn list_types' src-tauri/src/db/postgres.rs` = 1 hit; `cargo clippy --all-targets --all-features -- -D warnings` exit 0 (proves no other adapter is broken).

- `AC-230-04` **Frontend wrapper `tauri.listPostgresTypes(connectionId)` lives in `src/lib/tauri/schema.ts`.** Returns `Promise<PostgresTypeInfo[]>`. Exported via the existing `src/lib/tauri/index.ts` barrel (no barrel diff needed because `schema.ts` is already re-exported). **Decision (locked)**: file location = `schema.ts`. Rationale documented in In Scope §Frontend bullet 1. **Testable:** `grep -n 'export async function listPostgresTypes' src/lib/tauri/schema.ts` = 1 hit; `grep -n 'listPostgresTypes' src/lib/tauri/index.ts` = 0 hits (re-export is via `export * from "./schema"`); `git diff --stat src/lib/tauri/ddl.ts` = 0 (NOT in ddl.ts); `git diff --stat src/lib/tauri/index.ts` = 0 (barrel unchanged); `pnpm tsc --noEmit` exit 0.

- `AC-230-05` **`usePostgresTypes(connectionId)` hook contract.** Returns `{ types: string[] | null, loading: boolean, error: string | null, reload: () => void }`. On mount calls `tauri.listPostgresTypes(connectionId)`; while in flight exposes `types: [...POSTGRES_COMMON_TYPES]` (instant typing experience); on success **MERGES** canonical first, then non-duplicate live extras; on error sets `error` + falls back to canonical (combobox stays usable). Cache layer = **module-level `Map<connectionId, CacheEntry>` memo** (not zustand). Concurrent calls on the same connection share one in-flight Promise. `reload()` deletes the cache entry + refetches. **Testable:** ≥ 5 vitest cases in `src/hooks/usePostgresTypes.test.ts` — (a) mount triggers fetch + sets `types` to merged list on resolve; (b) success merge preserves canonical order at the head + appends non-duplicate live entries; (c) fetch error → `error` non-null + `types` = canonical fallback + `loading: false`; (d) `reload()` re-runs the fetch + updates cache; (e) cache hit on second mount with same connectionId does not re-call the Tauri wrapper.

- `AC-230-06` **Display label transformation rule.** The hook maps each live `PostgresTypeInfo` to its display string: `name` (when `schema === "pg_catalog"`) or `${schema}.${name}` (otherwise). So `pg_catalog.varchar` becomes `varchar`, `public.my_enum` stays as `public.my_enum`, `extensions.geometry` stays as `extensions.geometry`. **Testable:** vitest case in `usePostgresTypes.test.ts` — input `[{schema:"pg_catalog",name:"varchar",type_kind:"base"}, {schema:"public",name:"my_enum",type_kind:"enum"}, {schema:"extensions",name:"geometry",type_kind:"base"}]` + canonical `["varchar", "uuid", ...]` → merged includes `varchar` (deduped against canonical `varchar`), `public.my_enum`, `extensions.geometry`.

- `AC-230-07` **Combobox accepts `typesSource?: string[]` prop.** When supplied, suggestions filter from that list via `filterPostgresTypesAgainst(typesSource, value)`. When omitted (default), behaviour matches Sprint 227 baseline (canonical list via `filterPostgresTypes(value)`). The new helper `filterPostgresTypesAgainst` is exported from `src/lib/sql/postgresTypes.ts` (additive only — no changes to existing exports). **Testable:** ≥ 2 vitest cases in `src/components/schema/CreateTableTypeCombobox.test.tsx` — (a) `<CreateTableTypeCombobox typesSource={["geometry","public.my_enum","varchar","uuid"]} value="geo" onChange={…} />` shows `geometry` in suggestions; (b) `<CreateTableTypeCombobox value="int" onChange={…} />` (no `typesSource`) shows `integer | bigint | smallint | interval` from canonical list (Sprint 227 carry-over byte-for-byte). `grep -n 'filterPostgresTypesAgainst' src/lib/sql/postgresTypes.ts` = 1 hit; `grep -n 'typesSource' src/components/schema/CreateTableTypeCombobox.tsx` ≥ 1 hit.

- `AC-230-08` **`CreateTableDialog` wires `usePostgresTypes` → `typesSource`.** The dialog body invokes `const { types: pgTypes } = usePostgresTypes(connectionId);` and passes `typesSource={pgTypes ?? undefined}` to the existing `<CreateTableTypeCombobox …/>`. No other dialog body changes. **Testable:** `grep -n 'usePostgresTypes' src/components/schema/CreateTableDialog.tsx` ≥ 1 hit; vitest case in `CreateTableDialog.test.tsx` asserts `tauri.listPostgresTypes` mock was called once with the dialog's `connectionId` after mount + the combobox's suggestions list reflects the merged result.

- `AC-230-09` **Filter / expand parity with the dynamic list.** `filterPostgresTypesAgainst` is case-insensitive substring (matches AC-227-03 semantics). `expandParametricDefault("varchar")` → `varchar(255)` still works because the canonical bare types are guaranteed-present in the merged head. **Testable:** vitest case — declare `typesSource={["varchar", "varchar(255)", "geometry", "public.my_enum"]}`, type `var`, navigate to `varchar` row, press Enter → `onChange` called with `"varchar(255)"` (parametric default expansion intact); type `geo`, press Enter → `onChange` called with `"geometry"` (no parametric default). vitest case — type `INT` (uppercase), assert `integer/bigint/smallint/interval` all surface from canonical list (case-insensitive match).

- `AC-230-10` **Loading UX — canonical list shown instantly + silent merge replacement.** While `loading: true`, the combobox displays the canonical list with no spinner / no skeleton (instant typing experience). On fetch resolve, the merged list replaces silently — no flicker. **Testable:** vitest case in `CreateTableDialog.test.tsx` — mount the dialog with a Promise that delays 50ms, assert (a) immediately after mount the combobox shows canonical entries (e.g. `varchar` visible), (b) no spinner element rendered inside the combobox (`queryByRole("status")` inside the combobox subtree returns null), (c) after the Promise resolves with `[{schema:"public",name:"my_enum",type_kind:"enum"}]` the combobox now also shows `public.my_enum` when filtered.

- `AC-230-11` **Cache invalidation surface exposed.** A free function `invalidatePostgresTypesCache(connectionId: string): void` is exported from `src/hooks/usePostgresTypes.ts` so future call sites (Sprint 231 disconnect / reconnect / DB switch wiring) can punch the cache. The hook itself does NOT subscribe to disconnect events in Sprint 230 (would require a `connectionStore` body diff; out of scope). The `reload()` callback is the user-facing fallback — it calls `invalidatePostgresTypesCache(connectionId)` then refetches. **Testable:** vitest case — populate cache for `"conn1"`, call `invalidatePostgresTypesCache("conn1")`, mount the hook again → fetch is called fresh (mock invocation count increments).

- `AC-230-12` **No regression — Sprint 226+227+228+229 vitest + Rust fixtures unchanged.** All Sprint 226 / 227 / 228 / 229 vitest carry-over cases pass byte-for-byte. The combobox unit tests against the static list (Sprint 227 baseline) keep using the static list (back-compat default `typesSource: undefined`). New tests cover the dynamic path. **Testable:** `pnpm vitest run` exit 0 with file count ≥ 220 (Sprint 229 baseline 218 + 1 new `usePostgresTypes.test.ts` + 1 new (or extended in-place) Sprint 230 cases under existing files); `cargo test create_table create_index add_constraint` PASS unchanged; `git diff --stat src/lib/sql/postgresTypes.ts` shows additive-only lines (no removals); `git diff --stat src/components/schema/CreateTableTypeCombobox.tsx` shows surgical-only diff (≤ 12 LOC additive); `git diff --stat src/__tests__/cross-window-*.test.tsx src/__tests__/window-lifecycle.ac141.test.tsx` = 0.

- `AC-230-13` **Test coverage targets.** ≥ 1 Rust unit test for the SQL builder (`list_types_sql_matches_canonical_fixture`). ≥ 5 vitest cases in `src/hooks/usePostgresTypes.test.ts` (mount fetch, success merge, error fallback, reload, cache hit). ≥ 2 vitest cases for the combobox `typesSource` prop (`CreateTableTypeCombobox.test.tsx` Sprint 230 describe block). ≥ 1 vitest case for `CreateTableDialog` wiring (`CreateTableDialog.test.tsx` — Sprint 230 mount-fetch case + dialog-merges-into-combobox case). Coverage ≥ 70% line on `usePostgresTypes.ts` and on the modified portion of `CreateTableTypeCombobox.tsx`.

## Design Bar / Quality Bar

- **Cache layer = module-level `Map<connectionId, CacheEntry>` memo (NOT zustand).** Justification: (a) the data is small (~200-500 strings per connection) and pure-derived from PG state — no cross-window broadcast needed (each window can fetch its own); (b) zustand slice would require adding a `typesByConnection: Record<string, PostgresTypeInfo[]>` field to `schemaStore` AND a cache-invalidation callback wired into `clearForConnection` AND IPC bridge subscriptions if any future cross-window sync is wanted — store body is a **frozen invariant** for Sprint 230; (c) module memo is local to `usePostgresTypes.ts` + a single `invalidatePostgresTypesCache(connectionId)` exported for future Sprint 231 wiring; (d) module-memo's testability is fine because the test file resets the memo via `invalidatePostgresTypesCache(...)` between cases (or via `beforeEach` calling a private `__resetCacheForTesting()` exported under a `__test__` namespace if needed — Generator's call). The Sprint 229 schemaStore precedent (lazy `loadTables` + reactive subscription) is **NOT** reused here because the combobox does not need reactive store subscription; a one-shot fetch + memo is sufficient.
- **Tauri wrapper file = `src/lib/tauri/schema.ts`.** NOT `ddl.ts` (mutations only). NOT a new `types.ts` (one wrapper doesn't justify a new domain file). Pattern-match: `listSchemas`, `listTables`, `getTableColumns`, `listSchemaColumns` all live in `schema.ts` — `listPostgresTypes` is the same paradigm.
- **PG SQL is captured in a Rust `const`** (or a `fn build_list_types_sql() -> &'static str`) so the unit test asserts byte-for-byte against the same string runtime executes. No format-string interpolation needed (the SQL has no parameters — `connection_id` is resolved by the adapter dispatch, not by the SQL).
- **`typtype` filter set is a closed whitelist** — `b | d | e | r | c`. Pseudo (`p`), multirange (`m`), and any future PG `typtype` values are excluded by default; future sprint can extend.
- **Array element types excluded** via `typname NOT LIKE '\_%' ESCAPE '\'`. PG's underscore-prefix convention (`_int4`, `_varchar`, `_text`) is the canonical signal. The bare element name (`int4`, `varchar`, `text`) is included via the same row's underlying type.
- **Auto row types excluded** via `NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.reltype = t.oid)` — every CREATE TABLE generates an implicit composite type with `typtype = 'c'` referencing `pg_class.reltype`. Filter excludes those, keeping only user-defined `CREATE TYPE … AS (...)` composites.
- **Display label is canonical-first + qualified-on-collision-only.** The hook strips `pg_catalog.` prefix so built-ins read naturally (`varchar`, not `pg_catalog.varchar`); user schemas keep their prefix (`public.my_enum`) so users know where the type lives. **No coloring** in Sprint 230 — Sprint 231 polish.
- **`typesSource` prop optional with `undefined` default semantics → canonical-list path** keeps Sprint 227 combobox tests byte-for-byte stable. Generator MUST NOT change the default.
- **Loading UX = canonical-list-first + silent replace** (no spinner inside the combobox). Justification: the user expects the dropdown to be instantly responsive when they click the type cell. A spinner would flicker and feel slow; the canonical list covers > 95% of typical type names, and the merge happens silently when the live extras arrive.
- **No anticipatory abstraction** — keep `usePostgresTypes` in `src/hooks/`, do NOT lift the cache layer to a generic `useCachedTauriQuery` factory. If a second Sprint 231+ consumer needs the same pattern, refactor then.
- **No new shadcn primitives.** Combobox already uses `Popover`. No additions.
- **TDD evidence** — capture `red-state.log` in `docs/sprints/sprint-230/tdd-evidence/red-state.log` per `docs/PLAN.md` sprint convention.
- **No `it.skip` / `eslint-disable` / `any` / silent `catch {}`** — see Invariants. The hook's error-fallback `catch` is documented and surfaces via `error` state (NOT silent).

## Verification Plan

### Required Checks

1. `pnpm vitest run src/components/schema/CreateTableDialog.test.tsx` exit 0. Sprint 229 baseline 52 + 1 new Sprint 230 case = ≥ 53.
2. `pnpm vitest run src/components/schema/CreateTableTypeCombobox.test.tsx` exit 0. Sprint 227 baseline + ≥ 2 new Sprint 230 cases.
3. `pnpm vitest run src/hooks/usePostgresTypes.test.ts` exit 0 with ≥ 5 cases pass.
4. `pnpm vitest run` exit 0. File count ≥ 219 (Sprint 229 baseline 218 + 1 new `usePostgresTypes.test.ts`).
5. `pnpm tsc --noEmit` exit 0.
6. `pnpm lint` exit 0.
7. `cargo build --manifest-path src-tauri/Cargo.toml` exit 0.
8. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` exit 0.
9. `cargo test --manifest-path src-tauri/Cargo.toml create_table` PASS — 16/16 unchanged (Sprint 226+227 fixtures intact; no source diff).
10. `cargo test --manifest-path src-tauri/Cargo.toml create_index` PASS — 11/11 unchanged (Sprint 228 fixtures intact).
11. `cargo test --manifest-path src-tauri/Cargo.toml add_constraint` PASS — 12/12 unchanged (Sprint 229 fixtures intact).
12. `cargo test --manifest-path src-tauri/Cargo.toml list_types` PASS — ≥ 1 SQL builder fixture (`list_types_sql_matches_canonical_fixture`).
13. `git diff --stat src/components/structure/useDdlPreviewExecution.ts` = 0 (Sprint 214 freeze).
14. `git diff --stat src/components/structure/SqlPreviewDialog.tsx` = 0 (Sprint 227 freeze).
15. `git diff --stat src/__tests__/cross-window-*.test.tsx src/__tests__/window-lifecycle.ac141.test.tsx` = 0.
16. `git diff --stat src/stores/connectionStore.ts src/stores/schemaStore.ts` = 0.
17. `git diff --stat src/lib/sql/postgresTypes.ts` shows **additive-only** lines: `git diff src/lib/sql/postgresTypes.ts | grep "^-" | grep -v "^---"` = 0 (no removals; canonical list + existing helpers byte-equivalent).
18. `git diff --stat src/lib/tauri/ddl.ts` = 0 (new wrapper goes in `schema.ts`, NOT `ddl.ts`).
19. `git diff --stat src/lib/tauri/index.ts` = 0 (barrel unchanged; `schema.ts` already re-exported).
20. `git diff --stat src/components/schema/CreateTableDialog/Header.tsx src/components/schema/CreateTableDialog/IndexesTabBody.tsx src/components/schema/CreateTableDialog/ForeignKeysTabBody.tsx` = 0 (Sprint 227+228+229 freeze).
21. `git diff --stat src/hooks/useFkReferencePicker.ts` = 0 (Sprint 229 freeze).
22. `git diff --stat src/components/ui/` = 0 (no new shadcn primitive).
23. `grep -n 'list_postgres_types' src-tauri/src/lib.rs` ≥ 1 hit (registered in `tauri::generate_handler!`).
24. `grep -n 'pub async fn list_postgres_types' src-tauri/src/commands/rdb/schema.rs` = 1 hit.
25. `grep -nE 'pg_type|pg_namespace' src-tauri/src/db/postgres/schema.rs` ≥ 2 hits (catalog query landed).
26. `grep -n 'fn list_types' src-tauri/src/db/traits.rs` = 1 hit.
27. `grep -n 'fn list_types' src-tauri/src/db/postgres.rs` = 1 hit (trait impl override).
28. `grep -n 'export async function listPostgresTypes' src/lib/tauri/schema.ts` = 1 hit.
29. `grep -n 'usePostgresTypes' src/components/schema/CreateTableDialog.tsx` ≥ 1 hit (consumer wired).
30. `grep -n 'typesSource' src/components/schema/CreateTableTypeCombobox.tsx` ≥ 1 hit (prop landed).
31. `grep -n 'filterPostgresTypesAgainst' src/lib/sql/postgresTypes.ts` = 1 hit (helper exported).
32. `grep -n 'export function usePostgresTypes' src/hooks/usePostgresTypes.ts` = 1 hit.
33. `grep -n 'invalidatePostgresTypesCache' src/hooks/usePostgresTypes.ts` ≥ 1 hit (cache punch exported).
34. `grep -nE 'it\.only|it\.skip|describe\.skip|xit|it\.todo|this\.skip\(\)' src/hooks/usePostgresTypes.test.ts src/components/schema/CreateTableTypeCombobox.test.tsx src/components/schema/CreateTableDialog.test.tsx` matches 0.
35. `git diff src/ src-tauri/ | grep "^+.*eslint-disable"` matches 0.
36. `git diff src/ | grep -E "^\+.*\bany\b"` matches 0.
37. `grep -rnE 'createCollection|create_collection' src/lib/tauri/ src-tauri/src/commands/document/` matches 0 (Mongo path untouched).
38. Vitest case asserts canonical-list head order preserved in merge (`AC-230-05` (b)).
39. Vitest case asserts error-path fallback to canonical list + `error` state non-null (`AC-230-05` (c)).
40. Vitest case asserts `pg_catalog.varchar` mapped to `varchar` label + `public.my_enum` kept qualified (`AC-230-06`).
41. Vitest case asserts `expandParametricDefault` still works (`varchar` → `varchar(255)`) when `typesSource` is the dynamic list (`AC-230-09`).
42. Manual UI smoke (OPTIONAL) — `pnpm tauri dev` → connect to PG with PostGIS → CREATE TABLE → click type cell → confirm `geometry` appears in dropdown after canonical entries. Document in `docs/sprints/sprint-230/findings.md` if performed; e2e is dead, this is a manual gate only.

### Required Evidence

- Generator must provide:
  - 변경 파일 목록 (file → purpose → LOC delta).
  - check 1-41 실행 결과 (exit code + 핵심 출력). Check 42 optional + log.
  - AC-230-01..AC-230-13 별 concrete evidence (test file path + case name + assertion line; for backend ACs the `cargo test` case name + the `grep` outputs).
  - Decisions:
    - **cache layer**: confirm module-level `Map<connectionId, CacheEntry>` memo (NOT zustand) — quote rationale + show file path.
    - **`tauri.ts` location**: confirm `src/lib/tauri/schema.ts` (NOT `ddl.ts`, NOT new `types.ts`) — quote rationale.
    - **`typesSource` prop default**: confirm `undefined` default semantics → canonical-list path; existing combobox tests pass byte-for-byte.
    - **Display label rule**: confirm `pg_catalog.X → X` strip + `<schema>.<name>` qualification for non-`pg_catalog`.
    - **PG SQL constant location**: confirm SQL captured in a `const LIST_TYPES_SQL` (or `build_list_types_sql()` fn) in `src-tauri/src/db/postgres/schema.rs`; cited by both runtime and test.
    - **`reload()` semantics**: confirm calls `invalidatePostgresTypesCache(connectionId)` then refetches.
  - Edge cases tested (concrete vitest case names):
    - **connection-not-found error** (`tauri.listPostgresTypes` mock rejects with `"Connection not found"`) → hook surfaces error + falls back to canonical.
    - **empty result** (`tauri.listPostgresTypes` mock resolves `[]`) → merged list = canonical exactly (no extras appended).
    - **duplicate-name handling** (`tauri.listPostgresTypes` mock returns `[{schema:"pg_catalog",name:"varchar",...}]`) → merged list contains `varchar` exactly once (canonical entry preserved; live duplicate skipped).
    - **stale connectionId** (concurrency: hook is rendered with `conn1`, mid-fetch the parent re-renders with `conn2`, original `conn1` Promise resolves last) → `conn1`'s response is dropped (no state mutation for `conn2`).
    - **`pg_catalog.<built-in>` collision with parametric default** (`varchar` from canonical + `pg_catalog.varchar` from live) → still works with `expandParametricDefault("varchar") === "varchar(255)"`.
  - Confirmation of Sprint 226+227+228+229 fixture preservation: `cargo test create_table create_index add_constraint` PASS unchanged; `git diff src-tauri/src/db/postgres/mutations.rs` shows 0 lines diff.
  - Confirmation that `useDdlPreviewExecution` / `SqlPreviewDialog` / `tauri.ddl.ts` / `Header` / `IndexesTabBody` / `ForeignKeysTabBody` / `useFkReferencePicker` / `connectionStore` / `schemaStore` / `tauri.index.ts` are reused without diff.
  - Mongo-path-untouched proof (check 37).
  - TDD red-state evidence (`red-state.log` or red-state commit message in `docs/sprints/sprint-230/tdd-evidence/`).
  - Manual UI smoke note if performed.
  - Assumptions made during implementation.
  - Residual risks (e.g. cache stale on disconnect — Sprint 231 polish; SQL `\_` escape syntax verified against PG 14+).
- Evaluator must cite:
  - 각 AC-230-01..AC-230-13 별 pass/fail 근거 with concrete evidence (test file:line, IPC mock-call sequence, grep output, `cargo test` output).
  - missing 또는 weak evidence findings as `P1` / `P2`.
  - regression freeze verification — Sprint 226+227+228+229 fixtures pass with no source diff; combobox carry-over Sprint 227 cases pass byte-for-byte (no `typesSource` prop supplied → canonical path).
  - cross-window invariant verification (no diff).
  - sibling DDL surface freeze verification (`SqlPreviewDialog` / `useDdlPreviewExecution` / `connectionStore` / `schemaStore` / `tauri.ddl.ts` / `Header` / `IndexesTabBody` / `ForeignKeysTabBody` / `useFkReferencePicker` / `tauri.index.ts` zero diff).
  - `postgresTypes.ts` additive-only proof (no removals).
  - Backend SQL builder fixture verification (`list_types_sql_matches_canonical_fixture` PASS + the const string contains the canonical filter set).
  - Frontend hook contract verification (loading-canonical-first + silent merge-replace + error-fallback + module-memo cache + concurrent-share Promise + stale connectionId drop).
  - `typesSource` prop back-compat verification (Sprint 227 combobox tests pass byte-for-byte).

## Test Requirements

### Unit Tests (필수)

- **AC-230-01 (Tauri command registered)**: covered by `cargo build` + grep on `lib.rs` (no runtime test needed — registration is a compile-time check).
- **AC-230-02 (PG SQL canonical filter)**: 1 Rust unit test `list_types_sql_matches_canonical_fixture` — asserts `LIST_TYPES_SQL` const matches the fixture byte-for-byte.
- **AC-230-03 (RdbAdapter trait extension + PG override)**: covered by `cargo build` + `cargo clippy -D warnings` (proves no other adapter is broken by the trait extension).
- **AC-230-04 (Frontend wrapper `tauri.listPostgresTypes`)**: covered by `pnpm tsc --noEmit` + grep — no separate unit test (trivial 1-line `invoke` wrapper, pattern-matches sibling `listSchemas`).
- **AC-230-05 (`usePostgresTypes` contract)**: ≥ 5 vitest cases in `src/hooks/usePostgresTypes.test.ts`:
  - `mount triggers fetch + sets types to merged list on resolve` (AC-230-05 a).
  - `success merge preserves canonical order at the head + appends non-duplicate live entries` (AC-230-05 b).
  - `fetch error surfaces error + falls back to canonical + loading false` (AC-230-05 c + AC-230-12 error path).
  - `reload() refetches and updates cache` (AC-230-05 d).
  - `cache hit on second mount with same connectionId does not re-call the Tauri wrapper` (AC-230-05 e).
- **AC-230-06 (Display label transformation)**: 1 vitest case — input mix of `pg_catalog`/`public`/`extensions` schemas → label rule verified.
- **AC-230-07 (`typesSource` prop)**: ≥ 2 vitest cases in `CreateTableTypeCombobox.test.tsx`:
  - `typesSource={["geometry","public.my_enum","varchar","uuid"]} + value="geo"` → suggestions include `geometry`.
  - `typesSource omitted` → behaviour matches Sprint 227 baseline (canonical list).
- **AC-230-08 (Dialog wires hook + prop)**: 1 vitest case in `CreateTableDialog.test.tsx` — mount the dialog with mocked `tauri.listPostgresTypes`, assert mock called once with the dialog's `connectionId`, assert combobox suggestions include the merged result.
- **AC-230-09 (Filter / expand parity)**: 1 vitest case — type `var` against dynamic list, confirm `varchar` row's Enter triggers `onChange("varchar(255)")` (parametric expansion intact); type `INT` → case-insensitive match against canonical (`integer/bigint/smallint/interval`).
- **AC-230-10 (Loading UX)**: 1 vitest case — combobox shows canonical entries instantly on mount (no waiting for fetch), no spinner present, after fetch resolves the merged list silently replaces.
- **AC-230-11 (Cache invalidation surface)**: 1 vitest case — populate cache for `"conn1"`, call `invalidatePostgresTypesCache("conn1")`, mount again → fetch is called fresh.
- **Edge case (concurrent connectionId switch)**: 1 vitest case — hook mounts with `conn1`, fetch in flight, parent re-renders with `conn2`, `conn1`'s Promise resolves last → no state mutation for `conn2`.
- **Edge case (empty result)**: 1 vitest case — `tauri.listPostgresTypes` resolves `[]` → merged list = canonical exactly.
- **Edge case (duplicate name)**: 1 vitest case — live response includes `pg_catalog.varchar` → merged list contains `varchar` once (canonical entry preserved).
- **AC-230-12 / AC-230-13 (Coverage)**: covered by checks 1-4.

Total minimum new vitest cases: **≥ 5 in `usePostgresTypes.test.ts` + ≥ 2 in `CreateTableTypeCombobox.test.tsx` + ≥ 1 in `CreateTableDialog.test.tsx`**. Plus ≥ 1 Rust unit test (`list_types_sql_matches_canonical_fixture`). Sprint 226+227+228+229 carry-over cases pass byte-for-byte.

### Coverage Target

- 신규 `src/hooks/usePostgresTypes.ts`: 라인 ≥ 70%.
- 수정 `src/components/schema/CreateTableTypeCombobox.tsx`: 라인 ≥ 70% (Sprint 227 baseline already meets; new branch covered by Sprint 230 cases).
- 신규 `src-tauri/src/db/postgres/schema.rs::list_types` 함수: branch ≥ 70% (single SQL builder + sqlx mapper — the unit test fixture covers the SQL string; live execution covered indirectly by the Tauri command being callable).
- CI baseline: 라인 40% / 함수 40% / 브랜치 35%.

### Scenario Tests (필수)

- [x] **Happy path** — connection mounted → `usePostgresTypes(connectionId)` → fetch resolves with `[pg_catalog.varchar, public.my_enum, extensions.geometry]` → combobox suggestions include `varchar` (deduped) + `public.my_enum` + `extensions.geometry`. Typing `geo` filters to `geometry`. Pressing Enter on `geometry` calls `onChange("extensions.geometry")` (verbatim from merged list).
- [x] **Empty / 누락 입력** — `tauri.listPostgresTypes` resolves `[]` → merged list = canonical exactly (no extras). `tauri.listPostgresTypes` rejects → `error` non-null + canonical fallback active. `connectionId === ""` (edge: dialog mounted with empty conn) → fetch skipped (or fetch attempted + rejects gracefully — Generator's call; document in findings).
- [x] **에러 복구** — fetch error → fall back to canonical, surface `error`, combobox stays usable. Subsequent `reload()` retries the fetch (cache punched).
- [x] **경계 조건 / 동시성** — concurrent `usePostgresTypes(connectionId)` calls on the same connection share one in-flight Promise (mock invoked once). Hook re-renders with new `connectionId` mid-fetch → stale response dropped via `latestConnectionIdRef.current` compare.
- [x] **상태 전이** — mount → loading=true (canonical visible) → resolve → loading=false (merged visible). reload() → loading=true (cached merged visible while refetch in flight) → resolve → loading=false (new merged visible).
- [x] **에지 케이스** — duplicate name (live `pg_catalog.varchar` + canonical `varchar`) → merged contains `varchar` once. Live entry with empty `name` (defensive) → filtered out before merge. Live entry with `schema === "pg_toast"` (should never happen due to backend filter) → filtered out as defense-in-depth. `expandParametricDefault("varchar") === "varchar(255)"` works with dynamic list because canonical bare `varchar` is in the merged head.
- [x] **기존 기능 회귀 없음** — Sprint 226 `composite_pk_byte_equivalent` Rust fixture passes unchanged; Sprint 227 comment-fixture suite passes unchanged; Sprint 228 `create_index` fixture suite passes unchanged; Sprint 229 `add_constraint_*` fixtures (incl. ON DELETE/UPDATE) pass unchanged; Sprint 226+227+228+229 vitest cases pass byte-for-byte (no assertion-text flips); cross-window suite untouched; `postgresTypes.ts` canonical list + helpers byte-equivalent (additive-only diff).

## Test Script / Repro Script

1. baseline (before any change):
   ```sh
   pnpm vitest run src/components/schema/CreateTableDialog.test.tsx src/components/schema/CreateTableTypeCombobox.test.tsx
   pnpm vitest run src/components/schema/CreateTableDialog/IndexesTabBody.test.tsx src/components/schema/CreateTableDialog/ForeignKeysTabBody.test.tsx
   cargo test --manifest-path src-tauri/Cargo.toml create_table create_index add_constraint --no-run
   ```
2. Generator 작업 후 — primary command profile:
   ```sh
   pnpm vitest run src/hooks/usePostgresTypes.test.ts
   pnpm vitest run src/components/schema/CreateTableTypeCombobox.test.tsx
   pnpm vitest run src/components/schema/CreateTableDialog.test.tsx
   cargo test --manifest-path src-tauri/Cargo.toml list_types
   cargo test --manifest-path src-tauri/Cargo.toml create_table
   cargo test --manifest-path src-tauri/Cargo.toml create_index
   cargo test --manifest-path src-tauri/Cargo.toml add_constraint
   ```
3. Verification 4-set + clippy:
   ```sh
   pnpm vitest run
   pnpm tsc --noEmit
   pnpm lint
   cargo build --manifest-path src-tauri/Cargo.toml
   cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
   ```
4. Surface + freeze 검증:
   ```sh
   git diff --stat src/components/structure/useDdlPreviewExecution.ts src/components/structure/SqlPreviewDialog.tsx
   git diff --stat src/stores/schemaStore.ts src/stores/connectionStore.ts
   git diff --stat src/lib/tauri/ddl.ts src/lib/tauri/index.ts
   git diff --stat src/components/ui/
   git diff --stat src/components/schema/CreateTableDialog/Header.tsx
   git diff --stat src/components/schema/CreateTableDialog/IndexesTabBody.tsx
   git diff --stat src/components/schema/CreateTableDialog/ForeignKeysTabBody.tsx
   git diff --stat src/hooks/useFkReferencePicker.ts
   git diff --stat src/__tests__/cross-window-*.test.tsx src/__tests__/window-lifecycle.ac141.test.tsx
   git diff src/lib/sql/postgresTypes.ts | grep "^-" | grep -v "^---"
   grep -nE 'list_postgres_types' src-tauri/src/lib.rs
   grep -n 'pub async fn list_postgres_types' src-tauri/src/commands/rdb/schema.rs
   grep -nE 'pg_type|pg_namespace' src-tauri/src/db/postgres/schema.rs
   grep -n 'fn list_types' src-tauri/src/db/traits.rs src-tauri/src/db/postgres.rs
   grep -n 'export async function listPostgresTypes' src/lib/tauri/schema.ts
   grep -n 'usePostgresTypes' src/components/schema/CreateTableDialog.tsx
   grep -n 'typesSource' src/components/schema/CreateTableTypeCombobox.tsx
   grep -n 'filterPostgresTypesAgainst' src/lib/sql/postgresTypes.ts
   grep -n 'export function usePostgresTypes\|invalidatePostgresTypesCache' src/hooks/usePostgresTypes.ts
   grep -rnE 'createCollection|create_collection' src/lib/tauri/ src-tauri/src/commands/document/
   git diff src/ src-tauri/ | grep "^+.*eslint-disable"
   git diff src/ | grep -E "^\+.*\bany\b"
   grep -nE 'it\.only|it\.skip|describe\.skip|xit|it\.todo' src/hooks/usePostgresTypes.test.ts src/components/schema/CreateTableTypeCombobox.test.tsx src/components/schema/CreateTableDialog.test.tsx
   ```
5. Optional manual UI smoke (record in `docs/sprints/sprint-230/findings.md` if performed):
   ```sh
   pnpm tauri dev
   # → connect to PG (PostGIS-enabled if available)
   # → expand schema → right-click → Create Table…
   # → click on a column-type cell
   # → confirm dropdown shows canonical entries (varchar, integer, ...) immediately
   # → after a short delay, scroll the dropdown — confirm `geometry` (PostGIS)
   #   and any `public.my_enum` / `public.my_composite` user-defined types
   #   appear after the canonical entries
   # → type `geo` → confirm `geometry` filters in
   # → press Enter → confirm column type input is set to `geometry`
   ```

## Ownership

- Generator: general-purpose agent (Phase 3, harness skill).
- Write scope: backend (`src-tauri/src/models/schema.rs` additive `PostgresTypeInfo`, `src-tauri/src/commands/rdb/schema.rs` additive command, `src-tauri/src/db/traits.rs` additive trait method, `src-tauri/src/db/postgres.rs` additive trait override, `src-tauri/src/db/postgres/schema.rs` additive inherent method + `LIST_TYPES_SQL` const + 1 unit test, `src-tauri/src/lib.rs` 1-line registration) + frontend (`src/lib/tauri/schema.ts` additive wrapper, `src/types/schema.ts` additive `PostgresTypeInfo`, `src/lib/sql/postgresTypes.ts` additive `filterPostgresTypesAgainst` helper only — canonical list + existing helpers byte-equivalent, `src/hooks/usePostgresTypes.ts` new hook, `src/hooks/usePostgresTypes.test.ts` new test file, `src/components/schema/CreateTableTypeCombobox.tsx` surgical `typesSource` prop + branch, `src/components/schema/CreateTableTypeCombobox.test.tsx` ≥ 2 new cases, `src/components/schema/CreateTableDialog.tsx` surgical hook wiring + prop pass, `src/components/schema/CreateTableDialog.test.tsx` ≥ 1 new case + mock surface extension) + sprint docs (`handoff.md`, `findings.md`, `tdd-evidence/red-state.log`) + `docs/PLAN.md` row 5.
- 변경 금지: `useDdlPreviewExecution.ts` / `SqlPreviewDialog.tsx` / `useSafeModeGate*` / `analyzeStatement*` / `ColumnsEditor*` / `IndexesEditor*` / `ConstraintsEditor*` / `schemaStore.ts` / `connectionStore.ts` / `src/lib/tauri/ddl.ts` / `src/lib/tauri/index.ts` (barrel) / `src/lib/zustand-ipc-bridge.ts` / `src/lib/window-label.ts` / Mongo paths (`src/components/schema/DocumentDatabaseTree*` / `src-tauri/src/commands/document/`) / sibling `SchemaTree.*` test files / cross-window regression test (`src/__tests__/cross-window-*.test.tsx`) / `src/__tests__/window-lifecycle.ac141.test.tsx` / `main.tsx` / Sprint 226 + 227 + 228 + 229 backend fixtures (`mutations.rs` body unchanged) / `src-tauri/src/db/postgres/mutations.rs` / `src/components/schema/CreateTableDialog/Header.tsx` / `src/components/schema/CreateTableDialog/IndexesTabBody.tsx` / `src/components/schema/CreateTableDialog/ForeignKeysTabBody.tsx` / `src/hooks/useFkReferencePicker.ts` / canonical entries of `src/lib/sql/postgresTypes.ts` (additions to a new helper are fine; existing exports byte-equivalent).

## Exit Criteria

- Open `P1` / `P2` findings: `0`.
- Required checks passing: `yes` (1-41 모두; 42 optional).
- Acceptance criteria evidence linked in `handoff.md` — AC-230-01..AC-230-13 each cited with concrete test/grep evidence.
- **본 sprint 후 Phase 27 sprint 5 종료** — dynamic PG type list lands; Sprint 231 (UX 종합 polish: reorder + table COMMENT + schema picker move + type coloring + cross-tab visual feedback) plugs into the same `CreateTableDialog` shell + the `usePostgresTypes` hook (the new `type_kind` field is ready for Sprint 231's coloring) without further structural change.
- TDD evidence (`red-state.log` 또는 red-state commit) recorded in `docs/sprints/sprint-230/tdd-evidence/`.
- e2e closure dependency: **none**. `lefthook.yml:5_e2e` stays disabled per ADR 0019. Phase 27 e2e smoke deferred under `[DEFERRED-PHASE-27-E2E]` marker.
