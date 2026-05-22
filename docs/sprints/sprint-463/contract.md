---
review-profile: code
---

# Sprint 463 Contract: ERD Navigation And Layout Polish

## Goal

Make the ERD usable for real schemas by adding focused navigation, filtering, and
layout affordances.

## Dependencies

- Depends on: 462.
- Parallel lane: erd/ui.
- Blocks: 464.

## Scope

- Add table search/focus, relationship highlighting, fit-to-selection, and
  stable layout persistence only if it can be scoped safely.
- Ensure dense schemas remain navigable.
- Keep UI consistent with existing app patterns.
- Add tests for interaction state.

## Acceptance Criteria

- AC-463-01: Users can find and focus a table in a non-trivial schema.
- AC-463-02: Relationship highlighting helps trace FK dependencies.
- AC-463-03: Layout state does not corrupt workspace/query state.
- AC-463-04: Text and controls do not overlap at supported viewports.

## Out of Scope

- Collaborative diagram editing.
- Export/share.
- Schema mutation from ERD.

## Verification Plan

1. Component interaction tests.
2. Browser smoke on desktop and narrow viewport if ERD is visible.
3. Typecheck.

### Required Checks

1. `pnpm exec tsc -b --pretty false`
2. `cargo check --manifest-path src-tauri/Cargo.toml`
3. `git diff --check`
