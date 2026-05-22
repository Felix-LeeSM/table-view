# Phase 24: Index Write UI

> **상태: 계획** — TablePlus 패리티 7단계 중 4단계. Phase 22 게이트 +
> Phase 23 Safe Mode 위에 얹는 가장 작은 DDL cycle.

## 배경

`get_table_indexes` Read 인프라는 이미 구축됨 (`commands/rdb/schema.rs`).
인덱스 생성/삭제 UI 는 작은 cycle (단일 statement) 이라 Phase 22~23 의
게이트 패턴을 굳히는 첫 검증 케이스로 적합. 본 Phase 가 정착시키는 DDL
패턴을 Phase 25 (Constraint), Phase 26 (Trigger), Phase 27 (Table/Column)
이 그대로 답습한다.

근거: [`docs/tableplus-comparison.md`](../tableplus-comparison.md) Section H#4,
TablePlus `gui-tools/working-with-table/index.md`.

## 범위

- **Structure 패널 → Indexes 섹션 → "+ Index" / "− Index" 버튼**.
- **Index 생성 모달** — 컬럼 multi-select, UNIQUE 토글, 메서드 선택
  (`btree` / `hash` / `gin` / `gist` / `brin`), partial index `WHERE`
  표현식 입력, 인덱스 이름 (자동 생성 또는 수동).
- **Index 삭제** — 삭제 버튼 → Phase 22 Preview SQL → Phase 23 Safe Mode
  체크 → 트랜잭션 실행.
- **Backend command** — `create_index(connection_id, schema, table, index_def)`,
  `drop_index(connection_id, schema, index_name)`. Sprint 180 cancel-token
  레지스트리 통합 (긴 인덱스 빌드 취소).
- **Schema 트리 자동 갱신** — 생성/삭제 후 `list_indexes` 재실행, 트리
  invalidate.

## Out of Scope

- **Reindex** (`REINDEX`) — 별도 액션, Phase 후순위.
- **Concurrently 옵션** (`CREATE INDEX CONCURRENTLY`) — Phase 24 v2 또는
  사용자 요청 시. 본 Phase 는 standard `CREATE INDEX`.
- **MongoDB 인덱스** — 본 Phase 는 PG 한정. Mongo 인덱스 UI 는 별도 Phase.
- **인덱스 사용 통계** (`pg_stat_user_indexes`) — Metrics Board 영역.

## 작업 단위

- **Sprint 186** — `create_index` / `drop_index` Tauri command + Structure
  패널 모달 + 게이트 통합 + 단위 테스트 + e2e (PG 컨테이너).

## Exit Criteria

- BTree / UNIQUE / partial 인덱스 3종 생성 → 트리 갱신 → 삭제 → 트리 갱신
  의 round-trip 이 e2e 로 검증됨.
- Phase 22 Preview / Phase 23 Safe Mode 체크가 모든 DDL 에 일관 적용.
