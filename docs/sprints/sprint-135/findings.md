# Sprint 135 Evaluation

Independent re-verification of the Generator's S135 implementation. All
seven required gates were re-run by the evaluator (not trusting the
handoff alone), the two grep audits were re-run, and the static guard
test was empirically probed for tautology.

## Independent Verification

### 1. `pnpm vitest run`

```
 RUN  v4.1.3 /Users/felix/Desktop/study/view-table


 Test Files  127 passed (127)
      Tests  2049 passed (2049)
   Start at  01:45:01
   Duration  21.09s (transform 5.06s, setup 7.97s, import 33.76s, tests 49.65s, environment 77.14s)
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
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.32s
```

### 7. `pnpm exec eslint e2e/**/*.ts`

```
(no output — exit 0)
```

### Grep audit A — `grep -rn "SchemaSwitcher" src/ e2e/`

```
src/components/workspace/DisconnectButton.tsx:32: * control in `WorkspaceToolbar` (Sprint 135 removed `SchemaSwitcher`).
src/components/workspace/WorkspaceToolbar.tsx:16: * Sprint 135 — `<SchemaSwitcher>` was removed. Schema selection is now
src/components/workspace/WorkspaceToolbar.test.tsx:117:  // Sprint 135 — SchemaSwitcher was removed. Schema selection lives in the
src/components/workspace/WorkspaceToolbar.test.tsx:120:  it("does NOT render the legacy SchemaSwitcher chip (AC-S135-01)", () => {
```

All four hits are comments / regression-guard test names. No production
code path imports or renders `<SchemaSwitcher>`. `e2e/` returned no
matches. `Glob src/components/workspace/SchemaSwitcher*` returns
**no files** — both the production file and its test are deleted.

### Grep audit B — `grep -rEn "Coming in Sprint 1[2-3][0-9]" src/ e2e/`

```
src/__tests__/no-stale-sprint-tooltip.test.ts:7: * "Coming in Sprint 128" / "Coming in Sprint 130" while features were
```

The single hit lives inside the guard test's own docstring; the test
deliberately skips its own file path so it does not self-flag (line 43
of the guard file: `if (path.endsWith("no-stale-sprint-tooltip.test.ts")) continue;`).
**0 user-facing strings match.** `e2e/` returned no matches.

### Static guard tautology probe (out-of-band evaluator check)

The reviewer was asked to confirm the guard at
`src/__tests__/no-stale-sprint-tooltip.test.ts` is **not a tautology**.
Two fixtures were planted and re-run:

1. **Fixture in `src/__tests__/`** (sibling of the guard) containing
   `// Coming in Sprint 130` — guard FAILED with the expected diff
   showing the planted file path and matched string. Removed → guard
   PASSES again.
2. **Fixture in `src/components/`** (far from `__tests__/`) containing
   the same regex literal — guard FAILED, citing
   `/src/components/_taut_far_check_s135.ts:1: Coming in Sprint 130`.
   Removed → guard PASSES again.

Conclusion: `import.meta.glob("/src/**/*.{ts,tsx}", { eager: true, query: "?raw" })`
genuinely loads every TS/TSX source under `src/` and runs the regex
against each blob. The guard is **not a tautology**; it scans the
whole tree and the only excluded file is the guard itself (which is
the standard pattern for self-referencing static checks).

## AC Verdict

