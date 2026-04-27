# Sprint 147 Contract — Selective encrypted export (AC-149-*)

## Pre-sprint discovery

Sprint 140 already shipped:

- `SelectionTree` with master toggle, indeterminate group checkboxes,
  ungrouped pseudo-group, and the `"N connections, M groups selected"`
  counter — covers AC-149-2 / AC-149-3 (counter format pinned by
  `SelectionTree.test.tsx`).
- `ImportExportDialog` Export pane uses **only**
  `exportConnectionsEncrypted` (Argon2id + AES-256-GCM envelope); the
  button reads `"Generate encrypted JSON"`. No legacy plaintext call —
  covers AC-149-5.
- Round-trip envelope test (encrypted payload + password →
  `importConnectionsEncrypted`) — partially covers AC-149-4.

The work for this sprint is to **lock the AC-149-* invariants with
explicit regression tests** so a future change that re-introduces
plaintext export, breaks the single-connection scoping, or drops
passwords from the envelope surfaces as a test failure.

## In Scope

- `src/components/connection/ImportExportDialog.ac149.test.tsx` —
  new test file with one `it()` per AC-149-* sub-clause:
  - AC-149-1: select exactly one connection → backend called with
    `[oneId]` (length 1).
  - AC-149-2: group header check → `exportConnectionsEncrypted`
    called with the group's connection ids only; counter shows the
    expected `N connections, 1 group selected` shape.
  - AC-149-3: partial group → counter `N connections, 0 group
    selected`; group checkbox `aria-checked="mixed"`.
  - AC-149-4: password-bearing connection ids reach
    `exportConnectionsEncrypted` (no plaintext exposure assertion is
    feasible in jsdom; we assert the dialog does not strip
    `has_password=true` connections, and pin the legacy
    `exportConnections` is never called).
  - AC-149-5: source-string regression — no `Generate JSON` (without
    "encrypted") text in the dialog.

## Out of Scope

- Backend round-trip test of `import_connections_encrypted` — covered
  by sprint-140 backend tests; not duplicated here.
- Any UI/UX change to `ImportExportDialog` or `SelectionTree`.

## Invariants

- `pnpm vitest run` stays green (existing 2228 tests + new tests).
- `pnpm tsc --noEmit` exits 0; `pnpm lint` exits 0.
- Dialog remains the **only** export surface; `exportConnections`
  (plaintext) is never wired to a UI button.

## Done Criteria

1. New AC-149-mapped tests live in
   `ImportExportDialog.ac149.test.tsx` and pass.
2. Each AC-149-1 … AC-149-5 sub-clause has a named `it(...)` mapping
   to it (test name includes the AC label for grep-ability).
3. `pnpm vitest run`, `pnpm tsc --noEmit`, `pnpm lint` all green.

## Verification Plan

- Profile: `command`
- Required checks:
  1. `pnpm vitest run`
  2. `pnpm tsc --noEmit`
  3. `pnpm lint`
- Required evidence:
  - File-change manifest.
  - Per-AC test name table.
  - Command outputs.
