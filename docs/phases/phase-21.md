# Phase 21: CSV / SQL / JSON Export

> **상태: 계획 (Sprint 181)** — TablePlus 패리티 7단계 중 1단계, 단판승.

## 배경

TablePlus 사용자가 데일리 워크플로에서 가장 자주 부딪히는 마찰 — "결과
그리드 → 파일" 의 부재. 결과 row 가 이미 메모리/페이지에 있으니 외부 변환
도구 없이 한 번에 파일로 떨어지길 기대하는 것이 표준. 본 Phase 가 그 갭을
1 sprint 단판승으로 닫는다.

근거: [`docs/tableplus-comparison.md`](../tableplus-comparison.md) Section H#1,
`docs/table_plus/gui-tools/import-and-export.md`.

## 범위

- 세 surface(`DataGrid`, `DocumentDataGrid`, `QueryResultGrid`)에 동일한
  `<ExportButton>` 마운트.
- 포맷: **CSV** (RFC 4180 + UTF-8 BOM), **TSV**, **SQL `INSERT`** (RDB 전용,
  ANSI 식별자 quoting), **JSON Array** (Mongo 전용, Extended JSON v2 Relaxed).
- 변환은 **Rust 측에서만** (`commands/export.rs`) — 결정론적 출력의 단일
  진실원.
- Sprint 180 cancel-token 레지스트리 재사용 — 대용량 export 도 취소 가능.
- `tauri-plugin-dialog` 의 `save` API 통합, 기본 파일명
  `<context>_<YYYYMMDD-HHMMSS>.<ext>`.

## Out of Scope (Phase 22 이후)

- **Data import** (CSV → 테이블) — 별도.
- **전체 테이블 export** (페이지 가로지르는 fetch-all + stream) — Phase 21
  은 "현재 화면 row" 만.
- Excel / Parquet / XML / 압축.
- Schema export (`pg_dump` 통합) — Phase 후순위.

## 작업 단위

- **Sprint 181** — `commands/export.rs` + `csv = "1"` crate + `<ExportButton>`
  + 세 surface 통합 + 단위 테스트 15+ 케이스. 자세한 acceptance contract:
  [`sprints/sprint-181/contract.md`](../sprints/sprint-181/contract.md).

## Exit Criteria

- 세 surface 의 결과 영역 우상단에 ExportButton 노출, 4 포맷 동작.
- RFC 4180 CSV / Extended JSON v2 Relaxed 단위 테스트 100% green.
- TablePlus 와 동등한 출력으로 외부 도구(numbers / Excel / `psql -f` /
  `mongoimport`) 가 import 가능 — operator smoke 7-step 통과.
