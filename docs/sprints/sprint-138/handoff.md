# Sprint 138 — Handoff

## Summary

Sprint 138 splits the formerly-monolithic `ConnectionDialog` into a
DBMS-aware shell + 5 sub-components (one per `DatabaseType`). The
"user defaults to `postgres` for every DBMS" bug surfaced by the
2026-04-27 user check is fixed at its source: a new
`DATABASE_DEFAULT_FIELDS` map carries per-DBMS defaults for `port`,
`user`, and `database`, and the dialog routes through the matching
sub-component on every `db_type` change. The original port-only
`DATABASE_DEFAULTS` map is preserved (back-compat for unrelated call
sites). All 7 verification gates pass.

| # | Command | Status |
|---|---|---|
| 1 | `pnpm vitest run` | 2095 passed (134 files) |
| 2 | `pnpm tsc --noEmit` | 0 errors |
| 3 | `pnpm lint` | 0 errors |
| 4 | `pnpm contrast:check` | 0 new violations (64 allowlisted) |
| 5 | `cargo test --manifest-path src-tauri/Cargo.toml --lib` | 272 passed, 2 ignored |
| 6 | `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` | clean |
| 7 | `pnpm exec eslint e2e/**/*.ts` | 0 errors |

## Changed Files

| Path | Purpose |
|------|---------|
| `src/types/connection.ts` | Added `ConnectionDefaultFields` interface + `DATABASE_DEFAULT_FIELDS` map (port + user + database per DBMS). Added `parseSqliteFilePath()` helper and made `parseConnectionUrl()` recognise `sqlite:` URLs. The original port-only `DATABASE_DEFAULTS` is unchanged (back-compat). |
| `src/types/connection.test.ts` | +9 tests: `DATABASE_DEFAULT_FIELDS` per-DBMS expectations + "only PG defaults user to postgres" regression guard + 4 SQLite path/URL fallback tests. |
| `src/components/connection/forms/PgFormFields.tsx` | NEW — PG host/port/user/password/database row(s). Owns the "user defaults to `postgres`" path explicitly. |
| `src/components/connection/forms/PgFormFields.test.tsx` | NEW — 2 tests (default values + onChange propagation). |
| `src/components/connection/forms/MysqlFormFields.tsx` | NEW — MySQL row shape; defaults port=3306, user=root, database=''. |
| `src/components/connection/forms/MysqlFormFields.test.tsx` | NEW — 2 tests including explicit anti-regression `user.value !== "postgres"`. |
| `src/components/connection/forms/SqliteFormFields.tsx` | NEW — SQLite-only file path input; deliberately omits host/port/user/password rows. Fallback uses a text input — no native picker (see Decision 2 below). |
| `src/components/connection/forms/SqliteFormFields.test.tsx` | NEW — 2 tests asserting field absence + path propagation. |
| `src/components/connection/forms/MongoFormFields.tsx` | NEW — Mongo-specific shape (auth_source / replica_set / tls_enabled, optional user/password labels). |
| `src/components/connection/forms/MongoFormFields.test.tsx` | NEW — 2 tests (field presence + `tls_enabled` toggle propagation). |
| `src/components/connection/forms/RedisFormFields.tsx` | NEW — Redis-specific shape with numeric DB index field clamped to 0..15 and TLS toggle. |
| `src/components/connection/forms/RedisFormFields.test.tsx` | NEW — 2 tests (defaults + clamp [0, 15]). |
| `src/components/connection/ConnectionDialog.tsx` | Refactored: `applyDbTypeChange` now reads `DATABASE_DEFAULT_FIELDS` (resets port + user + database simultaneously, preserves host/name/group/color/environment). Inline form column replaced by an exhaustive `switch (form.db_type)` that routes to one of the 5 sub-components, with `assertNever` as the default. URL mode now falls back to `parseSqliteFilePath` when SQLite is selected. SQLite-aware Save validation (database file path required instead of host). |
| `src/components/connection/ConnectionDialog.test.tsx` | Updated SQLite-port test to assert the new field absence; added 1 test for AC-S138-02 ("PG → MySQL preserves host but resets user from postgres to root"); added 5 DBMS scenario tests (one per DBMS) under `Sprint 138: DBMS-aware form shape`. |

## Verification Commands (last 20 lines each)

### 1. `pnpm vitest run`

```
 RUN  v4.1.3 /Users/felix/Desktop/study/view-table


 Test Files  134 passed (134)
      Tests  2095 passed (2095)
   Start at  02:32:42
   Duration  21.98s (transform 5.29s, setup 8.15s, import 34.98s, tests 52.36s, environment 81.07s)
```

