# Sprint 470 Contract: Redis/Valkey Connection, Catalog, And Key Browser

## Goal

Implement the first Redis/Valkey slice: connect, inspect databases/keyspaces,
and browse keys safely.

## Dependencies

- Depends on: 469.
- Parallel lane: kv/redis.
- Blocks: 471 and 472.

## Scope

- Add Redis/Valkey profiles and server connection fields.
- Implement database/key browser using safe scan behavior, not blocking full key
  enumeration.
- Show key type, TTL, and size metadata where available.
- Add fixture-backed tests.

## Acceptance Criteria

- AC-470-01: Redis/Valkey can connect through the KV profile.
- AC-470-02: Key browsing uses bounded scan behavior.
- AC-470-03: TTL/type metadata is visible without mutating data.
- AC-470-04: Large keyspaces do not freeze the UI.

## Out of Scope

- Value editing.
- Streams UI.
- Cluster topology.

## Verification Plan

1. Redis fixture adapter tests.
2. Key browser UI tests.
3. Performance smoke for bounded scan behavior.
