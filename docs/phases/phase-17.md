# Phase 17: MySQL 어댑터 지원

> **상태: 보류 (2026-05-01 결정)** — TablePlus 패리티 우선 정책으로 Phase
> 21–27 종료까지 보류. 이전 상태는 "계획" (phase-9 F-Refactor + MySQL 승계).
> Phase 27 종료 시 재개 평가. 본 문서 본문은 동결, 재개 시 갱신.

## 배경

Phase 9 초안에서 MySQL + SQLite를 한 phase로 묶었지만, 현실적으로 (1) RDB trait 일반화 리팩터(F-Refactor)가 선행 필요, (2) MySQL과 SQLite는 connection model이 본질적으로 다름(host/port vs file path), (3) 각각 e2e/회귀 충분히 잠그려면 한 phase 분량이 필요해서 별도 phase로 분리.

판단 기준: "PostgreSQL 워크플로우(탐색/조회/편집/쿼리)를 MySQL 연결에서도 끊김 없이 반복할 수 있는가."

## 선행 작업: F-Refactor (RDB trait 일반화)

Phase 17 진입 전 Sprint 1-2개로 다음 추상화 마무리:

- `ConnectionConfig` variant 도입 (`Postgres`/`Mysql`/`Sqlite` enum, 또는 trait + concrete struct).
- `AlterTableRequest`, `FilterCondition` 등 PG-shaped DTO를 dialect-agnostic 추상화.
- `make_adapter` factory가 paradigm + dialect 모두 분기.

Phase 9 초안 F-Refactor 섹션 참조.

## 구현 항목

| Feature | ID | 우선순위 |
|---|---|---|
| F-Refactor — RDB trait 일반화 (선행) | F17.0 | P0 |
| MySQL 연결 폼 (host/port/socket/SSL/charset/database) | F17.1 | P0 |
| `MysqlAdapter` 구현 (`sqlx::mysql`) | F17.2 | P0 |
| MySQL database 사이드바 (`SHOW DATABASES` → 테이블 목록) | F17.3 | P0 |
| MySQL 조회/DDL (CREATE/ALTER/DROP TABLE 방언 흡수) | F17.4 | P0 |
| MySQL Indexes / Constraints / Foreign Keys | F17.5 | P1 |
| MySQL Views / Stored Procedures / Functions / Triggers | F17.6 | P2 |
| 타입 매핑 추상화 (PG ↔ MySQL → 공통 display/edit type) | F17.7 | P1 |
| 방언별 SQL preview (DROP TABLE, ALTER TABLE) | F17.8 | P2 |
| E2E — MySQL connection 생성 → 테이블 탐색/조회/편집 | F17.9 | P0 |

## Sprint 분해

| Sprint | 목적 |
|---|---|
| **171** | F-Refactor Part 1 — `ConnectionConfig` variant 도입 + 기존 PG 회귀 보장. |
| **172** | F-Refactor Part 2 — DDL DTO + factory 패턴 일반화. |
| **173** | `MysqlAdapter` 최소 구현 (`connect`/`list_databases`/`list_tables`/`fetch_rows`) + 단위 테스트. |
| **174** | MySQL 연결 폼 + 사이드바 wiring + 조회 흐름 e2e. |
| **175** | MySQL DDL (CREATE/ALTER/DROP) + Indexes/Constraints. |
| **176** | MySQL Views/SP/Functions/Triggers (P2 — 시간 허락 시) + 타입 매핑 + Phase 17 closure. |

## Acceptance Criteria

- **AC-17-01** 사용자가 MySQL connection 생성 가능 (host/port/socket/SSL/charset/database 입력).
- **AC-17-02** MySQL connection 활성화 시 좌측 사이드바에 database 목록 → 테이블 목록 트리.
- **AC-17-03** 테이블 클릭 → records 조회 (Phase 13 preview tab semantics 준수).
- **AC-17-04** Filter / Sort / Pagination — PG 동치.
- **AC-17-05** Cell 편집 — UPDATE 쿼리로 commit (PG 흐름 동치).
- **AC-17-06** CREATE TABLE / ALTER TABLE / DROP TABLE — MySQL 방언 SQL 생성, preview dialog → execute.
- **AC-17-07** Foreign keys / indexes / constraints CRUD.
- **AC-17-08** Views / Stored Procedures / Functions / Triggers 목록 사이드바 (P2 — 부분 구현 허용).
- **AC-17-09** 모든 PG 회귀 테스트 green 유지 (F-Refactor 영향 없음).
- **AC-17-10** E2E — MySQL connection 시나리오 + cross-paradigm 회귀.

## TDD 정책

- F-Refactor 두 sprint(171/172) — PG 회귀 테스트가 안전망. trait 추상화 시 PG 테스트 1개 RED → wiring 후 green.
- MySQL adapter 신규 — `mockall` crate로 trait mocking. Rust 단위 테스트 80% 이상 커버리지 (testing.md 기준).
- React 측 — connection form, sidebar tree, query 흐름 모두 RTL 단위 테스트 + e2e.

## E2E 시나리오

| ID | 시나리오 |
|---|---|
| E17-01 | MySQL connection 폼 작성 → 활성화 → 사이드바 데이터베이스/테이블 목록 노출 |
| E17-02 | 테이블 클릭 → 행 조회 → cell 편집 → 변경 commit |
| E17-03 | CREATE TABLE → SQL preview → execute → 사이드바 갱신 |
| E17-04 | ALTER TABLE (column 추가) → preview → execute |
| E17-05 | DROP TABLE 확인 modal → execute |
| E17-06 | PG와 MySQL 두 connection 동시 활성화 → tab paradigm 분리 정상 |

## 위험 / 미정 사항

- **R17.1** F-Refactor 영향 범위 큼. Phase 5/6 코드 다수 수정. PG 회귀 테스트 의존.
- **R17.2** `sqlx::mysql` vs `mysql_async` 선택. ADR 0014 후보.
- **R17.3** Trigger은 PG에 없음 — MySQL에서만 노출되는 UI 분기 필요.

## Phase Exit Gate

Skip-zero, AC-17-01..10 잠금, PG 회귀 green, e2e MySQL suite green, ADR (어댑터 라이브러리 선택) 동결.
