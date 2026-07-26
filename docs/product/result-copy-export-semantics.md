# Result Copy/Export Semantics

Single-table SELECT grid export 는 기존 `source_table` inference 경로를 유지한다.
Search hits 는 화면에 표시된 hit 를 JSON 으로 copy 하고 CSV/TSV 로 export 할 수
있지만 SQL INSERT 는 disabled reason 을 노출한다. Scalar/list 결과는 표시된 값을
copy 하고 non-empty result 만 CSV/TSV export 를 허용한다. Empty result 는 copy/export
를 disabled reason 과 함께 막는다. Write summary 는 JSON copy 만 지원하고 grid row
export 는 unsupported 로 표시한다.

MSSQL 은 #903 에서 bounded runtime
catalog/query/edit-row slice 로 승격됐다: SQL-auth/TDS connection test/connect/ping,
catalog browse/schema/indexes/constraints/relationships, query, multi-statement,
cancel, tabular result, and editRows through frontend SQL batch with primary-key
projection 는 active capability 다. #907 adds representative Runtime Happy Path
smoke for connect, seeded catalog browse, SELECT/DML, destructive Safe Mode
confirmation, cancellation, and grid edit. Structured DDL,
admin/security/jobs/users/roles, import/export, profiler/activity, full T-SQL
semantics, full workbench parity, sqlcmd/meta-command/procedure-body scripting,
은 claim 하지 않는다. Oracle 은 #905/#906 에서 service-name
lifecycle, catalog metadata, SELECT/DML batch, cooperative cancel, tabular
table-data query, key-projected editRows, bounded static Safe Mode classification,
and bounded editor completion assistance 만 허용한다. #907 adds representative
Runtime Happy Path smoke for service-name connect, seeded catalog/routine browse,
SELECT/DML, destructive Safe Mode confirmation, cancellation, and grid edit.
SID/TNS/wallet/TLS/advanced
auth, switch database, structured DDL, raw DDL/admin, full parser/completion
promotion, PL/SQL body/package work, triggers beyond the bounded catalog smoke
path, admin, import/export, profiler/activity, users/roles/grants,
session/storage, and full workbench parity 는 claim 하지 않는다.
MSSQL/Oracle 승격은 각 source 의 matching
runtime, contract, docs, smoke evidence 가 같은 PR/linked PR set 에서 닫힐 때만
가능하다.
Shared enterprise abstraction 은 SQL Server auth/TDS/T-SQL contract 와 Oracle
service/SID/TNS/wallet/Oracle SQL contract 를 합쳐 숨기면 안 된다.
Valkey 는 KV runtime slice 이며 `connection.test`, `query.query`,
`catalog.browse`, `edit.editKeys` 가 true 다. KV 사이드바 라우팅은
`paradigm === "kv"` 로 하고 (#1463 에서 redundant 한 `paradigmSpecific.keyBrowser`
flag 는 삭제됨), key 편집은 `edit.editKeys` 로 게이팅한다.
`e2e/fixtures/valkey/kv/seed.json` 는 wired Valkey Runtime Happy Path seed 이고,
`e2e/fixtures/valkey.redis-compatibility.json` 는 proven/candidate/rejected Redis
command-family rows 와 unsupported Redis assumptions 를 고정한다. Focused local
Valkey testcontainer evidence 는 connect/key scan/value preview, selected bounded
command query rows, Redis 와 공유되는 string/hash/list/set/zset KvMutationPanel
write controls (#1075) 까지 support claim 을 넓힌다. `redis-command` 는 bounded
command query target 이며, completion claim 은 proven local-runtime rows 에 제한된다.
Full Redis compatibility claim 은 아니다.

MSSQL 은 #903 에서 catalog/query/cancel/tabular/editRows runtime slice 로 승격됐다.
Oracle 은 #906 에서 key-projected editRows 와 bounded static Safe Mode/editor
assistance 까지 승격됐다. #907 은 두 source 의 bounded Runtime Happy Path smoke
를 추가한다. SQL Server DDL/admin/import/export/full-workbench, full T-SQL
scripting parity 과 Oracle SID/TNS/wallet/advanced auth, structured DDL, raw
DDL/admin, full parser/completion promotion, PL/SQL work 는 각각
source-specific promotion issue 에서 evidence 를 잠근 뒤 capability/profile
claim 을 바꾼다.
Elasticsearch/OpenSearch 는 Search identity, live runtime slice, and separated
fixture contract 를 갖고 있다. Elasticsearch 와 OpenSearch 는 connection dialog 와 backend
`test_connection` 에서 URL/auth/TLS 기반 live HTTP root probe 를 지원하고,
product/version/distribution detection 과 auth/network error surfacing 을 제공한다.
OpenSearch probe 는 Elasticsearch endpoint 를 거부한다. Elasticsearch/OpenSearch
live catalog 는 sidebar 에서 index/alias/data-stream shell 을 보여주고, selected
index tab 에서 명시적으로 선택한 mappings/settings/analyzers/templates/field
stats 를 lazy fetch 한다. OpenSearch detail 은 sample documents 를 지원하고,
query tab 은 selected index/alias target 에 scoped 된 bounded Search DSL 을
live `_search` 로 dispatch 한다. Delete-by-query
safety planning 은 Elasticsearch/OpenSearch 모두 safe `_search` estimate 를
preview plan 으로 보여준 뒤 Safe Mode confirm gate 뒤에서 live `_delete_by_query`
를 실행하며, wildcard/broad target 은 막는다. Search DSL editor
completion 은 Elasticsearch/OpenSearch product identity 를 분리하고 catalog/mapping
context 로 index/alias/data-stream/field/type/sort/source suggestions 를 제공한다.
Elasticsearch/OpenSearch Runtime Happy Path smoke now proves live service
connect/auth/TLS contract, catalog/index detail metadata, bounded search
rendering, delete-by-query safety planning plus live `_delete_by_query`
execution behind a Safe Mode confirmation, and visible error surface.
Elasticsearch live query 는 bounded `_search` dispatch 로 sample documents,
query/filter/aggs preflight, hits/source/fields/highlight/sort,
shards/timeout/total relation/took, aggregations, explain/profile response
payload 를 Search-native renderer 에 연결한다. Delete-by-query safety planning
은 fixture/live 모두 safe `_search` estimate 를 계산해 preview plan 으로
보여준 뒤, Safe Mode confirm gate (backend IPC chokepoint) 를 통과하면 live
`_delete_by_query` 를 실행한다. wildcard/broad target 과 index/settings admin
execution 은 막는다.
Initial sidebar load 는 index-catalog-first shell 이며 search hits,
explain/profile/destructive plan 을 가져오지 않는다. Selected-index
mappings/settings/templates/field stats/samples 는 lazy detail tab 또는 explicit
action 에서만 로드한다. Search live HTTP/admin promotion remains owned by the
Search roadmap/milestone, not non-RDBMS lazy-loading workbench hardening.
Elasticsearch/OpenSearch actual live admin execution, broader observability,
profile/explain request workflow, full language-core parser/completion ownership 은
아직 deferred 다.

Cassandra/Scylla, DynamoDB, graph, vector, stream 은 active `DatabaseType`,
profile, runtime, parser/completion, fixture/live evidence, E2E smoke claim 이
없다. 이 후보들은 `docs/ROADMAP.md` H6 계약과 adding-data-source checklist 를
통과하기 전까지 candidate-only 상태다.

DynamoDB 는 candidate-only `cloud-document` profile target 이다. Promotion 전
계약은 `cloud-api` connection kind, native API-first workflow,
table/keySchema/GSI/LSI catalog, `document`/`tabular` result envelopes,
access-pattern/cost/IAM/credential guardrails, and threat-model handoff before
auth/KDF/ACL/secrets/provider decisions 를 요구한다. `partiql` 은 active parser,
completion, or runtime claim 이 아니라 deferred editor/query-language inventory
다. DynamoDB Local/emulator or bounded mock fixtures are future-only inventory;
이 문단은 active runtime, connection UI, parser/completion, fixture/live
evidence, E2E smoke claim 을 만들지 않는다.

Vector 는 candidate-only `vector` profile target 이다. Promotion 전 계약은
`server` connection kind, cloud providers 에 대한 별도 `cloud-api` profile
decision, future `vector-query` or provider filter DSL, collection/vectorSchema/
payloadIndex catalog, `vectorNeighbors` result envelope, topK/filter/write/delete
guardrails 를 요구한다. Embedded/mock or container fixtures are future-only
inventory. Cloud credential/provider/ACL/secrets/KDF decisions require a
threat-model handoff before implementation. 이 문단은 active runtime, connection
UI, parser/completion, fixture/live evidence, E2E smoke claim 을 만들지 않는다.

Stream 은 candidate-only `stream` profile target 이다. Promotion 전 계약은
`cluster` connection kind, `stream-command` or typed API decision,
topic/partition/consumerGroup/schema catalog, `streamRecords`/`metrics` result
envelope, offset/consumer lag/replay/commit guardrails, produce/admin/destructive
defer 를 요구한다. Kafka 는 future baseline fixture target, Redpanda 는
compatibility delta 이며 둘 다 routine Runtime Happy Path wiring 이 아닌 future
non-routine CI inventory 다. 이 문단은 active runtime, connection UI,
parser/completion, fixture/live evidence, E2E smoke claim 을 만들지 않는다.
