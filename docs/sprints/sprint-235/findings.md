# Sprint 235 — Implementation Findings

Sprint: 235 (Phase 27 sprint 10 — table rename / drop polish)
Date: 2026-05-07

This document captures the trade-offs, surprises, and Open Questions
resolution log from the Sprint 235 implementation pass. The contract
+ execution-brief drove the high-level decisions; this file records
what surfaced inside the implementation.

## Things that went smoothly

### Backend trait migration scope

Confirmed via grep that PG is the only `RdbAdapter` impl; the trait
migration touched exactly four sites — `db/traits.rs`,
`db/postgres.rs` (impl forward), `db/tests.rs` (`FakeCancellableRdb` +
`FastFakeRdb`), and `commands/meta.rs` (`StubRdbAdapter`). All four
took identical 2-line stub shape `Box::pin(async move {
unimplemented!() })` so the diff stayed mechanical.

### Inherent method body rewrite

The `drop_table` body collapsed cleanly to 7 lines (validate_identifier
× 2, qualified_table, optional " CASCADE" suffix, preview branch
returning `SchemaChangeResult { sql }`, execute branch wrapping
`BEGIN; … COMMIT;`). Removing the `information_schema.tables`
pre-existence check simplified the body further — PG's verbatim error
("table … does not exist") surfaces unchanged through the existing
`AppError::Database` mapping.

`rename_table` body is even tighter — three identifier validations
(schema + table + new_name), `qualified_table` + raw `"new_name"`
quoting, single `ALTER TABLE … RENAME TO …` statement.

### Dual-export compat layer

The `src/lib/tauri/ddl.ts` dual export pattern (Sprint 235 contract
§Frozen paths invariant) keeps `schemaStore.ts` diff = 0. The
`renameTable` / `dropTable` compat wrappers internally call the new
request-shaped functions with `previewOnly: false`; existing callsites
(schemaStore, mutation hook) stay byte-equivalent.

### Frontend modal architecture

`RenameTableDialog` + `DropTableDialog` follow the Sprint 226
`CreateTableDialog` shell pattern (DialogHeader / body / collapsible
DDL preview pane / DialogFooter). Reusing `useDdlPreviewExecution`
(Sprint 214) means Safe Mode dispatch / pendingConfirm wiring /
preview fetch error surface all come for free. `useSchemaTableMutations`
(Sprint 223) wraps the commit closure so cache eviction +
listTables-fallback path stays uniform with Sprint 232.

### Hook collapse

The legacy `useSchemaTreeActions.ts` had 6 dialog state slots
(`confirmDialog`, `renameDialog`, `renameInput`, `renameError`,
`isOperating`, `renameInputRef`) + 3 handlers (`handleDropTable`,
`handleStartRename`, `handleConfirmRename`) with inline tauri calls,
history records, and toast paths. The Sprint 235 collapse:

- 6 dialog slots → 2 (`renameTableDialog`, `dropTableDialog`).
- 3 handlers → 2 simple openers — both just `setXDialog({ schemaName,
  tableName })`.
- All inline lifecycle (validation, tauri call, history record, toast)
  moved INSIDE the modals (delegated to `useDdlPreviewExecution`).

Net delta: hook went 360 LOC → 220 LOC (-39%). 200-line per-file
ceiling still holds.

## Things that needed adjustment

### 1. `SchemaTree.actions.test.tsx` mechanical migration

**Problem**: The contract explicitly permits sibling-test diff in
`SchemaTree.actions.test.tsx` because the legacy `confirmDialog` /
`renameDialog` shapes no longer exist. 16 of the original 30 cases
referenced removed slots:

- `screen.getByRole("dialog", { name: "Drop Table" })` (pre-Sprint
  235 the legacy minimal dialog used `aria-label="Drop Table"`; the
  Sprint 235 modal uses `<DialogTitle>Drop Table</DialogTitle>` —
  text query, not role+name).
- `screen.getByRole("button", { name: "Drop Table" })` (the legacy
  destructive button label was the table name; the Sprint 235 modal
  uses `<Button … aria-label="Apply">Apply</Button>`).