| AC | Verdict | Evidence |
|----|---------|----------|
| **AC-S135-01** | PASS | `Glob src/components/workspace/SchemaSwitcher*` → 0 files. `WorkspaceToolbar.tsx` body (lines 27-44) renders only `<DbSwitcher>` + `<DisconnectButton>` and contains no `SchemaSwitcher` import. New test `WorkspaceToolbar > does NOT render the legacy SchemaSwitcher chip (AC-S135-01)` (`WorkspaceToolbar.test.tsx:120-125`) asserts `queryByRole("button", { name: /active schema \(read-only\)/i })` is null — passes (`6 passed (6)` in isolated run). `pnpm tsc --noEmit` exit 0. |
| **AC-S135-02** | PASS | `treeShape.ts:46-47` maps `postgresql → "with-schema"`. `SchemaTree.tsx:1165` gates the schema-row `<button aria-label="X schema">` on `treeShape === "with-schema"`. New test `SchemaTree — DBMS-shape-aware tree depth (Sprint 135) > PG renders the schema row (3-level: database → schema → table) — AC-S135-02` (`SchemaTree.dbms-shape.test.tsx:85-107`) asserts `getByLabelText("public schema")` and `aria-expanded="false"` — passes. |
| **AC-S135-03** | PASS | `treeShape.ts:48-49` maps `mysql → "no-schema"`. `SchemaTree.tsx:1165` skips the schema row when shape ≠ `"with-schema"`. Auto-expand effect (`SchemaTree.tsx:486-500`) pre-expands every schema when shape ≠ `"with-schema"` so `loadTables` data flows. Tests `MySQL hides the schema row entirely (2-level: database → table) — AC-S135-03` (`SchemaTree.dbms-shape.test.tsx:112-135`) asserts schema row absent + `orders table` present, AND `MySQL still surfaces category headers (...) — AC-S135-03` (`SchemaTree.dbms-shape.test.tsx:137-157`) asserts `Tables in appdb` header present (guards against accidental `flat` regression). |
| **AC-S135-04** | PASS | `treeShape.ts:50-51` maps `sqlite → "flat"`. `SchemaTree.tsx:1227-1322` adds a dedicated `flat` render branch that lists tables directly under the root with no schema row and no category headers. Tests `SQLite renders tables directly under the root (1-level: table list) — AC-S135-04` (`SchemaTree.dbms-shape.test.tsx:163-189`) asserts schema row null + category header null + `todos table` / `settings table` present, AND `SQLite shows an empty placeholder when there are no tables — AC-S135-04 boundary` (`SchemaTree.dbms-shape.test.tsx:191-206`) asserts the "No tables" sentinel renders for the empty-table edge. The empty placeholder is in `SchemaTree.tsx:1233-1235` ("No tables"). |
| **AC-S135-05** | PASS | `DocumentDatabaseTree` was unchanged (out-of-scope per contract). New regression guard `DocumentDatabaseTree > renders database → collection (2-level tree, no schema layer) — AC-S135-05` (`DocumentDatabaseTree.test.tsx:251-273`) asserts the database row exists, then expands and asserts the collection row appears, then `queryByLabelText(/schema$/i)` returns null — passes (`12 passed (12)` in isolated run). |
| **AC-S135-06** | PASS | Static grep guard `Sprint 135 — stale 'Coming in Sprint 1XX' tooltip guard (AC-S135-06) > contains zero matches of /Coming in Sprint 1[2-3][0-9]/ in src/` (`no-stale-sprint-tooltip.test.ts:37-59`) passes. The guard was empirically probed by planting fixture files both inside and outside `src/__tests__/`; both fixtures triggered the expected failure with the planted path/match in the diff, and removing them restored a clean pass. **The guard is genuinely scanning all 200+ TS/TSX files under `src/`, not only the guard's own directory.** |
| **AC-S135-07** | PASS | Four db_type scenarios are pinned: PG (`SchemaTree.dbms-shape.test.tsx:85`), MySQL (`SchemaTree.dbms-shape.test.tsx:112`), SQLite (`SchemaTree.dbms-shape.test.tsx:163`), Mongo (`DocumentDatabaseTree.test.tsx:251`). Plus two pure-function tests for `resolveRdbTreeShape` (`SchemaTree.dbms-shape.test.tsx:212`, `:218`) covering relational + non-relational fallback. The dbms-shape file run reports `7 passed (7)`. |
| **AC-S135-08** | PASS | All seven gates were re-run by the evaluator and all returned green: vitest `2049 passed (127)`, tsc 0 errors, lint 0 errors, contrast 0 new violations, cargo test `268 passed; 2 ignored`, clippy clean, e2e eslint 0 errors. |

## Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| **Correctness** | 9/10 | Every AC maps to a concrete code+test pair that I re-ran. The exhaustive `switch (dbType)` in `treeShape.ts:45-60` covers every member of `DatabaseType` (postgresql / mysql / sqlite / mongodb / redis); all five arms are explicitly handled, so adding a new `DatabaseType` will compile-fail at this point. The auto-expand effect (`SchemaTree.tsx:486-500`) is idempotent (`mutated` flag returns the previous Set when no change is needed), so React's referential-equality bail-out fires and there is no infinite re-render. Minor: `flat` and `no-schema` always treat `isExpanded` as `true` (`SchemaTree.tsx:1138-1143`), which is correct given the schema row is suppressed, but means the user has no way to collapse the table list under the root for SQLite — that's intentional per contract ("단일 root → table list 1-레벨"). |
| **Test Quality** | 8/10 | Tests use user-facing queries (`getByLabelText`, `getByText`, `queryByLabelText`) per the React-testing-library convention; no `getByTestId`. The Mongo regression test asserts `queryByLabelText(/schema$/i)` is null after expanding — a strong shape-level guard. The MySQL "category-header survival" test (`SchemaTree.dbms-shape.test.tsx:137`) usefully pins the interpretation that MySQL ≠ flat, which would otherwise be ambiguous. The static guard test was empirically probed (see "tautology probe" section) and is genuinely scanning all of `src/`. **Gap**: no test exercises `handleExpandSchema` for the `no-schema` / `flat` shapes — collapsing/re-expanding via keyboard isn't possible since the schema row is suppressed, but if a future regression made `handleExpandSchema` reachable through some other path, only PG would notice. |
| **Regression Safety** | 9/10 | The 100-row `SchemaTree.test.tsx` baseline (PG-shape fixtures) continues to pass — confirms the PG render path is byte-for-byte unchanged (the new `treeShape !== "flat"` branch covers the same JSX as before for the `with-schema` path). `DocumentDatabaseTree.test.tsx` 12/12 pass. Virtualization is restricted to `with-schema` only (`SchemaTree.tsx:770-771`) — this is documented in the file comment and is a deliberate trade-off that prevents the new render branches from needing virtualized variants. The static guard locks the `Coming in Sprint 1XX` regex permanently. |
| **Code Quality** | 8/10 | `treeShape.ts` is a clean 60-line module with an exhaustive switch and an explanatory docstring. Comments throughout `SchemaTree.tsx` flag the new behaviour ("Sprint 135 — ..."). No `any` introduced. The `flat` render branch (`SchemaTree.tsx:1227-1322`) duplicates a chunk of the table-row JSX (icon, ContextMenu, ContextMenuTrigger, ContextMenuContent) from the existing `items.map` block — extracting a shared `<TableRow>` component would have cut ~80 lines and centralized the F2 / Drop / Rename / Structure handlers. Not a blocker (the duplication is local and traceable), but it widens the surface where a future fix to e.g. drop-confirm dialog has to be made in two places. |
| **Evidence Completeness** | 9/10 | Handoff supplies the changed-file list with one-line purposes, last-20-lines for all 7 commands, both grep audits with explanations of remaining-but-acceptable hits, and per-AC evidence. Assumptions section is honest about the MariaDB/MSSQL absence (the contract mentions them, the codebase doesn't have them yet) and pins the auto-expand + virtualization choices. The evaluator-side re-run reproduced every gate. |

**Overall: 8.6 / 10.** All five dimensions ≥ 7.

## Findings

### P1 (블로커)
*(none)*

### P2 (개선 권장)

1. **Flat-branch JSX duplicates the eager `items.map` table row**
   (`SchemaTree.tsx:1238-1320`). The flat branch reimplements the
   `Table2` icon + button + ContextMenu wrapper that already exists in
   the eager category branch (`SchemaTree.tsx:1481-1684`). A shared
   `<RdbTableRow>` component (or `renderTableItem(item, schemaName)`
   helper) would shrink the file by ~80 lines and ensure F2 / Drop /
   Rename / Structure stay in lockstep across the two render paths.
   - **Suggestion**: extract the table-row JSX into a local
     `renderTableItem({ item, schemaName, indentClass })` helper and
     reuse it from both branches; the `pl-3` vs `pl-10` difference
     becomes a single argument.

2. **`resolveRdbTreeShape` falls through to `"with-schema"` for
   `mongodb` / `redis`** (`treeShape.ts:52-60`). The handoff
   acknowledges this is a safety default. The non-relational arm is
   tested (`SchemaTree.dbms-shape.test.tsx:218`), but a defensive
   `pickSidebar` change in S138 could leak Mongo into `SchemaTree`,
   which would then render an empty schema tree silently. A more
   explicit `console.error` (or a `paradigm`-narrowed `Rdb` type)
   would surface the misroute earlier. Not a regression today
   (`pickSidebar` correctly routes Mongo to `DocumentDatabaseTree`),
   but the safety default could mask a future bug.
   - **Suggestion**: when MariaDB / MSSQL are added in a later sprint,
     also extract a `RelationalDatabaseType` type-narrowed `Connection`
     to enforce the boundary at the `RdbSidebar` prop.

### P3 (info)

1. **Contract mentions MSSQL / MariaDB** but the `DatabaseType` enum
   in `src/types/connection.ts:1-6` only ships `postgresql | mysql |
   sqlite | mongodb | redis`. The handoff calls this out as an
   assumption; the exhaustive switch in `resolveRdbTreeShape` will
   compile-fail when MariaDB / MSSQL are added, forcing a one-line
   addition. No action needed for S135.

2. **WorkspaceToolbar layout after both removals**: with
   ConnectionSwitcher (S134) and SchemaSwitcher (S135) gone, the
   toolbar (`WorkspaceToolbar.tsx:27-44`) renders DbSwitcher on the
   left and DisconnectButton on the far right (`ml-auto`). This is
   visually sparse but matches the contract intent ("toolbar carries
   no schema chip"). The empty-workspace placeholder still renders
   `—` per the WorkspaceToolbar test at line 127 — verified.

3. **Auto-expand timing for non-PG shapes**: the auto-expand effect
   (`SchemaTree.tsx:486-500`) runs whenever `treeShape` or `schemas`
   changes. For MySQL/SQLite the schema row is hidden but tables flow
   through the existing on-mount `loadSchemas → loadTables` chain at
   `SchemaTree.tsx:441-458`. The two effects don't race because
   `loadTables` is keyed by `${connectionId}:${schemaName}` and the
   second invocation is a no-op when the cache entry exists.

## Verdict: PASS

All eight acceptance criteria are met with concrete code + test
evidence. All seven verification gates re-run by the evaluator
returned green (vitest 2049/2049, tsc 0, lint 0, contrast 0 new,
cargo test 268, clippy clean, e2e eslint 0). The two grep audits
are clean (only comments / docstrings / regression-guard test
names retain mentions of the removed component or the stale-sprint
regex). The static guard test was empirically probed with two
out-of-band fixtures and is **not a tautology** — it genuinely
scans every TS/TSX file under `src/`. Both P2 findings are
non-blocking refactor suggestions.
