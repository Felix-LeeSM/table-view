# Sprint 101 Evaluation Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| **Correctness** | **9/10** | All four ACs satisfied with verified DOM assertions. Banner mounts at correct position (`DocumentDataGrid.tsx:230`, first child of root container, above `DataGridToolbar`). `role="status"` + `aria-live="polite"` correctly applied (`CollectionReadOnlyBanner.tsx:31-32`). Stateless component — re-mount on tab switch guarantees re-display per AC-02. Text choice ("Beta — schema and DDL operations are not yet supported.") is factually defensible: sprint-87 shipped cell editing + AddDocument (`src/components/document/AddDocumentModal.tsx` confirmed present), so the original spec text "Read-only — editing not yet supported" would have been actively misleading. |
| **Completeness** | **9/10** | Every contract deliverable is in place: new component (`CollectionReadOnlyBanner.tsx`), new constants module (`src/lib/strings/document.ts:17`), banner mount in `DocumentDataGrid.tsx:230`, banner unit tests (3 cases), `DocumentDataGrid.test.tsx` integration assertion (lines 409–420), `DataGrid.test.tsx` regression guard (lines 1699–1707). Constant has a single export site and four import sites — easy to swap into an i18n catalog without grepping JSX. The optional unit-test file was also produced. |
| **Reliability** | **8/10** | Stateless functional component with no side effects → no failure modes. `role="status"` + `aria-live="polite"` ensures one screen-reader announcement per mount, which is the desirable behavior for AC-02 ("탭 전환/재진입 시에도 일관되게 보임"). Sticky positioning (`sticky top-0 z-20`) is a no-op today because the parent (`flex flex-1 flex-col overflow-hidden` at `DocumentDataGrid.tsx:229`) does not scroll, but the directive is forward-compatible. Layout: banner is rendered before `flex-1` scroll area (`DocumentDataGrid.tsx:281`), so banner takes natural height and the data grid still occupies remaining space — no layout regression. Color tokens (`bg-warning/10`, `border-warning/30`, `text-warning`) match the existing convention used by `DataGridToolbar`, `DataGridTable`, `IndexesEditor`. One small future-proofing concern: the banner is hard-mounted regardless of paradigm-aware feature flags, so when DDL eventually ships the copy will need an update or conditional render — the generator already flagged this in their findings. |
| **Verification Quality** | **9/10** | All three contract verification steps confirmed locally: `pnpm vitest run` → 1749/1749 pass (100 files; baseline 1744 + 5 new), `pnpm tsc --noEmit` → exit 0, `pnpm lint` → exit 0. Test assertions are tight: `getByRole("status")` + `toHaveTextContent(COLLECTION_READONLY_BANNER_TEXT)` (named-import binding doubles as AC-04 evidence — moving/renaming the constant would break type-check). Regression test in `DataGrid.test.tsx:1699-1707` covers both text-absence and `role="status"` absence, catching cross-paradigm leaks via either signal. Unit test in `CollectionReadOnlyBanner.test.tsx:33` defensively asserts no `<button>` of any name (not just /dismiss|close/), guarding against future regressions. |
| **Overall** | **8.75/10** | |

## Verdict: PASS

All dimensions ≥ 7. Locally re-verified: vitest 1749/1749, tsc exit 0, lint exit 0.

## Sprint Contract Status (Done Criteria)

- [x] **AC-01** — Banner exposed at top of MongoDB collection tab with `role="status"` + `aria-live="polite"` and constant text.
  - Evidence: `CollectionReadOnlyBanner.tsx:31-32` (role + aria-live), line 27 (default = `COLLECTION_READONLY_BANNER_TEXT`), `DocumentDataGrid.tsx:230` (mount as first child). Test: `DocumentDataGrid.test.tsx:413-414` (`findByRole("status")` + `toHaveTextContent(COLLECTION_READONLY_BANNER_TEXT)`).
- [x] **AC-02** — No dismiss/close button; persists across tab switches.
  - Evidence: `CollectionReadOnlyBanner.tsx` renders zero `<button>` elements; component holds no local state, so each `DocumentDataGrid` mount re-renders the banner. Tests: `CollectionReadOnlyBanner.test.tsx:25-34` (asserts `queryByRole("button", { name: /dismiss|close/i })` null AND `queryByRole("button")` null) + `DocumentDataGrid.test.tsx:417-419`.
