# Sprint 435 Contract: Connection Cleanup Orchestrator

## Goal

Resolve RISK-040 by expressing connection teardown cleanup as one frontend
invariant. Removing or disconnecting a connection must not leave workspace
tabs, schema/document caches, or pending grid edits behind.

## Scope

- Add one exported cleanup entry point keyed by `connectionId`.
- Route connection delete, disconnect, and disconnected status-event transitions
  through that entry point.
- Keep connect-time cache refresh narrow; do not tear down workspace tabs on a
  successful connect.
- Preserve existing store shapes and cross-window sync allowlists.
- Update the risk register and plan notes when the invariant is covered.

## Acceptance Criteria

- AC-435-01: A single exported function clears schema, document catalog/query,
  workspace, and dataGrid pending-edit state for a connection id.
- AC-435-02: Direct connection removal clears workspace tabs and pending edits
  for the removed connection.
- AC-435-03: Direct disconnect clears workspace tabs and pending edits for the
  disconnected connection.
- AC-435-04: A backend disconnected status event reaches the same cleanup
  invariant.
- AC-435-05: Cleanup is idempotent when called repeatedly for the same id.
- AC-435-06: Other connection ids remain intact.
- AC-435-07: RISK-040 is marked resolved only if the above coverage is green.

## Out Of Scope

- State-management redesign or new persistence shape.
- New cross-window transport beyond observing existing connection state
  transitions.
- Changing connect behavior beyond the existing schema/document cache refresh.
- Refactoring unrelated store dependencies.

## Verification Plan

1. Focused Vitest coverage for the cleanup entry point and connection lifecycle
   paths.
2. TypeScript build.
3. Lint if practical.
4. Diff whitespace check and lefthook validation before delivery.
