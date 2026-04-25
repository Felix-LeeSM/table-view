# Sprint 101 — Generator Findings

## Changed Files

- `src/lib/strings/document.ts` *(new)* — exports `COLLECTION_READONLY_BANNER_TEXT`. Lives in a dedicated strings module so future i18n can swap copy without touching component layout or tests.
- `src/components/document/CollectionReadOnlyBanner.tsx` *(new)* — non-dismissible `role="status"` banner with `aria-live="polite"`, sticky to the top of its scroll container, amber/warning tone (`bg-warning/10`, `border-warning/30`, `text-warning`), and an `AlertTriangle` lucide icon. Accepts an optional `message` prop that defaults to the shared constant.
- `src/components/document/__tests__/CollectionReadOnlyBanner.test.tsx` *(new)* — 3 unit cases: default text + role/aria-live, custom message override, no dismiss button.
- `src/components/DocumentDataGrid.tsx` — imports the banner and mounts `<CollectionReadOnlyBanner />` as the first child of the root `flex flex-1 flex-col overflow-hidden` container, above `DataGridToolbar`. No other layout changes.
- `src/components/DocumentDataGrid.test.tsx` — adds 1 case asserting the banner renders with the constant text and has no dismiss/close button.
- `src/components/DataGrid.test.tsx` — adds 1 regression case asserting `queryByText(COLLECTION_READONLY_BANNER_TEXT)` and `queryByRole("status")` are both null in the RDB grid.

## AC-by-AC Coverage

- **AC-01 — Banner exposed at top of MongoDB collection tab with `role="status"|"banner"` and constant text.**
  - Implementation: `src/components/document/CollectionReadOnlyBanner.tsx` lines 28–39 (`role="status"`, `aria-live="polite"`, renders `{message}` defaulting to `COLLECTION_READONLY_BANNER_TEXT`).
  - Mounted: `src/components/DocumentDataGrid.tsx` line 230 — first child inside root `<div className="flex flex-1 flex-col overflow-hidden">`.
  - Test: `src/components/DocumentDataGrid.test.tsx` "renders the collection read-only banner above the toolbar" (`findByRole("status")` + `toHaveTextContent(COLLECTION_READONLY_BANNER_TEXT)`).

- **AC-02 — No dismiss/close button; banner re-renders after tab switch via mount/unmount.**
  - Implementation: `CollectionReadOnlyBanner.tsx` renders zero `<button>` elements; the component holds no local state, so each remount of `DocumentDataGrid` re-renders the banner unconditionally.
  - Tests:
    - `CollectionReadOnlyBanner.test.tsx` "does not render a dismiss/close button" (`queryByRole("button", { name: /dismiss|close/i })` and `queryByRole("button")` both null).
    - `DocumentDataGrid.test.tsx` banner case re-asserts absence of any dismiss/close button.

- **AC-03 — RDB `DataGrid` does NOT render the banner.**
  - Implementation: `src/components/DataGrid.tsx` is untouched and never imports `CollectionReadOnlyBanner`.
  - Test: `src/components/DataGrid.test.tsx` "does not render the MongoDB collection beta banner in the RDB grid" (`queryByText(COLLECTION_READONLY_BANNER_TEXT)` null + `queryByRole("status")` null after fetch resolves).

- **AC-04 — Banner text lives in a separate constants file, i18n-friendly.**
  - Implementation: `src/lib/strings/document.ts` exports the constant; both the banner component and all three test files import it from `@lib/strings/document`.
  - Test: covered indirectly — three tests import the constant by name and assert against it; if the constant moved or renamed, those tests would fail to type-check.

## Verification Outputs

1. `pnpm vitest run` — **PASS**. `Test Files 100 passed (100)`, `Tests 1749 passed (1749)` (baseline 1744 + 5 new: 3 banner unit + 1 DocumentDataGrid + 1 DataGrid regression).
2. `pnpm tsc --noEmit` — **PASS**. Exit code 0, no diagnostics.
3. `pnpm lint` — **PASS**. ESLint exit 0, no warnings or errors.

