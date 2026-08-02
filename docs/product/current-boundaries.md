# Current Boundaries

- 새 `DatabaseType` 추가는 기존 지원 DBMS 하나가 데스크톱 DB 클라이언트 수준의
  query/workbench parity lane 을 통과할 때까지 시작하지 않는다 (ADR 0060). 이미
  지원 중인 엔진의 capability 확장은 이 제약 밖이지만, 각 support claim 은 여전히
  해당 source 의 runtime/parser/completion/edit/fixture/e2e evidence 를 요구한다.
- Full admin parity 는 staged promotion 대상이다 (#1077, 2026-07-02 owner
  decision): extension management UI, schema diff/migration preview, deep
  activity/profiler dashboards 는 여전히 scope 밖. import/export 는 Stage 1,
  users/roles UI 는 Stage 2 로 승격됐다. Stage 1 의 첫 슬라이스는 SQL-file
  import 이다: query editor 툴바의 "Open SQL File" 이 사용자가 고른 `.sql`
  파일 (16 MiB cap, app-internal path 거부) 을 에디터로 로드한다. 실행은
  기존 Run 경로를 그대로 타서 destructive statement 는 Safe Mode confirm
  게이트를 통과한다 — 즉 자동 실행/자동 import 가 아니다. Stage 2 의 첫
  슬라이스는 read-only users/roles listing 이다: PG 는 `list_database_users`
  가 `pg_roles` (password-masked catalog view — `pg_authid`/`pg_shadow` 는
  참조 안 함) 를 읽어 계정/역할 + 소속 role 을 조회 전용으로 노출한다. 같은
  read-only listing 이 MySQL/MariaDB (`mysql.user` — `User`/`Host` + 권한 flag
  만, `authentication_string`/`Password` 는 미조회) 와 SQL Server
  (`sys.server_principals` — principal name + capability flag 만,
  `sys.sql_logins.password_hash` 는 미조회) 로 확장됐다. MySQL 과 MariaDB 는
  어댑터는 같지만 SQL 이 다르다 — MariaDB 10.4 가 `mysql.user` 를
  `mysql.global_priv` 위의 뷰로 바꿔 `account_locked` 를 없앴기 때문에 잠금
  상태는 그 뷰의 `Priv` JSON 에서, 역할은 `is_role` 컬럼에서 읽는다. backend
  `Unsupported` 게이트는 override 가 없는 나머지 RDB 어댑터(Oracle · SQLite ·
  DuckDB · `MssqlConnectionOnlyAdapter`)와 non-RDB paradigm 에 남는다 (Oracle
  은 `dba_users`/`all_users` 로 Stage 2 잔여, issue #1077 참조). SQL Server 는
  `sys.server_principals` 가 DMV 가 아니라 metadata-visibility 필터가 걸리는
  catalog view 라, `VIEW ANY DEFINITION` 없는 로그인에게는 목록이 조용히 잘려
  돌아온다 — 그래서 adapter 가 `HAS_PERMS_BY_NAME` 으로 먼저 probe 하고 권한이
  없으면 `CapabilityNotEnabled` 로 fail loud 한다 (server-scope 권한 부재로 인한
  부분 목록을 완전한 목록처럼 렌더하지 않기 위함). 이 probe 로 닫히지 않는
  잔여는 principal 단위 `DENY VIEW DEFINITION ON LOGIN::x` 다 — probe 는 통과하고
  해당 행만 조용히 빠진다
  ([known-limitations-rdbms](known-limitations-rdbms.md)).
  role 생성/변경/삭제 (CRUD) 는 depth step 후속.
  Stage 1 의 첫 슬라이스들 (SQL-file import, grid export
  계열, 테이블/쿼리 결과 tabular JSON export #1638 — headers 를 key 로 하는
  array-of-objects, CSV row-level import PG-first #1639 preview + #1640 commit —
  컬럼 매핑 후 행마다 single-row INSERT 를 한 트랜잭션의 `execute_query_batch`
  로 흘려 all-or-nothing 커밋) 은 이미 출하됐고, 잔여 in-scope 슬라이스는
  다음이다: MySQL restorable dump (#1641), MSSQL 확대 (#1642). 여전히
  out-of-scope: 16 MiB 초과 `.sql` streaming restore, DuckDB `COPY`
  import/export, DB-level backup/restore. admin parity 경계를 기록한 ADR 은
  존재하지 않으므로 이 문단이 그 경계의 SOT 다. 각 잔여 슬라이스의
  known-limitations 행은 해당 sub-issue 가 출하 시 갱신한다. profiler dashboard
  는 Stage 3 후속.
- DuckDB file analytics paths stay in active-session adapter state and clear on
  connect/refresh/disconnect. Source metadata, preview, source-scoped query,
  and error payloads expose only public source metadata and redact local paths.
  The local file query dialog result is modal-local, but successful source
  queries are recorded with the distinct `FILE` history source label. The
  global query editor keeps the normal result surface while the DuckDB backend
  accepts read-only SELECT statements that reference at least one registered
  alias without passing a source id, and those successful source queries also
  record the `FILE` history source label. Grid export is the
  generic explicit save-dialog export of current grid rows, not automatic export
  of a registered local file source; import workflows remain future work, and
  connection export is a separate encrypted-envelope flow that does not embed
  connection passwords or active-session registered file source metadata.
- DuckDB autocomplete is an editor-assistance surface: vocabulary and cached
  schema suggestions do not imply runtime permission for adapter-blocked
  extension, `COPY`, `ATTACH`/`DETACH`, capability-setting, or raw external-file
  statements.
- Runtime/parser/completion/edit/fixture/e2e/support-claim gaps 는 lane 단위
  깊이 우선순위를 따르되, 이는 권고이지 동시 진행 금지가 아니다 (ADR 0060).
  새 `DatabaseType` 추가만 lane 통과를 기다린다.
- PostgreSQL is the strongest active query/workbench parity lane. Its current routine
  desktop smoke proves the PostgreSQL connect -> browse/edit -> query journey,
  the Explain plan-inspection UI/source label, seeded `pgcrypto` and
  `fuzzystrmatch` installed-extension completion gating, Safe Mode info/warn/destructive
  confirmation, raw DDL preview, grid-edit preview paths, and cancellation
  UI/history/retry behavior. Cancellation does not imply a server
  activity/session management dashboard. Structured DDL flows, broader
  history-source coverage, ERD, admin, arbitrary extension semantics, and
  profiler/activity scenarios need separate promotion before product claims
  widen.
- MySQL has a narrower routine runtime-smoke baseline for connect, seeded table
  browse, SELECT, DML batch, row edit, cancellation/retry, history/source labels,
  and tabular result rendering. Catalog metadata now covers databases/schemas,
  tables, views, columns, indexes, constraints/FKs, and live version-gated
  column CHECK hints. Row-edit generated SQL uses MySQL backtick identifier
  quoting, primary-key row projection, and covered JSON/scalar/null coercion for
  preview/commit/discard paths. Structured DDL evidence is bounded to
  table/index/constraint preview/confirmation; Structure trigger create/drop
  remains hidden for MySQL because the supported trigger path is raw SQL.
  Parser/Safe Mode covers `LIMIT offset,count`,
  `ON DUPLICATE KEY UPDATE`, and narrow `CALL proc(scalar)`; stored routine/event
  bodies, control-flow scripting, `DELIMITER`, and `LOAD DATA` are explicit
  unsupported boundaries. Completion uses the current catalog as editor
  assistance only; completion runtime smoke, broader workbench breadth, and full
  admin/import/export parity remain separate promotion gates.
- MariaDB now has its own routine runtime-smoke baseline for connect, seeded
  table browse, catalog/workbench metadata browse, SELECT, DML batch, row edit,
  cancellation/retry, history/source labels, and tabular result rendering
  against the MariaDB engine fixture. Catalog/workbench evidence covers
  tables/views/columns/indexes/constraints/FKs/routine metadata browse; row edit
  and bounded table/index/constraint DDL have focused MariaDB-specific tests for
  the intentional MySQL-family path. CHECK constraint hints stay gated on MariaDB
  `>= 10.2.1` version context. MariaDB autocomplete keeps the keyword-level
  `RETURNING` suggestion for unknown versions and known versions at
  `>= 10.0.5`, and suppresses it for known older versions. This does not widen
  MariaDB-only
  runtime claims such as `RETURNING`, procedure-management/body authoring,
  trigger CRUD, admin/import/export, or completion-runtime support. `RETURNING`
  is currently profile/completion plus structural parser/Safe Mode evidence
  only; focused `mariadb:11` integration proves the server-accepted
  `DELETE ... RETURNING` side effect while preserving the no-returned-row and
  no-affected-row-count adapter boundary, so runtime acceptance remains outside
  the app's client-side support claim.
- SQLite is a file-backed DBMS lane. Current support is scoped to file
  create/open/test, read-only mode, catalog/table browse, read queries,
  writable-file DML, transactional DML batch/dry-run, and key-projected row
  edits. GitHub Runtime Happy Path now runs deterministic SQLite desktop smoke
  for file create/open, table browse, read query, writable DML, row edit,
  read-only write rejection, and internal app-state DB rejection. SQLite
  structured DDL, automatic ALTER rebuilds, extension/capability semantics,
  sqlite-cli command execution, and nested JSON edits remain future promotion
  gates.
- Routine runtime smoke currently proves the GitHub Runtime Happy Path for
  PostgreSQL, MySQL, MariaDB, SQLite, DuckDB `.duckdb`, MongoDB, Redis, Valkey,
  Elasticsearch, OpenSearch, MSSQL, and Oracle. MSSQL/Oracle smoke is bounded to
  representative connect, seeded catalog browse, SELECT/DML, destructive Safe
  Mode confirmation, cancellation, and grid edit paths. Other smoke specs or
  source inventories do not widen product support until a smoke runner and
  support docs promote them.
- Destructive/security behavior is source-specific. RDB DDL preview/confirm,
  RDB Safe Mode confirmations, MongoDB safety confirmations, Redis typed
  confirmation keys, and fixture/live Search destructive plan estimates exist, but
  Table View does not claim a universal admin/security dashboard, global
  audit log, role/user/permission UI, credential rotation UI, or broad
  dry-run system.
- Cassandra/Scylla, DynamoDB, graph, vector, stream 은 workflow value,
  profile target, capability, parser/completion owner, fixture/live evidence,
  smoke/E2E decision 전 active support 로 승격하지 않는다.
- Cassandra/Scylla candidate contract 는 `wide-column` profile target,
  `cluster` connection kind, CQL future Rust/WASM language-core ownership,
  keyspace/table/partition/clustering catalog, `tabular` result envelope,
  partition-key and expensive-read guardrails 로 제한된다. Future evidence path
  는 Cassandra testcontainer baseline plus Scylla compatibility testcontainer
  delta 이며, 이것은 active runtime/connection UI/parser/completion/smoke claim
  이 아니다.
- Graph candidate contract 는 `graph` profile target, `server` connection kind,
  Cypher-first language route with deferred GQL/Gremlin split,
  labels/relationships/properties/indexes catalog, existing `graph` envelope
  path view plus `tabular` projection 으로 제한된다. Graph-source catalog 는 RDBMS
  ERD/FK `SchemaGraph` 와 별도이며, 새 top-level path envelope 는 ADR 또는
  architecture note 전에는 만들지 않는다. Future evidence path 는
  Neo4j-compatible fixture graph/testcontainer plus traversal/write guardrails
  이며, 이것은 active runtime/connection UI/parser/completion/smoke claim 이
  아니다.
- Vector candidate contract 는 `vector` profile target, `server` connection
  kind, cloud providers 의 별도 `cloud-api` profile decision, future
  `vector-query` or provider filter DSL, collection/vectorSchema/payloadIndex
  catalog, `vectorNeighbors` result envelope 로 제한된다. Future evidence path 는
  topK/filter/write/delete guardrails plus embedded/mock or container fixture
  strategy 이며, cloud credential/provider decisions require threat-model
  handoff before implementation. 이것은 active runtime/connection
  UI/parser/completion/smoke claim 이 아니다.
- Current user-visible support boundaries and unmeasured UI/a11y/perf areas are
  tracked in [`known-limitations.md`](known-limitations.md).
