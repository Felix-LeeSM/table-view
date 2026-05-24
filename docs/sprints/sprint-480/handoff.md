# Sprint 480 Handoff: Capability Documentation And Developer Guide

## What Landed

- Added `docs/adding-a-data-source.md` as the contributor-facing checklist for
  adding or promoting a DBMS/data source.
- Linked active architecture, plan, and roadmap docs to the guide without
  duplicating the checklist.
- Updated the sprint contract required check to include the new guide file.

## Guide Coverage

The guide requires contributors to lock these contracts before implementation:

- profile and support level
- connection shape and credential/auth/TLS assumptions
- adapter family or new adapter contract
- query language ownership and fallback policy
- catalog model
- result envelope
- safety policy
- local fixture/emulator/mock strategy
- conformance level
- documentation impact

It also documents that `DatabaseType` is identity/compatibility metadata, while
feature enablement must use profile capabilities rather than `dbType` switch
sprawl. Legacy `queryMode` is limited to compatibility boundaries; new routing
uses `queryLanguage`.

## ADR Decision

No new ADR was required for Sprint 480. This sprint documents the already
accepted ADR 0046 contract rather than changing the architecture decision.

## Verification

- `npx prettier --check docs/adding-a-data-source.md docs/data-source-architecture.md docs/PLAN.md docs/ROADMAP.md docs/sprints/sprint-480/contract.md`
- `git diff --check`
