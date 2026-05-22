# Sprint 440 Contract: Data Source Alignment Core

## Goal

Introduce the no-behavior-change core types and registry shape required by
ADR 0046 so later DBMS work extends profiles instead of adding new switch
sprawl.

## Dependencies

- Depends on: none.
- Parallel lane: root.
- Blocks: 441-447.

## Scope

- Define `DataSourceProfile`, `DataParadigm`, `ConnectionKind`,
  `QueryLanguageId`, `CatalogModelKind`, `ResultEnvelopeKind`, and
  `DataSourceCapabilities` in the existing shared type surface.
- Add a read-only profile lookup keyed by the existing `DatabaseType`.
- Preserve current runtime, IPC, workspace, and query result shapes.
- Add exhaustive tests so every currently supported `DatabaseType` must resolve
  to a profile.

## Acceptance Criteria

- AC-440-01: Existing application behavior is unchanged.
- AC-440-02: Every existing `DatabaseType` has an explicit profile stub.
- AC-440-03: Missing profile lookup fails deterministically in tests.
- AC-440-04: No feature gate is migrated yet unless required by type wiring.

## Out of Scope

- New DBMS support.
- Query execution routing changes.
- UI redesign.
- Backend adapter rewrites.

## Verification Plan

1. Focused TypeScript/Rust tests for profile exhaustiveness, depending on where
   the canonical type surface lands.
2. Existing typecheck.
3. `git diff --check`.
