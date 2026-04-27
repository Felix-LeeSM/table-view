# Sprint 147 — Execution Brief

## Objective

Lock the AC-149-* (selective encrypted export) invariants with
explicit regression tests; no production code changes.

## Task Why

Sprint 140 implemented the SelectionTree + encrypted-only export
pane. The behaviour is correct today but only partially asserted in
tests. A future PR could (1) re-introduce a plaintext "Generate JSON"
button, (2) accidentally pass empty arrays to the encrypted export,
(3) drop password-bearing connections from the selection, without
breaking any existing test. Sprint 147 closes that hole.

## Scope Boundary

- One new test file: `ImportExportDialog.ac149.test.tsx`.
- No edits to `ImportExportDialog.tsx`, `SelectionTree.tsx`, or any
  store/backend.

## Invariants

- 2228 existing tests stay green.
- No UI/UX change visible to end users.

## Done Criteria

1. `ImportExportDialog.ac149.test.tsx` exists and passes.
2. Five `it(...)` blocks named after AC-149-1 … AC-149-5 cover their
   respective sub-clauses.
3. `pnpm vitest run`, `pnpm tsc --noEmit`, `pnpm lint` all green.

## Verification Plan

- Profile: `command`
- Required checks: `pnpm vitest run`, `pnpm tsc --noEmit`, `pnpm lint`.
- Required evidence: file-change manifest + per-AC test names +
  command outputs.
