# Findings: sprint-246

## Verification Summary

- Profile: command
- Checks run (re-executed by Evaluator):
  - `pnpm tsc --noEmit` — exit 0, 0 errors
  - `pnpm lint` — exit 0, 0 errors / 0 warnings
  - `pnpm vitest run` — exit 0, **226 files / 2936 tests passed** (matches Generator's claim)
  - `rg "ConfirmDangerousDialog" src/` — exit 1 (no matches) ✓
  - `rg "confirm-dangerous-input" src/` — exit 1 (no matches) ✓
  - `cargo test --lib --manifest-path src-tauri/Cargo.toml` — exit 0, **620 passed / 0 failed / 2 ignored**
  - `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` — exit 0, clean
- Evidence reviewed:
  - `src/components/workspace/ConfirmDestructiveDialog.tsx` (new, 122 lines)
  - `src/components/workspace/ConfirmDestructiveDialog.test.tsx` (new, 145 lines, 7 cases)
  - All 15 caller files (rdb/DataGrid, query/QueryTab, query/EditableQueryResultGrid,
    schema/{Add,Drop,Rename,Create,DropColumn}*Dialog, structure/{Columns,Constraints,Indexes}Editor,
    workspace/SafeModeToggle, hook docstrings)
  - 9 caller test files (DataGrid.editing, QueryTab.{safe-mode,document}, EditableQueryResultGrid.safe-mode,
    structure/{Columns,Constraints,Indexes}Editor, schema/{Drop{Table,Column},CreateTable}Dialog)
  - Untouched invariants: `src/lib/safeMode.ts`, `src/stores/safeModeStore.ts`, all Rust IPC

## Spot-check Detail

### a) `ConfirmDestructiveDialog.tsx` contract conformance

| Contract requirement | Evidence | Status |
|---|---|---|
| Props `{ open, reason, sqlPreview, environment, onConfirm, onCancel }` | lines 35–48 | ✓ |
| `environment === "production"` → title `"PRODUCTION DATABASE"` | lines 58–59 | ✓ |
| `environment === "non-production"` → title `"Destructive statement"` + `"Safe Mode (strict)"` | lines 59–62 (subcaption `"Safe Mode (strict) — non-production"`) | ✓ |
| `data-testid="dry-run-placeholder"` with Phase 3 copy | lines 93–99 (`"Dry-run preview will appear here (Phase 3)."`) | ✓ |
| Confirm always enabled | line 109–117 (no `disabled` prop) | ✓ |
| Type-to-confirm input + Run anyway button removed | none present | ✓ |
| Enter key triggers `onConfirm` | lines 73–78 (`onKeyDown` on `AlertDialogContent`) | ✓ |
| `data-testid="confirm-destructive-confirm"` | line 113 | ✓ |
| `data-testid="confirm-destructive-cancel"` | line 105 | ✓ |
| `aria-label="Statement preview"` on `<pre>` | line 89 | ✓ |
| `aria-label="Dry-run preview"` on placeholder | line 94 | ✓ |
| Default export is `ConfirmDestructiveDialog` | line 50 | ✓ |
| `autoFocus` on Confirm | line 114 | ✓ (also covers AC-246-D6 muscle-memory Enter) |

### b) `ConfirmDestructiveDialog.test.tsx` — AC-246-D1..D7 mapping

| AC | Test name | Line |
|---|---|---|
| D1 | `'PRODUCTION DATABASE' header` | 25 |
| D2 | `'Destructive statement' + 'Safe Mode (strict)' subcaption` | 42 |
| D3 | Confirm initially enabled | 59 |
| D4 | Confirm click → onConfirm × 1 | 74 |
| D5 | Cancel click → onCancel × 1 | 91 |
| D6 | Enter key → onConfirm × 1 | 108 |
| D7 | dry-run-placeholder + Phase 3 copy | 129 |

All 7 cases use the new testids; D4/D5 use `userEvent.click`; D6 uses `fireEvent.keyDown(getByRole("alertdialog"), {key: "Enter"})`.

### c) Caller files (3 sampled)

- **`src/components/rdb/DataGrid.tsx`**:
  - line 30: `import ConfirmDestructiveDialog from "@components/workspace/ConfirmDestructiveDialog";`
  - lines 630–645: JSX uses new component, `environment={connectionEnvironment === "production" ? "production" : "non-production"}` derived from `useConnectionStore` selector at line 55.
  - Confirms AC-246-E1.
- **`src/components/query/QueryTab.tsx`**:
  - line 16: import renamed.
  - lines 220–254: TWO dialog sites (Mongo + RDB) — both pass `environment={connection?.environment === "production" ? "production" : "non-production"}` (`connection` derived line 54).
  - Inline comment at line 235 explicitly notes Sprint 246 Phase 2 transition.
- **`src/components/schema/DropTableDialog.tsx`**:
  - line 14: import renamed.
  - line 79–82: new `connectionEnvironment` selector via `useConnectionStore`.
  - lines 274–289: JSX migrated, `environment` prop derived correctly.

All 15 callers use the identical `connection?.environment === "production" ? "production" : "non-production"` pattern (verified via `rg "connectionEnvironment === \"production\""` and `rg "connection?.environment === \"production\""`).

### d) Caller test files (3 sampled)

- **`src/components/rdb/DataGrid.editing.test.tsx`** (`AC-186-06` at line 791):
  - Old type-to-confirm flow gone — assertion now `await screen.findByText("PRODUCTION DATABASE")` at line 850.
  - No `confirm-dangerous-input` testid usage.
- **`src/components/query/EditableQueryResultGrid.safe-mode.test.tsx`**:
  - 13 testid lookups all use `confirm-destructive-confirm` / `confirm-destructive-cancel` (verified at lines 240, 254, 267).
  - `[AC-186-05a]` (line 231) explicitly asserts `expect(confirmBtn).not.toBeDisabled()` — verifies AC-246-W1/W3 behavior preserved.
  - `[AC-185-05c]` (line 189) covers non-production strict path — header reads `"Destructive statement"` + `Safe Mode (strict)` (lines 198–200), with `expect(screen.queryByText("PRODUCTION DATABASE")).not.toBeInTheDocument()` confirming environment branching works end-to-end.
- **`src/components/schema/DropTableDialog.test.tsx`**: line 272 `await screen.findByText("PRODUCTION DATABASE")`; cancel flow at 293–303 uses last `Cancel` button (the destructive dialog's, mounted on top).

### e) Out-of-Scope honored

- `git diff HEAD --stat` shows **no** modification of `src/lib/safeMode.ts` (decideSafeModeAction body) or `src/stores/safeModeStore.ts`. ✓
- IPC/Rust untouched (zero diff in `src-tauri/`). ✓
- `pendingConfirm` shape unchanged on all 3 hooks — the only diff is JSDoc text replacing `<ConfirmDangerousDialog>` → `<ConfirmDestructiveDialog>`. ✓
- No "Dry Run" separate button (Phase 4 deferred). ✓
- No Cmd+Z handler (Phase 5 deferred). ✓

## Findings

No P1/P2 findings. Two minor (P3) observations below.

### F-001 AC-246-W*/E1 labels not present in source as explicit `[AC-246-Wx]` strings

- Severity: P3 (informational)
- Repro: `rg "AC-246-W" src/` and `rg "AC-246-E1" src/` return 0.
- Expected: Contract says `[AC-246-W1..W4]` and `[AC-246-E1]` should be tracked, though contract also explicitly states `AC 번호 재발급 금지 — 기존 [AC-186-06] 등은 그대로 두되 본문만 새 dialog API 에 맞게 수정. 신규 케이스는 [AC-246-*] 시리즈만.`
- Actual: The behavioral guards live under their original AC numbers (`AC-186-04b`, `AC-186-05b`, `AC-186-06`, `AC-185-05c`, etc.) with updated bodies, which is consistent with the contract instruction to NOT renumber. No actual coverage gap — just label semantics.
- Evidence: `src/components/datagrid/useDataGridEdit.safe-mode.test.ts:244` ([AC-186-04b]); `EditableQueryResultGrid.safe-mode.test.tsx:189,231,246`; `DataGrid.editing.test.tsx:791`.
- Broken Contract Line: none — contract self-consistent on this.
- Suggestion: None required. Optionally Generator could add a top-of-handoff cross-reference table mapping AC-246-W1..W4/E1 to the legacy AC numbers (already partially done in handoff under "AC-185-* / AC-186-* / AC-187-* / AC-188-* / AC-231-*" section).
- Status: closed (acceptable per contract)

### F-002 Inline JSDoc comment in `EditableQueryResultGrid.safe-mode.test.tsx` (line 192) refers to "M.1 new flow"

- Severity: P3 (cosmetic)
- Repro: read line 192–194.
- Expected: just contextual comment.
- Actual: comment correctly explains Sprint 245+246 transition; no fix needed.
- Status: closed

## Pass Checklist

- `AC-246-D1`: `ConfirmDestructiveDialog.test.tsx:25` — production renders `PRODUCTION DATABASE` ✓
- `AC-246-D2`: `ConfirmDestructiveDialog.test.tsx:42` — non-production renders `Destructive statement` + `Safe Mode (strict)` ✓
- `AC-246-D3`: `ConfirmDestructiveDialog.test.tsx:59` — Confirm enabled at mount ✓
- `AC-246-D4`: `ConfirmDestructiveDialog.test.tsx:74` — onConfirm × 1 ✓
- `AC-246-D5`: `ConfirmDestructiveDialog.test.tsx:91` — onCancel × 1 ✓
- `AC-246-D6`: `ConfirmDestructiveDialog.test.tsx:108` — Enter → onConfirm × 1 ✓
- `AC-246-D7`: `ConfirmDestructiveDialog.test.tsx:129` — placeholder + Phase 3 copy ✓
- `AC-246-R1`: file `ConfirmDangerousDialog.tsx` deleted (`git status: D`) ✓
- `AC-246-R2`: `rg "ConfirmDangerousDialog" src/` = 0 ✓
- `AC-246-R3`: `rg "confirm-dangerous-input" src/` = 0 ✓
- `AC-246-W1`: `DataGrid.editing.test.tsx:791` AC-186-06 — `findByText("PRODUCTION DATABASE")` mount + Confirm enabled ✓
- `AC-246-W2`: `useDataGridEdit.safe-mode.test.ts:244` AC-186-04b — `confirmDangerous()` → `executeQueryBatch` × 1 (preserved verbatim, no diff in source hook signature) ✓
- `AC-246-W3`: `EditableQueryResultGrid.safe-mode.test.tsx:246` AC-186-05b — `confirm-destructive-confirm` click → `executeQueryBatch` × 1 ✓
- `AC-246-W4`: `EditableQueryResultGrid.safe-mode.test.tsx:189` AC-185-05c (dev+strict M.1 flow) — `findByText("Destructive statement")` + `Safe Mode (strict)` subcaption ✓
- `AC-246-E1`: `rg "connection?.environment === \"production\""` shows the identical ternary at every callsite (15+) ✓

## Missing Evidence

- None. Generator's evidence packet is complete and verified against actual file contents and re-run command output.

## Residual Risk

- **Phase 3 (Sprint 247)** must replace the static `<section data-testid="dry-run-placeholder">` body with real dry-run preview content; selector rename to `dry-run-preview` is suggested in handoff line 113.
- **Connection lookup race**: if the connection is deleted between `decideSafeModeAction` deciding "confirm" and dialog render, `connection` selector returns `undefined` and the ternary defaults to `"non-production"`. This is acceptable defensively (handoff line 81 documents it) — Safe Mode dialog still mounts, just with the less-shouty header. No failure path observed in tests.
- **Color-stripe SqlPreviewDialog (`environment` prop)**: structure editors still pass raw `connectionEnvironment: EnvironmentTag | null` to `SqlPreviewDialog` (different component) — not in scope here, but worth flagging that the codebase now has two `environment` prop conventions: `EnvironmentTag | null` (color stripe) vs `"production" | "non-production"` (destructive dialog). No conflict because the components are distinct, but Phase 3 should consider unifying if a third surface needs it.
