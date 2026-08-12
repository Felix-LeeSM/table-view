# H5 Non-RDBMS Smoke Matrix

Smoke matrix band. Parent index:
[`docs/contributor-guide/testing-and-quality.md`](../testing-and-quality.md).
User-visible support boundaries live in
[`docs/product/known-limitations.md`](../../product/known-limitations.md).

This matrix is the H5 non-RDBMS claim gate. It separates current evidence from
future promotion scenarios so Document/KV/Search support claims do not imply
full first-class parity.

## MongoDB connection/catalog/query/edit workflow

Current evidence:

- `e2e/fixtures/mongodb/document/seed.json`
- `e2e/smoke/mongodb.spec.ts`
- `e2e/smoke/phase-28-slice-A.spec.ts`
- `src/components/query/QueryTab/useQueryExecution.parserDispatch.test.tsx`
- `src/components/schema/DocumentDatabaseTree.test.tsx`
- `src/components/document/__tests__/MongoStructurePanel.test.tsx`
- `src/components/document/__tests__/MongoIndexesPanel.test.tsx`
- `src/components/document/ValidatorPanel.test.tsx`
- `src/components/document/DocumentDataGrid.schema.test.tsx`
- `src/components/document/DocumentDataGrid.test.tsx`
- `src/components/document/DocumentDataGrid.nested.test.tsx`
- `src/components/document/MqlPreviewModal.test.tsx`
- `src/components/document/DocumentDataGrid/DocumentBulkDeleteDialog.test.tsx`
- `src/components/document/DocumentDataGrid/DocumentBulkUpdateDialog.test.tsx`
- `src/components/datagrid/useDataGridEdit.document.test.ts`
- `src/components/layout/MainArea.test.tsx`
- `src-tauri/tests/mongo_integration.rs`
- `src/lib/tauri/document.ts`

Current gap / routing:

MongoDB has current desktop E2E smoke for the whitelisted document workflow.
Whitelisted query evidence includes find projection, cursor-chain
sort/skip/limit dispatch, aggregate cursor-chain lowering, scalar/list result
routing, and history. Edit/bulk evidence includes row-edit MQL
preview/execute/discard, ordered bulkWrite retry state retention, bulk
delete/update preview, and explicit partial-commit warnings. Catalog/workbench
evidence includes source-aware collection metadata, unknown-count and permission
fallbacks, structure/index/validator panels, field inference, and document
workbench routing. Full-support parity, native document-first result panels, and
version/deployment gates remain future lane work.

## MongoDB whitelist and safety boundary

Current evidence:

- `src/lib/mongo/mongoshAst.test.ts`
- `src/lib/mongo/mongoshParser.test.ts`
- `src/lib/mongo/mongoSafety.test.ts`
- `src/components/query/QueryTab/useQueryExecution.parserDispatch.test.tsx`
- `src/components/query/QueryTab.warn-dialog.test.tsx`
- `src-tauri/tests/cancel_mongo.rs`

Current gap / routing:

Arbitrary JavaScript, shell helpers, unsupported cursor helpers, multiple
statements, and cross-db shell navigation are unsupported with visible parser
errors and no IPC dispatch. Transaction-style paths on unsupported standalone
deployments must fail clearly rather than silently commit partial work.

## MongoDB test coverage recheck

Current evidence:

`e2e/smoke/mongodb.spec.ts`,
`src-tauri/tests/mongo_integration.rs`, `src-tauri/tests/cancel_mongo.rs`,
`src/lib/mongo/mongoshAst.test.ts`, `src/lib/mongo/mongoshParser.test.ts`,
`src/lib/mongo/mongoSafety.test.ts`,
`src/features/completion/mongo/mongoAutocomplete.test.ts`,
`src/lib/mongo/mongoCompletionVocabulary.test.ts`,
`src/features/completion/mongo/useMongoAutocomplete.test.ts`,
`src/components/query/MongoQueryEditor.test.tsx`,
`src/components/query/QueryTab.dialect.test.tsx`,
`src/components/query/QueryTab/useQueryExecution.parserDispatch.test.tsx`,
`src/components/query/QueryTab/useQueryExecution.runCommand.test.tsx`, #538

