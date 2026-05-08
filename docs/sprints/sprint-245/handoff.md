# Sprint 245 — Phase 1 (ADR 0022) Generator Handoff

## Generator Handoff

### Changed Files

Production code (5):

- `src/lib/safeMode.ts`: rewrote `decideSafeModeAction` to the destructive-only matrix (block path retired in Phase 1; production destructive → confirm regardless of mode; non-prod strict → confirm with M.1 reason copy; non-prod warn / off → allow). Removed `SQL_WRITE_KINDS`.
- `src/hooks/useSafeModeGate.ts`: removed `useSafeModeReadOnly` export + body + JSDoc; updated the matrix table in the file header to the Sprint 245 destructive-only policy.
- `src/components/rdb/DataGrid.tsx`: dropped the `useSafeModeReadOnly` import + flag + 4 guarded handlers + `toast` import; wired raw `editState.handleStartEdit / handleAddRow / handleDeleteRow / handleDuplicateRow` directly to `DataGridTable` and `DataGridToolbar`.
- `src/components/datagrid/DataGridToolbar.tsx`: removed `readOnly?: boolean` prop, the `readOnlyTitle` const, and every `disabled={readOnly || …}` / `title={readOnlyTitle ?? …}` branch; toolbar now matches the AC-185/AC-186 baseline.
- `src/components/workspace/SafeModeToggle.tsx`: rewrote `MODE_META.strict.tooltip` / `warn.tooltip` / `off.tooltip` to reflect the new policy semantics (strict = all environments; warn = production only; off = production-auto). Icons / `aria-pressed` / cycle order unchanged.

Test code (12):

- `src/lib/safeMode.test.ts`: removed `[AC-244-01..08]` (read-only assumptions); added 8 representative matrix cases `[AC-245-L1..L8]` plus the defensive empty-reason case.
- `src/hooks/useSafeModeGate.test.ts`: removed the `useSafeModeReadOnly` describe block (5 cases). Updated the wiring assertions to use `mode=warn` so they propagate without colliding with the new M.1 strict-mode dialog flow. New `[AC-245-H2]` ids.
- `src/components/rdb/DataGrid.editing.test.tsx`: removed the `useSafeModeStore.setState({ mode: "warn" })` workaround in `[AC-185-06]`.
- `src/components/datagrid/useDataGridEdit.safe-mode.test.ts`: inverted `[AC-244-10]` → `[AC-245-C1]` (prod+strict + safe DML now passes through). Inverted the prior block-on-prod-strict-WHERE-less-DELETE assertion to expect `pendingConfirm` (`[AC-185-04a]` re-pinned). Added `[AC-185-04c]` non-prod+strict M.1 dialog and `[AC-185-04c-2]` non-prod+warn pass-through. Replaced `[AC-190-01-3]` with `[AC-245-L6]` prod+off prod-auto-copy confirm. Header comment updated.
- `src/components/query/EditableQueryResultGrid.safe-mode.test.tsx`: inverted `[AC-244-09]` → `[AC-245-C3]` (prod+strict + UPDATE WHERE pk now passes through). Inverted `[AC-185-05a]` to expect confirm dialog. Added `[AC-185-05c]` M.1 non-prod+strict dialog and `[AC-185-05c-2]` non-prod+warn pass-through. Replaced `[AC-190-01-4]` with `[AC-245-L6]` prod+off prod-auto-copy confirm. Header comment updated.
- `src/components/query/QueryTab.safe-mode.test.tsx`: removed `[AC-244-11..14]` (4 cases). Added `[AC-245-C4 / C4-2 / C4-3]` (prod+strict + safe write/DDL pass-through), `[AC-245-N1]` (M.1 non-prod+strict+DROP confirm dialog), `[AC-245-N2]` (non-prod+warn+DROP pass-through). Inverted `[AC-231-01a]` (prod+strict+WHERE-less DELETE: block → confirm), `[AC-231-01c]` (prod+off+DROP: block → confirm with prod-auto copy), `[AC-231-02a]` (prod+strict+multi: block → confirm). Re-pinned `[AC-231-01d]` to dev+warn so non-prod-bypass coverage stays without overlapping M.1.
- `src/components/workspace/SafeModeToggle.test.tsx`: rewrote `[HF-187-A1]` into 3 separate cases `[AC-245-T1..T3]` matching the new tooltip copy.
- `src/components/query/QueryTab.execution.test.tsx`: pinned 3 multi-statement tests using `DROP TABLE nope` to mode=warn (otherwise non-prod+strict opens M.1 confirm and short-circuits the execution-path tests). Added `useSafeModeStore` import.
- `src/components/query/QueryTab.document.test.tsx`: inverted `[AC-188-03a]` (prod+strict+$out: block → confirm), `[AC-190-01-5]` (prod+off+$out: block → confirm with prod-auto copy), `[AC-188-03e]` (non-prod+strict+$out: dispatch → M.1 confirm). Added `[AC-188-03e-2]` non-prod+warn pass-through.
- `src/components/structure/IndexesEditor.test.tsx`: inverted `[AC-187-05a]` (prod+strict+DROP INDEX: block → confirm). Re-pinned `[AC-187-05e]` to mode=warn.
- `src/components/structure/ConstraintsEditor.test.tsx`: inverted `[AC-187-06a]` (prod+strict+DROP CONSTRAINT: block → confirm). Re-pinned `[AC-187-06e]` to mode=warn.
- `src/components/structure/ColumnsEditor.test.tsx`: inverted `[AC-187-04a]` (prod+strict+ALTER DROP COLUMN: block → confirm).
- `src/components/schema/DropTableDialog.test.tsx`: inverted the `[AC-235-06]` block case (prod+strict+DROP TABLE: block → confirm).
- `src/components/schema/DropColumnDialog.test.tsx`: inverted the `[AC-236-06]` block case (prod+strict+DROP COLUMN: block → confirm).
- `src/components/schema/StructurePanel.columns.test.tsx`: pinned `[AC-236-08]` to mode=warn (non-prod connection state would now open M.1 confirm dialog under default strict).
- `src/components/schema/StructurePanel.constraints.test.tsx`: pinned `executing drop constraint calls dropConstraint without preview_only` to mode=warn.
- `src/components/schema/StructurePanel.indexes.test.tsx`: pinned `executing drop index calls dropIndex without preview_only` and `shows error in modal when execute drop index fails` to mode=warn.
- `src/components/schema/CreateTableDialog.test.tsx`: inverted the `blocks commit closure entirely when Safe Mode is strict and statement is dangerous` case to `opens confirm dialog (does not commit) …`.

