# Phase 19: SQLite 어댑터 지원

> **상태: 보류 -> 재평가 대기 (2026-05-22 re-baseline)** — TablePlus
> 패리티 우선 정책으로 보류됐고 Phase 27 종료로 재개 평가 트리거는 이미
> 발동했다. 과거 sprint 번호는 retire 되었으므로 아래 구현 분해는
> slice 단위로만 유지한다.

## 배경

SQLite는 file-based RDBMS. host/port 모델 없음 → connection form 자체가
다름(파일 경로 picker). 또한 단일 namespace(`main` + attached DB) 모델이라
`NamespaceLabel::Single` 추상화 활용. 이 phase 는 **사용자 DBMS adapter** 만
다룬다. `docs/state-management-strategy-2026-05-15.md` 의 internal app
SQLite state store 이주는 별도 track 이며 cargo/sqlx feature 충돌 여부만
공유 dependency 로 본다.

판단 기준: "사용자가 SQLite 파일을 선택하면 즉시 테이블 탐색/조회/편집이 가능한가."

## 구현 항목

| Feature | ID | 우선순위 |
|---|---|---|
| SQLite connection form (파일 경로 picker + 읽기 전용 토글) | F19.1 | P0 |
| `SqliteAdapter` 구현 (`sqlx::sqlite`) | F19.2 | P0 |
| 단일 namespace + attached DB 사이드바 | F19.3 | P0 |
| 제한된 ALTER TABLE (SQLite는 column drop / rename 제약) | F19.4 | P0 |
| 미지원 DDL UI에서 disabled + tooltip 안내 | F19.5 | P1 |
| In-memory mode 지원 (`:memory:`) | F19.6 | P2 |
| SQLite 전용 PRAGMA UI (foreign_keys / journal_mode 등) | F19.7 | P2 |
| E2E — file 선택 → 테이블 탐색 → cell 편집 | F19.8 | P0 |

## Slice 분해

| Slice | 목적 |
|---|---|
| **19A** | `ConnectionConfig` SQLite variant + Tauri file picker + read-only contract. |
| **19B** | `SqliteAdapter` + `sqlx::sqlite` test harness + read/write mode. |
| **19C** | UI wiring + single namespace / attached DB sidebar + disabled unsupported DDL actions. |
| **19D** | E2E + optional `:memory:` / PRAGMA UI + phase closure. |

## Acceptance Criteria

- **AC-19-01** Connection 폼에서 "SQLite" 선택 → 파일 picker (Tauri dialog API) 노출.
- **AC-19-02** 읽기 전용 토글 — 활성화 시 모든 DDL/UPDATE 액션 disabled.
- **AC-19-03** 사이드바에 단일 `main` namespace 표시 + attached DB 있으면 추가.
- **AC-19-04** 테이블 조회 / cell 편집 / sort / filter — PG/MySQL 동치.
- **AC-19-05** ALTER TABLE column drop 시 — SQLite는 미지원이므로 UI에서 disabled + tooltip "SQLite에서 column 삭제는 테이블 재생성 필요". 또는 자동 fallback (CREATE+INSERT+DROP+RENAME) — ADR로 결정.
- **AC-19-06** PG/MySQL 회귀 green.
- **AC-19-07** In-memory mode (`:memory:`) connection — 세션 종료 시 데이터 휘발 명시.
- **AC-19-08** E2E SQLite 시나리오.

## TDD 정책

- File picker mock으로 단위 테스트.
- `SqliteAdapter` 단위 — `sqlx::sqlite` in-memory로 통합 테스트.
- 미지원 액션 disabled UI는 RTL `expect(button).toBeDisabled()` 단언.

## E2E 시나리오

| ID | 시나리오 |
|---|---|
| E19-01 | SQLite 파일 선택 → 테이블 목록 노출 |
| E19-02 | 테이블 cell 편집 → UPDATE 반영 |
| E19-03 | CREATE TABLE → SQLite 방언 SQL preview → execute |
| E19-04 | ALTER TABLE column drop 시도 → tooltip 표시 또는 자동 fallback |
| E19-05 | 읽기 전용 모드 → 모든 편집 액션 disabled |
| E19-06 | In-memory connection — 데이터 휘발 확인 |

## 위험 / 미정 사항

- **R19.1** ALTER TABLE column drop fallback 정책 ADR — 기본 disabled vs 자동 재생성.
- **R19.2** Tauri file picker permission scope 설정 (`tauri.conf.json` allowList).
- **R19.3** Internal app SQLite state-management track 과 Cargo feature /
  migration naming 충돌 가능 — Phase 19A 에서 dependency check.

## Phase Exit Gate

Skip-zero, AC-19-01..08 잠금, PG/MySQL 회귀 green, e2e SQLite suite green.
