---
title: Data Source Runtime Posture
type: memory
updated: 2026-08-02
surface: src-tauri/table-view-core/src/db/**
task: data-source, posture, support-claim, capability
keywords: Runtime Posture, separate contracts, MSSQL, T-SQL, Oracle, PL/SQL, Redis, Valkey, Elasticsearch/OpenSearch, _delete_by_query, Safe Mode confirm gate, Runtime Happy Path, list_database_users, users listing, users/roles, sys.server_principals, VIEW ANY DEFINITION, HAS_PERMS_BY_NAME, CapabilityNotEnabled, mysql.user, IS_SRVROLEMEMBER, Entra
trigger:
  signal: DBMS 지원 범위 / runtime posture / support claim 변경
  layer: index
---

# Data Source Runtime Posture

Current posture summary lives here only as architecture boundary; product wording
and evidence detail live in product/contributor docs. 상위 계약과 layer rule 은
[data source architecture](../memory.md) 를 본다.

MSSQL is active for lifecycle, bounded query/result, primary-key row edit,
bounded structured table/index/constraint DDL, catalog/workbench metadata,
representative Runtime Happy Path smoke, live cached catalog-aware completion,
and bounded static parser/Safe Mode metadata. SQL Server TLS-required workflow,
SQLCMD/admin/security/backup/jobs 및 user/role write management, broader
auth/encryption, instance discovery, and full T-SQL semantic parity remain
separate contracts.

Read-only users/roles listing (`list_database_users`, #1077 Stage 2) 은 이제 PG
+ MySQL/MariaDB (`mysql.user`) + SQL Server (`sys.server_principals`) 에서
active. MySQL 과 MariaDB 는 어댑터를 공유하지만 SQL 은 벤더별로 갈린다 —
MariaDB 의 `mysql.user` 는 `mysql.global_priv` 위의 뷰라 `account_locked` 가
없다. trait default `Unsupported` 게이트는 override 가 없는 나머지 RDB
어댑터(Oracle · SQLite · DuckDB · `MssqlConnectionOnlyAdapter`)와 non-RDB
paradigm 에 남는다. 어느 adapter 도 credential 컬럼을 select 하지 않는다
(`pg_authid`/`authentication_string`/`sys.sql_logins.password_hash` 미조회).
SQL Server 는 `sys.server_principals` 가 metadata-visibility 필터가 걸리는
catalog view 라 `VIEW ANY DEFINITION` 을 먼저 probe 하고 없으면
`CapabilityNotEnabled` 로 fail loud — server-scope 권한 부재로 잘린 목록을
완전한 목록으로 렌더하지 않는 것이 이 surface 의 불변식이다. probe 는 server
scope 답만 주므로 principal 단위 `DENY VIEW DEFINITION ON LOGIN::x` 로 인한 행
누락은 남는 경계이고 (product known-limitations 에 기록), 권한 flag 은
`IS_SRVROLEMEMBER` 가 certificate/asymmetric-key principal 에 NULL 을 주므로
catalog membership walk 와 항상 OR 한다 (NULL→0 collapse 금지). 행 선택에는
principal type 필터를 걸지 않는다 — `type IN (...)` whitelist 는 Entra
(`'E'`/`'X'`) principal 을 무기록·무에러로 누락시켰다. loginability 만 type 별로
판정한다. 계정 write (create/alter/drop) 는 여전히 별도 계약.

Oracle is active for service-name lifecycle plus bounded catalog/query/cancel/
tabular runtime: catalog metadata, SELECT/DML batch execution, cooperative
cancellation, and table-data query through the bounded runtime wrapper. SID/TNS/
wallet/TLS, advanced auth, switch database, editRows, structured DDL, raw
DDL/admin, parser/completion, runtime smoke, triggers, PL/SQL source/body/
package authoring, sequences/synonyms DDL/admin, import/export, profiler/
activity, users/roles/grants/session/storage, full workbench parity, and full
PL/SQL executable semantics remain separate contracts.

Redis and Valkey are active KV profiles with bounded connection/key browse/value
preview and command-query slices. Redis has direct key mutation controls for the
supported panel paths; Valkey keeps direct key mutation controls and full Redis
compatibility unclaimed until Valkey-specific evidence promotes them.

Elasticsearch/OpenSearch are active Search profiles for live HTTP connection,
catalog/index detail, bounded live `_search`, backend Search DSL validation,
Runtime Happy Path smoke, delete-by-query safety planning, and the live
`_delete_by_query` execution #1076 promoted behind the Safe Mode confirm gate.
Embedded fixtures remain contract evidence; index/settings admin APIs and
wildcard/`_all` delete targets remain deferred.

Cassandra/Scylla, DynamoDB, graph, vector, stream 은
workflow/profile/connection/language/catalog/result/safety/fixture contract 전
active `DatabaseType`/profile/runtime 으로 추가하지 않는다.

## Related

- [data source architecture](../memory.md)
- [adding data source](../adding/memory.md)
