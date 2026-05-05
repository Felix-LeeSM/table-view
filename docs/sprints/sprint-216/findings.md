# Sprint 216 — Findings (Generator)

## Changed Files

- `src/components/schema/__tests__/schemaTreeTestHelpers.ts` (new, 51 lines): shared helper module with the 5 `vi.fn()` action mocks (`mockLoadSchemas` / `mockLoadTables` / `mockLoadViews` / `mockLoadFunctions` / `mockPrefetchSchemaColumns`) and the 2 store-seed helpers (`setSchemaStoreState` / `resetStores`). All identifiers and bodies are byte-equivalent to the originals from `SchemaTree.test.tsx` so axis files can re-apply them in `beforeEach`.
- `src/components/schema/SchemaTree.lifecycle.test.tsx` (new, 11 cases): mount auto-load (AC-01), connectionId-change reload (AC-03), schema-list rendering and empty-store edge cases (AC-02), undefined-schema fallback, table-key format, connection-name → connection-ID fallback (AC-VIS-01), `Schemas` header label, and root `select-none` class.
- `src/components/schema/SchemaTree.expand.test.tsx` (new, 28 cases): schema toggle (AC-03), `loadTables` lazy/cached path (AC-04), tables rendering inside expanded schema, `No tables` placeholder (AC-08), Enter/Space keyboard toggling, refresh-button + per-schema spinners, all category headers (AC-CAT-01..06), category Enter/Space, schema auto-expand on active tab (AC-EXPAND-01..02), view/function/procedure rows, and `loadViews` / `loadFunctions` lazy loads.
- `src/components/schema/SchemaTree.refresh.test.tsx` (new, 6 cases): `Refresh schemas` button (AC-07), `refresh-schema` window event + cleanup (AC-10), schema right-click Refresh (AC-CM-17, AC-CM-18), and the `loadSchemas`-rejection cleanup path.
- `src/components/schema/SchemaTree.search.test.tsx` (new, 10 cases): all AC-SEARCH-01..10 for the per-schema table filter input — render, filter, case-insensitivity, clear (X) button, "No matching tables" vs "No tables", isolation from non-tables categories, per-schema state independence, and `Filter tables...` placeholder.
- `src/components/schema/SchemaTree.actions.test.tsx` (new, 31 cases): table click → addTab (AC-05), all 16 table context-menu cases (AC-CM-01..16: Structure / Data / Rename / Drop dialogs and store actions), 5 F2 keyboard rename cases (Sprint 107 #TREE-1, AC-01..04), view-row click and view-context-menu Structure / Data routing, function-row click → query tab, AC-191-03 toast fallback for dropTable / renameTable rejections, and AC-192-04 header Export popover (RDB-only) cases.
- `src/components/schema/SchemaTree.highlight.test.tsx` (new, 18 cases): row-count display (AC-09 tilde estimate, null `?`, zero `~0`), loadTables-rejection spinner cleanup, click selection (AC-SEL-01..03), schema-collapsed Folder icon (AC-VIS-02), indentation classes (AC-VIS-03), schema separators (AC-SEP-01), active-tab highlight (AC-ACTIVE-01..03), category icons (AC-ICON-02..04), and the views/functions count badge mix.
- `src/components/schema/SchemaTree.test.tsx` (deleted, was 2891 lines / 104 cases): replaced wholesale by the 6 axis files above (Option 1).

## Checks Run

| # | Check | Result |
|---|-------|--------|
| 1 | `pnpm vitest run` (SchemaTree*.test.tsx via explicit list) — 11 files / 139 tests | exit 0, 139 passed |
| 2 | `pnpm vitest run` project-wide | exit 0, 194 files / 2720 tests passed (file count ∈ [192, 196]) |
| 3 | `pnpm tsc --noEmit` | exit 0 |
| 4 | `pnpm lint` | exit 0 |
| 5 | `find … SchemaTree.<axis>.test.tsx` count, excluding pre-existing axes | 6 ∈ [4, 7] |
| 6 | `^  it(` count across new axis files | 11 + 28 + 6 + 10 + 31 + 18 = 104 ∈ [99, 104] |
| 7 | `git diff --stat src/components/schema/SchemaTree.tsx` | empty (0 changes) |
| 8 | `git diff --stat src/components/schema/SchemaTree/` | empty (0 changes) |
| 9 | `git diff --stat` for the 5 pre-existing axis test files | empty (0 changes) |
| 10 | `git diff --stat` for the 5 sibling test files (`SchemaPanel.test.tsx`, `DocumentDatabaseTree.test.tsx`, `StructurePanel.test.tsx`, `StructurePanel.first-render-gate.test.tsx`, `ViewStructurePanel.test.tsx`) | empty (0 changes) |
| 11 | New `eslint-disable*` lines in `src/components/schema/` | 0 |
| 12 | 23 verbatim AC strings each present ≥ 1 in `SchemaTree*.test.tsx` | each = 1 |
| 13 | Entry test handling | Option 1 — `src/components/schema/SchemaTree.test.tsx` removed |
| 14 | Helper file named exports (5 mocks + 2 helpers) | 7 named exports found |
| 15 | External imports of helper file | 6 (= 6 axis files; ≤ axis file count) |
| 16 | `it.only` / `it.skip` in axis files | 0 |
| 17 | `^describe(` count per axis file (root describe = 1) | each axis file = 1 |

## Done Criteria Coverage

- **AC-01** — Sum of cases across `SchemaTree*.test.tsx` (6 new axis + 5 pre-existing) = 104 + 35 = 139. `pnpm vitest run` for the explicit set returned `Test Files 11 passed (11)` / `Tests 139 passed (139)` exit 0. Pre-existing axis files contribute exactly 35 (10+5+9+4+7) — unchanged.
- **AC-02** — 6 new axis files (lifecycle / expand / refresh / search / actions / highlight). Per-file case counts: 11, 28, 6, 10, 31, 18 — each ≥ 5 and ≤ 35. None of the new axis names collide with the 5 pre-existing names.
- **AC-03** — Helper file at `src/components/schema/__tests__/schemaTreeTestHelpers.ts` (Option B) exposes 5 `vi.fn()` action mocks + 2 helper functions = 7 named exports. External imports limited to the 6 new axis files (`grep -rn "schemaTreeTestHelpers" src/ e2e/` = 6).
- **AC-04** — Option 1 selected: original `src/components/schema/SchemaTree.test.tsx` removed. All 104 cases relocated into the 6 new axis files; 0 cases left in the entry path.
- **AC-05** — All 23 verbatim AC strings preserved (each appears exactly once in axis files). All Global ACs satisfied: behaviour change 0 (`SchemaTree.tsx` + 5 sub-files diff 0); 104 cases preserved (`comm -23` and `comm -13` both empty); imports / mock pattern preserved; ARIA labels and verbatim text preserved (case descriptions and assertion bodies are byte-equivalent); fixture data shapes preserved; store seed pattern preserved (helper exports the original `setSchemaStoreState` / `resetStores`); `SchemaTreeProps` not touched; 0 new `eslint-disable*` / silent `catch{}`; vitest file count moved from 189 → 194 (new = 6, deleted = 1) ∈ [192, 196]; tests count unchanged at 2720; sibling test files diff 0.

## Assumptions

- Axis-file count = 6 (`lifecycle`, `expand`, `refresh`, `search`, `actions`, `highlight`) per the spec recommendation; within the 4–7 cap.
- Helper file location: `src/components/schema/__tests__/schemaTreeTestHelpers.ts` (Option B, recommended). Created the `__tests__/` directory in the schema folder.
- Entry handling: Option 1 — original `SchemaTree.test.tsx` removed; all 104 cases relocated.
- Case distribution within generator's ±2 discretion: `lifecycle` 11 (vs spec ~10), `expand` 28 (vs spec ~25 — kept all schema/category/auto-expand/view-row rendering here for cohesion), `refresh` 6, `search` 10, `actions` 31 (vs spec ~30 — including 4 Sprint-107 F2 cases + AC-CM-01..16 + AC-191-03 + AC-192-04 + view-context Structure/Data), `highlight` 18 (vs spec ~22 — count badges + Folder collapse + indentation + separator + icons + active highlight + selection + row_count grouped here as visual styling axis). Sum = 104 ✓.
- The 3 local async helpers from the original (`expandSchemaWithTables`, `expandSchemaWithMultipleTables`, `expandSchemaWithView`) were kept inline in the axis file that uses them (`expandSchemaWithTables` → `actions`; `expandSchemaWithMultipleTables` → `search`; `expandSchemaWithView` → `actions`) rather than being promoted to the helper file. Each helper is used by only one axis, so promotion would not have reduced duplication.
- No `vi.mock("@stores/schemaStore", …)` exists in the original (the test uses `useSchemaStore.setState` to inject mocks). Therefore the helper file does **not** need to call `vi.mock` and there is no ESM-hoisting concern — each axis file imports the shared `vi.fn()` instances and applies them via `setSchemaStoreState` / `resetStores` in its own `beforeEach`.
- `mockLoadSchemas` / `mockLoadTables` `mockResolvedValue(undefined)` is reapplied in each axis `beforeEach` after `vi.clearAllMocks()` (matching the original pattern verbatim) so prior `mockReturnValueOnce` / `mockRejectedValueOnce` from one case does not leak into the next.

## Residual Risk

- **Mock-fn instance sharing across axis files**: the 5 `vi.fn()` instances live in the helper module. Vitest's module cache is per-worker (one worker per file by default in pool mode), so instances are not shared across axis files. Within a worker, `vi.clearAllMocks()` in each `beforeEach` resets `.mock.calls` and clears one-shot reassignments. No leakage observed in the 139-pass run, but a future change to vitest pool config (e.g. `singleThread: true`) could expose a leak if a test forgets to reset a stateful mock. Mitigation: all current axis files preserve the original `clearAllMocks + mockResolvedValue(undefined) + resetStores` pattern verbatim.
- **Per-axis helper duplication**: `expandSchemaWithTables` / `expandSchemaWithMultipleTables` / `expandSchemaWithView` were inlined in their consumers rather than promoted. If a future sprint widens cross-axis helper sharing, a follow-up refactor can lift them into the helpers module.
- **Sub-file invariant guard is implicit**: the spec freezes `SchemaTree/{body,dialogs,rows,treeRows,useSchemaTreeActions}` only via `git diff --stat`. The axis files exercise the public component surface (i.e. through `<SchemaTree connectionId="…" />`), so behaviour drift in any sub-file would surface as test failure regardless. No risk identified beyond the structural guard.
