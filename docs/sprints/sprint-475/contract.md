---
review-profile: code
---

# Sprint 475 Contract: MongoDB Edit And Safety Semantics

## Goal

Define safe MongoDB edit semantics for documents, indexes, and destructive
operations before calling MongoDB support complete.

## Dependencies

- Depends on: 474.
- Parallel lane: document/mongo.
- Blocks: 476.

## Scope

- Define allowed document edit operations and identity assumptions.
- Keep transaction behavior explicit for standalone vs replica set servers.
- Gate destructive collection/index operations through preview or confirmation.
- Add tests for blocked and allowed paths.

## Acceptance Criteria

- AC-475-01: Document edits have deterministic identity and conflict behavior.
- AC-475-02: Standalone transaction limitations fail friendly.
- AC-475-03: Destructive operations cannot bypass safety policy.
- AC-475-04: Unsupported shell behavior remains blocked.

## Out of Scope

- Full shell compatibility.
- Aggregation pipeline builder.
- Advanced role/user management.

## Verification Plan

1. Document edit tests.
2. Safety policy tests.
3. MongoDB fixture smoke where available.

### Required Checks

1. `pnpm exec tsc -b --pretty false`
2. `cargo check --manifest-path src-tauri/Cargo.toml`
3. `git diff --check`
