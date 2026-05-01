# Sprint Execution Brief: sprint-176

## Objective

Selective Attention — overlay pointer-event hardening + first-render flash gate. Stop pointer events from reaching grid rows underneath the refetch loading overlay (`DataGridTable`, `DocumentDataGrid`), and stop `StructurePanel` from flashing "No columns/indexes/constraints found" before its first fetch settles. Resolves RISK-009 + RISK-035.

## Task Why

Two RISKS-register items have been active for multiple sprints. RISK-009 lets users mutate a grid (select rows, double-click into edit) while a refetch is in flight — a Selective-Attention violation that can corrupt user expectation of the loaded data. RISK-035 flashes a "no data" message during the first paint window before the structure fetch resolves, telling the user "this is empty" when in fact nothing has been queried yet. Sprint 180 (cancel overlay) builds on top of the same overlay surface, so 176 must harden it first (spec line 100).

## Scope Boundary

In: only the three components in the spec's "Components to Create/Modify" list, their sibling `*.test.tsx`, `docs/sprints/sprint-176/findings.md`, `docs/sprints/sprint-176/handoff.md`, `docs/RISKS.md`.

Out: anything in sprints 177–180; no general loading-state refactor; no design changes to spinner visuals (color, geometry, animation, opacity, blur preserved); no backend / IPC change; no cancel button — Sprint 180's surface.

## Invariants

- Spinner visuals unchanged: `Loader2 size={24}`, `animate-spin`, `text-muted-foreground`, `absolute inset-0 z-20`, `bg-background/60`.
- Existing tests across `DataGridTable.*.test.tsx`, `DocumentDataGrid.test.tsx`, `StructurePanel.test.tsx` continue to pass without modification beyond extension.
- E2E shards on `main` stay green (no e2e selector relies on overlay click-through; spec §Edge Cases §A.4).
- Skip-zero gate holds (no `it.skip` / `it.todo` / `xit`).
- Strict TS, no `any`.
- Only RISK-009 and RISK-035 are touched in `docs/RISKS.md`.

## Done Criteria

1. `AC-176-01`: Overlay blocks `mouseDown` / `click` / `doubleClick` / `contextmenu` from reaching row handlers in `DataGridTable` while in refetch state.
2. `AC-176-02`: Same blocking behavior on `DocumentDataGrid`; `findings.md` audit lists every `absolute inset-0` overlay in `src/components`.
3. `AC-176-03`: `StructurePanel` mounted with never-resolving fetch shows zero "No columns/indexes/constraints found" copy.
4. `AC-176-04`: Spinner DOM (classes, size, position) unchanged — snapshot or class assertion proves it.
5. `AC-176-05`: `docs/RISKS.md` moves RISK-009 and RISK-035 to `resolved` with Resolution Log entries naming sprint-176.

## Verification Plan

- Profile: `mixed` (browser + command).
- Required checks:
  1. `pnpm vitest run src/components/datagrid/DataGridTable src/components/document/DocumentDataGrid src/components/schema/StructurePanel`
  2. `pnpm vitest run` (full suite)
  3. `pnpm tsc --noEmit`
  4. `pnpm lint`
  5. `grep -RnE 'absolute inset-0' src/components` cross-referenced against `findings.md` (every match hardened or excluded).
  6. `pnpm tauri dev` smoke — click/double-click under spinner during slow refetch on an RDB grid.
  7. `grep -nE 'RISK-009|RISK-035' docs/RISKS.md` shows both rows in `resolved`.
- Required evidence:
  - Changed files list with purposes.
  - `docs/sprints/sprint-176/findings.md` (audit table + mechanism note + manual smoke).
  - Vitest output for AC-tagged tests.
  - Snapshot diff (or class-level absence-of-diff) for spinner branch.
  - `docs/RISKS.md` diff snippet for RISK-009 + RISK-035 transitions.

## Evidence To Return

- Changed files and purpose
- Checks run and outcomes
- Done criteria coverage with evidence (per-AC test name + assertion)
- Assumptions made during implementation (e.g. mechanism choice — pointer-events CSS vs. event capture)
- Residual risk or verification gaps (e.g. SQLite slow-refetch not covered manually if no SQLite seed exists locally)

## References

- Contract: `docs/sprints/sprint-176/contract.md`
- Spec: `docs/sprints/sprint-176/spec.md` (Sprint 176 section, lines 9–29)
- Findings (to be created): `docs/sprints/sprint-176/findings.md`
- Relevant files:
  - `src/components/datagrid/DataGridTable.tsx` (overlay at line 829–833)
  - `src/components/document/DocumentDataGrid.tsx` (overlay at line 324–331)
  - `src/components/schema/StructurePanel.tsx` (loading at line 109; empty-state passes through to `ColumnsEditor` / `IndexesEditor` / `ConstraintsEditor`)
  - `docs/RISKS.md` (RISK-009 line 30, RISK-035 line 56)
  - `memory/conventions/memory.md` (test rules, naming)
  - `.claude/rules/test-scenarios.md` (scenario checklist)