### 2. `pnpm tsc --noEmit`

```
(no output — exit 0)
```

### 3. `pnpm lint`

```
> table-view@0.1.0 lint /Users/felix/Desktop/study/view-table
> eslint .

(exit 0)
```

### 4. `pnpm contrast:check`

```
> table-view@0.1.0 contrast:check /Users/felix/Desktop/study/view-table
> tsx scripts/check-theme-contrast.ts

WCAG AA contrast: 72 themes / 144 theme-modes / 864 pairs — 0 new violations (64 allowlisted)
```

### 5. `cargo test --manifest-path src-tauri/Cargo.toml --lib`

```
test storage::tests::test_save_connection_empty_password_not_encrypted ... ok
test storage::tests::test_save_connection_rejects_duplicate_name ... ok
test storage::tests::test_save_connection_same_name_same_id_succeeds ... ok
test storage::tests::test_save_connection_updates_existing_by_id ... ok
test storage::tests::test_save_connection_with_none_preserves_existing ... ok
test storage::tests::test_save_group_adds_and_updates ... ok
test storage::tests::test_save_multiple_connections ... ok

test result: ok. 272 passed; 0 failed; 2 ignored; 0 measured; 0 filtered out; finished in 0.04s
```

### 6. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`

```
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.38s
```

### 7. `pnpm exec eslint e2e/**/*.ts`

```
(no output — exit 0)
```

## AC Coverage

### AC-S138-01 — Per-DBMS form shape

- **PG** (`PgFormFields.tsx`): host, port (default 5432), user (default
  `postgres`), password, database (default placeholder `postgres`).
  Asserted by `Sprint 138: DBMS-aware form shape > AC-S138-01 PG: defaults
  port=5432, user=postgres, database=postgres` and
  `PgFormFields > renders host, port, user, password, and database
  fields with PG defaults`.
- **MySQL** (`MysqlFormFields.tsx`): host, port (3306), user (`root`),
  password, database. Asserted by `AC-S138-01 / 03 MySQL: defaults
  port=3306, user=root (NOT postgres)` and `MysqlFormFields > renders
  MySQL defaults — user=root (NOT postgres), port=3306`.
- **SQLite** (`SqliteFormFields.tsx`): file path input only. Asserted by
  `AC-S138-04 SQLite: file path field present, host/port/user/password
  absent` and `SqliteFormFields > renders the file path field and OMITS
  host/port/user/password`.
- **MongoDB** (`MongoFormFields.tsx`): host, port (27017), user
  (optional), password (optional), database (optional), auth_source,
  replica_set, tls_enabled. Asserted by `AC-S138-01 Mongo: auth_source /
  replica_set / tls_enabled present + user defaults to empty` and
  `MongoFormFields > renders Mongo-specific fields`.
- **Redis** (`RedisFormFields.tsx`): host, port (6379), username
  (optional), password (optional), database index (0..15, default 0),
  tls_enabled. Asserted by `AC-S138-01 Redis: database index defaults
  to 0 and clamps to 0..15` and `RedisFormFields > clamps Redis
  database index to the [0, 15] range`.

### AC-S138-02 — `db_type` change resets DBMS defaults but preserves host

- `ConnectionDialog.tsx::applyDbTypeChange` reads
  `DATABASE_DEFAULT_FIELDS[dbType]` and resets `port`, `user`,
  `database` simultaneously (plus `paradigm`). All other fields
  (`name`, `host`, `group_id`, `color`, `environment`,
  `connection_timeout`, `keep_alive_interval`, `auth_source`,
  `replica_set`, `tls_enabled`) survive — including the user-typed
  `host` value, which is the regression guard the sprint contract
  explicitly calls out.
- Asserted by `Sprint 138: switching from PG to MySQL preserves host
  but resets user from postgres to root` (under the existing Sprint 108
  describe — same swap path, different observable).

### AC-S138-03 — No DBMS hard-codes user="postgres" except PG

- `DATABASE_DEFAULT_FIELDS` defines `user` as `"postgres"` only for
  `postgresql`; MySQL is `"root"` and the rest are empty strings.
- Asserted by `DATABASE_DEFAULT_FIELDS (Sprint 138) > only PG defaults
  user to 'postgres' (regression guard for #4)` and the per-DBMS
  scenario tests in `ConnectionDialog.test.tsx`.

### AC-S138-04 — SQLite has no host/port (and no user/password) fields

