---
id: 0060
title: Runtime promotion freeze 범위 — 새 DatabaseType 추가에만 적용
status: Accepted
date: 2026-07-25
supersedes: null
superseded_by: null
---

**결정**: `docs/ROADMAP.md` 순서 규칙 3 의 runtime promotion freeze 범위를 **새
`DatabaseType` 추가**로 한정한다 (2026-07-25 오너 grill).

- **freeze 밖 (지금 착수 가능)**: 이미 active 인 `DatabaseType` 의 capability 확장 전부. MSSQL 구조적 DDL (#1071), Oracle 런타임 슬라이스 해제 (#1072), DuckDB DDL/batch/introspection (#1070), Redis/Valkey 잔여 축, Search live admin 실행, 기존 엔진의 admin/import-export/profiler 확장이 모두 여기 속한다. 판정 기준은 `src/types/dataSource.ts` 의 active profile 목록이다 — 기계적으로 판정하고 회색지대 해석을 남기지 않는다.
- **freeze 안**: 새 `DatabaseType`/profile 추가. 현재 대상은 wider candidate 5종 (Cassandra/Scylla, DynamoDB, graph, vector, stream).
- **ladder 유지**: one-DBMS query/workbench parity ladder (승격 후보 1) 와 고정 lane 순서 (PostgreSQL → MySQL/MariaDB → SQLite/DuckDB → MongoDB) 는 폐기하지 않는다. 새 DBMS 를 추가하는 시점의 순서 규칙으로 남는다. "active lane 하나만 연다" 제약은 freeze 밖 작업에 적용하지 않는다.
- **별도 게이트 유지**: wider candidate 는 freeze 와 무관하게 `memory/engineering/architecture/data-source/adding/memory.md` 의 계약 10항목 lock 을 통과해야 구현을 시작한다. 로드맵 candidate 인벤토리가 채운 것은 profile target / connection kind / language / catalog model / result envelope / safety-fixture 계획이고, 미충족은 workflow value · conformance scope · docs-memory routing 3항목이다. freeze 를 푼다고 이 게이트가 풀리지 않는다.
- **실행 bucket**: freeze 밖 작업의 실행 bucket 은 GitHub milestone 22.50 "DBMS Parity - 엔진별 결손" 이다.

**이유**: freeze 원문이 MSSQL/Oracle DDL widening 을 이름으로 지목해 금지하는데,
milestone 22.50 이 이미 #1070/#1071/#1072 를 진행 중이고 `20e4be2b` (MSSQL trigger
introspection), `1c008349` (Oracle `list_triggers`), `68d76241` (DuckDB Stage 1
grid row-edit) 가 머지돼 문서와 실행이 모순 상태였다. freeze 가 원래 막으려던
것은 순서 규칙 1·2 의 "얕은 partial workflow 확산" 이다. 이미 지원 중인 엔진의
빠진 축을 채우는 것은 확산이 아니라 수렴이므로 원 의도에 반하지 않는다. 판정
기준 후보로 "다른 엔진에 이미 있는 기능인지" 도 검토했으나 축의 존재 여부를
엔진마다 판정해야 해 회색지대가 남는다 (Oracle PL/SQL body, Redis consumer-group
처럼 어느 엔진에도 없는 축). `DatabaseType` 목록 기준은 파일 하나로 확정된다.

**트레이드오프**:
- **+** 진행 중인 3건이 규칙 위반 상태에서 벗어난다. 판정이 기계적이라 작업마다 freeze 해석을 반복하지 않는다.
- **+** ladder 를 폐기하지 않아 H1~H7 지평 구조와 승격 후보 1~10 목록이 그대로 유효하다.
- **−** "어느 엔진도 완주하지 못한 채 전 엔진이 조금씩 개선되는" 상태를 freeze 가 더 이상 막지 않는다. 그 방어는 순서 규칙 1·2 와 승격 후보 순서에만 남으며 둘 다 freeze 보다 강제력이 약하다.
- **−** Search live admin 실행이 형식상 freeze 밖이 된다. 다만 #1076 이 preview-only by design 으로 별도 종결했으므로 실질 변화는 없고, 되살리려면 새 결정이 필요하다.

**관련**:
- ADR 0046 — data-source profile/capability architecture (`DatabaseType` 판정 기준 소유)
- `docs/ROADMAP.md` — 순서 규칙 1·2·3, 승격 후보 1~10
- `memory/engineering/architecture/data-source/adding/memory.md` — 계약 10항목 게이트
- GitHub milestone 22.50 — freeze 밖 작업 실행 bucket
- #1070 / #1071 / #1072 — freeze 밖 판정 대상
- #1076 — Search `_delete_by_query` preview-only 종결
