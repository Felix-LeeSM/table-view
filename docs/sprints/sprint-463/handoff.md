# Sprint 463 Handoff: ERD Navigation And Layout Polish

## Gate Result

Sprint 463 makes the ERD usable for non-trivial relational schemas with local
navigation controls. The renderer now supports table search, focus from search
results, selected-table fitting, and relationship highlighting without adding
workspace/query-store persistence.

## Closed By This Sprint

- Added a search box and result list for `schema.table` lookup.
- Selecting a search result focuses the matching table card and updates the
  selected-table contract.
- Added a fit-selected control that resets local zoom and scrolls the focused
  table into view.
- Highlighted FK edges connected to the focused table while dimming unrelated
  edges/tables.
- Split ERD layout/search helpers into `SchemaErdLayout.ts` so the renderer
  stays below god-file threshold.

## Acceptance Criteria

| AC | Evidence |
|---|---|
| AC-463-01 | `SchemaErdRenderer.test.tsx` filters `"pay"` to `public.payments`, clicks it, and asserts focus + `onSelectedTableIdChange`. |
| AC-463-02 | Relationship highlight test asserts connected edge `data-highlighted=true` and unrelated edge/table false. |
| AC-463-03 | Zoom/focus state remains local component state; test asserts fit-selected resets zoom while selected table remains stable. No workspace/query store writes added. |
| AC-463-04 | Toolbar uses wrapping flex layout, stable icon button sizes, fixed table card dimensions, truncation for long labels. |

## Verification

- `pnpm exec vitest run src/components/schema/SchemaErdRenderer.test.tsx`

## Residual Risk

- Browser screenshot smoke was not run in this sprint handoff; visual overlap is
  covered by layout constraints and should be included in the next full UI pass.
