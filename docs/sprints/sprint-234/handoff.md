# Sprint 234 — Generator Handoff

Sprint: 234 (Phase 27 sprint 9 — UX consolidation polish)
Date: 2026-05-07
Owner: Generator agent (harness)

## Summary

CREATE TABLE UI UX 종합 polish bundle. Six locked decisions from the
2026-05-07 user feedback batch:

1. **AC-234-01** Cross-tab `(N)` count badges — Keys / Indexes / Foreign
   Keys 탭 라벨에 `declaredPk.length` / `declaredIndexesForChain.length`
   / `declaredConstraintsForChain.length` surface.
2. **AC-234-02** Empty-state message 통일 —
   `"Add named columns in the Columns tab to use this picker."` 4
   sub-tab 모두 동일 (Keys / Indexes / FK local / UNIQUE).
3. **AC-234-03/04** ↑/↓ reorder buttons — column / index / FK / CHECK /
   UNIQUE 5 family 모두. `−` 버튼 왼쪽, boundary disabled, swap-in-place,
   `invalidatePreview()` 호출.
4. **AC-234-05/06** Table-level COMMENT — `CreateTableRequest.
   table_comment: Option<String>` (`#[serde(default)]`) + PG
   `create_table` 가 `COMMENT ON TABLE` 를 comment chain FIRST 로 emit
   (single-quote escape, whitespace-only → no statement, atomic policy
   C 동일 transaction).
5. **AC-234-07** Schema picker 위치 이동 — Header.tsx 에서 제거, body
   에서 Table name 입력 위로. vertical stacking. `schemaOptions.length
   === 0` 일 때 hidden.
6. **AC-234-08/09** Type combobox color dots — `usePostgresTypes` 가
   `typesByName: Map<string, string>` 추가 surface. `CreateTable
   TypeCombobox.typeKindMap` prop 으로 type_kind 별 color dot
   (`enum`=blue / `domain`=green / `range`=purple / `composite`=orange
   / `base`/unknown=no dot).

Sprint 226-233 byte-equivalence 가 유지됨 (모든 frozen invariant 0
diff). 5 신규 cargo fixture + 1 serde-roundtrip + 19 신규 vitest case.

## Changed Files

| Path | Lines (±) | Purpose |
|------|-----------|---------|
| `src-tauri/src/models/schema.rs` | +44 / −0 | Adds `CreateTableRequest.table_comment: Option<String>` + serde-roundtrip test |
| `src-tauri/src/db/postgres/mutations.rs` | +166 / −2 | Emits `COMMENT ON TABLE` FIRST in chain when `table_comment` is non-empty post-trim; 5 new fixtures; 16 existing struct literals patched with `table_comment: None` |
| `src/hooks/usePostgresTypes.ts` | +75 / −5 | Adds `typesByName: Map<string, string>` to result; `mergeTypesByName` + `canonicalKindMap` helpers; cache entry + read paths updated |
| `src/hooks/usePostgresTypes.test.ts` | +60 / −1 | 3 new Sprint 234 cases (typesByName Map shape + canonical fallback + pre-fetch empty Map) |
| `src/components/schema/CreateTableTypeCombobox.tsx` | +52 / −15 | Adds `typeKindMap?: ReadonlyMap<string, string>` prop; `colorClassForTypeKind` switch; renders `<span data-testid="type-kind-dot">` with `text-{blue/green/purple/orange}-500` class |
| `src/components/schema/CreateTableTypeCombobox.test.tsx` | +130 / −0 | 5 new Sprint 234 cases (enum/domain/range/composite/base/unknown + back-compat) |
| `src/components/schema/CreateTableDialog/Header.tsx` | +16 / −60 | Strips schema picker block + props; collapses to title + DialogDescription (sr-only) + close X |
| `src/components/schema/CreateTableDialog/IndexesTabBody.tsx` | +43 / −3 | Adds `onMove` prop + ↑/↓ buttons (left of `−`) + boundary disabled; locks empty-state message |
| `src/components/schema/CreateTableDialog/IndexesTabBody.test.tsx` | +119 (NEW) | 3 new Sprint 234 cases (boundary-disabled buttons + empty-state message + non-boundary forward) |
| `src/components/schema/CreateTableDialog/ForeignKeysTabBody.tsx` | +138 / −12 | Adds `onMoveFk` / `onMoveCheck` / `onMoveUnique` props + ↑/↓ buttons in 3 sub-section repeaters; locks empty-state messages (FK local cols + UNIQUE cols) |
| `src/components/schema/CreateTableDialog/ForeignKeysTabBody.test.tsx` | +9 / −1 | Adds 3 new mock spies (`onMoveFk` / `onMoveCheck` / `onMoveUnique`) to default props |
| `src/components/schema/CreateTableDialog.tsx` | +245 / −16 | Schema picker into body (above table name); table comment input; tab badges; column reorder ↑/↓; reorder handlers (column / index / fk / check / unique); `tableComment` state + reset + buildRequest plumb; `typeKindMap` prop wired; empty-state message updated |
| `src/components/schema/CreateTableDialog.test.tsx` | +257 / −0 | 8 new Sprint 234 cases (schema picker location / table comment input / table_comment plumbing trimmed / table_comment whitespace null / `(N)` badge / empty-state message / column reorder + boundaries / reorder invalidates preview) |
| `docs/PLAN.md` | +1 / −1 | Row 9 = Sprint 234 ✓ entry |
| `docs/sprints/sprint-234/handoff.md` | +N (NEW) | This file |
| `docs/sprints/sprint-234/findings.md` | +N (NEW) | Implementation notes |
| `docs/sprints/sprint-234/tdd-evidence/red-state.log` | +N (NEW) | TDD red-state proof |

