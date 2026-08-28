# Product State

이 문서는 현재 제품 상태와 지원 범위를 기록한다. 미래 목표와 승격 후보는
[`docs/ROADMAP.md`](../ROADMAP.md) 에서 확인한다.

## Product Goal

기존 데스크톱 DB 클라이언트를 쓰던 사용자가 핵심 워크플로우를 잃지 않고
Table View 로 전환할 수 있어야 한다.

핵심 워크플로우는 연결 -> 탐색 -> 조회/쿼리 -> 편집 -> 안전한 검토/커밋 순서로
이어진다.

## Detail Pages

분량이 큰 섹션은 sibling child page 로 분리했다. 아래 목록은 분리하기 전의 섹션
순서를 그대로 유지한다.

- [`supported-workflow-summary.md`](supported-workflow-summary.md): Supported Workflow Summary
- [`current-support-snapshot.md`](current-support-snapshot.md): Current Support Snapshot
- [`fixture-coverage-snapshot.md`](fixture-coverage-snapshot.md): Fixture Coverage Snapshot
- [`result-copy-export-semantics.md`](result-copy-export-semantics.md): Result Copy/Export Semantics
- [`current-boundaries.md`](current-boundaries.md): Current Boundaries

## Profile Registry Boundary

`src/types/dataSource.ts` 의 `DATA_SOURCE_PROFILES` 는 모든 `DatabaseType` identity 를
포함한다. 그러나 profile 이 존재한다고 해서 그것이 곧 runtime support claim 이
되지는 않는다. 현재 connection dialog
와 runtime connection support 는 `src/types/dataSource.ts` 의
`getConnectionSupportedDatabaseTypes` / `isConnectionSupportedDatabaseType` 이
`capabilities.connection.test` 로 판정한 12개 source 로 제한된다. Legacy
compatibility list 인 `src/features/connection/model.ts` 의
`SUPPORTED_DATABASE_TYPES` 는 같은 12개 allow-list 를 유지해야 한다:
PostgreSQL, MySQL, MariaDB, SQLite, DuckDB, MSSQL, Oracle, MongoDB, Redis,
Valkey, Elasticsearch, OpenSearch.

Connection form SOT 는
`src/features/connection/components/ConnectionDialog/ConnectionDialogBody.tsx`
의 `renderDbmsFields` switch 다. PostgreSQL 은 `PgFormFields`, MySQL/MariaDB 는
`MysqlFormFields`, MSSQL 은 `MssqlFormFields`, Oracle 은 `OracleFormFields`,
Elasticsearch/OpenSearch 는 `SearchFormFields`, MongoDB 는 `MongoFormFields`,
Redis/Valkey 는 `RedisFormFields`, SQLite/DuckDB 는 file-form `SqliteFormFields`
를 쓴다. MSSQL 과 Oracle, Search 는 Pg form 을 재사용한다는 claim 을 하지 않는다.

폼은 `기본` 과 `고급`, `SSH/SSL` 세그먼트로 나뉜다. 어느 컨트롤이 어느
세그먼트에 속하는지는 `ConnectionDialogBody.tsx` 의 세 `TabsContent` 패널과 각 폼
컴포넌트의 `section` 분기가 정하므로, 이 문서에는 옮겨 적지 않는다. 한편
`src/features/connection/components/forms/formSection.ts` 는 세그먼트 이름을
정의하는 타입이다. 저장이 거부되면 폼은 `기본` 세그먼트로 돌아간다. Name / Database Type /
Environment 는 세그먼트 밖에 남아 있어서, 폼 모드에서는 어느 세그먼트를 열어도 화면에
계속 보인다. 파일 연결(SQLite/DuckDB)에는 `SSH/SSL` 세그먼트가 없다.

Support audit artifacts are historical inputs only.
`docs/archives/audits/refactor-05-support-claims-ledger-2026-06-12.md` 는
snapshot 으로 보존하며, durable result 는 `docs/product/**` (이 index 와 Detail
Pages / known-limitations / query-language-support 의 child page), `docs/ROADMAP.md`,
and symbol/path owners above 로 흡수한다. New claims must update those SOTs
directly; line-number references are not stable SOT.

