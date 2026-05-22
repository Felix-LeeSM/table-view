# Sprint 462 Contract: ERD Renderer Foundation

## Goal

Render the first RDBMS ERD from `SchemaGraph` with stable layout, selection, and
basic relationship display.

## Dependencies

- Depends on: 461.
- Parallel lane: erd/ui.
- Blocks: 463.

## Scope

- Add an ERD view that consumes `SchemaGraph`.
- Render tables, key columns, and FK relationships.
- Provide basic pan/zoom/fit behavior if the chosen renderer needs it for
  usability.
- Add visual/state tests appropriate to the frontend stack.

## Acceptance Criteria

- AC-462-01: ERD renders a non-empty graph for fixture schemas.
- AC-462-02: Tables and relationships are legible at desktop sizes.
- AC-462-03: Empty/no-FK schemas show a useful empty or isolated-node state.
- AC-462-04: ERD does not duplicate catalog extraction logic.

## Out of Scope

- Full layout polish.
- Editing schema from ERD.
- Non-RDBMS graph visualization.

## Verification Plan

1. Component tests for rendered nodes/edges.
2. Playwright or screenshot smoke if the UI surface requires it.
3. Typecheck.
