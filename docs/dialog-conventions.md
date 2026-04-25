# Dialog Conventions

Status: active (sprint-96)

This document describes the Table View dialog architecture and the rules
contributors follow when adding or modifying a dialog.

## 2-Layer architecture

```
Layer 1 — primitives        src/components/ui/dialog.tsx
                            src/components/ui/alert-dialog.tsx
                            src/components/ui/tabs.tsx (used by TabsDialog)

Layer 2 — preset wrappers   src/components/ui/dialog/ConfirmDialog.tsx
                            src/components/ui/dialog/FormDialog.tsx
                            src/components/ui/dialog/PreviewDialog.tsx
                            src/components/ui/dialog/TabsDialog.tsx

Application dialogs         src/components/connection/GroupDialog.tsx
                            src/components/connection/ImportExportDialog.tsx
                            src/components/datagrid/BlobViewerDialog.tsx
                            src/components/datagrid/CellDetailDialog.tsx
                            src/components/structure/SqlPreviewDialog.tsx
                            src/components/document/MqlPreviewModal.tsx
                            src/components/document/AddDocumentModal.tsx
                            src/components/connection/ConnectionDialog.tsx [escape hatch]
                            src/components/shared/ConfirmDialog.tsx [re-export]
```

### Layer 1 — primitives

shadcn-style wrappers around Radix Dialog. They own the universal contracts:

- `data-slot` selectors used by tests (`dialog-content`, `dialog-feedback`,
  `alert-dialog-content`, ...).
- `tone` prop: `default` / `destructive` / `warning` border tokens.
- `DialogHeader` `layout`: `row` (default — title and X on one row) /
  `column` (stacked title + description).
- `DialogContent` `showCloseButton`: keep ≤ 1 close button per dialog
  (sprint-91 matrix).
- `DialogFeedback`: always-mounted slot for idle / loading / success / error
  with stable DOM identity (sprint-92).

### Layer 2 — presets

Four wrappers that absorb the boilerplate of the four dominant dialog
patterns. **Application dialogs should pick one of these — they should not
import Layer 1 primitives directly.**

| Preset | Use when |
|--------|----------|
| `ConfirmDialog` | Yes/no destructive or terminal action. Title + short message + confirm/cancel. Built on `<AlertDialog>` so the X is suppressed and the keyboard contract follows the Radix AlertDialog rules. |
| `FormDialog` | Form-style dialog with inputs and submit/cancel. Owns header + body slot + optional `feedback` slot + footer. |
| `PreviewDialog` | Read-only or "review then run" preview of generated content (SQL/MQL/cell/blob). Owns title + body slot + optional confirm footer + sprint-93 `commitError` banner. |
| `TabsDialog` | Dialog whose body is a tabbed pane (e.g. Hex / Text, Export / Import). Owns title + tab list + `<TabsContent>` panes. |

Each preset documents its own props in JSDoc. Common rules:

- Presets never reach into Radix directly. They only compose Layer 1.
- Presets accept a `className` that is forwarded to `DialogContent` so the
  call site can override width / padding without rewriting the shell.
- Presets wire `onOpenChange={(next) => !next && onCancel()}` automatically.
  Application dialogs should not duplicate this.
- Sprint-93 `commitError` (executed/failed-at counters + raw failing SQL)
  lives in `PreviewDialog`. Migrating SQL/MQL preview surfaces between
  tablet/desktop layouts must not rebuild that banner.

### Application dialogs

These are the call sites. They:

- Pick a preset that matches the dialog's pattern.
- Own state (form fields, parser errors, async outcomes).
- Forward state to the preset's typed props rather than hand-rolling
  banners or footers.

### Sprint-96 migration map

| Dialog | Preset |
|--------|--------|
| `connection/GroupDialog` | `FormDialog` |
| `connection/ImportExportDialog` | `TabsDialog` |
| `datagrid/BlobViewerDialog` | `TabsDialog` |
| `datagrid/CellDetailDialog` | `PreviewDialog` (read-only viewer — no confirm footer) |
| `structure/SqlPreviewDialog` | `PreviewDialog` |
| `document/MqlPreviewModal` | `PreviewDialog` |
| `document/AddDocumentModal` | `FormDialog` |
| `shared/ConfirmDialog` | `ConfirmDialog` (re-export from `ui/dialog/`) |
| `connection/ConnectionDialog` | escape hatch — Layer 1 only |

## Escape hatch policy

A dialog may bypass Layer 2 and use Layer 1 primitives directly **only when
all of the following are true**:

1. The dialog has a structural requirement no preset captures (e.g. a
   custom footer layout, a unique stable-identity contract, or a multi-mode
   body that cannot be expressed via `children`).
2. The bypass is documented at the top of the file with a comment that
   names the specific reasons and references this document.
3. The escape hatch passes the sprint-91 close-button matrix
   (`src/components/ui/dialog.test.tsx`) — at most one element with the
   close-button accessible name.

Currently `connection/ConnectionDialog` is the only sanctioned escape
hatch. It satisfies all three rules:

- Custom footer split (Test Connection on the left, Cancel + Save on the
  right) — no preset offers a two-group footer.
- `data-slot="test-feedback"` selector preserved via
  `<DialogFeedback slotName="test-feedback" />` so the sprint-92
  `expectNodeStable` test keeps tracking the same node across state
  transitions.
- The save-error banner sits next to (not inside) the test-feedback slot —
  presets keep feedback contained within a single slot by design.

New escape hatches require a sprint contract entry and a corresponding
note in the migration map above. Default: **pick a preset**.

## Invariant checklist

When migrating or adding a dialog:

- [ ] sprint-91 close-button matrix passes (≤ 1 close button per dialog).
- [ ] sprint-92 `expectNodeStable` still passes for ConnectionDialog.
- [ ] sprint-93 `commitError` banner contract preserved if SQL/MQL preview
      is involved (`role="alert"`, `aria-live="assertive"`,
      `data-testid="sql-preview-commit-error"`, "executed: N, failed at: K
      of M" + raw failed SQL).
- [ ] sprint-94 toast hookups still fire after commit/connection actions.
- [ ] sprint-95 Layer-1 primitives (`tone`, `layout`, `DialogFeedback`)
      remain in use rather than hand-rolled equivalents.
- [ ] Each preset added under `src/components/ui/dialog/__tests__/` carries
      ≥ 1 unit test.