## Database Scope Semantics

Table View 는 DB/index/database scope 를 paradigm 별로 다르게 노출한다.

- RDB 에서 `connection.switchDatabase` 가 true 인 PostgreSQL, MySQL, MariaDB,
  SQL Server 는 toolbar `DbSwitcher` 를 connection-global active
  database/catalog 로 쓴다. SQL Server 는 #2094 에서 이 기능을 켰다. wired
  `MssqlAdapter` 가 `RdbAdapter::switch_database` 를 override 해
  `switch_active_database` 로 보내고 있었는데, 선언만 빠져 있었기 때문이다.
  SQLite/DuckDB 는 file/session scope 로 고정되고,
  Oracle 은 `OracleAdapter` 에 override 가 없어 trait 기본값인 `Unsupported` 를
  돌려주므로 `switchDatabase` 가 disabled 다.
- KV 인 Redis/Valkey 는 toolbar `DbSwitcher` 를 connection-global numeric
  database index 로 쓴다. `switch_active_db` 는 `KvAdapter::switch_database` 로
  dispatch 되고, key scan/value/query/mutation 은 요청이 explicit database 를
  명시하지 않으면 active DB 를 따른다.
- MongoDB 는 global `DbSwitcher` 를 쓰지 않는다. Query tab 의 tab-local
  `TabDbChip` binding (`tab.database`) 이 scope 를 소유하므로, 한 tab 에서
  database 를 바꾸어도 connection-global state 는 바뀌지 않는다.
- Search 인 Elasticsearch/OpenSearch 는 database switching 을 노출하지 않는다.
  selected index/alias/data stream scope 는 sidebar/query target surface 에서
  정한다.

Disabled switcher copy 는 실제 fixed-scope 이유를 말해야 하며 Redis/Valkey
database switching 이 unsupported 라고 주장하면 안 된다.

## KV Mutation Entry Points

Redis/Valkey workbench 의 key action surface 는 selected-key mutation 과 new-key
creation 을 분리한다. `New key` 는 현재 bounded KV contract 에서 지원하지 않으므로
disabled 상태를 유지한다. `Edit` 과 `Delete` 는 selected key 가 로드되고 mutation panel 이
지원하는 type 일 때만 enable 되며, 각각 기존 value mutation preview 와 Safe Mode
delete confirmation path 로 포커스를 이동시킨다. 따라서 delete 는 local panel input 에만
있는 숨은 기능이 아니라, workbench action 에서 호출되어 milestone Safe Mode gate 를 통과한다.
이 key action/value 편집 surface 는 sidebar 하단 inline 이 아니라, key 를 선택하면 열리는
오른쪽 `kv` paradigm detail tab (`KvKeyDetailPanel`) 이 호스팅하며, 이는 search paradigm
(`SearchIndexDetailPanel`) 과 동일한 구조다. sidebar (`KvSidebar`) 는 scan 과 key 선택만
담당하며, panel mutation (특히 delete) 뒤에 list 를 자동으로 rescan 하는 기능은 아직 없어서 수동 Scan 이 필요하다.

## Related Documents

- [`docs/product/query-language-support.md`](query-language-support.md): current query-language support boundaries
- [`memory/engineering/architecture/data-source/memory.md`](../../memory/engineering/architecture/data-source/memory.md): data-source profile/capability architecture
- [`memory/engineering/architecture/data-source/adding/memory.md`](../../memory/engineering/architecture/data-source/adding/memory.md): contributor checklist for new sources
- [`docs/product/known-limitations.md`](known-limitations.md): current product-visible limitations
- [`docs/roadmap/follow-up-queue.md`](../roadmap/follow-up-queue.md): open follow-up queue
- [`docs/ROADMAP.md`](../ROADMAP.md): promotion order
