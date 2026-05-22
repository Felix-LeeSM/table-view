# Phase 25: Constraint Write UI

> **상태: 계획** — TablePlus 패리티 7단계 중 5단계. Phase 24 의 패턴을
> Constraint 영역으로 확장.

## 배경

`get_table_constraints` Read 인프라는 이미 있고, Phase 24 가 Index Write
UI 의 패턴을 굳혀준다. 본 Phase 는 그 패턴을 PK / FK / Check / Unique 4종
constraint 의 추가/삭제 UI 에 그대로 답습.

근거: [`docs/tableplus-comparison.md`](../tableplus-comparison.md) Section H#5,
TablePlus `gui-tools/working-with-table/constraint.md`.

## 범위

- **Structure 패널 → Constraints 섹션 → "+ / −" 버튼**.
- **Constraint 추가 모달** — 종류별 폼:
  - **Primary Key**: 컬럼 multi-select.
  - **Foreign Key**: source 컬럼 + target 스키마/테이블/컬럼 + ON UPDATE / ON DELETE 동작.
  - **Check**: 표현식 입력 (CodeMirror SQL 모드).
  - **Unique**: 컬럼 multi-select.
- **Constraint 삭제** — Phase 22 Preview → Phase 23 Safe Mode → 트랜잭션.
- **Backend command** — `add_constraint(connection_id, schema, table, constraint_def)`,
  `drop_constraint(connection_id, schema, table, constraint_name)`.
- **FK 동작 시각화** — Schema 트리에서 FK 가 가리키는 target 으로 점프
  (단, 본 Phase 는 backend write 가 핵심, 시각화는 Phase 후순위 옵션).
- **Schema 트리 자동 갱신** — Phase 24 와 동일 패턴.

## Out of Scope

- **DEFERRABLE / INITIALLY DEFERRED** — 고급 옵션, Phase 후순위.
- **Exclusion constraint** (PG `EXCLUDE USING gist`) — 본 Phase 는 4 표준
  constraint 한정.
- **NOT NULL / DEFAULT 컬럼 속성** — Phase 27 (Column DDL) 영역.
- **Constraint 위반 행 검출** ("이 FK 추가가 가능한가" 사전 점검) — out.
  사용자가 Preview SQL 을 보고 판단.

## 작업 단위

- **Sprint 187** — `add_constraint` / `drop_constraint` command + Structure
  패널 모달 4종 + 게이트 통합 + 단위 테스트 + e2e (PG 컨테이너).

## Exit Criteria

- PK / FK / Check / Unique 4종 추가/삭제 round-trip e2e 통과.
- FK 의 ON UPDATE / ON DELETE 옵션이 모달에서 노출되고 SQL 에 반영.
- 게이트 패턴이 Phase 24 와 100% 동일 (코드 중복 없음 — 공통 hook 또는
  컴포넌트로 추출).
