# Sprint 445 Contract: Backend Adapter Contract Normalization

## Goal

Audit and minimally normalize backend adapter contracts against ADR 0046 without
changing runtime behavior.

## Dependencies

- Depends on: 440.
- Parallel lane: backend adapter.
- Can run with: 442, 443, 444, 446.

## Scope

- Compare `ActiveAdapter`, `RdbAdapter`, `DocumentAdapter`, `SearchAdapter`, and
  `KvAdapter` surfaces to the profile/capability model.
- Add read-only profile/capability helpers on the backend only if they avoid
  future IPC churn.
- Keep marker traits as markers unless a tested read-only contract can be
  introduced safely.
- Document any adapter mismatch as follow-up, not hidden implementation drift.

## Acceptance Criteria

- AC-445-01: Existing adapter behavior is unchanged.
- AC-445-02: Backend contract gaps are explicitly listed or encoded.
- AC-445-03: No speculative Redis/Search implementation is added.
- AC-445-04: Tests cover any new helper introduced.

## Out of Scope

- New adapter implementations.
- Connection dialog changes.
- IPC response shape changes unless fully backward compatible.

## Verification Plan

1. Focused Rust tests for new helpers, if any.
2. Existing adapter tests.
3. Cargo check/test for touched crates.