Current gap / routing:

Final test coverage recheck maps runtime/query/edit backend evidence,
source-equivalent document UI and MQL preview paths, parser/safety
unsupported-boundary behavior, autocomplete vocabulary/context behavior, fixture
inventory, and wired Runtime Happy Path smoke routing before parity closure.
Fixture inventory remains contract evidence only, and completion tests remain
editor-assistance evidence unless a runtime smoke path also covers the workflow.

## MongoDB documentation recheck

Current evidence:

`docs/ROADMAP.md`, `docs/product/README.md`,
`docs/product/query-language-support.md`, `docs/product/known-limitations.md`,
this matrix, #537

Current gap / routing:

Final docs recheck confirms the product snapshot, query-language
runtime/parser/safety/autocomplete boundaries, known limitations, and testing
matrix match shipped MongoDB behavior. Runtime smoke, focused component/backend
evidence, fixture-only inventory, and completion-only editor assistance stay
separated before parity closure.

## Redis backend KV first slice

Current evidence:

- `e2e/fixtures/redis/kv/seed.json`
- `e2e/smoke/redis.spec.ts`
- `src-tauri/table-view-core/src/db/redis/mod.rs`
- `src-tauri/table-view-core/src/db/redis/tests.rs`
- `src-tauri/tests/redis_integration.rs`
- `src/lib/tauri/kv.test.ts`

Current gap / routing:

Backend evidence covers database/key scan, typed value reads, guarded string
set, delete confirmation, TTL expire/persist, and bounded stream read. Redis
desktop E2E smoke now covers the representative
connect/scan/preview/GET/guarded-write/TTL/delete path on seeded DB 2.

## Redis visible UI journey

Current evidence:

- `e2e/smoke/redis.spec.ts`
- `src/components/workspace/KvSidebar.test.tsx`
- `src/lib/tauri/kv.test.ts`

Current gap / routing:

Product UI claim covers key browser/value preview, selected-key bounded stream
reader controls, bounded string/hash/list/set/zset mutation controls, and
expire/persist/delete preview/confirm semantics. Runtime E2E smoke proves one
representative string-key path; consumer-group stream UI and full Redis
CLI/admin parity remain future promotion gates.

## Redis test coverage recheck

Current evidence:

`.github/workflows/e2e-smoke.yml`,
`e2e/fixtures/redis/kv/seed.json`, `e2e/smoke/redis.spec.ts`,
`src-tauri/src/commands/kv.rs`, `src-tauri/table-view-core/src/db/kv_types.rs`,
`src-tauri/table-view-core/src/db/redis/mod.rs`, `src-tauri/table-view-core/src/db/redis/command.rs`,
`src-tauri/table-view-core/src/db/redis/command_parser.rs`, `src-tauri/table-view-core/src/db/redis/tests.rs`,
`src-tauri/tests/redis_integration.rs`, `src/lib/tauri/kv.test.ts`,
`src/hooks/useRedisKeySuggestions.test.ts`,
`src/features/completion/redis/redisCommandCompletion.test.ts`,
`src/components/query/RedisCommandEditor.test.tsx`,
`src/components/query/QueryTab/useQueryExecution.kvDispatch.test.tsx`,
`src/components/query/QueryTab.dialect.test.tsx`,
`src/components/query/QueryEditor.tsx`, `src/types/queryLanguage.docs.test.ts`,
`src/components/workspace/KvSidebar.test.tsx`, #540/#481/#482/#483

Current gap / routing:

