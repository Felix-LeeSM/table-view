# Phase 27: Table / Column DDL UI

> **상태: 계획** — TablePlus 패리티 7단계 중 7단계 (마지막).
> **본 Phase 종료 시점이 TablePlus `working-with-table` 영역 패리티
> 달성 마일스톤.**

## 배경

가장 큰 수술 — 테이블 자체의 생성·이름변경·삭제, 컬럼 추가·수정·삭제.
Phase 22 게이트 / Phase 23 Safe Mode / Phase 24~26 의 DDL 패턴이 모두
정착된 시점에서 그 인프라를 활용해 가장 사용자-가시 surface 를 닫는다.
이 Phase 가 끝나면 TablePlus `gui-tools/working-with-table/{table,column,row,
constraint,index,trigger}.md` 6 영역 모두 동등 수준 도달.

근거: [`docs/tableplus-comparison.md`](../tableplus-comparison.md) Section H#7,
TablePlus `gui-tools/working-with-table/{table,column}.md`.

## 범위

- **Table CRUD 모달**:
  - **Create**: 이름 + 컬럼 정의 N개 + 즉시 PK / Unique / Check 추가
    (Phase 25 모달 재사용).
  - **Rename**: 인플레이스 rename (트리에서 더블클릭 또는 메뉴).
  - **Drop**: typing confirm (Phase 23 Safe Mode 패턴) + CASCADE preview
    (의존 객체 표시).
- **Column 편집기**:
  - **Add**: 이름 / 타입 (PG type picker) / NULL 여부 / DEFAULT / CHECK
    표현식.
  - **Modify**: 타입 변경 (USING 캐스트 표현식 입력 가능), nullability,
    default 변경. 충돌 가능성 사전 표시 (예: NULL → NOT NULL 인데 NULL 행
    존재).
  - **Drop**: typing confirm + CASCADE 영향 표시.
- **Backend command** — `create_table`, `rename_table`, `drop_table`,
  `add_column`, `alter_column`, `drop_column`. 모두 트랜잭션 단위, Sprint
  180 cancel-token 통합.
- **Schema 트리 갱신** — Phase 24~26 패턴.
- **Multi-step 트랜잭션** — Column 변경이 여러 statement 로 분해될 때
  (예: 타입 변경 + USING) 단일 트랜잭션으로 묶음. 실패 시 자동 ROLLBACK.

## Out of Scope

- **PARTITION** — 본 Phase 는 standard table 한정.
- **MATERIALIZED VIEW** — 별도 entity, 본 Phase 외.
- **TABLESPACE / 스토리지 옵션** — 고급 옵션, Phase 후순위.
- **TEMP TABLE** — out.
- **컬럼 reorder (`ALTER TABLE … ALTER COLUMN POSITION`)** — PG 는 native
  지원 없음 (recreate 필요), out.
- **MongoDB collection schema validation** — Mongo 측 패러다임 다름, 별도.

## 작업 단위

- **Sprint 189** — Table CRUD (create / rename / drop) + 게이트.
- **Sprint 190** — Column 편집기 (add / drop) + 트리 갱신.
- **Sprint 191** — Column modify (alter, USING) + multi-step 트랜잭션 +
  e2e 종합 + 패리티 마일스톤 평가.

## Exit Criteria

- TablePlus `working-with-table/{table,column,row,constraint,index,trigger}.md`
  의 모든 동작이 Table View 에서 동등 수준 가능 — 운영자 시나리오 smoke 가
  일대일 매핑 표를 통과.
- Phase 21~26 의 패턴이 깨지지 않음 (회귀 0).
- Phase 17~20 (MySQL / MariaDB / SQLite / Oracle) 재개 평가 — 본 Phase
  종료 시점에 신규 DBMS 추가의 비용/가치 재산정.
- TablePlus 패리티 달성 자축 기록 — `memory/lessons/` 에 회고 1편.