- `SqliteFormFields` deliberately renders only `Database File`.
- Asserted by:
  - `SqliteFormFields > renders the file path field and OMITS
    host/port/user/password`
  - `Sprint 138: DBMS-aware form shape > AC-S138-04 SQLite: file path
    field present, host/port/user/password absent`
  - The updated `Sprint 108` test
    `auto-updates port when current port is 0 (sqlite default → mysql)`
    now also pins `screen.queryByLabelText("Port")` to be absent in
    SQLite mode.

### AC-S138-05 — Sub-component routing + `assertNever`

- `ConnectionDialog.tsx::renderDbmsFields()` is an exhaustive
  `switch (form.db_type)` with `default: return assertNever(form.db_type)`.
  `assertNever` is imported from `src/lib/paradigm.ts` (existing
  utility — generic exhaustive guard from Sprint 65).
- Adding a new `DatabaseType` variant without updating this switch will
  fail TypeScript compilation, not silently fall through. There is no
  `any` cast anywhere in the dialog.

### AC-S138-06 — URL parsing per-paradigm + SQLite fallback

- `parseConnectionUrl` continues to handle PG / MySQL / Mongo / Redis
  unchanged. The pre-Sprint-138 paradigm-tagging tests in
  `connection.test.ts` (Sprint 65) still pass.
- New: `parseConnectionUrl` recognises `sqlite:/path` URLs and produces
  a SQLite draft with the path stored in `database`. New helper
  `parseSqliteFilePath` accepts a raw file path and trims whitespace.
- The dialog wires this in: when the URL parse fails AND `db_type`
  is `sqlite`, it calls `parseSqliteFilePath(urlValue)` as a fallback.
- Asserted by `parseSqliteFilePath / sqlite URL fallback (Sprint 138)`
  (4 tests).

### AC-S138-07 — 5 DBMS vitest scenarios

- See `src/components/connection/ConnectionDialog.test.tsx` →
  `describe("Sprint 138: DBMS-aware form shape")`:
  - `AC-S138-01 PG: defaults port=5432, user=postgres, database=postgres`
  - `AC-S138-01 / 03 MySQL: defaults port=3306, user=root (NOT postgres)`
  - `AC-S138-04 SQLite: file path field present, host/port/user/password absent`
  - `AC-S138-01 Mongo: auth_source / replica_set / tls_enabled present + user defaults to empty`
  - `AC-S138-01 Redis: database index defaults to 0 and clamps to 0..15`
- Plus the cross-DBMS swap test
  `Sprint 138: switching from PG to MySQL preserves host but resets
  user from postgres to root` (lives in the existing Sprint 108
  describe block).
- Plus 10 sub-component tests (2 per form file).

### AC-S138-08 — All 7 gates green, no backend change

- See verification table at top of handoff. All 7 commands exit 0.
- The backend `connection_test` command and `ConnectionConfig` schema
  are unchanged; the form payload (`ConnectionDraft`) shape is
  unchanged. The only addition on the type side is the
  `DATABASE_DEFAULT_FIELDS` map and the `parseSqliteFilePath` helper —
  both new exports, no breaking renames.

## Decision Notes

### 1. `DATABASE_DEFAULTS` extended or replaced?

**Extended in parallel, not replaced.** `DATABASE_DEFAULTS` is a
port-only `Record<DatabaseType, number>` used by the legacy
"isDefaultOrEmpty" port check in `ConnectionDialog.tsx` and by URL
parsing. Replacing it would have rippled into 3 files and required
re-tagging the URL parse return shape. The cleaner move was to add
`DATABASE_DEFAULT_FIELDS` (richer record with `port`/`user`/`database`)
alongside the existing map and have the new code read the new map.
Future cleanup may unify them — out of scope for S138.

### 2. SQLite file picker — native plugin or text fallback?

**Text input fallback.** `src-tauri/Cargo.toml` does NOT include
`tauri-plugin-dialog`, and adding it touches Rust capability grants
plus front-end `@tauri-apps/plugin-dialog` install — out of scope per
"Do NOT change backend" hard rule. The SQLite form ships a plain text
input with a hint about absolute paths. A future sprint can swap the
input for a native picker without changing `SqliteFormFieldsProps`.

### 3. User-input preservation policy on `db_type` swap

When the user changes `db_type`, these fields are **reset** to the new
DBMS defaults from `DATABASE_DEFAULT_FIELDS`:
- `port`
- `user`
- `database`
- `paradigm` (derived from `db_type`)

