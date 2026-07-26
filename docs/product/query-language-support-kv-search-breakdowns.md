# KV And Search Source Support Breakdowns

Child page of
[`docs/product/query-language-support.md`](query-language-support.md).

## Redis Command Support Breakdown

- Runtime: Redis connection/profile, database/key scan, key browser, typed value
  preview, bounded value mutation panel, and Redis command editor are the
  shipped product surface. Focused frontend/backend tests cover the
  `useQueryExecution` -> `executeKvCommand` dispatch path for selected commands.
- Parser / safety: Redis command handling is a backend allowlist, not
  language-core parser ownership. It classifies selected read/write/TTL/stream/
  destructive commands, requires exact-key confirmation for single-key
  `DEL`/`PERSIST`, and rejects unsupported command families.
- Completion / autocomplete: `redis-command` has TypeScript-owned command-name
  vocabulary for the backend allowlist plus current-DB key suggestions from a
  bounded first-page key scan. Key suggestions are filtered by command key type
  where available and fall back to no key suggestions when the scan cache is
  empty, loading, failed, or unavailable.
- Evidence: `e2e/fixtures/redis/kv/seed.json` is fixture/contract inventory, not a
  live runtime or desktop E2E smoke claim by itself. The wired Runtime Happy
  Path Redis smoke uses that deterministic DB 2 fixture for connect, scan,
  preview, `GET`, guarded string write, TTL, and exact-key delete coverage.
  Broader Redis command dispatch remains focused component/backend/core evidence
  below full CLI parity.

## Valkey Redis Compatibility Boundary

- Current status: Valkey has a KV runtime slice for connection test/connect,
  database/key scan, typed value preview, selected-key bounded stream reads,
  bounded Redis-compatible command query dispatch, direct UTF-8 string-key
  mutation controls, and command completion for proven local-runtime rows.
  Hash/list/set/zset writes and full Redis compatibility are not claimed.
- Compatibility matrix: `e2e/fixtures/valkey.redis-compatibility.json` separates
  proven local Valkey runtime rows from candidate families and rejected
  assumptions. Redis Runtime Happy Path smoke does not count as Valkey evidence;
  the wired Valkey smoke is the Runtime Happy Path evidence for the promoted
  slice. Unsupported Redis families cannot widen for Valkey without separate
  safety and result-envelope decisions.
- Detection delta: future Valkey promotion must prove Valkey-specific server
  identity instead of relying on Redis-compatible identity fields alone.
- Proven command rows: database/keyspace browse, string value preview plus
  `SET EX` dispatch, `HGETALL`, `EXPIRE`/`PERSIST` confirmation, bounded
  `XRANGE`, unsupported-family rejection, and exact-key `DEL` confirmation run
  against a local Valkey runtime.
- Rejected families: admin/server-control, broad destructive commands, cluster,
  pub/sub, modules/functions, arbitrary scripting, and consumer-group workflows
  remain out of scope even if a Valkey server accepts Redis-compatible command
  names.

## Search DSL Support Breakdown

- Runtime: Elasticsearch and OpenSearch live connection test,
  index-catalog-first sidebar shell, selected-index/explicit-action catalog
  detail fetches, bounded `_search` dispatch, Search-native result rendering,
  delete-by-query safety planning plus live `_delete_by_query` execution behind
  a Safe Mode confirmation (backend IPC chokepoint), and query
  cancellation/error surfacing are active. Runtime Happy Path smoke covers
  representative Elasticsearch and OpenSearch connect/auth/TLS, catalog
  metadata, selected-index detail, search/render, delete-plan, live
  delete-execution, and error-surface paths on Ubuntu.
- Parser / safety: Search DSL handling is a backend request validator plus
  source-specific safety policy, not language-core parser ownership. The live
  validator allows only the documented query/filter/aggs subset and rejects
  unsupported body keys, unsupported aggregations, raw/admin targets, and
  unsupported delete-by-query request shapes before dispatch.
- Completion / autocomplete: bounded TypeScript editor completion is active for
  Elasticsearch/OpenSearch catalog and mapping context. It suggests
  product-scoped indexes, aliases, data streams, fields, field types, `sort`,
  `_source`, and shared bounded query/aggs/sort/source snippets. This is editor
  assistance only; full language-core parser/completion ownership remains
  deferred, and backend request validation is runtime safety evidence rather
  than autocomplete evidence.
- Fixture / live evidence: `e2e/fixtures/elasticsearch/search/seed.json` and
  `e2e/fixtures/opensearch/search/seed.json` mirror embedded fixture contracts. The wired
  Elasticsearch/OpenSearch smoke specs are live runtime evidence for their
  representative product paths. OpenSearch has focused live
  connection/catalog/query/destructive-plan evidence for indexes, aliases, data
  streams, mappings, settings/analyzers, templates, field paths, bounded
  `_search` dispatch/rendering, sample documents, error handling, cancellation,
  and safe `_search` delete-by-query estimates.
- Remaining unsupported work: profile/explain request workflow, broader admin
  APIs (index/settings create/delete), broader observability workflows, and
  product-specific destructive deltas remain future gates. Search
  live HTTP/admin promotion remains owned by the Search roadmap/milestone, not
  non-RDBMS lazy-loading workbench hardening.