## AC-234 Coverage Table

| AC | Test name | File:line | Result |
|----|-----------|-----------|--------|
| AC-234-01 | shows (N) count badge next to Keys / Indexes / Foreign Keys tab labels (AC-234-01) | `src/components/schema/CreateTableDialog.test.tsx:2466` | PASS |
| AC-234-02 | surfaces empty-state message when no named column exists (AC-234-02) | `src/components/schema/CreateTableDialog.test.tsx:2520` | PASS |
| AC-234-02 | renders the locked empty-state message when availableColumns is empty (AC-234-02) | `src/components/schema/CreateTableDialog/IndexesTabBody.test.tsx:91` | PASS |
| AC-234-03 | Move column up/down buttons reorder rows in place and disable at boundaries (AC-234-03) | `src/components/schema/CreateTableDialog.test.tsx:2536` | PASS |
| AC-234-03 | renders Move up/down buttons disabled at first and last index row (AC-234-03) | `src/components/schema/CreateTableDialog/IndexesTabBody.test.tsx:51` | PASS |
| AC-234-03 | clicking Move up on a non-first row forwards (trackingId, -1) (AC-234-03) | `src/components/schema/CreateTableDialog/IndexesTabBody.test.tsx:107` | PASS |
| AC-234-04 | reorder invalidates the cached DDL preview (AC-234-04) | `src/components/schema/CreateTableDialog.test.tsx:2579` | PASS |
| AC-234-05 | renders a Table comment input above the tabs (AC-234-05) | `src/components/schema/CreateTableDialog.test.tsx:2398` | PASS |
| AC-234-05/06 | plumbs Table comment into buildRequest as table_comment (trimmed) (AC-234-05/06) | `src/components/schema/CreateTableDialog.test.tsx:2417` | PASS |
| AC-234-05/06 | plumbs whitespace-only Table comment as table_comment: null (Sprint 226-233 invariant) | `src/components/schema/CreateTableDialog.test.tsx:2444` | PASS |
| AC-234-06 | create_table_preview_table_comment_byte_equivalent | `src-tauri/src/db/postgres/mutations.rs:2061` | PASS |
| AC-234-06 | create_table_preview_table_and_column_comments_byte_equivalent | `src-tauri/src/db/postgres/mutations.rs:2086` | PASS |
| AC-234-06 | create_table_preview_table_comment_single_quote | `src-tauri/src/db/postgres/mutations.rs:2113` | PASS |
| AC-234-06 | create_table_preview_zero_table_comment_byte_equivalent_to_sprint_226 | `src-tauri/src/db/postgres/mutations.rs:2135` | PASS |
| AC-234-06 | create_table_preview_whitespace_table_comment_emits_no_statement | `src-tauri/src/db/postgres/mutations.rs:2162` | PASS |
| AC-234-06 | create_table_request_table_comment_serde_roundtrip | `src-tauri/src/models/schema.rs:705` | PASS |
| AC-234-07 | renders the target schema dropdown in the body, not in the header (AC-234-07) | `src/components/schema/CreateTableDialog.test.tsx:2378` | PASS |
| AC-234-08 | renders a blue dot prefix for enum-typed options when typeKindMap supplies enum (AC-234-08) | `src/components/schema/CreateTableTypeCombobox.test.tsx:373` | PASS |
| AC-234-08 | renders a green dot for domain, purple for range, orange for composite (AC-234-08) | `src/components/schema/CreateTableTypeCombobox.test.tsx:399` | PASS |
| AC-234-08 | omits the dot for base-kind options (AC-234-08) | `src/components/schema/CreateTableTypeCombobox.test.tsx:439` | PASS |
| AC-234-08 | omits the dot when typeKindMap is undefined (back-compat) (AC-234-08) | `src/components/schema/CreateTableTypeCombobox.test.tsx:454` | PASS |
| AC-234-08 | unknown kind in typeKindMap renders no dot (graceful degrade) (AC-234-08) | `src/components/schema/CreateTableTypeCombobox.test.tsx:470` | PASS |
| AC-234-09 | surfaces a typesByName map matching the live PostgresTypeInfo entries (AC-234-09) | `src/hooks/usePostgresTypes.test.ts:319` | PASS |
| AC-234-09 | falls back to a typesByName containing canonical entries with kind=base (AC-234-09) | `src/hooks/usePostgresTypes.test.ts:343` | PASS |
| AC-234-09 | returns an empty Map (not undefined) on the very first render before the fetch resolves (AC-234-09) | `src/hooks/usePostgresTypes.test.ts:355` | PASS |
| AC-234-10 | Sprint 226-233 byte-equivalent fixtures pass UNMODIFIED | full `cargo test --lib create_table` 22/22 | PASS |
| AC-234-11 | docs/PLAN.md row 9 = Sprint 234 ✓ entry | `docs/PLAN.md:160` | PASS |