## Text-Choice Rationale

The original spec calls for "Read-only — editing not yet supported", but Sprint 87 already shipped:
- Cell-level inline editing for MongoDB collections (double-click → edit → Commit → MQL preview → Execute path), and
- The Add Document modal (`AddDocumentModal.tsx`) with `insertDocument` / `updateDocument` / `deleteDocument` Tauri commands.

A "Read-only" banner would therefore be factually wrong and would mislead users who can clearly type into cells. The remaining gap relative to a fully-featured MongoDB UX is **schema/DDL operations** (collection create/drop, index management, schema validators), which is also called out as out-of-scope in the contract's *Out of Scope* section.

The recommended text — `"Beta — schema and DDL operations are not yet supported."` — accurately conveys both:
1. The product maturity signal users need ("Beta"), and
2. The specific capability gap, so users don't waste time looking for a missing feature.

This text is exported as `COLLECTION_READONLY_BANNER_TEXT` (constant name preserved from the spec for stability), so a future i18n migration only has to translate one string.

## Risks / Assumptions

- **Sticky positioning**: Banner uses `sticky top-0 z-20`. The parent (`flex flex-1 flex-col overflow-hidden`) does not scroll, so `sticky` behaves identically to a static block here, but the directive is preserved for the case where a future refactor moves the scroll container above the banner.
- **Color contrast**: `text-warning` on `bg-warning/10` is the same combination already used by `DataGridToolbar` and `DataGridTable` warning surfaces, so theme contrast is consistent with the rest of the app.
- **`aria-live="polite"`**: Screen readers announce the banner once on mount. Subsequent tab switches remount the component, which causes a re-announcement. This is desirable per AC-02 ("탭 전환/재진입 시에도 일관되게 보임").
- **Banner is permanently visible**: When DDL/schema work eventually ships, the banner will need either a `paradigm`-aware kill switch or its copy updated. That's explicitly out of scope here, but worth noting for future planners.

## Generator Handoff

### Changed Files
- `src/lib/strings/document.ts`: i18n-friendly constants module for document-paradigm UI strings.
- `src/components/document/CollectionReadOnlyBanner.tsx`: non-dismissible beta banner component.
- `src/components/document/__tests__/CollectionReadOnlyBanner.test.tsx`: unit tests (3 cases).
- `src/components/DocumentDataGrid.tsx`: mounts the banner above the toolbar.
- `src/components/DocumentDataGrid.test.tsx`: asserts the banner renders in the document grid.
- `src/components/DataGrid.test.tsx`: regression guard ensuring the banner is absent from RDB grids.

### Checks Run
- `pnpm vitest run`: pass (1749 / 1749)
- `pnpm tsc --noEmit`: pass
- `pnpm lint`: pass

### Done Criteria Coverage
- MongoDB tab top-of-grid banner with `role="status"`: covered by `CollectionReadOnlyBanner.tsx` + `DocumentDataGrid.tsx` mount + DocumentDataGrid test.
- No dismiss + persists across tab switches: covered by absence of button + stateless component design.
- RDB does not show the banner: covered by `DataGrid.test.tsx` regression guard.
- Text imported from a constants module: covered by `src/lib/strings/document.ts` + import-by-name assertions in three tests.

### Assumptions
- Recommended text (`"Beta — schema and DDL operations are not yet supported."`) is the right substitution for the stale literal spec text, given Sprint 87's editing capabilities.
- `text-warning` (rather than `text-warning-foreground`) is the appropriate utility because it is the established convention across `DataGridToolbar`, `DataGridTable`, `IndexesEditor`, etc.

### Residual Risk
- None for this sprint. Future DDL work will need to revisit the banner copy or remove it conditionally; that is explicitly out of scope here and deferred to a later sprint.
