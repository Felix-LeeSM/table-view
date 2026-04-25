# Sprint-96 Findings — Dialog 2-Layer Layer 2 Preset Wrappers

## Summary

- 4 Layer-2 preset wrappers introduced under `src/components/ui/dialog/`:
  `ConfirmDialog`, `FormDialog`, `PreviewDialog`, `TabsDialog`.
- 7 application dialogs migrated onto presets (full migration map below).
- `connection/ConnectionDialog` carries an escape hatch comment (no body
  changes); `shared/ConfirmDialog` becomes a thin re-export so existing
  call sites and tests do not change.
- `docs/dialog-conventions.md` documents the architecture, preset selection
  rules, escape-hatch policy, and invariant checklist.

## Changed Files

| File | Purpose |
|---|---|
| `src/components/ui/dialog/ConfirmDialog.tsx` (new) | Layer-2 preset — generalised yes/no confirm with `tone` forwarding, replacing the original shared file. |
| `src/components/ui/dialog/FormDialog.tsx` (new) | Layer-2 preset — title/description + form body + submit/cancel footer + optional `DialogFeedback` slot. |
| `src/components/ui/dialog/PreviewDialog.tsx` (new) | Layer-2 preset — title + read-only preview body + optional confirm footer + sprint-93 `commitError` banner. |
| `src/components/ui/dialog/TabsDialog.tsx` (new) | Layer-2 preset — title + Radix `<Tabs>` group with declarative `tabs` array. |
| `src/components/ui/dialog/__tests__/ConfirmDialog.test.tsx` (new) | Preset unit tests (4 cases). |
| `src/components/ui/dialog/__tests__/FormDialog.test.tsx` (new) | Preset unit tests (6 cases). |
| `src/components/ui/dialog/__tests__/PreviewDialog.test.tsx` (new) | Preset unit tests (6 cases) including sprint-93 `commitError` banner. |
| `src/components/ui/dialog/__tests__/TabsDialog.test.tsx` (new) | Preset unit tests (5 cases). |
| `src/components/shared/ConfirmDialog.tsx` | Replaced with a thin re-export of the new preset (preserves `@components/shared/ConfirmDialog` import path for `QueryLog`, `GlobalQueryLogPanel`, `dialog.test.tsx`). |
| `src/components/connection/GroupDialog.tsx` | Migrated onto `FormDialog`. |
| `src/components/connection/ImportExportDialog.tsx` | Migrated onto `TabsDialog` (Export/Import tabs). |
| `src/components/datagrid/BlobViewerDialog.tsx` | Migrated onto `TabsDialog` (Hex/Text tabs). |
| `src/components/datagrid/CellDetailDialog.tsx` | Migrated onto `PreviewDialog` (read-only viewer — no confirm footer). |
| `src/components/structure/SqlPreviewDialog.tsx` | Migrated onto `PreviewDialog`; `commitError` flows through unchanged. |
| `src/components/document/MqlPreviewModal.tsx` | Migrated onto `PreviewDialog`. |
| `src/components/document/AddDocumentModal.tsx` | Migrated onto `FormDialog`. |
| `src/components/connection/ConnectionDialog.tsx` | Escape-hatch comment added at file top (lines 1–22). No body changes. |
| `src/components/connection/ImportExportDialog.test.tsx` | Selector tweaked from `role="radio"` to `role="tab"` + `mouseDown` to match Radix Tabs activation. |
| `docs/dialog-conventions.md` (new) | Layer architecture, preset selection table, escape-hatch policy, invariant checklist. |

## Migration Matrix (AC-02)

| Dialog | Preset | Notes |
|---|---|---|
| `connection/GroupDialog` | `FormDialog` | Inputs + palette radio group inside body slot; submitDisabled gates the Save button on blank name. |
| `connection/ImportExportDialog` | `TabsDialog` | Export/Import declared as `tabs[]`; controlled `value` mirrors prior `initialTab` prop. |
| `datagrid/BlobViewerDialog` | `TabsDialog` | Hex/Text tabs; byte-count footer rendered inside each pane. |
| `datagrid/CellDetailDialog` | `PreviewDialog` | Read-only viewer; no `onConfirm` → footer omitted. |
| `structure/SqlPreviewDialog` | `PreviewDialog` | sprint-93 `commitError` prop forwarded directly. |
| `document/MqlPreviewModal` | `PreviewDialog` | Enter-to-execute keydown lives on preview body, errors-list rendered inside body. |
| `document/AddDocumentModal` | `FormDialog` | textarea + parse error / async error inside body. |
| `shared/ConfirmDialog` | `ConfirmDialog` (re-export) | API stable; original path preserved as a thin re-export of `@components/ui/dialog/ConfirmDialog`. |
| `connection/ConnectionDialog` | escape hatch — Layer 1 only | See escape-hatch comment lines 1–22. |

