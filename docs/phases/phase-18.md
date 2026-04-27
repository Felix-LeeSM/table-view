# Phase 18: MariaDB 어댑터 지원

> **상태: 계획** — Phase 17(MySQL) 직후. 통상 MariaDB는 MySQL wire-compatible.

## 배경

MariaDB는 MySQL 5.5 fork에서 시작했고 wire protocol 호환. 대부분의 SQL 방언과 information_schema도 동치. 그러나 (1) `JSON` 타입 구현 차이, (2) sequence 객체(MariaDB 10.3+ 자체 SEQUENCE), (3) `CHECK` 제약 강제 차이, (4) 일부 시스템 함수 차이 등이 존재. 사용자 관점에서 "MariaDB 연결도 MySQL과 동일하게 동작" 보장이 핵심.

판단 기준: "사용자가 MariaDB connection을 MySQL과 구분 없이 활성화하고, version-specific 차이는 어댑터가 흡수해 UI는 동일한가."

## 전략

Phase 17의 `MysqlAdapter`를 base로 `MariaDbAdapter`를 (a) MySQL adapter 재사용 + dialect flag로 분기 또는 (b) 별도 adapter 신규 작성 중 결정. Sprint 177에서 ADR로 동결.

## 구현 항목

| Feature | ID | 우선순위 |
|---|---|---|
| MariaDB connection variant 도입 (Phase 17 ConnectionConfig 확장) | F18.1 | P0 |
| Server identity 자동 감지 (`SELECT VERSION()`) | F18.2 | P0 |
| `MariaDbAdapter` 또는 `MysqlAdapter` flag mode | F18.3 | P0 |
| MariaDB-specific SEQUENCE / JSON / CHECK 흡수 | F18.4 | P1 |
| Connection form에 MariaDB 옵션 (별도 dropdown 또는 자동 감지) | F18.5 | P0 |
| E2E — MariaDB connection 생성 → 시나리오 동치 | F18.6 | P0 |

## Sprint 분해

| Sprint | 목적 |
|---|---|
| **177** | ADR — Adapter 재사용 vs 별도 adapter 결정. ConnectionConfig variant 추가 + version 감지 단위 테스트. |
| **178** | Adapter wiring (재사용 결정 시 flag, 신규 시 trait impl). MariaDB-specific 흡수 (JSON / SEQUENCE / CHECK). |
| **179** | E2E + Phase 18 closure. |

## Acceptance Criteria

- **AC-18-01** MariaDB connection 폼에서 server type 선택 또는 자동 감지 (`SELECT VERSION()` 결과에 "MariaDB" 포함 시).
- **AC-18-02** Connection 활성화 후 MySQL Phase 17 시나리오 모두 동치 (E17-01..06 회귀 green on MariaDB).
- **AC-18-03** SEQUENCE 객체 — MariaDB에서만 노출 (사이드바 또는 nodes).
- **AC-18-04** JSON 타입 컬럼 — MariaDB JSON_VALID/JSON_EXTRACT 흡수.
- **AC-18-05** PG / MySQL / MariaDB 3개 connection 동시 활성화 회귀 green.
- **AC-18-06** ADR — adapter 전략 결정 동결.

## TDD 정책

- ADR 결정은 trade-off 명시(+ 코드 재사용 / − 분기 복잡도 vs + 격리 / − 중복).
- `MariaDbAdapter` 신규 시 테스트 80% 이상.
- Sprint 177 진단 테스트 — MariaDB 컨테이너 또는 mock으로 version 감지 cover.

## E2E 시나리오

E17-01..06 시나리오를 MariaDB 컨테이너로 1:1 회귀 + MariaDB-specific:

| ID | 시나리오 |
|---|---|
| E18-01 | MariaDB connection 생성 → server type 자동 감지 → 사이드바에 SEQUENCE 노출 |
| E18-02 | JSON 컬럼 cell 편집 → JSON_VALID 통과 |
| E18-03 | MySQL과 MariaDB 동시 connection — paradigm 분리 정상 |

## 위험 / 미정 사항

- **R18.1** Adapter 재사용 vs 신규 분기 트레이드오프 — ADR 0015 후보.
- **R18.2** Version 감지 실패 시 default fallback (MySQL 가정).

## Phase Exit Gate

Skip-zero, AC-18-01..06 잠금, e2e MariaDB suite green, ADR 동결.
