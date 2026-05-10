# Sprint 238 — DataGrid Cell Layout Policy Lock — Evaluator Findings

Date: 2026-05-10
Final commit: `2a45382` ("fix(sprint-238): Document grid 도 min-w-full 제거 (AC-238-11)")
Spec: `docs/sprints/sprint-238/spec.md` (locked at session start)
Contract: `docs/sprints/sprint-238/contract.md`
Execution brief: `docs/sprints/sprint-238/execution-brief.md`

## Sprint 238 Evaluation Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| **Correctness** (35%) | 9/10 | 12/12 acceptance criteria implemented and verified by unit + integration tests. Backend category SoT (Rust `ColumnCategory` + PG/Mongo mappers) decoupled from raw `data_type` per AC-238-02 비회귀 제약 — Structure/Records 뷰는 변경 0 (raw data_type 그대로). (c) 산식 mount-only via `useColumnWidths` + `useLayoutEffect`, no recalc on container resize. Drag-resize commits per-column (`setWidth(name, px)`) replacing the pre-238 batched updater — column independence holds. Toolbar "Reset column widths" wired via `forwardRef` + `useImperativeHandle` (single-direction call into DataGridTable; no shared zustand). One small wart: ColumnInfo.category is *optional* on the TS side (`category?: ColumnCategory`) for back-compat with fixtures that predate the field — production wire-format always populates it via `#[serde(default)]` Unknown fallback, so the `?? "unknown"` fallback in DataGridTable / HeaderRow / DataRow is real-world unreachable on PG/Mongo paths but keeps tests / older payloads parsing. |
| **Completeness** (25%) | 9/10 | 모든 AC-238-01..12 다뤄졌고 Out of Scope 항목은 spec 에 명시되어 다음 sprint 로 이월 (raw data_type DDL-level 노출, BigInt wire-format, Document grid 의 (c) 산식 적용, schema 자동 감지). Document grid 는 AC-238-11 (`min-w-full` 제거) 만 적용 — spec 의 `Components to Modify` 가 RDB grid 중심이라 Document 의 category-driven widths 는 의도적으로 보류. text-align 카테고리 적용은 DataRow 만 (DocumentDataGrid 는 미적용 — Document 에 category 가 도달해 있으나 DataGrid 와 달리 widths 통합 대상에서 빠지면서 text-align 도 함께 빠짐). 다음 sprint 의 cleanup 후보. |
| **Reliability** (20%) | 8/10 | jsdom rootFontSize NaN fallback (`16px`) — 환경 격차 흡수. ref 가 null 로 시작하는 production 경로를 useLayoutEffect 로 보강 (lazy useState init 만으로는 ref 가 첫 render 시점에 비어있음). drag 가 음수로 흐르면 `Math.max(0, ...)` 으로 floor — AC-238-04 user-free policy 와 일관 (시각 가드는 inline `min-width: MIN_COL_WIDTH` 가 담당). useImperativeHandle deps = `[resetColumnWidths]` 로 callback identity 안정. **Gap**: container 폭 변동 (사이드바 toggle, viewport resize) 은 의도적으로 무시 (AC-238-04) — 사용자가 toolbar reset 으로 명시 트리거. 이 정책은 spec 에 정렬되나, 일부 사용자에게는 학습 곡선 — 향후 tooltip/onboarding 검토 가능. |
| **Verification Quality** (20%) | 8/10 | TS: 3177 → 3176 tests (column-resize 가 3 테스트 → 2 테스트, 하나는 통합/DOM 단언으로 흡수). 신규 단위 테스트: `useColumnWidths.test` (3, mount/drag/reset), `columnCategory.test` (23, lookup + (c) 산식 6 케이스), `jsonCell.test` (10, circular/BigInt/Symbol/nested). 신규 컴포넌트 테스트: DataGridToolbar reset 버튼 렌더링/onClick (3). 회귀 테스트 갱신: column-resize.test 가 prop-mock 단언 → DOM `<th> style.width` 단언 (실제 사용자 가시 동작), DataGrid.refetch-overlay.test 의 MIN_COL_WIDTH clamp 단언 → finite/≥0 (AC-238-04 반영). Rust: PG `map_pg_data_type` (10 케이스) / Mongo `map_mongo_data_type` (8 케이스) + `ColumnCategory` snake_case serialization 단언. **Gap**: AC-238-08 text-align 의 DOM-level 통합 테스트 부재 — `DataRow` 가 category → `text-right` / `text-center` 클래스를 적용하는 경로는 unit 테스트는 있으나 (columnCategory.test), 렌더링된 `<td className>` 단언은 없음. ColumnInfo.category 의 PG/Mongo 매퍼 wire 가 실제 schema fetcher 를 통과해 frontend 까지 간다는 e2e-level 단언도 없음 (하지만 정수 wire-format ID test 가 ColumnCategory 의 snake_case 직렬화는 잡아냄). |
| **Overall** | **8.6/10** | Weighted: 9×0.35 + 9×0.25 + 8×0.20 + 8×0.20 = 3.15 + 2.25 + 1.6 + 1.6 = 8.6. |

## Verdict: PASS