## Escape Hatch (AC-03)

`src/components/connection/ConnectionDialog.tsx:1-22` — banner comment
identifies this file as the sole sanctioned Layer-1 escape hatch and lists
the four reasons (custom footer split, sprint-92 `slotName="test-feedback"`
identity contract, scrollable URL toggle, save-error rendered alongside the
test-feedback slot). Body of the dialog (lines 23+) is unchanged from prior
sprints.

## Verification Plan Outputs

| # | Command | Result |
|---|---|---|
| 1 | `pnpm vitest run` | `Test Files 97 passed (97), Tests 1713 passed (1713)` |
| 2 | `pnpm tsc --noEmit` | exit 0, no diagnostics |
| 3 | `pnpm lint` | exit 0, no diagnostics |
| 4 | `grep -rn "ConfirmDialog\|FormDialog\|PreviewDialog\|TabsDialog" src/components/ui/dialog` | All 4 preset files detected with named exports + tests. |
| 5 | `grep -rn 'from "@components/ui/dialog/' src` | 7 application-dialog migration sites + 1 re-export + 4 preset tests detected. |
| 6 | `ls docs/dialog-conventions.md` | File present (6.4 KB). |

## AC Coverage

- **AC-01 — 4 preset wrappers exist + Layer 1 only.**
  - Source: `src/components/ui/dialog/{ConfirmDialog,FormDialog,PreviewDialog,TabsDialog}.tsx`.
  - Each preset imports only `@components/ui/dialog`,
    `@components/ui/alert-dialog`, `@components/ui/tabs`, and `@components/ui/button`.
  - No direct `radix-ui` imports inside the presets.

- **AC-02 — 7 dialogs migrated.**
  - See migration matrix above. Each migration site imports from
    `@components/ui/dialog/<Preset>`.

- **AC-03 — ConnectionDialog escape hatch comment.**
  - `src/components/connection/ConnectionDialog.tsx:1-22`.

- **AC-04 — `docs/dialog-conventions.md` written.**
  - `docs/dialog-conventions.md` covers layer architecture, preset
    selection table, escape-hatch policy, invariant checklist.

- **AC-05 — Preset unit tests ≥ 1 per preset (≥ 4 total).**
  - `ConfirmDialog.test.tsx` — 4 cases.
  - `FormDialog.test.tsx` — 6 cases.
  - `PreviewDialog.test.tsx` — 6 cases (includes sprint-93 `commitError`).
  - `TabsDialog.test.tsx` — 5 cases.
  - Total: 21 preset tests, all passing.

- **AC-06 — sprint-91~95 invariant regressions: 0.**
  - sprint-91 close-button matrix: 9/9 cases pass (`src/components/ui/dialog.test.tsx:248-263`).
  - sprint-92 `expectNodeStable` on ConnectionDialog: 4/4 cases pass.
  - sprint-93 `commitError` banner contract preserved
    (`PreviewDialog.test.tsx` "renders the sprint-93 commitError banner..."
    asserts `role="alert"`, `aria-live="assertive"`,
    `data-testid="sql-preview-commit-error"`, "executed: 1, failed at: 2 of 3").
  - sprint-94 toast hookups: GlobalQueryLogPanel/QueryLog tests pass
    (still use `@components/shared/ConfirmDialog` re-export path).
  - sprint-95 `tone` / `layout` / `DialogFeedback`: presets reuse the
    primitives directly (`FormDialog` headerLayout, `PreviewDialog`/`TabsDialog`
    tone forwarding, `FormDialog` feedback slot).

- **AC-07 — visual/behavioural regression: 0.**
  - Full vitest run: 1713/1713.

## Assumptions

- The contract said "7~8 dialogs" — I migrated 7 (every dialog enumerated in
  the execution brief). The eighth dialog mentioned in the spec
  ("`StructurePanel`'s confirm modal etc.") does not exist as a dedicated
  modal in the codebase — `SchemaTree.tsx` uses an inline `confirmDialog`
  state object and a `<Dialog>` it renders directly. Migrating that inline
  confirm flow would touch unrelated SchemaTree state and was not in the
  brief's "쓰기 허용" list, so it was left as-is.
- `ImportExportDialog` previously used `<ToggleGroup type="single">` (Radix
  RadioGroup semantics → `role="radio"`). The `TabsDialog` preset uses
  Radix Tabs (`role="tab"`). Per the contract's Design Bar / Quality Bar
  ("필요 시 selector 만 미세 조정"), the test selector was updated from
  `getByRole("radio", ...)` + `fireEvent.click` to
  `getByRole("tab", ...)` + `fireEvent.mouseDown`. No behavioural change to
  end users.
