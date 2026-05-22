# Phase 18: MariaDB 어댑터 지원

> **상태: 보류 -> 재평가 대기 (2026-05-22 re-baseline)** — TablePlus
> 패리티 우선 정책으로 보류됐고 Phase 27 종료로 재개 평가 트리거는 이미
> 발동했다. 과거 sprint 번호는 retire 되었으므로 아래 구현 분해는
> slice 단위로만 유지한다.

## 배경

MariaDB는 MySQL 5.5 fork에서 시작했고 wire protocol 호환. 대부분의 SQL 방언과 information_schema도 동치. 그러나 (1) `JSON` 타입 구현 차이, (2) sequence 객체(MariaDB 10.3+ 자체 SEQUENCE), (3) `CHECK` 제약 강제 차이, (4) 일부 시스템 함수 차이 등이 존재. 사용자 관점에서 "MariaDB 연결도 MySQL과 동일하게 동작" 보장이 핵심.

판단 기준: "사용자가 MariaDB connection을 MySQL과 구분 없이 활성화하고, version-specific 차이는 어댑터가 흡수해 UI는 동일한가."

## 전략

Phase 17의 `MysqlAdapter`를 base로 **MySQL adapter 재사용 + MariaDB
identity/dialect flag** 를 default 전략으로 검증한다. `SELECT VERSION()` /
capability probe 로 MariaDB 를 감지하고, JSON / SEQUENCE / CHECK 차이는
adapter 내부 dialect profile 로 흡수한다. 별도 `MariaDbAdapter` 는 재사용
전략이 테스트/운영 복잡도를 키운다는 evidence 가 나올 때만 ADR 로 전환한다.

## 구현 항목

| Feature | ID | 우선순위 |
|---|---|---|
| MariaDB connection variant 도입 (Phase 17 ConnectionConfig 확장) | F18.1 | P0 |
| Server identity 자동 감지 (`SELECT VERSION()`) | F18.2 | P0 |
| `MariaDbAdapter` 또는 `MysqlAdapter` flag mode | F18.3 | P0 |
| MariaDB-specific SEQUENCE / JSON / CHECK 흡수 | F18.4 | P1 |
| Connection form에 MariaDB 옵션 (별도 dropdown 또는 자동 감지) | F18.5 | P0 |
| E2E — MariaDB connection 생성 → 시나리오 동치 | F18.6 | P0 |

## Slice 분해

| Slice | 목적 |
|---|---|
| **18A** | MariaDB `DatabaseType` / connection form / version detection. MySQL reuse 전략을 테스트로 고정. |
| **18B** | Adapter wiring: `MysqlAdapter` dialect flag + MariaDB JSON / CHECK / SEQUENCE behavior probes. |
| **18C** | MariaDB regression suite + PG/MySQL/MariaDB 동시 connection smoke + phase closure. |

## Acceptance Criteria

- **AC-18-01** MariaDB connection 폼에서 server type 선택 또는 자동 감지 (`SELECT VERSION()` 결과에 "MariaDB" 포함 시).
- **AC-18-02** Connection 활성화 후 MySQL Phase 17 시나리오 모두 동치 (E17-01..06 회귀 green on MariaDB).
- **AC-18-03** SEQUENCE 객체 — MariaDB에서만 노출 (사이드바 또는 nodes).
- **AC-18-04** JSON 타입 컬럼 — MariaDB JSON_VALID/JSON_EXTRACT 흡수.
- **AC-18-05** PG / MySQL / MariaDB 3개 connection 동시 활성화 회귀 green.
- **AC-18-06** Adapter reuse evidence 기록. 전용 adapter 로 전환하면 ADR 로
  결정 동결.

## TDD 정책

- Adapter reuse default 를 깨는 경우에만 ADR 작성. 깨지 않으면 slice handoff 에
  trade-off/evidence 기록.
- `MariaDbAdapter` 신규 시 테스트 80% 이상.
- Slice 18A 진단 테스트 — MariaDB 컨테이너 또는 mock으로 version 감지 cover.

## E2E 시나리오

E17-01..06 시나리오를 MariaDB 컨테이너로 1:1 회귀 + MariaDB-specific:

| ID | 시나리오 |
|---|---|
| E18-01 | MariaDB connection 생성 → server type 자동 감지 → 사이드바에 SEQUENCE 노출 |
| E18-02 | JSON 컬럼 cell 편집 → JSON_VALID 통과 |
| E18-03 | MySQL과 MariaDB 동시 connection — paradigm 분리 정상 |

## 위험 / 미정 사항

- **R18.1** Adapter 재사용이 MariaDB-specific branch 를 과도하게 늘릴 수 있음
  — evidence 발생 시 전용 adapter ADR.
- **R18.2** Version 감지 실패 시 default fallback (MySQL 가정).

## Phase Exit Gate

Skip-zero, AC-18-01..06 잠금, e2e MariaDB suite green, adapter strategy
evidence 기록. 전용 adapter 전환 시 ADR 동결.
