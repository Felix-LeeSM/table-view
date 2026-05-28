# Phase 20: Oracle 어댑터 지원

> **상태: 보류 (2026-05-01 결정)** — TablePlus 패리티 우선 정책으로 Phase
> 21–27 종료까지 보류. 이전 상태는 "계획". Phase 27 종료 시 재개 평가.
> 본 문서 본문은 동결.

## 배경

Oracle은 SQL 방언 차이가 가장 큼 (PL/SQL, sequence + trigger 의존, 대소문자 보존, ROWNUM vs LIMIT, DUAL 테이블 등). Rust 생태계에서 Oracle driver는 `oracle` crate(thick client) 또는 ODBC 경유가 일반적. 사용자 관점에서 "Postgres 워크플로우와 끊김 없이 동치"를 보장하려면 dialect 흡수가 가장 무거운 phase.

판단 기준: "기업 사용자가 Oracle 연결을 PG와 구분 없이 활성화하고, 일상 워크플로우(탐색/조회/편집/쿼리)에서 unfamiliar 메시지 없이 동일하게 사용할 수 있는가."

## 전제

- Oracle Instant Client 설치 필요 (사용자 환경 의존). Tauri 빌드 시점에 lib path 명시.
- 라이센스 — Oracle Instant Client는 OTN 라이센스. 사용자가 직접 설치하도록 가이드 제공 (앱 번들에 포함 X).

## 구현 항목

| Feature | ID | 우선순위 |
|---|---|---|
| Oracle connection form (TNS / SID / Service Name / 인증 방식) | F20.1 | P0 |
| `OracleAdapter` 구현 (`oracle` crate 또는 ODBC) | F20.2 | P0 |
| Oracle schema 사이드바 (USER_TABLES / ALL_TABLES / DBA_TABLES) | F20.3 | P0 |
| ROWNUM 기반 pagination (LIMIT/OFFSET 미지원) | F20.4 | P0 |
| DUAL 테이블 special case 처리 | F20.5 | P1 |
| Sequence + Trigger 사이드바 노출 | F20.6 | P1 |
| PL/SQL block 실행 지원 (쿼리 에디터에서) | F20.7 | P2 |
| 대소문자 quoting (`"TableName"` vs `TABLENAME`) 정책 | F20.8 | P0 |
| Oracle 전용 데이터 타입 (CLOB / BLOB / NUMBER(p,s) / DATE) edit UX | F20.9 | P1 |
| E2E — Oracle connection 시나리오 (Docker container 기반 또는 mock) | F20.10 | P0 |

## Sprint 분해

| Sprint | 목적 |
|---|---|
| **184** | ADR — Oracle driver 선택 (`oracle` crate vs ODBC). Connection 폼 + variant 추가. |
| **185** | `OracleAdapter` 구현 + 단위 테스트 (mock or in-memory simulator). |
| **186** | 사이드바 + 조회 흐름 (ROWNUM pagination + DUAL 흡수). |
| **187** | DDL + 대소문자 quoting + 데이터 타입 UX. |
| **188** | PL/SQL 블록 실행 (P2) + Sequence/Trigger 사이드바. |
| **189** | E2E + Phase 20 closure + Phase 13~20 통합 회고 ADR. |

## Acceptance Criteria

- **AC-20-01** Oracle connection 폼 — TNS / SID / Service Name 분기 입력 가능.
- **AC-20-02** Connection 활성화 → 사이드바에 user schema 테이블 목록 (USER_TABLES).
- **AC-20-03** 테이블 조회 — ROWNUM 흡수해서 PG/MySQL과 동일 pagination UX.
- **AC-20-04** Cell 편집 — UPDATE + COMMIT (Oracle은 explicit commit 필요).
- **AC-20-05** CREATE/ALTER/DROP TABLE — Oracle 방언 SQL preview → execute.
- **AC-20-06** Sequence + Trigger 사이드바 노출 + 기본 CRUD.
- **AC-20-07** PL/SQL 블록 — 쿼리 에디터에서 BEGIN..END 실행 지원 (P2).
- **AC-20-08** 대소문자 — 사용자 입력 그대로 quote 또는 unquoted (config). 기본은 unquoted (대문자 캐논화).
- **AC-20-09** PG / MySQL / MariaDB / SQLite / Oracle 5개 connection 동시 활성화 회귀 green.
- **AC-20-10** E2E — Oracle Docker 컨테이너 또는 mock 기반 시나리오.

## TDD 정책

- Oracle adapter 단위 테스트는 `mockall` + simulated trait responses (실제 Oracle 컨테이너 회피).
- 통합/E2E는 Oracle XE Docker 이미지 (`gvenzl/oracle-xe`) 기반 별도 CI job.
- `oracle` crate 사용 시 thick client 의존성 → CI에 Instant Client install step 추가.

## E2E 시나리오

| ID | 시나리오 |
|---|---|
| E20-01 | Oracle XE 컨테이너 → connection 생성 → USER_TABLES 노출 |
| E20-02 | 테이블 cell 편집 → COMMIT → 재조회 시 반영 |
| E20-03 | ROWNUM pagination — 100행 테이블에서 페이지 이동 |
| E20-04 | Sequence CRUD — CREATE SEQUENCE → 사이드바 노출 |
| E20-05 | PL/SQL block — DBMS_OUTPUT 결과 확인 |
| E20-06 | 5개 paradigm/dialect 동시 connection 회귀 |

## 위험 / 미정 사항

- **R20.1** Oracle Instant Client 라이센스 — 사용자 설치 가이드 필수. README + INSTALL.md 갱신.
- **R20.2** thick client 의존 — Tauri 빌드 시점 dynamic library path 설정.
- **R20.3** 대소문자 정책 — TablePlus 기본 동작 조사 필요.
- **R20.4** Oracle 라이센스가 회사마다 다름 — 사용자 직접 동의 화면 추가 검토.
- **R20.5** Phase 20 종료 = 본 로드맵 완료. 후속 phase는 별도 PLAN 갱신 필요.

## Phase Exit Gate

Skip-zero, AC-20-01..10 잠금, PG/MySQL/MariaDB/SQLite 회귀 green, e2e Oracle suite green (Docker 기반), ADR (driver 선택 + 대소문자 정책) 동결, Phase 13~20 통합 회고 ADR.
