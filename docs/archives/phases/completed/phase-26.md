# Phase 26: Trigger 관리

> **상태: 계획** — TablePlus 패리티 7단계 중 6단계. Phase 24~25 의 DDL UI
> 패턴을 Trigger 까지 확장.

## 배경

PG Trigger 는 Phase 21 시점까지 Read 도 미구현. Schema 트리에 Trigger
노드를 추가하고, Function Read (`get_function_source`) 와 동등한 수준의
Trigger Read + Write UI 를 제공한다. PG Trigger 는 Function 에 의존하므로
("trigger function" 패턴), Function CREATE/EDIT 도 본 Phase 의 부속으로
포함 가능 (재평가 시점에 결정).

근거: [`docs/tableplus-comparison.md`](../tableplus-comparison.md) Section H#6,
TablePlus `gui-tools/working-with-table/trigger.md`,
`gui-tools/database-objects/function.md`.

## 범위

- **Schema 트리에 Trigger 노드 추가** — 테이블 하위에 Triggers 섹션, 각
  trigger 표시 (이름, 타이밍 BEFORE/AFTER, 이벤트 INSERT/UPDATE/DELETE).
- **Backend Read** — `list_triggers(schema, table)`, `get_trigger_source(name)`.
  PG `pg_trigger` + `pg_proc` 조인.
- **Trigger 생성/수정 모달** — 타이밍 / 이벤트 / FOR EACH ROW|STATEMENT /
  WHEN 조건 / 호출할 function 선택 (또는 inline `CREATE FUNCTION` + trigger).
- **Trigger 삭제** — Phase 22 Preview → Phase 23 Safe Mode → 트랜잭션.
- **Function CREATE/EDIT** (옵션, 본 Phase 진입 시점에 재평가) — Trigger
  function 작성 흐름이 자연스러우려면 함께 진행. Sprint 분량은 Function
  편집기 = 1 sprint 추가 가능.

## Out of Scope

- **Event trigger** (database-level) — Phase 후순위.
- **Trigger 의존성 그래프 시각화** — out.
- **PL/pgSQL 디버거** — out (TablePlus 도 미지원).
- **MongoDB change streams** — Mongo 측 패러다임 다름, 별도.

## 작업 단위

- **Sprint 188** — Trigger Read (트리 + 패널) + Trigger Write 모달 + 게이트
  통합 + 단위/통합 테스트.
- **Sprint 188+1** (옵션) — Function CREATE/EDIT UI (Trigger function
  자연 흐름 우선).

## Exit Criteria

- Schema 트리에서 Trigger 노드가 렌더되고 source 가 보임.
- BEFORE INSERT / AFTER UPDATE 두 케이스 e2e round-trip 통과.
- Function CREATE/EDIT 가 본 Phase 에 포함된 경우 Trigger function 작성
  → Trigger 부착 한 흐름이 단일 sprint 안에서 가능.