- [x] **AC-03** — RDB `DataGrid` does NOT render the banner.
  - Evidence: `src/components/DataGrid.tsx` is untouched and never imports `CollectionReadOnlyBanner`. Test: `DataGrid.test.tsx:1699-1707` asserts `queryByText(COLLECTION_READONLY_BANNER_TEXT)` and `queryByRole("status")` are both null after fetch resolves.
- [x] **AC-04** — Banner text imported from a constants module (i18n-friendly).
  - Evidence: `src/lib/strings/document.ts:17` is the single export site. Imports in `CollectionReadOnlyBanner.tsx:2`, `DocumentDataGrid.test.tsx:15`, `DataGrid.test.tsx:12`, `__tests__/CollectionReadOnlyBanner.test.tsx:4`. No inline string literal of the banner copy exists in any component.

## Special Checks

### 1. Text-choice defensibility (sprint-87 reality)

`AddDocumentModal.tsx` and `insertDocument`/`updateDocument`/`deleteDocument` Tauri commands are present (sprint-87 confirmed). A "Read-only" banner would contradict observable UI behavior (cells are editable). The chosen text "Beta — schema and DDL operations are not yet supported." accurately scopes the limitation to schema/DDL, which `Out of Scope` of the contract also explicitly excludes. The contract's *Background note* even prescribed this exact substitution as **권장 (recommended)** — generator chose the recommended option. Defensible.

### 2. Layout safety (banner inside flex container)

Banner mounts at `DocumentDataGrid.tsx:230` as first child of the root `flex flex-1 flex-col overflow-hidden` container (line 229). The banner does not declare `flex-1`, so it takes natural height (`py-1.5` ≈ 24-28px). The scroll area at line 281 still owns `flex-1`. There is no layout regression. The `sticky top-0 z-20` directive is preserved for future scroll-container refactors without breaking current behavior.

### 3. i18n single-import-point

`COLLECTION_READONLY_BANNER_TEXT` exported once (`src/lib/strings/document.ts:17`), imported by exactly four files (one component + three tests). Replacing with an i18n key (`t("collection.readonly_banner")`) would only require modifying `document.ts`. Confirmed grep-clean — no inline duplicates.

## Feedback for Generator

1. **Future-proofing — Banner kill-switch (P3, not blocking)**
   - Current: banner is hard-rendered regardless of state.
   - Expected (eventually): when DDL/schema editing ships, copy must update or the banner must hide.
   - Suggestion: defer to a follow-up sprint. The generator's finding already calls this out (`findings.md:58`). No action needed for sprint-101.

2. **Visual polish — text-warning vs text-warning-foreground (P3, accepted)**
   - Current: `text-warning` (component line 33).
   - Expected: contract suggested `text-warning-foreground`.
   - Suggestion: generator's choice (`text-warning`) is defensible because it matches the existing convention in `DataGridToolbar`, `DataGridTable`, and `IndexesEditor`. Contract's "or equivalent amber/yellow tone" clause permits this. No change required.

3. **Test fidelity — banner-only role="status" assumption (P3, brittle but acceptable)**
   - Current: `DataGrid.test.tsx:1706` uses `queryByRole("status")` to assert banner absence.
   - Risk: if RDB ever introduces an unrelated `role="status"` element (e.g., a loading spinner), this test will produce a false positive without correctly identifying the banner specifically.
   - Suggestion: paired with `queryByText(COLLECTION_READONLY_BANNER_TEXT)` on line 1704, the joint assertion is sound for the current codebase. Consider tightening to `queryByText` alone in the future if RDB adds other status surfaces.

## Handoff Artifacts

### Changed Files (verified)
- `src/lib/strings/document.ts` (new, 19 lines)
- `src/components/document/CollectionReadOnlyBanner.tsx` (new, 43 lines)
- `src/components/document/__tests__/CollectionReadOnlyBanner.test.tsx` (new, 36 lines, 3 cases)
- `src/components/DocumentDataGrid.tsx` (modified — import line 15, mount line 230)
- `src/components/DocumentDataGrid.test.tsx` (modified — import line 15, new case lines 409–420)
- `src/components/DataGrid.test.tsx` (modified — import line 12, regression case lines 1699–1707)

### Verification Outputs (re-run)
- `pnpm vitest run` — PASS (Test Files 100 passed; Tests 1749 passed; baseline 1744 + 5 new)
- `pnpm tsc --noEmit` — PASS (exit 0)
- `pnpm lint` — PASS (exit 0)

### Findings: P1 = 0, P2 = 0, P3 = 3 (all advisory, none blocking)

### Exit
Sprint 101 satisfies contract. Recommend merge.
