# Current Support Snapshot

| DBMS | Parser / safety | Completion |
|---|---|---|
| [PostgreSQL](#postgresql) | strong bounded subset | WASM-first + installed-extension-gated packs |
| [MySQL](#mysql) | bounded parser/Safe Mode slice; constraint conformance version-gated | Rust/WASM MySQL-family vocabulary + current-catalog schema/table/column/routine suggestions |
| [MariaDB](#mariadb) | MySQL-family parser/Safe Mode path + MariaDB dialect/profile identity | Rust/WASM MySQL-family vocabulary + version-aware profile/completion MariaDB `RETURNING` delta |
| [SQLite](#sqlite) | bounded parser/Safe Mode guardrails; raw DDL rejected by adapter | Rust/WASM built-in vocabulary + cached schema objects + sqlite-cli suggestions |
| [DuckDB](#duckdb) | DuckDB SQL/file analytics guardrails | Rust/WASM DuckDB editor vocabulary + cached schema objects |
| [MongoDB](#mongodb) | whitelisted mongosh/MQL | Rust/WASM vocabulary + cached catalog context |
| [Redis](#redis) | backend KV guardrails plus bounded command allowlist and typed-confirm mutation controls; not language-core parser ownership | TypeScript bounded command vocabulary + current-DB/type-filtered key suggestions |
| [Valkey](#valkey) | Redis-compatible bounded command allowlist and typed confirmation; same write surface as Redis (#1075) | TypeScript proven Valkey command subset + current-DB/type-filtered key suggestions |
| [Elasticsearch/OpenSearch](#elasticsearchopensearch) | index-catalog sidebar shell plus selected-index lazy catalog detail and samples for both products; mapping/search guardrails for both products; destructive-plan guardrails for both products | Backend Search DSL validator active; full language-core parser/completion ownership remains future; bounded TypeScript completion is editor assistance for Elasticsearch/OpenSearch catalog and mapping context |
| [MSSQL](#mssql) | bounded parser/Safe Mode unsupported-boundary recognition only | bounded editor assistance only |
| [Oracle](#oracle) | bounded static Safe Mode classification only | bounded editor assistance only |
| [Cassandra/Scylla, DynamoDB, graph, vector, stream](#cassandrascylla-dynamodb-graph-vector-stream) | deferred language ids only | deferred |

## PostgreSQL

**Runtime**: strong

**현재 판단**: 현재 가장 강한 lane 이다. routine desktop smoke 는 connect/browse/edit/query,
Explain plan-inspection UI/source-label path, seeded `pgcrypto`/`fuzzystrmatch`
installed-extension completion gating, Safe Mode info/warn/destructive
confirmation, raw DDL preview, grid-edit preview, cancellation UI/history/retry
behavior, and bounded Structure table-plus-index DDL
preview/execute/history/schema-refresh behavior 를 증명한다. Cancellation claim 은
query toolbar/API boundary, cancelled history, stale-grid clearing, retry 로
제한된다. Structure DDL claim 은 table creation plus index creation only 이다. CSV
row-level import (#1640) 는 PG 에서 지원한다 — 컬럼 매핑 후 행마다 single-row INSERT 를 한 트랜잭션의
`execute_query_batch` 로 커밋하며 (empty-field NULL/'' tri-state 토글, 커밋 전 확인), 다른 엔진은
`Unsupported`. roles/users, extension management, DB-level import/export,
broader admin, and broader structured DDL parity 는 보장하지 않음. server
activity/slow-query (profiler) 패널은 capability-gated auto-polling dashboard
(세션-로컬 비영속 count trend, 디스크/DB 영속 없음) 로 승격됐지만 full profiler/activity admin
parity 는 여전히 out-of-scope

## MySQL

**Runtime**: runtime/query/edit/DDL adapter active

**현재 판단**: connection, browsing, databases/schemas, tables, views, columns,
indexes, constraints/FKs, raw query, DML-oriented multi-statement batch, row
edit with MySQL-quoted generated SQL/key projection, cancellation, and bounded
structured table/index/constraint DDL are active. Routine desktop smoke covers
connect, browse seeded table, SELECT result grid, narrow seeded
`CALL proc(scalar)` result rendering, DML batch per-statement result, row edit,
cancellation/retry, history/source labels, result-envelope rendering, and
bounded Structure table/index/FK DDL preview/execute/catalog readback.
Completion suggestions use the current connection/database catalog and MySQL
backtick identifier context, but they do not widen runtime support for stored
routine bodies or scripting. CHECK/constraint catalog metadata uses live MySQL
`>= 8.0.16` context; older/unknown versions return empty CHECK hints. Stored
routine/event bodies, broad CALL expressions, control-flow scripting,
`DELIMITER`, and `LOAD DATA` are explicit unsupported editor/backend boundaries.
Trigger metadata is read-only in Structure; structured trigger create/drop and
DB-level import/export/dump parity remain unsupported/follow-up

## MariaDB

**Runtime**: runtime/query/edit/catalog/DDL adapter active through distinct
MariaDB engine smoke

**현재 판단**: connection, seeded table browse, catalog/workbench metadata browse,
SELECT result grid, DML batch per-statement result, narrow seeded
`CALL proc(scalar)` result rendering, row edit, cancellation/retry,
history/source labels, result-envelope rendering, and bounded Structure
table/index/FK DDL preview/execute/catalog readback have wired MariaDB Runtime
Happy Path evidence. Catalog/workbench coverage includes tables, views, columns,
indexes, constraints/FKs, and routine metadata browse through the shared
MySQL-family adapter plus MariaDB-specific smoke seed/categories. Row edit has
MariaDB-specific hook evidence for quoted key-projected preview/discard/commit
SQL, and bounded table/index/constraint DDL has MariaDB-specific
export/backend-preview evidence with runtime smoke coverage for the intentional
MySQL-family SQL path. CHECK/constraint promotion remains version-gated at
MariaDB `>= 10.2.1`. Intentional shared paths are the MySQL-family adapter
implementation, CodeMirror dialect, parser/Safe Mode boundary,
capability/conformance family, and `mysql-client` completion family. MariaDB
autocomplete keeps the `mariadb` profile identity and suppresses `RETURNING`
only when known server version context is below `10.0.5`. Focused `mariadb:11`
integration verifies the live server version and shows `DELETE ... RETURNING` is
server-accepted, but the app exposes it only as a DML envelope with no returned
rows and no affected-row count. The app does not claim a MariaDB `RETURNING`
runtime/version returned-row gate; raw execution remains server-resolved.
MySQL-only evidence does not become a MariaDB runtime/admin/import/export claim
without MariaDB-specific tests/docs

## SQLite

**Runtime**: file adapter + read/writable-file DML + the structured DDL SQLite
runs natively

**현재 판단**: user DBMS adapter 는 internal SQLite state 와 분리됨. 쓰기는 writable file 의
DML/PK-projected row edit 로 제한된다. GitHub Runtime Happy Path now runs a
deterministic SQLite desktop smoke for file create/open, table browse, read
query, writable DML, row edit, structured table creation with schema
refresh proof, read-only write rejection, and internal app-state DB rejection.
SQLite structured DDL 은 엔진이 네이티브로 실행하는 범위다 — `CREATE TABLE` /
`DROP TABLE` / `ALTER TABLE … RENAME TO` / `ADD COLUMN` / `DROP COLUMN` /
`CREATE INDEX` / `DROP INDEX`. 제공하지 않는 구조 변경은 컬럼의 타입·NOT NULL·DEFAULT 와
독립 제약 선언·추가·삭제이고,
Structure UI 에서 둘은 다르게 나타난다. Columns 탭의 per-row Edit 은 화면에 그대로 두되
disabled 이고 마우스를 올리면 사유가 뜬다. 제약은 SQLite 에 Constraints 탭 자체가 없어
(어댑터에 구조화된 제약 목록이 없다) 끌 컨트롤도 없고, 그 경계는 화면이 아니라 이 문서가
적는다. raw SQL DDL, nested JSON
edit, sqlite-cli execution, extension/capability semantics 는 unsupported

## DuckDB

**Runtime**: RDBMS file adapter + registered local analytics query

**현재 판단**: `rdb` profile + `file` connection kind 로 표현한다. local `.duckdb` file 은
catalog/table read 와 statement-level raw SQL 실행 경로를 지원한다. GitHub Runtime Happy
Path now runs separate deterministic DuckDB desktop smokes: `.duckdb`
open/catalog/table browse/raw SELECT/history/read-only evidence, and registered
deterministic CSV source -> global editor SELECT -> result grid -> `FILE`
history/source evidence -> no absolute local path in visible UI. registered
local CSV/Parquet/JSON/NDJSON analytics 는 active-session source alias 등록, source
metadata/workbench alias 표시, preview, focused dialog/API source-scoped SELECT
evidence, global query editor SELECT execution through the normal result
surface/backend route against registered aliases without source-id plumbing, and
a distinct `FILE` history source label for source-scoped dialog and
global-editor source queries 가 있다. 이 evidence 는 automatic import/export parity 로
승격하지 않는다. Public payload 는 source alias, file name, kind, size, columns, preview
SQL 만 노출하고 absolute local path 는 노출하지 않는다. Completion 은 editor assistance 이며
runtime support 를 넓히지 않는다. extension install/load/helper functions, `COPY`,
`ATTACH`/`DETACH`, sensitive external-file capability settings, and arbitrary
external-file SQL functions/replacement scans are adapter-blocked. 구조화된 grid row
edit (INSERT/UPDATE/DELETE) 는 writable connection 에서 transactional
`execute_sql_batch` 경로로 노출된다 (ADR 0051 Stage 1, #1070). Native structural DDL 도
writable connection 에서 노출된다 (ADR 0051 Stage 2, #1070): table create/drop/rename,
column add/drop/type, index create/drop 가 native DuckDB `ALTER TABLE` /
`CREATE|DROP TABLE|INDEX` 로 실행된다. constraint add/drop (Stage 2b rebuild-swap),
identity/auto-increment column, dry-run/multi-statement transaction (Stage 3),
file analytics automatic import/export parity 는 unsupported/follow-up 이며 해당 컨트롤은
`ddl.alterConstraint` / `ddl.identityColumn` capability 로 숨겨진다 (click-then-error
아님)

## MongoDB

**Runtime**: runtime-backed whitelisted document workflow

**현재 판단**: connection, source-aware catalog metadata, workbench metadata panels,
document query/edit with MQL preview/discard, catalog-aware
collection/field/index-name autocomplete, bulk delete/update previews with
partial-commit warnings, bulk/index/validator slices, cancellation, destructive
collection/admin confirmations, and transaction-helper unsupported gates are
active for tested whitelist paths. Runtime Happy Path smoke proves seeded
collection browse, row-edit MQL preview/execute, query-tab `find`
projection/sort/limit, destructive `runCommand` confirmation, and
cancel/no-mutation re-read. Focused component/backend tests cover broader
catalog, autocomplete, bulk, index, validator, parser, cancellation, and
unsupported-helper gates below smoke. arbitrary JavaScript/shell behavior,
unsupported cursor helpers, server-version feature promotion gates, native
document-first result panels, and full-support parity remain follow-up

## Redis

**Runtime**: connection/profile + backend KV primitives + key browser/value
preview/edit UI + selected-key bounded stream reader + bounded command editor
vocabulary/key suggestions

**현재 판단**: key browser/value preview and selected-key bounded stream reader are
live. Runtime Happy Path smoke covers Redis connection, deterministic DB 2
seed/reset, key scan, string value preview, `GET` command result, guarded string
overwrite, TTL update, and exact-key delete confirmation. The value panel
promotes bounded string/hash/list/set/zset edits plus expire/persist/delete
preview/confirm flows, while partial/unsupported surfaces fail visibly. Frontend
stream reader evidence covers selected stream start/end/count controls, refresh,
loading/error states, and bounded table rendering through `read_kv_stream`.
Backend guarded string set, delete confirmation, TTL expire/persist, bounded
stream read, selected read/write/TTL/stream command dispatch, tabular
projection, and exact-key `confirmKey` enforcement for single-key
`DEL`/`PERSIST` have focused IPC/runtime evidence. The Redis command editor
suggests the backend allowlist command names with arity hints/snippets plus
current-DB key suggestions filtered by command key type. It still does not own
full Redis CLI parsing or admin parity.
Full CLI/admin parity, consumer-group stream UI, cluster/pubsub/modules/consumer-group management,
multi-key destructive commands, broader command coverage, language-core
parser/completion ownership, and Valkey command compatibility are follow-up

## Valkey

**Runtime**: KV runtime for connection + key browser/value preview +
selected-key stream reader + bounded command query + shared
string/hash/list/set/zset KvMutationPanel write controls

**현재 판단**: `valkey` is an active `DatabaseType`/profile identity with server
connection kind, product label, KV paradigm, Valkey backend adapter profile, and
`redis-command` compatibility target. Connection UI/runtime support is exposed
for test/connect/key browse/value preview and selected bounded command query
rows through the same Redis command allowlist. Selected stream keys use the same
read-only bounded stream reader panel backed by `read_kv_stream`. Mutation
controls share the Redis string plus hash/list/set/zset KvMutationPanel write
surface (#1075), all routed through the same Safe Mode +
ConfirmDestructiveDialog gate, with focused Valkey backend/component evidence.
Runtime Happy Path smoke uses `e2e/fixtures/valkey/kv/seed.json` for connect/key
scan/value preview, `GET`, `HGETALL`, `XRANGE`, bounded `SET`/`EXPIRE`, and
destructive/unsupported guard evidence. Command completion is limited to the
proven local Valkey runtime rows plus safe current-keyspace hints.
`e2e/fixtures/valkey.redis-compatibility.json` separates proven local-runtime
rows from candidate/rejected command families. Valkey collection-write smoke
coverage and full Redis compatibility are not claimed

## Elasticsearch/OpenSearch

**Runtime**: Elasticsearch live connection + live catalog + bounded live Search
query plus fixture/live delete-by-query safety planning and live
`_delete_by_query` execution; OpenSearch live connection + live catalog +
bounded live Search query plus fixture/live delete-by-query safety planning and
live `_delete_by_query` execution

**현재 판단**: Search uses an index-catalog-first workbench boundary: the sidebar
shell loads only index/alias/data-stream summaries, and selected-index
mappings/settings/analyzers/templates/field stats/sample documents load from
detail tabs or explicit actions. Elasticsearch exposes URL/auth/TLS connection
UI, a live HTTP root probe that detects product/version/distribution and
surfaces scoped redacted auth/TLS/network/timeout/permission/server/shard
failures, live catalog reads for indexes, aliases, data streams, mappings,
settings/analyzers, templates, and field paths, bounded live `_search` execution
with backend validation for `match_all`, `term`, `terms`, `match`, `bool`
filters, `range`, `exists`, `terms`/`value_count` aggregations, pagination,
`track_total_hits`, bounded field sort, bounded `_source` filtering, and the
boolean `profile` flag plus
hits/source/fields/highlights/sort/shards/aggs response parsing, and
delete-by-query safety planning that estimates matching documents through a safe
`_search` request, then executes a live `_delete_by_query` behind a Safe Mode
confirmation (backend IPC chokepoint). OpenSearch exposes URL/auth/TLS
connection UI, a live HTTP root probe that verifies OpenSearch
product/version/distribution, rejects Elasticsearch endpoints, surfaces scoped
redacted auth/TLS/network/timeout/permission/server/shard failures, reads live
indexes, aliases, data streams, mappings, settings/analyzers, composable/legacy
templates, and field paths, dispatches bounded live `_search` requests through
the same validator/result renderer with cancellation and scoped HTTP error
handling, and uses the same safe `_search` estimate for delete-by-query preview
plans plus the same live `_delete_by_query` execution behind a Safe Mode
confirmation. Runtime Happy Path smoke covers representative Elasticsearch and
OpenSearch live connect/auth/TLS, catalog metadata, selected-index detail,
search/render, delete-plan, live delete-execution, and error-surface workflows.
Bounded Search DSL editor completion uses product-scoped catalog/mapping context
for index, alias, data stream, field, type, `sort`, and `_source` suggestions
plus shared query/aggs/sort/source snippets. Unsupported body keys, unsupported
aggregation kinds/options, script sort, broad source options, raw/admin targets,
wildcard targets, and destructive/admin APIs reject before live Search dispatch
or destructive planning. Search live HTTP/admin promotion remains owned by the
Search roadmap/milestone, not non-RDBMS lazy-loading workbench hardening.
Broader Search admin APIs (index/settings create/delete), global
audit/admin/security dashboards, the `_explain` endpoint, a dedicated
profile/explain request workflow with its own viewer (#2198 accepts the
`profile` flag through the raw DSL and renders the payload in the existing
result panel; it ships no viewer), and
product-specific live deltas beyond these slices are deferred

## MSSQL

**Runtime**: SQL-auth/TDS connection plus catalog/query/cancel/tabular runtime
and PK-projected row edit through SQL batch

**현재 판단**: `mssql` is a source-specific profile/dialect identity with SQL Server
labels, defaults, URL parsing, and seed/spec inventory. Issue #903 promotes
connection test/connect/ping, catalog
browse/schema/indexes/constraints/relationships, query, multi-statement
execution, cancellation, tabular result rendering, and editRows through the
frontend SQL batch path with primary-key projection. #907 adds representative
Runtime Happy Path smoke for connect, seeded catalog browse, SELECT/DML,
destructive Safe Mode confirmation, cancellation, and grid edit.
#2094 turns `switchDatabase` on: the wired `MssqlAdapter` already overrode
`RdbAdapter::switch_database` (`mssql/catalog.rs::switch_active_database`), so
the toolbar `DbSwitcher` and the default-database self-heal are live. Named
instances, Windows authentication, Azure AD/authSource modes, structured DDL,
admin/security/jobs/users/roles, import/export, profiler/activity, full T-SQL
semantic parity, full workbench parity, and sqlcmd/meta-command/procedure-body
scripting remain unclaimed.

## Oracle

**Runtime**: service-name lifecycle plus bounded catalog/query/cancel/tabular
runtime and PK-projected row edit

**현재 판단**: `oracle` remains a source-specific profile/dialect identity with
Oracle labels, service-name defaults, URL parsing, and seed/spec inventory. #905
promotes lifecycle, catalog metadata, SELECT/DML batch execution, cooperative
cancellation, and tabular table-data query. #906 adds key-projected editRows
through the frontend SQL batch path, Oracle identifier/literal generation,
tested SELECT/DML/DDL Safe Mode classification, and PL/SQL/admin boundary
blocks. #907 adds representative Runtime Happy Path smoke for service-name
connect, seeded catalog/routine browse, SELECT/DML, destructive Safe Mode
confirmation, cancellation, and grid edit. #1072 dissolves the runtime slice and
wires the full adapter, promoting bounded structured table/index/constraint DDL
through the shared StructurePanel path. The runtime still blocks switch
database, raw DDL/admin, PL/SQL body/package authoring, trigger DDL beyond the
bounded catalog smoke path, SID/TNS/wallet/TLS/advanced auth, import/export,
profiler/activity, users/roles/grants/session/storage, full workbench parity,
and full parser/completion promotion.

## Cassandra/Scylla, DynamoDB, graph, vector, stream

**Runtime**: candidate only

**현재 판단**: no active `DatabaseType`/profile/runtime/parser/completion,
fixture/live evidence, or E2E smoke claim. Workflow value, profile target,
connection kind, language owner, catalog model, result envelope, safety policy,
fixture strategy, and smoke evidence must be locked before promotion
