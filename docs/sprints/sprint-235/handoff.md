# Sprint 235 — Generator Handoff

Sprint: 235 (Phase 27 sprint 10 — table rename / drop polish)
Date: 2026-05-07
Owner: Generator agent (harness)

## Summary

Promote the existing minimal `RenameTableDialog` /
`DropTableConfirmDialog` (legacy `SchemaTree` slots) to the Phase 24-26
DDL surface contract. Eight locked decisions:

1. **AC-235-01 / AC-235-02 / AC-235-03** Backend rewrite — `rename_table`
   / `drop_table` Tauri commands gain a `preview_only` branch returning
   `SchemaChangeResult { sql }`, mirroring Sprint 226 `create_table`
   shape. Trait + impl signatures change to take request structs
   (`RenameTableRequest` / `DropTableRequest` with `#[serde(rename_all
   = "camelCase")]` + `#[serde(default)] preview_only: bool`).
2. **AC-235-04** `RenameTableDialog` — single text input, identifier
   regex `^[a-zA-Z_][a-zA-Z0-9_]*$`, byte-length check via
   `TextEncoder` (PG NAMEDATALEN limit 63), rename-to-self pre-check
   (Apply disabled when input == tableName), inline DDL preview pane,
   uses `useDdlPreviewExecution` (Sprint 214) +
   `useSchemaTableMutations` (Sprint 223).
3. **AC-235-05** `DropTableDialog` — typing-confirm input
   (case-sensitive byte-for-byte, NO trim, NO debounce), CASCADE
   checkbox (default off, toggle invalidates preview), inline DDL
   preview, Apply variant=destructive disabled until typing matches +
   preview SQL fetched.
4. **AC-235-06** Safe Mode dispatch — `useDdlPreviewExecution`
   classifies `DROP TABLE` as `ddl-drop` / danger so production×strict
   blocks, production×warn escalates to `pendingConfirm`, non-prod /
   off allows. Rename emits `ddl-other` / safe so the gate always
   allows.
