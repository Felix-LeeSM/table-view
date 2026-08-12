---
title: Data Source Runtime Posture
type: memory
updated: 2026-07-17
surface: src-tauri/table-view-core/src/db/**
task: data-source, posture, support-claim, capability
keywords: Runtime Posture, separate contracts, MSSQL, T-SQL, Oracle, PL/SQL, Redis, Valkey, Elasticsearch/OpenSearch, _delete_by_query, Safe Mode confirm gate, Runtime Happy Path
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
SQLCMD/admin/security/backup/jobs/users/roles, broader auth/encryption, instance
discovery, and full T-SQL semantic parity remain separate contracts.

Oracle is active for service-name lifecycle plus bounded catalog/query/cancel/
tabular runtime: catalog metadata, SELECT/DML batch execution, cooperative
cancellation, and table-data query through the bounded runtime wrapper. The dial
also takes a SID and a wallet-mTLS directory (#1065) and, since #2154, a TNS
connect descriptor and wallet-less 1-way TCPS off the shared sslmode posture —
all through the one `connect_config` trust boundary. Active beyond the dial:
key-projected editRows, bounded structured table/index/constraint DDL, read-only
trigger listing and PL/SQL body/package source (#1072), plus representative
Runtime Happy Path smoke (#907). tnsnames.ora alias resolution, skip-verify TLS
(the driver cannot express it), advanced auth, switch database, raw DDL/admin,
trigger DDL, PL/SQL body/package authoring, full parser/completion,
sequences/synonyms DDL/admin, DB-level import/backup-restore, profiler/activity,
users/roles/grants/session/storage, full workbench parity, and full PL/SQL
executable semantics remain separate contracts.

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
