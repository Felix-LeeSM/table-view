# Sprint 468 Handoff: Redis Integration Gate; Valkey Follow-Up

## Gate Result

Sprint 468 aligns the Redis status after Sprint 465-467 and PR #144. This
sprint does not add a new runtime feature; it closes the integration gate by
making the plan, risk register, architecture SOT, and sprint handoff match the
Redis surface that is now on main. Valkey remains unverified follow-up until it
has explicit adapter and test evidence.

## Closed By This Sprint

- Redis is now documented as the first live KV slice, not a deferred marker
  candidate.
- Valkey is documented as protocol-compatible follow-up, not implemented or
  verified support.
- Supported Redis workflows are bounded key browsing, value reads, guarded
  string writes, delete plumbing, TTL mutation, and bounded stream reads.
- `streamRecords` result support is documented separately from
  `streamConsumer`; consumer-group management remains unsupported.
- Cluster administration, pub/sub console behavior, and module-specific
  management remain explicit follow-up scope.
- Elasticsearch/OpenSearch status remains current-main aligned as a live Search
  contract slice with HTTP catalog/search execution deferred.

## Acceptance Criteria

| AC | Evidence |
|---|---|
| AC-468-01 | Redis support claims match the verified Sprint 465-467 workflows; Valkey parity/support is follow-up and cluster/pubsub/modules claims are avoided. |
| AC-468-02 | KV UI is documented as `KvSidebar`/key-browser based, not an RDB table/schema workflow. |
| AC-468-03 | Large keyspace behavior remains bounded through scan/page contracts. |
| AC-468-04 | Deferred cluster/pubsub/module and consumer-group gaps are tracked in `docs/RISKS.md`. |

## Verification

- `git diff --check`
- `pnpm exec vitest run src/types/dataSource.test.ts src/lib/tauri/kv.test.ts src/components/workspace/KvSidebar.test.tsx`
- `cargo check --manifest-path src-tauri/Cargo.toml`