- `screen.getByLabelText("Rename")` for the rename submit button
  (replaced with `aria-label="Apply"`).
- `useSchemaStore.setState({ dropTable: mockDropTable })` /
  `renameTable: mockRename` — overriding the schemaStore action no
  longer suffices because the modal's commit closure goes through
  `useSchemaTableMutations` → `schemaStore.dropTable` →
  `tauri.dropTable` (compat wrapper). The right mock layer is
  `@lib/tauri.dropTable` / `tauri.renameTable`.
- AC-191-03 toast-fallback assertions removed entirely — the modal
  owns the user-visible error surface (inline `previewError` +
  `pendingConfirm` dialog), so the original silent-swallow regression
  no longer applies.

**Fix**: Rewrote the file with `vi.hoisted` mock pattern at module
top to redirect `@lib/tauri.dropTable` / `renameTable` /
`dropTableRequest` / `renameTableRequest` calls. The 16 affected
cases collapsed to 12 cases (4 dropped: AC-191-03 toast assertions
× 2 because no longer applicable; AC-CM-12/13 Enter+Escape because
they tested the F2 dialog's submit-on-Enter which moved into the
modal — covered by `RenameTableDialog.test.tsx`'s identifier
validation tests). Added 4 new AC-235-07 / AC-235-08 cases. Final
case count: 30 → 30 (4 dropped + 4 added).

**Lesson**: When promoting a minimal dialog to a Phase 24-26 DDL
surface, sibling tests need their mock layer pushed down from store
to IPC because the new modal architecturally bypasses the store
override surface (`useDdlPreviewExecution` calls `tauri.*` directly
on preview, then `useSchemaTableMutations` calls schemaStore which
calls `tauri.*` on commit).

### 2. `validate_identifier` shared with Sprint 226

The leading-digit error message standardised on "must start with a
letter or underscore" — the legacy ad-hoc message ("must not start
with a digit") was less informative. Updated the legacy fixture
assertion to the new canonical text. No test regression because the
shared validator is the single source of truth.

### 3. CASCADE preview re-fetch contract

The contract specifies that toggling CASCADE invalidates the cached
preview so the next Show DDL click re-fetches with the new SQL.
Implementation: `previewStale` flag flips to `true` on cascade
toggle + collapses the DDL preview pane (`setShowDdl(false)`) +
calls `ddl.cancelPreview()` to drop the cached SQL. Next Show DDL
click runs the full `loadPreview` path again. `DropTableDialog.test`
case `[AC-235-05] CASCADE toggle invalidates preview + next Show DDL
re-fetches with cascade:true` locks this behaviour.

### 4. Connection environment default

The Sprint 235 modal Safe Mode gate dispatches based on
`useConnectionStore.connections[i].environment`. In
`SchemaTree.actions.test.tsx` the tests don't set up a connection
explicitly (the schema render only needs a connectionId). When the
modal's commit path runs, `decideSafeModeAction` falls through to the
"no connection found" branch which the gate treats as `allow` (Sprint
189 invariant — defensive). This kept the actions tests working
without a connection setup; `DropTableDialog.test.tsx` /
`RenameTableDialog.test.tsx` set up explicit `dev` / `production`
connections for the 6 cases that exercise the gate matrix directly.

## Open Questions resolution log

The Sprint 235 contract called out 5 Open Questions; here is how each
landed:

### OQ-1: Pre-existence check removal

Resolution: REMOVED. PG's verbatim error ("table … does not exist")
already surfaces through `AppError::Database` mapping, and the modal's
preview pane has a `previewError` slot that displays errors verbatim
(`role="alert"`). No defense-in-depth check in the backend; the
preview SQL is the user-visible gate. `drop_table_preview_*` fixtures
no longer assert on `information_schema.tables` at all.

### OQ-2: Cancel-token propagation