Final test coverage recheck maps backend runtime/query/edit and
source-equivalent UI paths, parser/safety allowlist and unsupported-boundary
behavior, fixture inventory, and Redis Runtime Happy Path routing before Redis
milestone closure. Redis command completion now has bounded TypeScript
vocabulary evidence for the backend allowlist plus current-DB/type-filtered key
suggestion evidence. Fixture inventory remains contract evidence only unless the
path is wired into the Redis Runtime Happy Path smoke.

## Valkey bounded command runtime claim

Current evidence:

`src/types/connection.test.ts`, `src/types/dataSource.test.ts`,
`src/types/adapterConformance.test.ts`,
`src/features/connection/components/ConnectionDialog/ConnectionDialogBody.tsx`,
`src/components/workspace/KvSidebar.test.tsx`,
`src/components/query/QueryTab/useQueryExecution.kvDispatch.test.tsx`,
`src/features/completion/redis/redisCommandCompletion.test.ts`,
`src/components/query/RedisCommandEditor.test.tsx`,
`src/components/query/QueryTab.dialect.test.tsx`,
`src-tauri/src/commands/connection.rs`, `src-tauri/table-view-core/src/db/redis/mod.rs`,
`src-tauri/tests/backend_adapter_contract_profile.rs`,
`src-tauri/tests/redis_integration.rs`, `e2e/fixtures/valkey/kv/seed.json`,
`e2e/smoke/valkey.spec.ts`,
`.github/workflows/e2e-smoke.yml`,
`docs/product/README.md`, `docs/product/query-language-support.md`,
`docs/product/known-limitations.md`, `docs/ROADMAP.md`, #488/#489/#490/#491/#890

Current gap / routing:

