---
title: Data Source Runtime Posture
type: memory
updated: 2026-07-17
surface: src-tauri/src/db/**
task: data-source, posture, support-claim, capability
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

Oracle is active for service-name/SID lifecycle plus catalog metadata,
SELECT/DML batch execution, cooperative cancellation, table-data query,
key-projected editRows, bounded structured table/index/constraint DDL,
read-only trigger listing, schema-dump export, admin ops, and (#1072) database
switching — Oracle has no `USE <db>`, so the switch re-dials the stored service
name/SID and the picker lists the session container plus reachable open PDBs.
TNS descriptors, wallet-less TLS, advanced auth, raw DDL/admin, trigger DDL,
parser/completion promotion, PL/SQL source/body/package authoring,
sequences/synonyms DDL/admin, import/export, users/roles/grants/session/storage,
full workbench parity, and full PL/SQL executable semantics remain separate
contracts.

Redis and Valkey are active KV profiles with bounded connection/key browse/value
preview and command-query slices. Redis has direct key mutation controls for the
supported panel paths; Valkey keeps direct key mutation controls and full Redis
compatibility unclaimed until Valkey-specific evidence promotes them.

Elasticsearch/OpenSearch are active Search profiles for live HTTP connection,
catalog/index detail, bounded live `_search`, backend Search DSL validation,
Runtime Happy Path smoke, and delete-by-query safety planning. Embedded fixtures
remain contract evidence; actual live `_delete_by_query` and broader admin APIs
remain deferred.

Cassandra/Scylla, DynamoDB, graph, vector, stream 은
workflow/profile/connection/language/catalog/result/safety/fixture contract 전
active `DatabaseType`/profile/runtime 으로 추가하지 않는다.

## Related

- [data source architecture](../memory.md)
- [adding data source](../adding/memory.md)