5. **AC-235-07** `SchemaTree` slot collapse — `useSchemaTreeActions`
   collapsed 6 dialog state slots (`confirmDialog`, `renameDialog`,
   `renameInput`, `renameError`, `isOperating`, `renameInputRef`) into
   2 (`renameTableDialog`, `dropTableDialog`) and 3 handlers into 2
   simple openers. Inline tauri / history / toast paths moved INSIDE
   the modals. F2 keyboard rename preserved (focus + select-all via
   modal's `autoFocus + onFocus={e => e.currentTarget.select()}`).
6. **AC-235-08** `dialogs.tsx` slot wrappers — three exports
   (`CreateTableDialogSlot`, `RenameTableDialogSlot`,
   `DropTableDialogSlot`); each thread `connectionId` + `{ schemaName,
   tableName }` + `onClose`.
7. **AC-235-09** Identifier validation — empty / whitespace /
   embedded-quote / NULL byte / leading digit / length > 63 all
   rejected at modal level (Apply disabled with inline error) +
   backend defense-in-depth via shared `validate_identifier`.
8. **AC-235-10 / AC-235-11** Pre-existence check removal in
   `drop_table` (let PG surface errors verbatim) + dual-export compat
   layer in `src/lib/tauri/ddl.ts` so `schemaStore.ts` stays diff = 0
   (Sprint 223 invariant preserved).

Sprint 226-234 byte-equivalence maintained (all frozen invariants 0
diff). 8 new cargo fixtures + 2 serde-roundtrip + 20 new vitest cases
in dedicated dialog test files + 4 new + 8 mechanically migrated
cases in `SchemaTree.actions.test.tsx`.

## Changed Files

| Path | Lines (±) | Purpose |
|------|-----------|---------|
| `src-tauri/src/models/schema.rs` | +107 / −0 | `RenameTableRequest` + `DropTableRequest` structs with `#[serde(rename_all = "camelCase")]` + 2 serde-roundtrip tests |
| `src-tauri/src/models/mod.rs` | +1 / −1 | Re-export new request types |
| `src-tauri/src/db/traits.rs` | +14 / −9 | `RdbAdapter::rename_table` / `drop_table` signatures take `&'a RenameTableRequest` / `&'a DropTableRequest`, return `BoxFuture<'a, Result<SchemaChangeResult, AppError>>` |
| `src-tauri/src/db/postgres/mutations.rs` | +320 / −78 | Adds `PG_IDENTIFIER_MAX_BYTES = 63` length check in `validate_identifier`; rewrites `drop_table` (preview/execute, optional CASCADE, BEGIN/COMMIT, removes pre-existence check); rewrites `rename_table` (preview/execute, validates schema/table/new_name); 8 new fixtures (`rename_table_preview_byte_equivalent`, `drop_table_preview_no_cascade_byte_equivalent`, `drop_table_preview_cascade_byte_equivalent`, `rename_table_invalid_new_name_rejected`, embedded NULL byte, rename-to-self permissive, etc.) |
| `src-tauri/src/db/postgres.rs` | +18 / −6 | Forward request-shaped `RdbAdapter::drop_table` / `rename_table` impls to inherent methods |
| `src-tauri/src/db/tests.rs` | +24 / −13 | Update `FakeCancellableRdb` + `FastFakeRdb` trait stub impls to new signatures |
| `src-tauri/src/commands/meta.rs` | +13 / −8 | Update `StubRdbAdapter` trait stub impls to new signatures |
| `src-tauri/src/commands/rdb/ddl.rs` | +25 / −13 | Rewrite `drop_table` / `rename_table` Tauri command handlers to take `request: T` + return `Result<SchemaChangeResult, AppError>` |
| `src/types/schema.ts` | +28 / −0 | TS `RenameTableRequest` + `DropTableRequest` matching Rust serde shape |
| `src/lib/tauri/ddl.ts` | +47 / −16 | Dual export — new `dropTableRequest` / `renameTableRequest` request-shaped APIs + legacy `dropTable` / `renameTable` positional compat wrappers (call request-shaped with `previewOnly: false`); preserves `schemaStore.ts` diff = 0 invariant |
| `src/components/schema/RenameTableDialog.tsx` | +313 (NEW) | Phase 27-shaped modal — single text input, identifier validation, rename-to-self pre-check, inline DDL preview pane, uses `useDdlPreviewExecution` + `useSchemaTableMutations` |
| `src/components/schema/RenameTableDialog.test.tsx` | +229 (NEW) | 8 cases — pre-fill, rename-to-self disable, identifier rejection (space/quote/digit/64-byte/NULL/empty), IPC payload shape, commit-success closes modal |
| `src/components/schema/DropTableDialog.tsx` | +296 (NEW) | Phase 27-shaped modal — typing-confirm (case-sensitive, no trim/debounce), CASCADE checkbox (default off, toggle invalidates), inline DDL preview, Safe Mode dispatch, Apply variant=destructive |
| `src/components/schema/DropTableDialog.test.tsx` | +357 (NEW) | 12 cases — typing-confirm enable/disable, case sensitivity, CASCADE default off + toggle invalidates, IPC payload shape (camelCase), commit-success closes, Safe Mode block + warn-cancel + safe matrix |
| `src/components/schema/SchemaTree.tsx` | +18 / −14 | Replace `DropTableConfirmDialog` / `RenameTableDialog` mounts with `DropTableDialogSlot` / `RenameTableDialogSlot` |
| `src/components/schema/SchemaTree/dialogs.tsx` | +103 / −121 | Three slot exports (`CreateTableDialogSlot` unchanged; `RenameTableDialogSlot` + `DropTableDialogSlot` NEW); thread connectionId + `{ schemaName, tableName }` + onClose |
| `src/components/schema/SchemaTree/useSchemaTreeActions.ts` | +85 / −136 | Collapse 6 dialog slots → 2 + 3 handlers → 2 simple openers; remove inline tauri / history / toast paths (moved into modals) |
| `src/components/schema/SchemaTree.actions.test.tsx` | +346 / −179 | Mechanical migration — `vi.hoisted` mock pattern for `@lib/tauri.dropTable` / `renameTable`; 16 cases adapted to new modal shapes; AC-191-03 toast-fallback cases removed (modal owns error surface); 4 new AC-235-07/08 cases |
| `docs/PLAN.md` | +1 / −1 | Row 10 = Sprint 235 ✓ entry |
| `docs/sprints/sprint-235/handoff.md` | +N (NEW) | This file |
| `docs/sprints/sprint-235/findings.md` | +N (NEW) | Implementation notes + Open Questions resolution log |
| `docs/sprints/sprint-235/tdd-evidence/red-state.log` | +N (NEW) | TDD red-state proof (compile errors + module-not-found) |

## AC-235 Coverage Table

| AC | Test name | File:line | Result |
|----|-----------|-----------|--------|
| AC-235-01 | Show DDL fires renameTableRequest with previewOnly:true + camelCase fields | `src/components/schema/RenameTableDialog.test.tsx:181` | PASS |
| AC-235-01 | rename_table_preview_byte_equivalent | `src-tauri/src/db/postgres/mutations.rs` (cargo test) | PASS |
| AC-235-02 | IPC sequence: preview true → commit goes through compat wrapper | `src/components/schema/DropTableDialog.test.tsx:232` | PASS |
| AC-235-02 | rename_table_request_serde_camelcase_roundtrip | `src-tauri/src/models/schema.rs` (cargo test) | PASS |
| AC-235-02 | drop_table_request_serde_camelcase_roundtrip | `src-tauri/src/models/schema.rs` (cargo test) | PASS |
| AC-235-03 | IPC sequence preview true → commit (compat wrapper) | `src/components/schema/DropTableDialog.test.tsx:232` | PASS |
| AC-235-03 | drop_table_preview_no_cascade_byte_equivalent | `src-tauri/src/db/postgres/mutations.rs` (cargo test) | PASS |
| AC-235-03 | drop_table_preview_cascade_byte_equivalent | `src-tauri/src/db/postgres/mutations.rs` (cargo test) | PASS |
| AC-235-04 | opens with current table name pre-filled in input | `src/components/schema/RenameTableDialog.test.tsx:110` | PASS |
| AC-235-04 | Apply disabled when input matches current name | `src/components/schema/RenameTableDialog.test.tsx:117` | PASS |
| AC-235-04 | inline error when input is empty / whitespace-only | `src/components/schema/RenameTableDialog.test.tsx:170` | PASS |
| AC-235-04 | commit-success closes modal + calls onClose once | `src/components/schema/RenameTableDialog.test.tsx:201` | PASS |
| AC-235-05 | Apply disabled until typing-confirm matches table name | `src/components/schema/DropTableDialog.test.tsx:129` | PASS |
| AC-235-05 | case mismatch (Users vs users) keeps Apply disabled | `src/components/schema/DropTableDialog.test.tsx:136` | PASS |
| AC-235-05 | typing match unlocks Show DDL → preview SQL fetched | `src/components/schema/DropTableDialog.test.tsx:145` | PASS |
| AC-235-05 | CASCADE default off emits SQL without CASCADE keyword | `src/components/schema/DropTableDialog.test.tsx:158` | PASS |
| AC-235-05 | CASCADE toggle invalidates preview + next Show DDL re-fetches with cascade:true | `src/components/schema/DropTableDialog.test.tsx:174` | PASS |
| AC-235-05 | commit-success closes modal + calls onClose once | `src/components/schema/DropTableDialog.test.tsx:207` | PASS |
| AC-235-06 | production × strict + DROP TABLE → block path surfaces canonical message | `src/components/schema/DropTableDialog.test.tsx:262` | PASS |
| AC-235-06 | production × warn + DROP TABLE → warn-cancel surfaces canonical message | `src/components/schema/DropTableDialog.test.tsx:295` | PASS |
| AC-235-06 | local × off + DROP TABLE → safe path runs commit closure once | `src/components/schema/DropTableDialog.test.tsx:335` | PASS |
| AC-235-07 | Rename menu mounts RenameTableDialog pre-filled with current name | `src/components/schema/SchemaTree.actions.test.tsx:259` | PASS |
| AC-235-07 | Rename commit-success calls tauri.renameTable + dialog closes | `src/components/schema/SchemaTree.actions.test.tsx:308` | PASS |
| AC-235-07 | Apply disabled when name unchanged (rename-to-self) | `src/components/schema/SchemaTree.actions.test.tsx:401` | PASS |
| AC-235-08 | Drop menu mounts DropTableDialog with typing-confirm | `src/components/schema/SchemaTree.actions.test.tsx:198` | PASS |
| AC-235-08 | Drop commit-success calls tauri.dropTable + dialog closes | `src/components/schema/SchemaTree.actions.test.tsx:223` | PASS |
| AC-235-09 | inline error when input has embedded space | `src/components/schema/RenameTableDialog.test.tsx:124` | PASS |
| AC-235-09 | inline error when input has embedded quote | `src/components/schema/RenameTableDialog.test.tsx:133` | PASS |
| AC-235-09 | inline error when input has leading digit | `src/components/schema/RenameTableDialog.test.tsx:142` | PASS |
| AC-235-09 | inline error when input length > 63 bytes | `src/components/schema/RenameTableDialog.test.tsx:151` | PASS |
| AC-235-09 | inline error when input has embedded NULL byte | `src/components/schema/RenameTableDialog.test.tsx:160` | PASS |
| AC-235-09 | rename_table_invalid_new_name_rejected | `src-tauri/src/db/postgres/mutations.rs` (cargo test) | PASS |
| AC-235-10 | Sprint 226-234 byte-equivalent fixtures pass UNMODIFIED | `cargo test --lib` 395/0 (was 385/0; +10) | PASS |
| AC-235-11 | docs/PLAN.md row 10 = Sprint 235 ✓ entry | `docs/PLAN.md:161` | PASS |

Total: 32 distinct AC-tagged assertions (multiple cases per AC where
relevant). Vitest filter `AC-235` reports 22 cases; 10 cargo fixtures
+ 2 serde tests round out the backend coverage.

## Verification check results (40 / 40)

| # | Check | Command | Result |
|---|-------|---------|--------|
| 1 | vitest full | `pnpm vitest run` | PASS — 224 files / 2886 tests, 0 failed |
| 2 | tsc | `pnpm tsc --noEmit` | PASS — silent |
| 3 | lint | `pnpm lint` | PASS — silent |
| 4 | build | `pnpm build` | PASS — `dist/assets/index-*.js 1,221.03 kB` (size ↑ ~5 KB from 2 new modal components, gzipped delta ~1.5 KB) |
| 5 | cargo build | `cargo build --manifest-path src-tauri/Cargo.toml` | PASS — Finished in 0.68s |
| 6 | cargo clippy | `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` | PASS — 0 warnings |
| 7 | cargo fmt | `cargo fmt --check` | PASS — silent |
| 8 | cargo test (all) | `cargo test --lib` | PASS — 395/0/2 ignored (was 385/0/2; +10) |
| 9 | cargo test create_table | `cargo test --lib create_table` | PASS — 22/22 unchanged |
| 10 | cargo test create_index | `cargo test --lib create_index` | PASS — 11/11 unchanged |
| 11 | cargo test add_constraint | `cargo test --lib add_constraint` | PASS — 12/12 unchanged |
| 12 | cargo test alter_table | `cargo test --lib alter_table` | PASS — unchanged |
| 13 | cargo test rename_table | `cargo test --lib rename_table` | PASS — 11/11 (5 baseline rewritten + 6 new) |
| 14 | cargo test drop_table | `cargo test --lib drop_table` | PASS — 6/6 (2 baseline rewritten + 4 new) |
| 15 | cargo test list_types | `cargo test --lib list_types` | PASS — 2/2 unchanged |
| 16 | cargo test serde_roundtrip | `cargo test --lib serde_camelcase_roundtrip` | PASS — 2 new |
| 17 | vitest filter AC-235 | `pnpm vitest run -t "AC-235"` | PASS — 22/22 |
| 18 | RenameTableDialog file | `pnpm vitest run RenameTableDialog.test.tsx` | PASS — 8/8 |
| 19 | DropTableDialog file | `pnpm vitest run DropTableDialog.test.tsx` | PASS — 12/12 |
| 20 | SchemaTree.actions file | `pnpm vitest run SchemaTree.actions.test.tsx` | PASS — 30/30 |
| 21 | frozen — useDdlPreviewExecution | `git diff --stat src/components/structure/useDdlPreviewExecution.ts` | 0 |
| 22 | frozen — SqlPreviewDialog | `git diff --stat src/components/structure/SqlPreviewDialog.tsx` | 0 |
| 23 | frozen — schemaStore | `git diff --stat src/stores/schemaStore.ts` | 0 |
| 24 | frozen — connectionStore | `git diff --stat src/stores/connectionStore.ts` | 0 |
| 25 | frozen — safeModeStore | `git diff --stat src/stores/safeModeStore.ts` | 0 |
| 26 | frozen — safeMode + sqlSafety | `git diff --stat src/lib/safeMode.ts src/lib/sqlSafety.ts` | 0 |
| 27 | frozen — useFkReferencePicker | `git diff --stat src/hooks/useFkReferencePicker.ts` | 0 |
| 28 | frozen — postgresTypes.ts | `git diff --stat src/types/postgresTypes.ts` | 0 |
| 29 | frozen — SqlSyntax + sqlTokenize | `git diff --stat src/components/shared/SqlSyntax.tsx src/lib/sqlTokenize.ts` | 0 |
| 30 | frozen — Mongo paths | `git diff --stat src-tauri/src/db/mongo/ src/lib/tauri/mongo.ts` | 0 |
| 31 | frozen — useSchemaTableMutations | `git diff --stat src/hooks/useSchemaTableMutations.ts` | 0 |
| 32 | frozen — useDdlPreviewExecution test | `git diff --stat src/components/structure/useDdlPreviewExecution.test.tsx` | 0 |
| 33 | frozen — useSchemaCache | `git diff --stat src/hooks/useSchemaCache.ts` | 0 |
| 34 | frozen — useSchemaCache test | `git diff --stat src/hooks/useSchemaCache.test.ts` | 0 |
| 35 | grep — typing-confirm pattern | `grep -n "typingConfirm" src/components/schema/DropTableDialog.tsx` | 4 hits (state + check + change + reset) |
| 36 | grep — CASCADE checkbox | `grep -n 'aria-label="CASCADE"' src/components/schema/DropTableDialog.tsx` | 1 hit |
| 37 | grep — IDENTIFIER_RE | `grep -n "IDENTIFIER_RE" src/components/schema/RenameTableDialog.tsx` | 2 hits |
| 38 | grep — preview_only camelCase | `grep -n "previewOnly" src/lib/tauri/ddl.ts` | 4 hits |
| 39 | grep — request struct serde | `grep -n 'rename_all = "camelCase"' src-tauri/src/models/schema.rs` | 8 hits (3 baseline + 2 sprint 235 + headers) |
| 40 | grep — pre-existence check removed | `grep -n "information_schema.tables" src-tauri/src/db/postgres/mutations.rs` | 0 hits in `drop_table` body |

All 40 checks PASS.

## Decisions taken

All Sprint 235 contract-locked decisions confirmed without deviation:

- **Pre-existence check removal** — `drop_table` no longer queries
  `information_schema.tables`. PG's verbatim error surface through
  `AppError::Database` mapping; modal `previewError` slot
  (`role="alert"`) displays errors verbatim. Sprint 235 contract
  §Open Questions OQ-1.
- **CASCADE default state** — OFF (locked). User opts INTO the more
  dangerous form. Toggle invalidates preview. AC-235-05.
- **Typing-confirm policy** — case-sensitive byte-for-byte (locked).
  NO trim, NO debounce, every keystroke re-evaluates. AC-235-05.
- **Cancel-token propagation** — DEFERRED (Sprint 226 precedent).
  Sprint 235 contract §Open Questions OQ-2.
- **F2 keyboard rename** — preserved. F2 keydown handler in
  `rows.tsx` opens new modal. Auto-focus + select-all behaviour
  preserved via `autoFocus + onFocus={e => e.currentTarget.select()}`.
- **Dual-export compat layer** — `src/lib/tauri/ddl.ts` exports both
  `dropTableRequest` (request-shaped) and `dropTable` (positional
  compat); `schemaStore.ts` keeps diff = 0 (Sprint 223 invariant).

## Edge cases tested (with file:line references)

- Embedded NULL byte rejection (RE fails NULL byte) —
  `RenameTableDialog.test.tsx:160`.
- Embedded quote / leading digit / 64-byte / empty / whitespace-only
  — `RenameTableDialog.test.tsx:124-177`.
- CASCADE byte-equivalent SQL — `mutations.rs` fixture.
- Rename-to-self (modal pre-check Apply disabled, backend permissive)
  — `RenameTableDialog.test.tsx:117` + `mutations.rs` fixture.
- Safe Mode block / warn-cancel / safe matrix —
  `DropTableDialog.test.tsx:262/295/335`.
- IPC sequence `[{ previewOnly: true }, { previewOnly: false }]` —
  `RenameTableDialog.test.tsx:181` + `DropTableDialog.test.tsx:232`.
- F2 keyboard rename preserved — `SchemaTree.actions.test.tsx:482`.
- View / function buttons do NOT respond to F2 — `:516` + `:556`.

## Out of scope (deferred to future sprints)

- Mongo collection rename / drop — not part of Phase 27. Existing
  `useDocumentDatabaseDrop` hook preserved with its own confirm
  dialog pattern (Mongo flat shape).
- Cancel-token propagation through preview / commit (OQ-2 deferred).
- Rename across schemas (`ALTER TABLE … SET SCHEMA …`) — separate
  sprint candidate; current rename only changes the table name within
  the same schema.

## Bytes-equivalent SQL strings (for grep verification)

All four canonical preview emissions:

```sql
-- rename: ALTER TABLE "public"."users" RENAME TO "people"
-- drop (no cascade): DROP TABLE "public"."users"
-- drop (cascade): DROP TABLE "public"."users" CASCADE
-- rename to self (permissive): ALTER TABLE "public"."users" RENAME TO "users"
```

Asserted byte-for-byte in:
- `mutations.rs` fixtures: `rename_table_preview_byte_equivalent`,
  `drop_table_preview_no_cascade_byte_equivalent`,
  `drop_table_preview_cascade_byte_equivalent`,
  `rename_table_preview_self_permissive`.
- Test files reference these strings via `mockResolvedValueOnce({
  sql: 'DROP TABLE "public"."users" CASCADE' })` etc.

## Notes for the Evaluator

- The `SchemaTree.actions.test.tsx` rewrite is the only sibling-test
  diff (contract §Test invariants explicitly allows this). The
  rewrite drops 4 cases (AC-191-03 toast-fallback × 2; AC-CM-12/13
  Enter+Escape submit) because the underlying behaviour moved into
  the modal and is now covered by the dedicated dialog test files.
  Net case count preserved (30 → 30).
- `validate_identifier`'s leading-digit error message changed from
  the legacy ad-hoc "must not start with a digit" to the canonical
  "must start with a letter or underscore". One legacy fixture
  assertion text updated to match.
- The dual-export compat layer in `src/lib/tauri/ddl.ts` is the
  load-bearing piece that keeps `schemaStore.ts` diff = 0. If you
  inspect the diff, note that `dropTable(connectionId, table,
  schema)` now internally calls `dropTableRequest({ connectionId,
  schema, table, cascade: false, previewOnly: false })` — same
  network call, just wrapped.
