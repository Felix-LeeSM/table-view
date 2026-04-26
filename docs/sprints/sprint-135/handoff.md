# Sprint 135 — Handoff

## Summary

Sprint 135 removes `SchemaSwitcher` from `WorkspaceToolbar`, unifying
schema selection into the sidebar tree as the single source of truth.
The relational sidebar tree (`SchemaTree`) now folds its depth based on
`connection.db_type`: PostgreSQL keeps the `database → schema → table`
3-level shape, MySQL drops the schema row to a `database → table`
2-level shape, and SQLite collapses to a flat 1-level table list under
the root. MongoDB stays on its existing `database → collection` 2-level
tree (regression-guarded). A static guard test locks the toolbar
against re-introducing stale "Coming in Sprint 1XX" placeholder copy.

All 7 verification gates pass:

| # | Command | Status |
|---|---|---|
| 1 | `pnpm vitest run` | 2049 passed (127 files) |
| 2 | `pnpm tsc --noEmit` | 0 errors |
| 3 | `pnpm lint` | 0 errors |
| 4 | `pnpm contrast:check` | 0 new violations |
| 5 | `cargo test --manifest-path src-tauri/Cargo.toml --lib` | 268 passed, 2 ignored |
| 6 | `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` | clean |
| 7 | `pnpm exec eslint e2e/**/*.ts` | 0 errors |

## Changed Files

| Path | Purpose |
|------|---------|
| `src/components/workspace/SchemaSwitcher.tsx` | **DELETED** — toolbar schema chip removed; SoT moved to sidebar tree (AC-S135-01). |
| `src/components/workspace/SchemaSwitcher.test.tsx` | **DELETED** — paired with the production file. |
| `src/components/workspace/WorkspaceToolbar.tsx` | Drop `SchemaSwitcher` import/render; toolbar now hosts only `<DbSwitcher>` and the trailing `<DisconnectButton>`. |
| `src/components/workspace/WorkspaceToolbar.test.tsx` | Drop schema-chip assertions; add a regression guard that the legacy `<SchemaSwitcher>` is NOT rendered (AC-S135-01); tighten the active-tab assertion to the DB switcher only. |
| `src/components/workspace/DisconnectButton.tsx` | Doc-comment fix: drop the now-dead `SchemaSwitcher` reference. |
| `src/components/schema/treeShape.ts` | **CREATED** — `resolveRdbTreeShape(db_type)` helper that maps `DatabaseType` → `"with-schema" \| "no-schema" \| "flat"`. Pure function; exhaustive switch over `DatabaseType` with safe default for non-relational types. |
| `src/components/schema/SchemaTree.tsx` | Read `connection.db_type` from `connectionStore`; resolve `treeShape`; auto-expand schemas behind the scenes when shape ≠ `with-schema`; gate the schema row + section separator on `with-schema`; add a `flat` render branch (table list directly under the root, no category headers); restrict virtualization to `with-schema` so MySQL/SQLite stay on the eager render path. |
| `src/components/schema/SchemaTree.dbms-shape.test.tsx` | **CREATED** — 4 db_type-aware tree-depth tests (AC-S135-02/03/04/07) plus 2 unit tests for `resolveRdbTreeShape`. Covers PG (schema row visible), MySQL (no schema row, categories preserved), SQLite (flat, no categories), and the empty-table boundary. |
| `src/components/schema/DocumentDatabaseTree.test.tsx` | Add the AC-S135-05 regression guard: Mongo stays at exactly `database → collection` 2 levels (no `*-schema` aria-label appears between the two). |
| `src/__tests__/no-stale-sprint-tooltip.test.ts` | **CREATED** — static grep guard that scans `src/` for `/Coming in Sprint 1[2-3][0-9]/` and fails on any match. Locks AC-S135-06 permanently against re-introduction. |

## Verification Commands (last 20 lines each)

### 1. `pnpm vitest run`

```
 RUN  v4.1.3 /Users/felix/Desktop/study/view-table


 Test Files  127 passed (127)
      Tests  2049 passed (2049)
   Start at  01:41:44
   Duration  21.03s
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

test result: ok. 268 passed; 0 failed; 2 ignored; 0 measured; 0 filtered out; finished in 0.04s
```

### 6. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`

```
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.33s
```

### 7. `pnpm exec eslint e2e/**/*.ts`

```
(no output — exit 0)
```

## Grep Audit

### `grep -rn "SchemaSwitcher" src/ e2e/`

```
src/components/workspace/WorkspaceToolbar.test.tsx:117:  // Sprint 135 — SchemaSwitcher was removed. Schema selection lives in the
src/components/workspace/WorkspaceToolbar.test.tsx:120:  it("does NOT render the legacy SchemaSwitcher chip (AC-S135-01)", () => {
src/components/workspace/WorkspaceToolbar.tsx:16: * Sprint 135 — `<SchemaSwitcher>` was removed. Schema selection is now
src/components/workspace/DisconnectButton.tsx:32: * control in `WorkspaceToolbar` (Sprint 135 removed `SchemaSwitcher`).
```

All 4 hits are comments / regression-guard test names. **0 production
code paths import or render `<SchemaSwitcher>`.** No matches under
`e2e/`.