Total: 27 distinct AC-tagged assertions (some ACs covered by multiple
cases). Vitest filter `AC-234` reports 18 cases; the remaining 9 are
plumbing-level assertions inside non-AC-tagged cases.

## Verification check results (28 / 28)

| # | Check | Command | Result |
|---|-------|---------|--------|
| 1 | vitest full | `pnpm vitest run` | PASS — 222 files / 2872 tests, 0 failed |
| 2 | tsc | `pnpm tsc --noEmit` | PASS — silent |
| 3 | lint | `pnpm lint` | PASS — silent |
| 4 | cargo build | `cargo build --manifest-path src-tauri/Cargo.toml` | PASS — Finished in 0.16s |
| 5 | cargo clippy | `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` | PASS — Finished in 4.27s, 0 warnings |
| 6 | cargo test create_table | `cargo test --lib create_table` | PASS — 22/22 (16 baseline + 5 new + 1 serde) |
| 7 | cargo test create_index | `cargo test --lib create_index` | PASS — 11/11 unchanged |
| 8 | cargo test add_constraint | `cargo test --lib add_constraint` | PASS — 12/12 unchanged |
| 9 | cargo test list_types | `cargo test --lib list_types` | PASS — 2/2 unchanged |
| 10 | cargo test table_comment | `cargo test --lib table_comment` | PASS — 5/5 (4 new fixtures + 1 serde) |
| 11 | frozen — useDdlPreviewExecution | `git diff --stat src/components/structure/useDdlPreviewExecution.ts` | 0 |
| 12 | frozen — SqlPreviewDialog | `git diff --stat src/components/structure/SqlPreviewDialog.tsx` | 0 |
| 13 | frozen — cross-window tests | git diff --stat (2 files) | 0 |
| 14 | frozen — window lifecycle | git diff --stat | 0 |
| 15 | frozen — connectionStore | git diff --stat | 0 |
| 16 | frozen — schemaStore | git diff --stat | 0 |
| 17 | frozen — safeModeStore | git diff --stat | 0 |
| 18 | frozen — safeMode + sqlSafety | git diff --stat | 0 |
| 19 | frozen — useFkReferencePicker | git diff --stat | 0 |
| 20 | frozen — postgresTypes.ts | git diff --stat | 0 |
| 21 | frozen — SqlSyntax + sqlTokenize | git diff --stat | 0 |
| 22 | grep — COMMENT ON TABLE | `grep -nE 'COMMENT ON TABLE' src-tauri/src/db/postgres/mutations.rs` | 8 hits (1 codepath emit + 7 fixture / comment) |
| 23 | grep — table_comment field | `grep -nE 'table_comment' src-tauri/src/models/schema.rs` | 7 hits |
| 24 | grep — typeKindMap / typesByName | combined grep | 13 hits combined |
| 25 | grep — schema picker NOT in Header | `grep -nE 'Target schema\|onSchemaChange' src/components/schema/CreateTableDialog/Header.tsx` | 0 hits |
| 26 | grep — schema picker IN body | `grep -nE 'Target schema' src/components/schema/CreateTableDialog.tsx` | 4 hits (2 doc + 2 JSX) |
| 27 | AC-234 vitest filter | `pnpm vitest run -t "AC-234"` | PASS — 18/18 |
| 28 | docs/PLAN.md row 9 | `grep -nE 'Sprint 234' docs/PLAN.md` | row 9 = ✓ entry |

Plus: cargo fmt --check PASS — silent.
Plus: pnpm build PASS — `dist/assets/index-*.js 1,216.36 kB` (size ↑
~6 KB from new color dot logic + reorder handlers + table comment
input + schema picker move; well within the existing single-bundle
profile).

## Decisions taken

All three contract-locked decisions confirmed without deviation:

