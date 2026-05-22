# Sprint 435 Handoff: Connection Cleanup Orchestrator

## Status

Complete. RISK-040 is resolved by routing connection teardown through a single
frontend cleanup entry point.

## Implemented Invariant

`cleanupConnectionFrontendState(connectionId)` clears these domains together:

- schema cache
- document catalog cache
- document query cache
- workspace tabs
- dataGrid pending edits

`connectionStore` observes connection state transitions and invokes that entry
point when a connection is removed, when a status becomes disconnected, or when
a status entry disappears. This covers direct remove/disconnect actions and the
existing `connection-status-changed` disconnected event path.

## Behavior Notes

- Connect still performs only the existing schema/document cache refresh. It
  does not clear workspace tabs because that would broaden user-visible
  behavior outside teardown.
- `workspaceStore.clearForConnection` still purges table-scoped pending edits
  for its own close-all path; the orchestrator also calls dataGrid purge so
  pending edits are removed even when no workspace entry exists.
- Repeated cleanup is safe and preserves sibling connection state.

## Verification

- `pnpm exec vitest run src/hooks/connectionCleanup.test.ts src/hooks/useConnectionLifecycle.test.ts src/stores/connectionStore.test.ts`
  - Pass: 3 files, 53 cases.

## Residual Risk

No known RISK-040 residual. Broader state-management redesign and unrelated
cross-window transport changes remain out of scope.