12개 AC 가 모두 구현·테스트되었고, 사용자 보고 #4 (RTL/스크롤 중 폭 변동) 의 진짜 trigger 였던 `min-w-full` 가 양쪽 grid 에서 제거되었다. (c) 산식은 mount-only 로 lock 되어 스크롤 중 폭 변동 회귀를 차단하며, drag-resize 는 column 독립성을 유지한다. category SoT 는 백엔드에 위치하여 frontend 가 dialect-aware 매핑을 모르며, raw `data_type` 은 Structure/Records 뷰에서 변경 0 으로 노출된다.

## Sprint Contract Status (AC-238-01..12)

- [x] **AC-238-01** Row 1줄 fixed — `line-clamp-3` 전 grid 에서 제거; ellipsis 1줄 정책 (DataRow / DocumentDataGrid / QueryResultGrid / EditableQueryResultGrid).
- [x] **AC-238-02** Type 카테고리 SoT 백엔드 — Rust `ColumnCategory` enum (snake_case serde), PG/Mongo `map_*_data_type`, `QueryColumn` + `ColumnInfo` 양쪽에 `category` 필드 (`#[serde(default)]` Unknown). 비회귀: Structure/Records 의 raw `data_type` 노출 변경 0.
- [x] **AC-238-03** (c) 산식 mount 1회 — `useColumnWidths(columns, containerRef)` + `useLayoutEffect`. sum < containerPx → 비례 확대, sum ≥ containerPx → defaults (horizontal scroll).
- [x] **AC-238-04** Drag-resize 한도 없음, 세션 메모리만 — `useColumnResize` → `setWidth(name, px)`. min/max 가드 0 (`Math.max(0, ...)` floor 만). container 폭 변동 시 재계산 안 함 — 스크롤 중 폭 변동 회귀 차단.
- [x] **AC-238-05** Char-truncate 폐기 — `truncateCell` + `CELL_DISPLAY_LIMIT` 삭제 (`src/lib/format.ts`).
- [x] **AC-238-06** Cell overflow CSS ellipsis — `overflow-hidden text-ellipsis whitespace-nowrap` + `dir="auto"` + `[unicode-bidi:isolate]` 4 grid 적용.
- [x] **AC-238-07** JSON / object 1줄 표현 — `safeStringifyCell` (`src/lib/jsonCell.ts`) circular / BigInt / Symbol → `"[unserializable]"` fallback.
- [x] **AC-238-08** text-align 카테고리 기반 — DataRow 만 (int/float → right, bool → center, else → left). Document grid 은 본 sprint scope 외.
- [x] **AC-238-09** Detail expansion 추가 안 함 — 기존 QuickLook 재사용, 새 popover/modal 없음.
- [x] **AC-238-10** NULL 표시 유지 — italic muted "NULL" 변경 0.
- [x] **AC-238-11** Column 독립성 + `min-w-full` 제거 — RDB + Document grid 양쪽 적용. drag-resize 가 인접 column 폭 침범 안 함 (column-resize.test 단언).
- [x] **AC-238-12** Column widths reset 액션 — DataGridToolbar `Columns3` 버튼 + `onResetColumnWidths` callback + DataGridTable `forwardRef` + `useImperativeHandle({ resetColumnWidths })`. cmd+R / F5 는 layout state 미관여 (data refetch 만).

## Out-of-Scope (Sprint 239+ 또는 별도 backlog)

spec 의 Out of Scope 섹션 그대로 이월 + 본 sprint 작업 중 발견된 추가 정리 항목:

- **Document grid (c) 산식 적용 + text-align** — DataGrid 와 달리 Document 는 `min-w-full` 제거만 받음. category 기반 widths 통합은 별도 sprint.
- **TS ColumnInfo.category 를 required 로 강제** — 현재 `?:` 옵션. 모든 fixtures 마이그레이션 후 strict 로 좁힐 수 있음.
- **AC-238-08 text-align DOM 통합 테스트** — `<td>` className 단언으로 회귀 가드.
- **container 폭 변동 시 재계산 정책 onboarding** — 사용자 학습 곡선 보강 (tooltip / 첫-사용 hint).
- **raw `data_type` DDL-level 노출** (serial / smallint / timestamptz) — PG `format_type(atttypid, atttypmod)` 경로 별도 sprint.
- **BigInt / Decimal128 wire-format 정밀도 보존** — IPC contract 변경 + 모든 cell renderer 수정 별도 sprint.
- **"Reset column widths" 키보드 단축키** — toolbar 버튼만, 단축키는 backlog.

## 구현 슬라이스 이력

본 sprint 의 vertical slice TDD 진행:

1. `feat(sprint-238): DataGrid layout 정책 lock — 백엔드 category SoT + 프론트 (c) 산식 foundation` (`38503ba`) — Trace bullet: ColumnCategory enum + PG/Mongo 매퍼 + `useColumnWidths` 기반.
2. `feat(sprint-238): cell ellipsis + truncateCell 폐기 (slice #8/#12)` (`79cd510`) — 4 grid ellipsis CSS, `truncateCell` 제거.
3. `feat(sprint-238): ColumnInfo category enrichment (slice #11)` (`bf96376`) — TableData 가 records 뷰까지 category 전달.
4. `feat(sprint-238): DataGridTable useColumnWidths 통합 (slice #9/#10)` (`b9dd160`) — drag-resize 새 API + min-w-full 제거 + reset imperative ref.
5. `fix(sprint-238): Document grid 도 min-w-full 제거 (AC-238-11)` (`2a45382`) — Document 측 spec 준수.