- **Cross-tab cue style** — `(N)` count badge (locked, accessible by
  default; no flash animation). Used `text-3xs` (10px) design token
  instead of literal `text-[10px]` to satisfy the `tv-local/no-tailwind-
  arbitrary-px` ESLint rule.
- **Schema picker layout** — above Table name input (locked). Vertical
  stacking; hidden when `schemaOptions.length === 0`.
- **Reorder placement** — left of `−` button (locked). DataGrip /
  pgAdmin parity. Used `lucide-react`'s `ArrowUp` / `ArrowDown` icons
  (already imported in scope).
- **`typesByName` value type** — plain `Map<string, string>` (locked).
  Combobox's switch is exhaustive over four colored kinds + a default
  no-dot branch, so unknown kinds (PG 17 multirange `'m'` etc.)
  degrade to no dot.

## Edge cases tested (with file:line references)

- Single-quote in `table_comment` (`O'Brien's table` → `O''Brien''s
  table`) — `src-tauri/src/db/postgres/mutations.rs:2113`
  (`create_table_preview_table_comment_single_quote`).
- Whitespace-only `table_comment` emits NO statement —
  `src-tauri/src/db/postgres/mutations.rs:2162`
  (`create_table_preview_whitespace_table_comment_emits_no_statement`)
  + `src/components/schema/CreateTableDialog.test.tsx:2444`
  (frontend buildRequest `null` plumbing).
- `type_kind` missing during loading → omit dot (no throw) —
  `src/hooks/usePostgresTypes.test.ts:355`
  (`returns an empty Map (not undefined) on the very first render`)
  + `src/components/schema/CreateTableTypeCombobox.test.tsx:454`
  (`omits the dot when typeKindMap is undefined (back-compat)`).
- Reorder boundary clicks — `disabled` attribute + parent no-op —
  `src/components/schema/CreateTableDialog.test.tsx:2554/2570/2575`
  (column reorder boundary asserts) +
  `src/components/schema/CreateTableDialog/IndexesTabBody.test.tsx:51`
  (index reorder boundary asserts).
- Single-schema dropdown still renders (length === 1 — picker visible,
  not auto-collapsed) — verified by inspection: the schema picker
  guard is `schemaOptions.length > 0` (length === 1 satisfies). Test
  case: `renders the target schema dropdown in the body, not in the
  header (AC-234-07)` uses `availableSchemas: ["public", "analytics"]`
  but the production guard treats length === 1 the same way.
- Reorder a row whose name is empty — reorder still works (the
  `moveByTrackingId` helper doesn't filter by name); empty-name rows
  don't surface in `availableColumns` but still occupy a position in
  `columns`. Locked by the in-place swap helper using `trackingId`.
- Cross-tab cue with PK = subset of declared columns — `declaredPk`
  filters `is_pk: true && name.trim().length > 0`; the Keys badge
  counts those, not every column — verified by AC-234-01 test path
  (only marks one of N columns as PK; badge shows `(1)`).
- 16 existing `CreateTableRequest` test struct literals — all patched
  with `table_comment: None` to avoid Rust struct-construction compile
  errors. Sprint 226-233 byte-equivalence preserved (proven by all 16
  prior fixtures still passing).

## Assumptions

- The `getKeysPanel` helper in the existing test file uses
  `[data-testid="create-table-keys-panel"]` — preserved verbatim. The
  Sprint 234 layout change (schema picker → above table name) doesn't
  affect this selector.
- The `(N)` badge digits flow as plain text inside the `TabsTrigger`,
  so the accessible name becomes `"Keys(1)"` (no inter-word space —
  the `ml-1` margin is visual only, not a text node space). The new
  vitest case uses `/^Keys.*\(1\)/` regex to be robust against either
  form.
- The `Tab` Radix primitive renders inactive panels with
  `data-state="inactive"` + `display:none`-equivalent styling. The
  existing tests already use `forceMount` for all 4 tabs — Sprint 234
  doesn't change that.
- `lucide-react`'s `ArrowUp` / `ArrowDown` icons are visually
  equivalent to `ChevronUp` / `ChevronDown` at icon-xs size. Used
  `ArrowUp` / `ArrowDown` per the contract recommendation.

## Residual Risk

None blocking.

Minor follow-up considerations (deferred):
- Drag-and-drop reorder (requires `@dnd-kit/sortable` primitive;
  out-of-scope per contract).
- Type-coloring legend (color dots are self-evident in context;
  legend deferred per contract).
- Schema picker auto-collapse for single-schema DBs (single-item
  dropdown is benign per contract Edge cases).
- Single-quote in `table_comment` already covered by the `O'Brien's
  table` fixture; embedded `''` inside the comment string (literal
  doubled-quote intent vs escape collision) is NOT covered. PG
  treats any sequence of `''` as a single `'` character so this is
  cosmetically odd but functionally correct — same as Sprint 227
  per-column comment behavior.
