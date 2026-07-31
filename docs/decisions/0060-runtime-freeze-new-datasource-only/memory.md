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

- **freeze 밖 (지금 착수 가능)**: 이미 active 인 `DatabaseType` 의 capability 확장 전부. MSSQL 구조적 DDL (#1071), Oracle 런타임 슬라이스 해제 (#1072), DuckDB DDL/batch/introspection (#1070), Redis/Valkey 잔여 축, Search index/settings admin 실행, 기존 엔진의 admin/import-export/profiler 확장이 모두 여기 속한다. 판정 기준은 `src/types/dataSource.ts` 의 active profile 목록이다 — 기계적으로 판정하고 회색지대 해석을 남기지 않는다.
- **freeze 안**: 새 `DatabaseType`/profile 추가. 현재 대상은 wider candidate 5종 (Cassandra/Scylla, DynamoDB, graph, vector, stream).
- **ladder 와 freeze 를 분리한다**: 승격 후보 1 의 one-DBMS query/workbench parity ladder 와 고정 lane 순서 (PostgreSQL → MySQL/MariaDB → SQLite/DuckDB → MongoDB) 는 유지하되, 이제 **freeze 의 강제 대상이 아니라 깊이 작업 우선순위 권고**다. 네 lane 모두 이미 active `DatabaseType` 이므로 freeze 로는 아무것도 막지 않는다. "active lane 하나만 연다" 는 제약도 freeze 밖 작업에 적용하지 않는다.
- **freeze 는 착수 게이트일 뿐 승격 게이트가 아니다**: freeze 밖이라고 해서 support claim 이 자동으로 넓어지지 않는다. 각 source 의 runtime/parser/completion/edit/fixture/e2e/docs evidence 요구는 그대로다.
- **별도 게이트 유지**: wider candidate 는 freeze 와 무관하게 `memory/engineering/architecture/data-source/adding/memory.md` 의 Required Contract 10항목 (Profile / Connection / Adapter / Language / Catalog / Result envelope / Safety policy / Fixtures / Conformance / Docs-memory) lock 을 통과해야 구현을 시작한다. `docs/ROADMAP.md` candidate 인벤토리가 채운 것은 profile target / connection kind / language / catalog model / result envelope / safety-fixture 계획이고, 미충족은 **Adapter · Conformance · Docs-memory** 3항목이다. freeze 를 푼다고 이 게이트가 풀리지 않는다.
- **실행 bucket**: freeze 밖 작업은 성격에 따라 GitHub milestone **22.50 "DBMS Parity - 엔진별 결손"** (엔진별 빠진 축) 또는 **22.80 "Admin Parity - 단계 승격"** (admin/import-export/profiler) 이 소유한다.

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
- **+** H1~H7 지평 구조와 승격 후보 1~10 목록이 그대로 유효하다.
- **−** "어느 엔진도 완주하지 못한 채 전 엔진이 조금씩 개선되는" 상태를 freeze 가 더 이상 막지 않는다. 그 방어는 순서 규칙 1·2 와 승격 후보 순서에만 남으며 둘 다 freeze 보다 강제력이 약하다.
- **−** ladder 가 강제에서 권고로 내려간다. 고정 lane 순서를 어기는 작업이 규칙 위반이 아니게 되므로, 깊이 우선 판단은 매 선택마다 사람이 해야 한다.
- **−** Search index/settings admin 실행이 freeze 밖이 되지만 착수를 뜻하지는 않는다. `docs/ROADMAP.md` Search gate 가 요구하는 admin destructive 실행 정책과 observability/profile-explain 계약이 여전히 선행이다.

**관련**:
- ADR 0046 — data-source profile/capability architecture (`DatabaseType` 판정 기준 소유)
- `docs/ROADMAP.md` — 순서 규칙 1·2·3, 승격 후보 1~10, Search live admin/smoke promotion gate
- `memory/engineering/architecture/data-source/adding/memory.md` — Required Contract 10항목 게이트
- GitHub milestone 22.50 / 22.80 — freeze 밖 작업 실행 bucket
- #1070 / #1071 / #1072 — freeze 밖 판정 대상
- #1076 — Search live `_delete_by_query` 실행 승격 결정. 실행 경로는 `src-tauri/src/commands/search.rs:215` 로 shipped 이며, deferred 로 남은 것은 그 범위 밖이던 index/settings admin 실행이다
