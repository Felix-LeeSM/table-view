---
title: RDB + Mongo Unified Ops 후속 묶음
type: decision-log
updated: 2026-05-14
---

# RDB + Mongo Unified Ops 후속 묶음

2026-05-14 Mongo Full Support grill 중 "RDB 에도 없는데, 같이 만들자" 가
반복 도출. paradigm-shared UI + paradigm 분기 driver 패턴이 동일해 별도
phase 로 묶는다. Phase 28 (Mongo Full Support) 종료 후 phase 29 후보.

## 묶음 항목

| ID | 항목 | RDB | Mongo | UI |
|----|------|-----|-------|----|
| U1 | Server activity (List + Kill) | `pg_stat_activity` + `pg_terminate_backend` / MySQL `SHOW PROCESSLIST` + `KILL` | `db.currentOp()` + `db.killOp()` | connection 우클릭 → "Server activity..." 패널, 자동 refresh, kill confirmation modal |
| U2 | Explain Viewer | `EXPLAIN ANALYZE` JSON/text | `.explain("executionStats")` | Query Editor `Explain` 버튼 → visual tree (IXSCAN/COLLSCAN/SORT 등 stage 노드 + 시간/rows + 색상 hint) |
| U3 | Collection/Table Stats 탭 | `pg_total_relation_size` + `pg_stat_user_tables` + index sizes | `db.coll.stats()` | StructurePanel 의 새 `Stats` 탭 — documents/data size/storage size/avg doc size/total index size + per-index size |
| U4 | Server Info 패널 | `SELECT version()` + `pg_database_size()` + connection count + `pg_stat_replication` | `db.serverStatus()` + `db.stats()` + `rs.status()`/`sh.status()` | connection 우클릭 → "Server Info..." 모달/패널 — version/host/uptime/connections/opcounters/memory + Replication 섹션 (manual refresh) |
| U5 | Slow Query / Profiler | `pg_stat_statements` + `log_min_duration_statement` toggle / MySQL `slow_query_log` | `db.setProfilingLevel(...)` + `db.system.profile` | "Slow queries" 패널 — enable toggle (threshold ms) + recent 리스트 + 각 row → U2 Explain Viewer 로 jump |

## Backend IPC 시그니처 (안)

- U1: `list_running_ops(conn_id) -> Vec<ServerOp>`, `kill_op(conn_id, op_id) -> Result<()>`
- U2: `explain_query(conn_id, sql_or_mongo, mode) -> ExplainPlan` (paradigm-shared 구조)
- U3: `get_table_stats(conn_id, ns) -> TableStats` (paradigm-shared shape)
- U4: `get_server_info(conn_id) -> ServerInfo` (paradigm-shared shape)
- U5: `get_slow_queries(conn_id, since, limit) -> Vec<SlowQuery>`, `set_slow_threshold(conn_id, ms)`

## 직접 lock 된 grill 결정 출처

- Q24 → U1
- Q26 → U2
- Q27 → U3
- Q28 → U4, Q32 도 U4 흡수
- Q29 → U5

상세: [phase-28-mongo-full-support](../phase-28-mongo-full-support/memory.md).

## 권장 진행

1. Phase 28 (Mongo Full Support) Slice A–M 완료
2. 본 묶음 phase 착수 — U3+U4 (정보) 와 U1+U2+U5 (대화형) 둘로 2 sprint 또는 5 sprint 분해
3. paradigm-shared UI shell 재사용 부담 한 곳에 모음

## 관련 방

- [roadmap](../memory.md)
- [phase-28-mongo-full-support](../phase-28-mongo-full-support/memory.md)