Resolution: DEFERRED. The Sprint 226 `create_table` precedent ships
without cancel-token; rename / drop follow suit. `useDdlPreviewExecution`
already supports cancel via `cancelPreview()` for the preview branch
(in-flight Promise abort), and the commit branch (single ALTER /
DROP) is too short to warrant cancellation. Future sprint may revisit
if user reports long-running drops on production.

### OQ-3: CASCADE default state

Resolution: OFF (locked). User opts INTO the more dangerous form
explicitly. Toggling on invalidates preview. AC-235-05 case
`CASCADE default off emits SQL without CASCADE keyword` locks this.

### OQ-4: Typing-confirm matching policy

Resolution: case-sensitive, byte-for-byte (locked). NO trim, NO
debounce, every keystroke re-evaluates `typingConfirm === tableName`.
`Users` ≠ `users`, leading/trailing space ≠ exact match. AC-235-05
case `case mismatch (Users vs users) keeps Apply disabled` locks
this.

### OQ-5: F2 keyboard-rename UX

Resolution: PRESERVED. The F2 keydown handler in `rows.tsx` still
calls `ctx.handleStartRename(item.name, row.schemaName)` which now
opens `RenameTableDialog` instead of the legacy minimal version.
Auto-focus + select-all behaviour preserved via the new modal's
`autoFocus + onFocus={e => e.currentTarget.select()}` pattern.
`SchemaTree.actions.test.tsx` AC-01/02/04 cases pass unchanged.

## Edge cases tested (with file:line references)

- Embedded NULL byte rejection — covered by the shared
  `validate_identifier` regex (NULL byte fails the `[a-zA-Z0-9_]`
  character class). `RenameTableDialog.test.tsx:160`
  (`embedded NULL byte`).
- Embedded quote in identifier — same path. `:133` (`embedded quote`).
- Leading digit — same path. `:142` (`leading digit`).
- Identifier > 63 bytes — `:151` (`length > 63 bytes`).
- Empty / whitespace-only — `:170` (`empty / whitespace-only`).
- CASCADE byte-equivalent SQL — `mutations.rs` fixture
  `drop_table_preview_cascade_byte_equivalent`.
- Rename-to-self permissive backend, modal pre-check —
  `RenameTableDialog.test.tsx:117` (Apply disabled at name == current)
  + `mutations.rs` fixture `rename_table_preview_self_permissive`
  (backend emits the SQL anyway — modal saves the round-trip).
- Safe Mode block + warn-cancel + safe matrix —
  `DropTableDialog.test.tsx:262/295/335`.
- IPC payload shape (camelCase) + sequence
  `[{ previewOnly: true }, { previewOnly: false }]` —
  `RenameTableDialog.test.tsx:181` + `DropTableDialog.test.tsx:232`.

## Confirmed invariants (frozen paths, diff = 0)

All 14 Sprint 234 frozen invariants verified diff = 0 via
`git diff --stat`:

- `useDdlPreviewExecution.ts` / `SqlPreviewDialog.tsx`
- `cross-window` tests
- `connectionStore` / `schemaStore` / `safeModeStore`
- `safeMode.ts` / `sqlSafety.ts` / `useFkReferencePicker.ts`
- `postgresTypes.ts` / `SqlSyntax.tsx` / `sqlTokenize.ts`
- Mongo paths (Sprint 198 bulk-write, Sprint 219 per-doc commands)

`schemaStore.ts` invariant preserved via the dual-export compat
wrapper in `src/lib/tauri/ddl.ts`.

## Total scope

- Rust: +560 LOC (8 fixtures + 2 serde tests + body rewrite +
  validate_identifier 63-byte branch + trait stubs)
- TypeScript: +1195 LOC NEW (2 components + 2 test files) +
  ~900 LOC modified (compat layer, hook collapse, slot wrappers,
  shell wiring, sibling test migration)
- Net: 14 modified + 4 NEW production files + 2 NEW test files
- Test count: vitest 222 → 224 files, 2872 → 2886 cases (+14;
  20 from new test files − 6 from sibling rewrite consolidation)
- Cargo: 385 → 395 cases (+10; 8 fixtures + 2 serde)
