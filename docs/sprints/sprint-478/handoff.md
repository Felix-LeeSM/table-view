# Sprint 478 Handoff

## Scope Delivered

- Added `src/types/adapterConformance.ts` as the table-driven adapter
  conformance matrix.
- Added focused matrix coverage in `src/types/adapterConformance.test.ts`.
- Current pilot coverage exercises PostgreSQL as the RDBMS family and MongoDB
  as the non-RDBMS family.

## Conformance Rules

- Every `DatabaseType` must appear in `ADAPTER_CONFORMANCE_MATRIX`.
- Every conformance area chooses a level: `unsupported`, `declared`,
  `contract`, or `runtime`.
- Every supported profile capability in `connection`, `catalog`, `query`, and
  `edit` maps to a conformance check id.
- Every unsupported profile capability in those areas is recorded as
  unsupported or deferred.
- Focused mode is available through `getAdapterConformanceMatrix({ dbTypes,
  areas, minLevel })` and through direct focused Vitest invocation.

## Risks

- The matrix is frontend/profile-level conformance. Backend live integration
  assertions remain in existing Rust adapter tests and future sprint work.
- Search adapters currently retain connection-only frontend claims even though
  backend search contracts exist; the matrix marks catalog/query/edit features
  as deferred until the UI support claims change.
