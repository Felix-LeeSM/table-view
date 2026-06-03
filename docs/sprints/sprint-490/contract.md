---
review-profile: code
---

# Sprint 490 Contract: Valkey Command Completion

## Goal

Close #490 by adding Valkey-aware command completion after the bounded Valkey
command runtime contract exists.

## Dependencies

- Depends on: #489 Valkey bounded command query runtime.
- Phase: H5 Redis/Valkey parity hardening.
- Tracks: #490.

## Scope

- Keep Redis command completion sourced from the existing backend allowlist.
- Add a Valkey completion target sourced from the proven local Valkey runtime
  command rows in the compatibility matrix.
- Pass the active KV connection type into the command editor.
- Keep current-keyspace suggestions bounded to the target command set and key
  type filters.
- Update support/evidence docs without promoting Valkey smoke, direct mutation
  UI, or full Redis compatibility.

## Acceptance Criteria

- AC-490-01: Redis completion still suggests the full bounded Redis allowlist.
- AC-490-02: Valkey completion suggests only the proven Valkey command subset.
- AC-490-03: Valkey key suggestions use current database scan cache and do not
  appear for unpromoted Valkey command families.
- AC-490-04: QueryTab passes the Valkey target to the KV command editor.
- AC-490-05: Product/testing docs separate completion support from Valkey smoke
  and full Redis compatibility.

## Out of Scope

- Valkey direct key mutation controls.
- Valkey Runtime Happy Path smoke.
- Broader Valkey command-family runtime promotion.
- Language-core Redis/Valkey parser ownership.
- Full Redis or Valkey CLI/admin parity.

## Required Checks

1. `pnpm vitest run src/lib/redis/redisCommandCompletion.test.ts src/components/query/RedisCommandEditor.test.tsx src/components/query/QueryTab.dialect.test.tsx --reporter=dot`
2. `pnpm vitest run scripts/fixtures/dbms-seeds.test.ts --reporter=dot`
3. `pnpm exec tsc -b --pretty false`
4. `pnpm exec prettier --check docs/sprints/sprint-490/contract.md src/lib/redis/redisCommandCompletion.ts src/lib/redis/redisCommandCompletion.test.ts src/components/query/RedisCommandEditor.tsx src/components/query/RedisCommandEditor.test.tsx src/components/query/QueryTab.tsx src/components/query/QueryTab.dialect.test.tsx src/components/query/__tests__/queryTabTestHelpers.ts e2e/fixtures/valkey.redis-compatibility.json docs/ROADMAP.md docs/product/README.md docs/product/query-language-support.md docs/product/known-limitations.md docs/contributor-guide/testing-and-quality.md`
5. `git diff --check origin/main...HEAD`
