# Sprint 246 — Generator Handoff

## Summary
ADR 0022 Phase 2: replaced `ConfirmDangerousDialog` (type-to-confirm + "Run anyway") with
`ConfirmDestructiveDialog` (simple Yes/No + `environment` prop driving header copy + dry-run
placeholder section). Hook signatures (`pendingConfirm`, `decideSafeModeAction`) are preserved;
only the dialog UI and its 9 caller test files changed shape.

## Acceptance Criteria

### AC-246-D1..D7 (new dialog component)
| AC | Description | Test |
|----|-------------|------|
| D1 | `environment="production"` renders `PRODUCTION DATABASE` title + `Destructive statement` subcaption | `ConfirmDestructiveDialog.test.tsx` |
| D2 | `environment="non-production"` renders `Destructive statement` title + `Safe Mode (strict) — non-production` subcaption | same |
| D3 | Confirm button is enabled on mount (no type-to-confirm gate) | same |
| D4 | Confirm click invokes `onConfirm` exactly once | same |
| D5 | Cancel click invokes `onCancel` exactly once | same |
| D6 | Enter key submits (calls `onConfirm`); autoFocus on Confirm | same |
| D7 | Dry-run placeholder section is rendered with `data-testid="dry-run-placeholder"` and Phase 3 copy | same |

### AC-185-* / AC-186-* / AC-187-* / AC-188-* / AC-231-* (caller test migration)
- All 9 caller test files migrated from `getByLabelText("Type danger reason to confirm")` +
  "Run anyway" button click → `getByTestId("confirm-destructive-confirm")` click.
- Header copy assertions updated:
  - production-environment connections (`mockConnection.environment === "production"`) →
    `PRODUCTION DATABASE`.
  - non-production strict (Safe Mode strict on non-production env) → `Destructive statement`
    + `Safe Mode (strict) — non-production`.
- Cancel testid: `confirm-destructive-cancel`.

## Files Changed

### Created
- `src/components/workspace/ConfirmDestructiveDialog.tsx` — new dialog (replaces ConfirmDangerousDialog).
- `src/components/workspace/ConfirmDestructiveDialog.test.tsx` — AC-246-D1..D7.

### Deleted
- `src/components/workspace/ConfirmDangerousDialog.tsx`
- `src/components/workspace/ConfirmDangerousDialog.test.tsx`

### Modified — call sites (15)
- `src/components/rdb/DataGrid.tsx` — import + JSX rename + `environment` prop from `connectionEnvironment`.
- `src/components/query/QueryTab.tsx` — 2 dialog sites (Mongo + RDB), uses `connection?.environment`.
- `src/components/query/EditableQueryResultGrid.tsx` — uses `connectionEnvironment`.
- `src/components/query/useRawQueryGridEdit.ts` — comments only.
- `src/components/datagrid/useDataGridEdit.ts` — JSDoc only.
- `src/components/schema/DropTableDialog.tsx` — `useConnectionStore` selector + `environment` prop.
- `src/components/schema/DropColumnDialog.tsx` — same.
- `src/components/schema/AddColumnDialog.tsx` — same.
- `src/components/schema/RenameTableDialog.tsx` — same.
- `src/components/schema/CreateTableDialog.tsx` — same.
- `src/components/structure/ColumnsEditor.tsx` — uses existing `connectionEnvironment`.
- `src/components/structure/ConstraintsEditor.tsx` — same.
- `src/components/structure/IndexesEditor.tsx` — same.
- `src/components/structure/useDdlPreviewExecution.ts` — JSDoc only.
- `src/components/workspace/SafeModeToggle.tsx` — docstring only.

### Modified — caller tests (9)
- `src/components/structure/ColumnsEditor.test.tsx` (AC-187-04a..d)
- `src/components/structure/ConstraintsEditor.test.tsx` (AC-187-06)
- `src/components/structure/IndexesEditor.test.tsx` (AC-187-05)
- `src/components/query/EditableQueryResultGrid.safe-mode.test.tsx` (AC-185-05c, AC-186-05a..c)
- `src/components/query/QueryTab.safe-mode.test.tsx` (AC-231-02b, AC-231-03)
- `src/components/query/QueryTab.document.test.tsx` (AC-188-03b + 5 testid sites)
- `src/components/schema/DropTableDialog.test.tsx` (header copy)
- `src/components/schema/DropColumnDialog.test.tsx` (header copy)
- `src/components/schema/CreateTableDialog.test.tsx` (4 sites header copy)
- `src/components/rdb/DataGrid.editing.test.tsx` (AC-186-06 header copy)

## Key Design Decisions

1. **Header copy branching is in the dialog, not callers.** Callers pass `environment` literal
   (`"production" | "non-production"`); the dialog computes title + subcaption. This keeps
   Phase 3 (dry-run) free to add policy-aware UI without touching every caller again.

2. **`environment` derivation rule** at every call site:
   ```ts
   environment={connection?.environment === "production" ? "production" : "non-production"}
   ```
   Falls back to `"non-production"` when connection is `undefined` (defensive — Safe Mode
   would already be `lenient` and confirm wouldn't fire, but the prop is required).

3. **Dry-run placeholder is a real section, not a comment.** Renders
   `<section aria-label="Dry-run preview" data-testid="dry-run-placeholder">…</section>`
   with the literal copy `"Dry-run preview will appear here (Phase 3)."` so Phase 3 (Sprint 247)
   can swap the body without restructuring the dialog.

4. **Confirm always enabled, autoFocus, Enter submits.** Removed the type-to-confirm gate
   per ADR 0022. Phase 4 (Sprint 248) will add a separate "Dry Run" button next to Confirm.

5. **Hook signatures untouched.** `decideSafeModeAction` body and `pendingConfirm` shape
   are preserved — Phase 3 will extend, not break, this surface.

## Verification

| Check | Result |
|-------|--------|
| `pnpm tsc --noEmit` | 0 errors |
| `pnpm lint` | 0 errors / 0 warnings |
| `pnpm vitest run` | 226 files / 2936 tests passed |
| `rg "ConfirmDangerousDialog" src/` | 0 matches |
| `rg "confirm-dangerous-input" src/` | 0 matches |
| `rg "ConfirmDangerous" src/` | 0 matches |
| `rg "confirm-dangerous" src/` | 0 matches |
| `cargo test --lib --manifest-path src-tauri/Cargo.toml` | 620 passed / 0 failed / 2 ignored |
| `cargo clippy --all-targets --all-features -- -D warnings` | clean |

## Risks / Follow-ups

- **Phase 3 (Sprint 247)** will replace the dry-run placeholder section with real
  preview content. The `data-testid="dry-run-placeholder"` selector is the integration
  point — Phase 3 should rename it to `dry-run-preview` once content lands.
- **Phase 4 (Sprint 248)** adds a separate "Dry Run" button. The current footer layout
  (`Cancel` + `Confirm`) leaves room for a third button to the left of `Cancel`.
- **Phase 5 (Sprint 249)** adds Cmd+Z undo. Not affected by this sprint.
- No changes to `decideSafeModeAction` matrix — production + lenient still routes through
  the Phase 1 policy. Phase 2 only changes presentation.

## Out of Scope (intentionally deferred)

- Dry-run execution wiring (Phase 3).
- Separate Dry Run button (Phase 4).
- Cmd+Z shortcut (Phase 5).
- ADR 0022 production policy revisions (locked from Phase 1).
