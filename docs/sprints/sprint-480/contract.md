# Sprint 480 Contract: Capability Documentation And Developer Guide

## Goal

Document the extension contract in a contributor-facing guide so future DBMS
work starts from profile/capability/adapter/language/result/safety contracts.

## Dependencies

- Depends on: 442, 477.
- Parallel lane: docs/shared.
- Blocks: 481.

## Scope

- Add a guide for adding a new data source.
- Include required checklist: profile, connection, adapter, language, catalog,
  result envelope, safety policy, fixtures, conformance level, docs.
- Link ADR 0046 and current active sprint sequence.
- Remove ambiguity around `dbType` switches and legacy `queryMode`.

## Acceptance Criteria

- AC-480-01: A new contributor can identify every required contract before
  writing implementation code.
- AC-480-02: The guide discourages `dbType` switch sprawl.
- AC-480-03: The guide explains when a new ADR is required.
- AC-480-04: Active docs link to the guide without duplicating it.

## Out of Scope

- Marketing docs.
- End-user feature docs.
- New implementation.

## Verification Plan

1. Documentation link check.
2. Markdown formatting.
3. Review against ADR 0046.