### Checks Run

1. `pnpm tsc --noEmit` — pass (exit 0)
2. `pnpm lint` — pass (no ESLint output, exit 0)
3. `pnpm vitest run` — pass: `Test Files 226 passed (226), Tests 2934 passed (2934)` in 38.07s
4. `cargo test --lib --manifest-path src-tauri/Cargo.toml` — pass: `620 passed; 0 failed; 2 ignored`
5. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` — pass: clean, no warnings

### Done Criteria Coverage

1. **`decideSafeModeAction` matrix 8 cases** — `src/lib/safeMode.ts:53-91` body; verified by `src/lib/safeMode.test.ts:50-186` (`AC-245-L1..L8`).
2. **`useSafeModeReadOnly` symbol absent** — `src/hooks/useSafeModeGate.ts` exports only `SafeModeDecision`, `SafeModeGate`, `useSafeModeGate`. Wider repo grep returns 2 matches in comments (DataGrid.tsx:257, useSafeModeGate.test.ts:11) describing the removal — no actual uses.
3. **`DataGridToolbar.readOnly` prop absent** — `src/components/datagrid/DataGridToolbar.tsx:39-89` interface has no `readOnly`, no `readOnlyTitle` const, no `disabled={readOnly}` branch (verified by grep returning 0 matches in the toolbar file).
4. **DataGrid cell-edit / Add / Delete / Duplicate work in production+strict** — `src/components/rdb/DataGrid.tsx:257-263` (no gate) + `src/components/rdb/DataGrid.editing.test.tsx:734` (`[AC-185-06]` no longer needs the warn workaround; cell-edit flows under any mode).
5. **prod+strict + safe DML / safe write passes through to executeQueryBatch / executeQuery** —
   - `useDataGridEdit`: `src/components/datagrid/useDataGridEdit.safe-mode.test.ts:136` (`[AC-245-C1]`)
   - `EditableQueryResultGrid`: `src/components/query/EditableQueryResultGrid.safe-mode.test.tsx:177` (`[AC-245-C3]`)
   - `useQueryExecution`: `src/components/query/QueryTab.safe-mode.test.tsx:222` (`[AC-245-C4]`), `:242` (`[AC-245-C4-2]`), `:258` (`[AC-245-C4-3]`)
6. **non-prod + strict + DROP TABLE → confirm dialog (M.1 NEW flow)** — `src/components/query/QueryTab.safe-mode.test.tsx:278` (`[AC-245-N1]`); paired pass-through case `:302` (`[AC-245-N2]`).
7. **`SafeModeToggle` tooltip reflects new policy** — `src/components/workspace/SafeModeToggle.tsx:30-72` body; verified by `src/components/workspace/SafeModeToggle.test.tsx:81-126` (`[AC-245-T1..T3]`).
8. **5 verification checks pass** — see "Checks Run" above.

### Sprint 244 invert AC handling

- `[AC-244-01..08]` (lib read-only assertions in `safeMode.test.ts`) — **deleted** and replaced by `[AC-245-L1..L8]`.
- `[AC-244-09]` (EditableQueryResultGrid block on safe DML) — **inverted to** `[AC-245-C3]` pass-through.
- `[AC-244-10]` (useDataGridEdit block on safe DML) — **inverted to** `[AC-245-C1]` pass-through.
- `[AC-244-11..14]` (QueryTab safe write/DDL block) — **deleted**; replaced by `[AC-245-C4 / C4-2 / C4-3]` pass-through cases (write+DDL on prod+strict) plus `[AC-245-N1 / N2]` (M.1 non-prod strict flow).

### Assumptions

- **prod + off destructive — confirm vs. block**: ADR 0022 Phase 1 invariant says "prod + any-mode + destructive → confirm". I implemented this; the prod-auto reason copy ("production environment forces Safe Mode — change connection environment tag to override") is preserved verbatim so off remains distinguishable from warn on production. Phase 2 will unify the dialog UI; until then, downstream consumers see the prod-auto copy in `pendingConfirm.reason` instead of `commitError.message`.
- **Confirm reason copy on prod + strict / warn**: kept *bare* analyzer reason (e.g. `"DELETE without WHERE clause"`) rather than appending the toolbar-override hint. Reason: the existing Phase 1 dialog uses type-to-confirm, and the existing tests (`[AC-186-04a]`, `[AC-186-05b]`, `[AC-231-02b]`) type the bare analyzer reason verbatim. Sprint 246 will replace the typed-confirm with simple Yes/No; the override hint can move into a separate dialog field at that point. Contract `AC-245-L6`'s "strict/warn 은 toolbar override copy" is interpreted as describing the eventual Phase 2 dialog text, not the Phase 1 `action.reason` field — preserving Phase 1 dialog dialog text per the execution-brief Invariant ("현재 텍스트 그대로 유지").
- **Non-prod + strict reason copy**: NEW M.1 reason adds the suffix "(Safe Mode strict — destructive statement in non-production)" so this branch is distinguishable from the bare prod+strict copy. Pinned by `[AC-245-L1]`, `[AC-185-04c]`, `[AC-188-03e]`, `[AC-245-N1]`. The longer suffix makes type-to-confirm awkward in non-prod strict, but Phase 2 will eliminate the typing requirement.
- **Re-pinning of `[AC-187-05e]` / `[AC-187-06e]` / `[AC-231-01d]`**: those cases previously asserted "non-prod + strict bypass". Under the new M.1 flow, non-prod+strict+destructive opens the dialog; I switched them to mode=warn so they keep asserting "non-prod = unguarded for warn/off" without overlapping the new M.1 path (which already has dedicated `[AC-245-N1]` etc. coverage).

### Residual Risk

- **Phase 2 dialog redesign tightly coupled to reason-copy semantics**: my Phase 1 chose to keep bare reason for prod+strict / prod+warn so existing type-to-confirm tests still pass. Sprint 246 will need to surface the toolbar-override hint as separate dialog text (not in `action.reason`). If Sprint 246 instead chooses to extend the lib reason field, several `[AC-186-*]` and `[AC-231-02b]` tests will need their typed strings updated.
- **Mongo dry-run unsupported (Phase 3 scope)**: ADR 0022 mentions Mongo single-node lacks transactions, so dry-run preview won't apply. Phase 1 leaves the existing `analyzeMongoPipeline` classifier untouched and routes Mongo destructive through the same confirm dialog as RDB; Phase 3 will need a Mongo-specific fallback.
- **`AC-231-01a` / `AC-231-01c` / `AC-231-02a` were re-purposed**: they originally asserted block flow on prod+strict; under Phase 1 they assert confirm dialog. The AC ids stay because the tests still cover the same scenario family — the contract did not list them in the explicit removal list, but their previous assertions are no longer reachable. If Phase 2 needs to re-introduce block paths (e.g. for cancellable destructive), the inverted assertions should be re-evaluated.