These fields are **preserved** (assumed to be user intent, not
DBMS-coupled):
- `name`
- `host`
- `group_id`
- `color`
- `environment`
- `connection_timeout`
- `keep_alive_interval`
- `auth_source` / `replica_set` / `tls_enabled` (Mongo extension fields
  hang around but are simply ignored by non-Mongo `connection_test`)

This matches the contract's "host 등 사용자 입력은 보수적으로 보존"
clause and the master-spec edge case "DBMS-aware form db_type 전환".

## Assumptions

1. **`assertNever` reused from `src/lib/paradigm.ts`**. The existing
   helper is typed as `(value: never) => never` — generic enough for
   any exhaustive switch, even though the source file is named
   `paradigm.ts`. Did not introduce a duplicate `src/lib/assertNever.ts`
   to avoid two import sources for the same primitive. If a future
   sprint extracts it, both files can re-export the same function.

2. **PG database default placeholder, not value**. `createEmptyDraft()`
   pre-Sprint-138 sets `database: ""`. We did not change the empty draft
   to set `database: "postgres"` because that would (a) churn unrelated
   tests that assert empty default, (b) cause the user's first save
   without typing anything to land on the `postgres` system DB which
   may be a footgun. Instead the PG form's input `placeholder` is
   `"postgres"` (the documented default), and `applyDbTypeChange` does
   set `database: "postgres"` when the user *switches into* PG via the
   select. The 5 per-DBMS scenario test for PG accommodates this by
   asserting the placeholder, not the value.

3. **SQLite "Database File" requires non-empty input on save**. New
   guard in `handleSave`: when `db_type === "sqlite"`, `database` must
   be non-empty (file path) instead of `host` being non-empty. This
   matches the master-spec edge case "SQLite file path 빈 입력 거부".
   Existing `Host is required` validation is bypassed for SQLite.

4. **`DATABASE_DEFAULTS` (port-only) is not deleted**. `parseConnectionUrl`
   still falls back to it for non-SQLite cases. URL-mode parse depends
   on the simpler shape; refactoring to `DATABASE_DEFAULT_FIELDS[type].port`
   is mechanical but felt out of scope for a sprint focused on the form.

5. **Redis DB index typed as string in `database`**. `ConnectionDraft.database`
   is `string`. Redis numeric index goes there as `"0".."15"`. The
   form clamps via `clampDbIndex` and the input type is `number`, but
   the stored value remains a string for ConnectionConfig parity.

6. **Mongo extension fields not cleared on type swap**. When the user
   switches from MongoDB to MySQL, the latent `auth_source` /
   `replica_set` / `tls_enabled` slots remain on the draft. The
   backend serialiser (Sprint 65) drops `null`/empty Mongo fields for
   non-Mongo connections, so this is harmless on save.

## Risks / Gaps

- **Native SQLite file picker deferred**. A user has to paste / type a
  path. This is the same UX SQLite users had pre-S138 (the field just
  used to be misleadingly called "Database" alongside host/port). A
  follow-up that adds `@tauri-apps/plugin-dialog` would replace the
  text input with `<input type="file" /> + button` — straightforward
  but out of scope.

- **No DB-type-aware test for `DATABASE_DEFAULTS` swap inside URL
  parse**. The PG/MySQL/Mongo/Redis URL cases still read
  `DATABASE_DEFAULTS[dbType]` (the port-only map) for default port
  fallback. If a future sprint replaces this with `DATABASE_DEFAULT_FIELDS`,
  it should add a test for the URL-default-port path. Not blocking
  S138.

- **Per-form sub-components share the password block code**. PG /
  MySQL / Mongo / Redis all render a near-identical password input
  with the "Clear stored password" badge. We deliberately copied the
  block (4× ~30 LOC) rather than introduce a shared `<PasswordField>`
  abstraction in the same sprint — a future refactor sprint can DRY
  it without changing behaviour.

- **None blocking**. All 7 verification gates green. No pending P1/P2
  findings.

## References

- Contract: `docs/sprints/sprint-138/contract.md`
- Execution brief: `docs/sprints/sprint-138/execution-brief.md`
- Master spec: `docs/sprints/sprint-134/spec.md` (Phase 10 — S138 section)
- Origin lesson: `memory/lessons/2026-04-27-workspace-toolbar-ux-gaps/memory.md`
- S134 baseline: `docs/sprints/sprint-134/handoff.md`
- S135 baseline: `docs/sprints/sprint-135/handoff.md`
- S136 baseline: `docs/sprints/sprint-136/handoff.md`
- S137 baseline: `docs/sprints/sprint-137/handoff.md`