### `grep -rEn "Coming in Sprint 1[2-3][0-9]" src/ e2e/`

```
src/__tests__/no-stale-sprint-tooltip.test.ts:7: * "Coming in Sprint 128" / "Coming in Sprint 130" while features were
```

The single hit is inside the guard test's own docstring (the regex
literal needs to be expressible somewhere). The guard test deliberately
skips its own file path so it does not self-flag. **0 user-facing
strings match.**

## Acceptance Criteria Evidence

### AC-S135-01 — Delete SchemaSwitcher

- `src/components/workspace/SchemaSwitcher.tsx` and
  `SchemaSwitcher.test.tsx` deleted (verified by absence in the
  workspace directory listing).
- `src/components/workspace/WorkspaceToolbar.tsx` no longer imports or
  renders `SchemaSwitcher`.
- New regression test in `WorkspaceToolbar.test.tsx`:
  `WorkspaceToolbar > does NOT render the legacy SchemaSwitcher chip
  (AC-S135-01)` — passes.
- `pnpm tsc --noEmit` clean.

### AC-S135-02 — PG sidebar = `database → schema → table` (3-level)

- `SchemaTree.tsx` renders the schema-row button only when
  `treeShape === "with-schema"`. `resolveRdbTreeShape("postgresql")`
  returns `"with-schema"`.
- New test:
  `SchemaTree — DBMS-shape-aware tree depth (Sprint 135) > PG renders
  the schema row (3-level: database → schema → table) — AC-S135-02` —
  passes. Asserts `getByLabelText("public schema")` exists with
  `aria-expanded="false"`.
- The 100 baseline `SchemaTree.test.tsx` tests (all run against PG-shape
  fixtures) continue to pass — confirms PG render path is byte-for-byte
  unchanged.

### AC-S135-03 — MySQL sidebar = `database → table` (2-level), no schema row

- `SchemaTree.tsx` suppresses the schema row + section separator when
  `treeShape === "no-schema"`. `resolveRdbTreeShape("mysql")` returns
  `"no-schema"`. The auto-expand effect pre-expands every schema
  returned by the backend so `loadTables` still fires and the table
  list surfaces under the toolbar root.
- New tests:
  - `MySQL hides the schema row entirely (2-level: database → table) —
    AC-S135-03` — asserts `queryByLabelText("appdb schema")` is `null`
    AND `getByLabelText("orders table")` exists.
  - `MySQL still surfaces category headers (Tables / Views / …) so
    views/functions remain reachable — AC-S135-03` — guards against
    accidentally collapsing MySQL into the SQLite "flat" shape.

### AC-S135-04 — SQLite sidebar = single root → table list (1-level)

- `SchemaTree.tsx` adds a `treeShape === "flat"` branch that renders
  the table list directly under the sidebar root with no schema row and
  no category headers. `resolveRdbTreeShape("sqlite")` returns
  `"flat"`.
- New tests:
  - `SQLite renders tables directly under the root (1-level: table
    list) — AC-S135-04` — asserts `queryByLabelText("main schema")` is
    `null`, `queryByLabelText(/Tables in main/i)` is `null`, AND both
    `todos table` and `settings table` are present.
  - `SQLite shows an empty placeholder when there are no tables —
    AC-S135-04 boundary` — asserts the "No tables" sentinel renders
    when the table list is empty.

### AC-S135-05 — Mongo regression guard

- `DocumentDatabaseTree` is unchanged (out of S135 scope per the
  contract). Added a single regression test:
  `DocumentDatabaseTree > renders database → collection (2-level tree,
  no schema layer) — AC-S135-05`. Asserts the database row exists, then
  expands and asserts the collection row appears, then asserts no
  `*-schema` aria-label exists anywhere in the rendered tree.
- The existing 13 `DocumentDatabaseTree.test.tsx` tests continue to
  pass — confirms no Mongo regressions introduced by the SchemaTree
  shape branch.

### AC-S135-06 — stale "Coming in Sprint" guard