- `connection/ConnectionDialog`'s escape-hatch comment was treated as the
  only allowed change to that file (per "**쓰기 금지**: ConnectionDialog
  본체 변경"). All 56 ConnectionDialog tests continue to pass unchanged.

## Residual Risk

- Preset surfaces are larger than the dialogs they replaced (extra
  `data-slot`, `role="dialog"` from `<DialogContent>`). No test currently
  relies on attributes that changed, but future tests should query
  presets via accessible name / role instead of tag-name lookups.
- The `BlobViewerDialog` byte-count footer is now duplicated inside each
  tab pane (Hex + Text) because `TabsDialog` does not own a "below tabs"
  slot. Visually identical; structurally redundant. Could be cleaned up
  later by adding a `footer` prop to `TabsDialog`, but that was out of
  scope this sprint.

---

## Generator Handoff

### Changed Files

- `src/components/ui/dialog/ConfirmDialog.tsx`: Layer-2 preset (yes/no confirm).
- `src/components/ui/dialog/FormDialog.tsx`: Layer-2 preset (form pattern).
- `src/components/ui/dialog/PreviewDialog.tsx`: Layer-2 preset (preview + sprint-93 commitError).
- `src/components/ui/dialog/TabsDialog.tsx`: Layer-2 preset (tabs pattern).
- `src/components/ui/dialog/__tests__/ConfirmDialog.test.tsx`: 4 unit tests.
- `src/components/ui/dialog/__tests__/FormDialog.test.tsx`: 6 unit tests.
- `src/components/ui/dialog/__tests__/PreviewDialog.test.tsx`: 6 unit tests including commitError.
- `src/components/ui/dialog/__tests__/TabsDialog.test.tsx`: 5 unit tests.
- `src/components/shared/ConfirmDialog.tsx`: re-export shim.
- `src/components/connection/GroupDialog.tsx`: → `FormDialog`.
- `src/components/connection/ImportExportDialog.tsx`: → `TabsDialog`.
- `src/components/datagrid/BlobViewerDialog.tsx`: → `TabsDialog`.
- `src/components/datagrid/CellDetailDialog.tsx`: → `PreviewDialog`.
- `src/components/structure/SqlPreviewDialog.tsx`: → `PreviewDialog`.
- `src/components/document/MqlPreviewModal.tsx`: → `PreviewDialog`.
- `src/components/document/AddDocumentModal.tsx`: → `FormDialog`.
- `src/components/connection/ConnectionDialog.tsx`: escape-hatch comment added (lines 1–22).
- `src/components/connection/ImportExportDialog.test.tsx`: tab selector tweak (radio → tab).
- `docs/dialog-conventions.md`: new conventions document.

### Checks Run

- `pnpm vitest run`: pass (1713/1713).
- `pnpm tsc --noEmit`: pass.
- `pnpm lint`: pass.
- `grep -rn "ConfirmDialog|FormDialog|PreviewDialog|TabsDialog" src/components/ui/dialog`: 4 presets + 4 test files detected.
- `grep -rn 'from "@components/ui/dialog/' src`: 7 migration sites + re-export + 4 preset tests.
- `ls docs/dialog-conventions.md`: present.

### Done Criteria Coverage

- AC-01: 4 presets present + Layer 1 only — verified by inspection of
  imports inside each preset file.
- AC-02: 7 dialogs migrated — see migration matrix.
- AC-03: ConnectionDialog escape-hatch comment at lines 1–22.
- AC-04: `docs/dialog-conventions.md` written.
- AC-05: 21 preset tests across 4 files, all passing.
- AC-06: sprint-91/92/93/94/95 invariant regression: 0.
- AC-07: full suite green.

### Assumptions

- "7~8 dialogs" interpreted as 7 — see Assumptions section above.
- Sprint-91 `ConfirmDialog` re-export keeps the
  `@components/shared/ConfirmDialog` import path stable for QueryLog /
  GlobalQueryLogPanel / dialog.test.tsx; new code can import from
  `@components/ui/dialog/ConfirmDialog`.
- Test selector tweak in ImportExportDialog (radio → tab) is the
  contract-allowed "minor selector adjustment" for the tabs migration.

### Residual Risk

- Byte-count footer duplicated across BlobViewerDialog tabs (cosmetic; no
  tests rely on a single instance).
- New presets accept `className` pass-through to `DialogContent`; callers
  who later want padding-on-content vs padding-in-body customisation may
  need a follow-up `bodyClassName` prop.