Profile/contract tests cover active `valkey` identity, server connection kind,
product label, KV paradigm, Valkey backend adapter, connection/key browser/value
preview, `query.query`, and `edit.editKeys` capability. Focused frontend
evidence covers Valkey connection form routing, Valkey key-browser labels, the
shared Redis/Valkey string plus hash/list/set/zset KvMutationPanel write
controls (#1075), query-tab command dispatch through `executeKvCommand`, and
command completion for proven local-runtime rows with current-DB/type-filtered
key suggestions. Runtime Happy Path smoke now covers Valkey service/seed wiring,
connect, key scan, typed value preview, `GET`, `HGETALL`, `XRANGE`, bounded
`SET`/`EXPIRE`, and destructive/unsupported command guard surfacing. Focused
backend testcontainer evidence covers direct string set, expire, persist,
exact-key delete, exact-key confirmation success, and selected backend details
against local Valkey.

## Valkey fixture/live evidence strategy

Current evidence:

`e2e/fixtures/valkey/kv/seed.json`, `e2e/smoke/valkey.spec.ts`,
`src-tauri/tests/redis_integration.rs`,
this matrix, #486/#488/#489/#490/#491/#890

Current gap / routing:

Chosen strategy: promote Valkey in slices. Current support covers connect/key
scan/value preview, bounded command query dispatch, the shared Redis/Valkey
string plus hash/list/set/zset KvMutationPanel write controls (#1075), command
completion for proven local-runtime rows, and a wired Runtime Happy Path smoke
for the representative query/guard path. Future support must separately prove
Valkey collection-write smoke coverage, broader compatibility, and full Redis
compatibility before those claims widen. Live/manual evidence can only
supplement local fixture/testcontainer/smoke evidence, not replace it.

## Valkey Redis compatibility matrix

Current evidence:

`e2e/fixtures/valkey.redis-compatibility.json`,
`docs/product/query-language-support.md`,
`src/features/completion/redis/redisCommandCompletion.test.ts`,
#487/#489/#490/#491

Current gap / routing:

The matrix covers Table View's bounded Redis command families and the seed reset
commands, requires Valkey-specific identity detection, and keeps unsupported
Redis assumptions rejected. Local Valkey runtime evidence and the wired smoke
mark only selected rows as proven; command completion uses that proven subset
and withholds key suggestions for unpromoted command families. The shared
Redis/Valkey string plus hash/list/set/zset KvMutationPanel write controls
(#1075) are promoted by focused backend/component evidence, not the matrix
alone. Candidate rows and full Redis compatibility remain unpromoted.
Admin/server-control, broad destructive, cluster, pub/sub, modules/functions,
scripting, and consumer-group workflows need separate workflow-specific
promotion.

## Valkey test coverage recheck

Current evidence:

`.github/workflows/e2e-smoke.yml`,
`e2e/fixtures/valkey/kv/seed.json`,
`e2e/fixtures/valkey.redis-compatibility.json`, `e2e/smoke/valkey.spec.ts`,
`src-tauri/tests/redis_integration.rs`,
`src/features/completion/redis/redisCommandCompletion.test.ts`,
`src/components/query/RedisCommandEditor.test.tsx`,
`src/components/query/QueryTab/useQueryExecution.kvDispatch.test.tsx`,
`src/components/query/QueryTab.dialect.test.tsx`,
`src/components/workspace/KvSidebar.test.tsx`,
`docs/product/query-language-support.md`, #542

Current gap / routing:

Final test coverage recheck maps Valkey runtime/query and source-equivalent UI
paths, parser/safety allowlist plus unsupported-boundary behavior, autocomplete
vocabulary/context behavior for proven local-runtime rows, fixture inventory,
and Runtime Happy Path smoke routing before milestone closure. Redis-only
evidence does not widen Valkey claims; fixture-only compatibility rows remain
contract evidence unless backed by local Valkey runtime or smoke.

## Valkey documentation recheck

Current evidence:

`docs/ROADMAP.md`, `docs/product/README.md`,
`docs/product/query-language-support.md`, `docs/product/known-limitations.md`,
this matrix, #541

Current gap / routing:

Final docs recheck confirms the product snapshot, query-language
runtime/parser-safety/autocomplete boundaries, known limitations, and testing
matrix match shipped Valkey behavior. Runtime smoke, focused local testcontainer
evidence, shared string plus hash/list/set/zset KvMutationPanel write evidence
(#1075), TypeScript completion assistance, fixture-only compatibility inventory,
and remaining full-compatibility work stay separated before parity closure.

## Valkey support-claim closure audit

Current evidence:

`docs/ROADMAP.md`, `docs/product/README.md`,
`docs/product/query-language-support.md`, `docs/product/known-limitations.md`,
this matrix, #492

Current gap / routing:

Final support-claim audit confirms Valkey closure relies on Valkey-specific
runtime smoke, focused local Valkey evidence, shared string plus
hash/list/set/zset KvMutationPanel write evidence (#1075), and Valkey
compatibility matrix rows rather than Redis-only evidence. Redis support claims
stay unchanged; the string plus hash/list/set/zset write surface is now shared
parity (#1075), while full Redis compatibility, CLI/admin parity, broad
destructive/admin/server-control commands, cluster/pubsub/modules/functions,
scripting, and consumer-group flows remain future gates.

## Redis support-claim closure audit

Current evidence:

`docs/ROADMAP.md`, `docs/product/README.md`,
`docs/product/query-language-support.md`, `docs/product/known-limitations.md`,
this matrix, #484

Current gap / routing:

Final support-claim audit confirms product docs and the testing matrix agree on
exact Redis runtime/UI/editor evidence: wired representative smoke for
connect/scan/preview/GET/guarded-write/TTL/delete, focused backend/frontend
evidence for broader bounded KV and command paths including selected-key stream
reads, and fixture inventory only where wired into smoke. Valkey, full CLI/admin
parity, consumer-group stream UI, cluster/pubsub/modules, broader command
coverage, multi-key destructive commands, and language-core parser ownership
remain separate future gates.

## Search fixture-backed contract

Current evidence:

- `e2e/fixtures/elasticsearch/search/seed.json`
- `e2e/fixtures/opensearch/search/seed.json`
- `.github/workflows/e2e-smoke.yml`
- `e2e/fixtures/seed-smoke.ts`
- `e2e/smoke/elasticsearch.spec.ts`
- `e2e/smoke/opensearch.spec.ts`
- `e2e/smoke/search-runtime-smoke.ts`
- `src-tauri/table-view-core/src/db/search.rs`
- `src-tauri/table-view-core/src/db/search_destructive.rs`
- `src-tauri/table-view-core/src/db/search_dsl.rs`
- `src-tauri/table-view-core/src/db/search_live_destructive.rs`
- `src-tauri/table-view-core/src/db/search_live_query.rs`
- `src-tauri/src/commands/search.rs`
- `src-tauri/tests/fixture_harness.rs`
- `src/lib/tauri/search.test.ts`
- `src/lib/search/searchDslCompletion.test.ts`
- `src/hooks/useSearchAutocomplete.test.ts`
- `src/components/workspace/SearchSidebar.test.tsx`
- `src/components/search/SearchIndexDetailPanel.test.tsx`
- `src/components/search/SearchResultView.test.tsx`
- `src/components/query/QueryTab.search-route.test.tsx`

Current gap / routing:

Elasticsearch/OpenSearch live catalog/query/destructive planning and
Elasticsearch/OpenSearch fixture paths stay separated. Initial sidebar catalog
loads identity, indexes, aliases, and data streams for Elasticsearch/OpenSearch;
selected-index detail tabs explicitly fetch mapping/settings/templates/field
stats for both products, and sample documents fetch only after the Samples tab
is requested. Search-hit/explain/profile/destructive-plan fetches stay out of
the shell. Elasticsearch/OpenSearch live query uses bounded backend DSL
validation for query/filter/aggs, pagination, `track_total_hits`, field sort,
`_source` filters, and the boolean `profile` flag plus the shared Search-native
result renderer;
OpenSearch-specific tests lock raw/admin/destructive target rejection,
unsupported body feature rejection, safe `_search` delete-by-query estimates,
and wildcard target rejection before dispatch. Delete-by-query planning produces
a preview plan for both Search products, and #1076 promoted the live
`_delete_by_query` execution that follows it behind the Safe Mode confirm gate.
Search DSL editor completion uses product-scoped Elasticsearch/OpenSearch
catalog/mapping context for index/alias/data-stream/field/type/sort/source
suggestions plus shared snippets. Runtime Happy Path now wires representative
Elasticsearch and OpenSearch connect/auth/TLS root-probe, catalog metadata,
selected-index detail, search render, delete-plan, live delete-execution, and
error-surface smoke, but this does not claim actual live index/settings admin
execution, broader observability, the `_explain` request workflow, or full
language-core Search DSL parser/completion ownership.

## Elasticsearch/OpenSearch product delta

Current evidence:

- `src-tauri/table-view-core/src/models/search.rs`
- `src-tauri/table-view-core/src/db/search.rs`
- `src-tauri/table-view-core/src/db/search_destructive.rs`
- `src-tauri/table-view-core/src/db/search_dsl.rs`
- `src-tauri/table-view-core/src/db/search_http.rs`
- `src-tauri/table-view-core/src/db/search_live_destructive.rs`
- `src-tauri/table-view-core/src/db/search_live_query.rs`
- `src/lib/search/searchDslCompletion.ts`
- `src/hooks/useSearchAutocomplete.ts`
- `src-tauri/tests/backend_adapter_contract_profile.rs`

Current gap / routing:

Shared Search contract and product deltas must stay separated. Elasticsearch
root probe now detects product/version/distribution, live catalog reads indexes,
aliases, data streams, mappings, settings/analyzers, templates, and field paths,
live `_search` validates the supported query/filter/aggs/sort/source request
subset before parsing hits/shards/aggs/error/cancel surfaces, and live
delete-by-query planning estimates through safe `_search` as a preview plan
before the confirmed live `_delete_by_query`
runs. OpenSearch root probe now detects OpenSearch product/version/distribution,
rejects Elasticsearch endpoints, surfaces auth/network failures, reads live
indexes, aliases, data streams, mappings, settings/analyzers, composable/legacy
templates, and field paths, live `_search` validates the same supported request
subset before parsing hits/shards/aggs/error/cancel surfaces, live
delete-by-query planning estimates through safe `_search` as a preview plan
before the confirmed live `_delete_by_query` runs, Runtime Happy Path covers the
representative product workflow, and Search DSL completion keeps catalog
candidates product-scoped. Broader live promotion still requires index/settings
admin execution policy, broader observability and `_explain` workflows, and
product-specific destructive deltas.

## Elasticsearch support-claim closure audit

Current evidence:

`docs/ROADMAP.md`, `docs/product/README.md`,
`docs/product/query-language-support.md`, `docs/product/known-limitations.md`,
this matrix, #500

Current gap / routing:

Final support-claim audit confirms the product docs agree on the exact
Elasticsearch claim: live URL/auth/TLS root probe, catalog/index detail, bounded
`_search` request validation/rendering, delete-by-query safety planning plus the
live `_delete_by_query` execution promoted by #1076, visible error surface, and
wired Runtime Happy Path smoke. Static Search fixtures remain contract evidence,
OpenSearch query is now a focused runtime slice, and actual live index/settings
admin execution, broader observability and the `_explain` workflow, and full
language-core editor parser/completion ownership remain separate future gates.

## Elasticsearch documentation recheck

Current evidence:

`docs/ROADMAP.md`, `docs/product/README.md`,
`docs/product/query-language-support.md`, `docs/product/known-limitations.md`,
this matrix, #543

Current gap / routing:

Final docs recheck confirms the product snapshot, query-language
runtime/parser-safety/autocomplete boundaries, known limitations, and testing
matrix match shipped Elasticsearch behavior. Runtime smoke, backend request
validation, bounded TypeScript editor assistance, fixture-only Search contracts,
OpenSearch connection/catalog focused evidence, and remaining unsupported live
admin/observability/`_explain`/full-language-core-completion work stay
separated before parity closure.

## OpenSearch documentation recheck

Current evidence:

`docs/ROADMAP.md`, `docs/product/README.md`,
`docs/product/query-language-support.md`, `docs/product/known-limitations.md`,
this matrix, #545

Current gap / routing:

Final docs recheck confirms the product snapshot, query-language
runtime/parser-safety/autocomplete boundaries, known limitations, and testing
matrix match shipped OpenSearch behavior. Runtime smoke, backend request
validation, bounded TypeScript editor assistance, fixture-only Search contracts,
live service evidence, and remaining unsupported live
admin/observability/`_explain`/full-language-core-completion work stay
separated before parity closure.

## OpenSearch test coverage recheck

Current evidence:

`docs/ROADMAP.md`, `.github/workflows/e2e-smoke.yml`,
`e2e/smoke/opensearch.spec.ts`, `e2e/smoke/search-runtime-smoke.ts`,
`e2e/fixtures/opensearch/search/seed.json`, `e2e/fixtures/seed-smoke.ts`,
`src-tauri/table-view-core/src/db/search/tests.rs`,
`src-tauri/table-view-core/src/db/search/tests/live_query.rs`,
`src-tauri/table-view-core/src/db/search/tests/destructive.rs`,
`src-tauri/table-view-core/src/db/search_dsl.rs`, `src-tauri/table-view-core/src/db/search_live_destructive.rs`,
`src-tauri/table-view-core/src/db/search_live_query.rs`, `src/lib/tauri/search.test.ts`,
`src/lib/search/searchDslCompletion.test.ts`,
`src/hooks/useSearchAutocomplete.test.ts`,
`src/components/workspace/SearchSidebar.test.tsx`,
`src/components/search/SearchIndexDetailPanel.test.tsx`,
`src/components/search/SearchResultView.test.tsx`,
`src/components/query/QueryTab.search-route.test.tsx`, #546/#507

Current gap / routing:

Final test coverage recheck maps OpenSearch backend
runtime/query/destructive-plan evidence, source-equivalent
sidebar/detail/result/query UI paths, backend parser/safety unsupported-boundary
behavior, TypeScript Search DSL completion vocabulary/context behavior, fixture
inventory, and wired OpenSearch Runtime Happy Path smoke routing before parity
closure. Completion-only evidence remains editor-assistance evidence unless
backed by runtime smoke, and actual live index/settings admin execution stays
out of scope.

## OpenSearch support-claim closure audit

Current evidence:

`docs/ROADMAP.md`, `docs/product/README.md`,
`docs/product/query-language-support.md`, `docs/product/known-limitations.md`,
this matrix, #508

Current gap / routing:

Final support-claim audit confirms the product docs agree on the exact
OpenSearch claim: live URL/auth/TLS root probe with OpenSearch
product/version/distribution detection, Elasticsearch endpoint rejection, live
catalog/index detail, bounded `_search` request validation/rendering,
delete-by-query safety planning plus the live `_delete_by_query` execution
promoted by #1076, mapping-aware editor assistance, visible error surface, and
wired Runtime Happy Path smoke. Static Search fixtures remain contract evidence,
Elasticsearch claims stay separate, and actual live index/settings admin
execution, broader observability and the `_explain` workflow, product-specific
destructive deltas, and full language-core editor parser/completion ownership
remain separate future gates.

## Elasticsearch test coverage recheck

Current evidence:

`docs/ROADMAP.md`, `.github/workflows/e2e-smoke.yml`,
`e2e/smoke/elasticsearch.spec.ts`, `e2e/smoke/opensearch.spec.ts`,
`e2e/smoke/search-runtime-smoke.ts`,
`e2e/fixtures/elasticsearch/search/seed.json`,
`e2e/fixtures/opensearch/search/seed.json`, `src-tauri/table-view-core/src/db/search/tests.rs`,
`src-tauri/table-view-core/src/db/search/tests/live_query.rs`,
`src-tauri/table-view-core/src/db/search_executor.rs`, `src-tauri/table-view-core/src/db/search_dsl.rs`,
`src-tauri/table-view-core/src/db/search_live_destructive.rs`,
`src-tauri/tests/fixture_harness.rs`,
`src/lib/search/searchDslCompletion.test.ts`,
`src/hooks/useSearchAutocomplete.test.ts`, `src/lib/tauri/search.test.ts`,
`src/components/workspace/SearchSidebar.test.tsx`,
`src/components/search/SearchIndexDetailPanel.test.tsx`,
`src/components/search/SearchResultView.test.tsx`,
`src/components/query/QueryTab.search-route.test.tsx`, #544/#507

Current gap / routing:

Final test coverage recheck maps backend runtime/query/destructive-plan
evidence, source-equivalent sidebar/detail/result/query UI paths, backend
parser/safety unsupported-boundary behavior, TypeScript Search DSL completion
vocabulary/context behavior, fixture inventory, and wired
Elasticsearch/OpenSearch Runtime Happy Path smoke routing before parity closure.
Completion-only evidence remains editor-assistance evidence unless backed by
runtime smoke.

## Non-RDBMS E2E inventory

Current evidence:

This matrix and current E2E smoke set

Current gap / routing:

Redis, MongoDB, Valkey, Elasticsearch, and OpenSearch now have wired Runtime
Happy Path smoke paths. Elasticsearch/OpenSearch smoke covers live service
connect/auth/TLS contract, catalog/index detail metadata, bounded search
rendering, delete-by-query safety planning, live `_delete_by_query` execution
behind the Safe Mode confirm gate, and visible error surface. Future Search
promotion still includes index/settings admin execution policy, broader
observability workflows, and product-specific destructive deltas. Future
Redis/Valkey smoke expansion can add DB switch, stream-specific coverage, and
confirmed Valkey delete/persist success without widening full CLI/admin parity.