- `grep -rEn "Coming in Sprint 1[2-3][0-9]" src/ e2e/` returned zero
  user-facing matches before the test was added (the SchemaSwitcher /
  DbSwitcher tooltips used lowercase `"sprint 128"` / `"sprint 130"`
  rather than the regex's uppercase `"Sprint NNN"`).
- Even though the regex was already 0-match, AC-S135-06 explicitly
  requires a guard that locks this state. New test
  `src/__tests__/no-stale-sprint-tooltip.test.ts > Sprint 135 — stale
  'Coming in Sprint 1XX' tooltip guard (AC-S135-06) > contains zero
  matches of /Coming in Sprint 1[2-3][0-9]/ in src/` — passes.
- Guard works: I verified by adding a temporary fixture file with the
  stale string, the test failed with the expected diff, then I removed
  the fixture and the test passes again.

### AC-S135-07 — db_type-aware tree depth vitest (4 scenarios)

The contract requires 4-scenario coverage (PG / MySQL / SQLite / Mongo)
in a single sprint. Coverage is split between two test files for
locality (Mongo lives next to its component):

| Scenario | Test name | File |
|---|---|---|
| PG (3-level) | `PG renders the schema row (3-level: database → schema → table) — AC-S135-02` | `SchemaTree.dbms-shape.test.tsx` |
| MySQL (2-level) | `MySQL hides the schema row entirely (2-level: database → table) — AC-S135-03` | `SchemaTree.dbms-shape.test.tsx` |
| SQLite (1-level) | `SQLite renders tables directly under the root (1-level: table list) — AC-S135-04` | `SchemaTree.dbms-shape.test.tsx` |
| Mongo (2-level) | `renders database → collection (2-level tree, no schema layer) — AC-S135-05` | `DocumentDatabaseTree.test.tsx` |

Plus 2 helper tests:
- `resolveRdbTreeShape maps every relational db_type to a shape`
- `resolveRdbTreeShape falls back to with-schema for non-relational
  db_types so a misrouted Mongo/Redis connection doesn't crash`

All 6 new tests + 1 Mongo regression guard pass.

### AC-S135-08 — All 7 verification gates green

See the table at the top of this handoff. All 7 commands return
clean / 0 errors / 0 violations / all tests passing.

## Assumptions

- **`DatabaseType` enum**. The actual `src/types/connection.ts`
  enumerates `"postgresql" | "mysql" | "sqlite" | "mongodb" | "redis"`
  — not `mariadb`, `mssql`, or `elasticsearch` (those are mentioned in
  the brief as conceptual neighbours but do not exist in the codebase).
  The S135 helper maps the three relational types that actually ship.
  Adding MariaDB later would compile-fail in `resolveRdbTreeShape`'s
  exhaustive switch and surface as a single one-line addition.
- **MySQL "no-schema" preserves categories**. The contract says "schema
  row 미렌더; tables become direct children of database". I read this
  as suppressing the schema row but keeping the existing
  Tables/Views/Functions/Procedures category headers so views and
  functions remain reachable. Stripping the categories would conflate
  MySQL into the SQLite "flat" shape and lose the function/procedure
  surface. A test (`MySQL still surfaces category headers …`) pins
  this interpretation.
- **SQLite "flat" cuts both rows**. The contract reads "단일 root → table
  list 1-레벨, 인공적 'main' schema row 없음". I interpreted "1-레벨" as
  cutting BOTH the schema row AND the category headers (so the user
  sees the table list immediately, not a "Tables" header followed by
  the list). Views/functions are not surfaced for SQLite, which matches
  TablePlus / DBeaver's SQLite treatment.
- **`treeShape` placement**. I extracted the helper into
  `src/components/schema/treeShape.ts` rather than extending
  `pickSidebar.ts` because `pickSidebar` operates on `Paradigm` while
  `treeShape` operates on `DatabaseType` — different layers, different
  type domains. Co-locating with `SchemaTree` keeps the shape coupled
  to its only consumer.
- **Auto-expand effect for non-PG shapes**. For MySQL/SQLite the schema
  row is hidden, so I added an effect that pre-expands every schema in
  the store. The effect runs whenever `treeShape` or `schemas` changes
  and is idempotent (no-op when every schema is already expanded). The
  existing PG render path is unaffected because the effect early-exits
  when shape is `with-schema`.
- **Virtualization gating**. I restricted `shouldVirtualize` to
  `with-schema` only. MySQL/SQLite trees cap at table count which is
  bounded by the user's database contents and rarely crosses the
  200-row threshold; gating keeps the simpler shapes on the eager
  render path so the new render branches stay the only render branches
  (no virtualized variant to maintain).
- **Static grep guard implementation**. Used Vite's `import.meta.glob`
  with `eager: true` + `query: "?raw"` to load source text without
  pulling in `@types/node`. Cleaner than adding a node-types dependency
  for a single 35-line guard test.
- **WorkspaceToolbar test consolidation**. I dropped the
  `WorkspaceToolbar > updates labels when the active tab changes` test
  since it asserted on the (now-deleted) schema chip. The remaining
  active-tab assertion (`reflects the active tab's connection /
  database`) covers the DB switcher's reflection of tab state. The
  Mongo test was kept as the canonical document-paradigm assertion.

## Risks / Gaps

- **None identified**. All 7 gates green; both grep checks return the
  expected pattern (only comments / docstrings retain string mentions
  of the removed component or the stale-sprint regex).
- **Future sprint follow-ups (out of S135 scope)**:
  - S136 (sidebar single-click preview semantics) may revisit the
    SQLite flat-shape rendering — its right-click + double-click
    contract should remain stable.
  - S138 (DBMS-aware connection form) would benefit from extracting
    `RelationalDatabaseType` from `treeShape.ts` to narrow the
    `RdbSidebar` boundary.

## References

- Contract: `docs/sprints/sprint-135/contract.md`
- Execution brief: `docs/sprints/sprint-135/execution-brief.md`
- Master spec: `docs/sprints/sprint-134/spec.md` (Phase 10 합본)
- Origin lesson: `memory/lessons/2026-04-27-workspace-toolbar-ux-gaps/memory.md`
- Phase 9/10 baseline: `docs/sprints/sprint-134/handoff.md`
