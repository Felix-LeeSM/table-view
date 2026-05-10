# Sprint 238 Spec — DataGrid Cell Layout 정책 lock

## Feature Description

DataGrid (RDB + Document) 의 cell rendering 이 긴 값 / 다국어 / 구조적 데이터 (JSON, array, subdoc) 입력 시 layout 을 깨뜨리고 있음 — 가로 폭 cap 부재 + char-truncate(200) 와 `line-clamp-3` 이 상호 무력화 (가로폭 통제가 없어 한 줄 200자 cell 이 grid layout 을 폭발시킴). RTL/emoji 도 스크롤 중 일시 layout 파손을 만든다 (#4 사용자 보고).

이 sprint 는 DataGrid cell 의 **render 정책 단일 모델**을 lock 하고 코드를 단순화한다. master plan 의 "TablePlus 워크플로우 끊김 없이" 기준에 맞춰 1줄 fixed 가 default.

## Sprint Breakdown

이 feature 는 **단일 sprint (Sprint 238)** 로 끝낸다 — detail expansion / cell editor / column sort / persist 등의 인접 영역은 별도 sprint 로 미루거나 (하단 Out of Scope) 기존 패턴 (QuickLook, edit mode) 을 그대로 재사용.

## Acceptance Criteria

### AC-238-01 — Row 높이 1줄 고정
- 모든 cell 이 1줄 high (CSS line) 로 고정 렌더. `line-clamp-3` 다줄 정책 제거.
- row 별 polymorphic height 없음 → virtualization 측정이 단순화.

### AC-238-02 — Type 카테고리 SoT 가 백엔드
- Rust `QueryColumn` 에 `category: ColumnCategory` enum 필드 **추가** (기존 `data_type` 은 그대로 유지 — 대체 아님).
- 8 종 lock: `int / float / text / bool / datetime / object / binary / enum / unknown` (uuid → text 흡수).
- 각 dialect adapter (PG / MySQL / SQLite / Mongo) 가 raw `data_type` 을 카테고리로 매핑.
- 미지 type 은 `unknown` fallback.
- **비회귀 제약**: `category` 는 DataGrid 의 display 정책 (폭 + text-align) 에만 사용한다. Structure / Records 뷰 등 type 자체를 노출하는 곳은 raw `data_type` 을 그대로 표시 — `category` 로 치환 금지 (예: uuid 컬럼은 structure 뷰에서 "uuid" 로 보여야 하고, "text" 가 아니다).

### AC-238-03 — Type 별 default rem 폭 및 초기 폭 산식
- bool 4 / int·binary 6 / float·enum 7.5 / datetime 11 / unknown 12.5 / text·object 15
- 초기 폭 산식 (mount 1회):
  1. 각 column 의 category default rem → `rootFontSize` (runtime `getComputedStyle(document.documentElement).fontSize`) 로 px 변환.
  2. `sum(defaultPx)` < `containerPx` 이면 전체 column 을 `containerPx / sum(defaultPx)` 비율로 비례 확대 — container 를 정확히 채움.
  3. `sum(defaultPx)` ≥ `containerPx` 이면 default 그대로 — horizontal scroll 허용.
- container 기준: DataGridTable wrapper div 실측 폭 (`ResizeObserver` 또는 `getBoundingClientRect()`).
- 구현 단위: `useColumnWidths(columns, containerRef)` 훅으로 분리.

### AC-238-04 — Drag-resize, 한도 없음, 세션 메모리만
- column header 끝의 drag handle 로 가로 폭 변경 가능.
- min/max 가드 0 (사용자 자유).
- 폭은 React state (또는 zustand session store) 에만 보관 — localStorage / 백엔드 storage 에 persist 안 함. Cold-boot 시 AC-238-03 산식으로 재계산.
- mount 후에는 **오직 drag-resize 만** column 폭을 변경한다. container 폭 변동 (사이드바 열림/닫힘, 창 resize) 은 재계산 trigger 가 아니다 — 스크롤 중 폭이 변하는 회귀를 차단.

### AC-238-05 — Char-truncate 폐기
- `truncateCell()`, `CELL_DISPLAY_LIMIT`, `line-clamp-3` 모두 제거.
- DOM 메모리 가드는 row-level virtualization 이 이미 담당 — display-layer 추가 cap 불요.

### AC-238-06 — Cell overflow 시 CSS ellipsis
- `overflow: hidden` + `text-overflow: ellipsis` + `white-space: nowrap` 1줄 정책.
- `dir="auto"` + `unicode-bidi: isolate` (cell 내부) — RTL 글자 자동 방향 + 인접 cell 간 bidi level 격리.
- DataGrid layout flow 자체 (행 번호, sort 화살표, drag handle) 는 LTR 고정.

### AC-238-07 — JSON / object cell 1줄 표현
- `JSON.stringify(value)` compact 한 줄 + try/catch 가드 (circular ref / BigInt → `"[unserializable]"` fallback).
- nested 도 deep recursive serialization (예: `{a:{b:{c:1}}}` → `'{"a":{"b":{"c":1}}}'`). `[Object object]` 누출 회귀 방지.
- Pretty print 는 QuickLook 에서 처리.

### AC-238-08 — text-align 카테고리 기반
- `int` / `float` 우편향 (`text-right`)
- `bool` 가운데 (`text-center`)
- 그 외 좌편향 (`text-left`)

### AC-238-09 — Detail expansion 추가 안 함
- 기존 QuickLook (`src/components/shared/QuickLookPanel/`) 재사용. 새 detail panel / popover / modal 만들지 않음.
- toolbar 의 `onToggleQuickLook` 으로 사용자가 row 풀텍스트 확인.

### AC-238-10 — NULL 표시 유지
- 기존 italic muted "NULL" 그대로.

### AC-238-11 — Column 독립성 (drag-resize 가 다른 column 폭에 영향 없음)
- 한 column 의 drag-resize 가 인접 column 의 폭을 침범하지 않는다.
- table 자체 폭은 sum(column widths) 만큼만:
  - mount 시: AC-238-03 (c) 산식으로 container 폭에 정확히 맞춤 (잔여 공간 0).
  - drag-shrink 후: sum < container → 우측 잔여 공간 (사용자 의도).
  - container 확장 후 (사이드바 닫힘 등): sum < container → 우측 잔여 공간 (재계산 안 함, AC-238-04).
  - sum > container: horizontal scroll.
- `<table className="...">` 의 `min-w-full` 클래스 제거 (RDB + Document grid 양쪽). `table-fixed` 만 남긴다 — `min-w-full` 이 width-redistribution 의 진짜 trigger (`table-layout: fixed` 만으로는 명시 width 들의 합이 container 보다 작을 때 빈 공간 분배 동작 발생). 제거하면 명시 width 가 그대로 유지되어 스크롤 중 폭 변동 회귀가 사라짐.

### AC-238-12 — Column widths reset 액션 (별도 트리거)
- 기존 cmd+R / F5 = data refetch 만 (현재 동작 유지). DataGridTable 리마운트 안 함, column widths state 보존.
- DataGridToolbar (`src/components/datagrid/DataGridToolbar.tsx`) 에 **"Reset column widths"** 버튼 추가:
  - 아이콘: column/grid 계열 (예: `Columns3` lucide).
  - 클릭 시 `useColumnWidths` 의 reset 액션 호출 → AC-238-03 (c) 산식 재실행.
  - tooltip: "Reset column widths to default".
  - records view (DataGrid) 한정 — structure view 는 (c) 산식 적용 대상 아니므로 노출 안 함.
- 키보드 단축키는 **이번 sprint scope 외** (별도 backlog). 사용자가 toolbar 버튼으로만 트리거.
- 사용자가 drag-resize 한 폭은 모두 폐기되고 (c) 산식 결과로 대체됨 — 명시적 의도이므로 confirm dialog 없음.

## Components to Create / Modify

### Rust (백엔드)
- `src-tauri/src/models/query.rs` (또는 동등 위치) — `ColumnCategory` enum 추가 + `QueryColumn::category` 필드
- `src-tauri/src/db/postgres.rs` — `data_type` → category 매핑
- `src-tauri/src/db/mysql.rs` — 매핑
- `src-tauri/src/db/sqlite.rs` — 매핑
- `src-tauri/src/db/mongo.rs` — Mongo BSON type → category 매핑
- 각 dialect 의 unit test 에 매핑 케이스 추가

### Frontend (TS)
- `src/types/query.ts` — `data_type` 옆에 `category: ColumnCategory` 타입 추가 (백엔드와 동기화)
- `src/lib/columnCategory.ts` (신규) — category → default rem 폭 lookup, category → text-align lookup. **data_type → category 매핑은 포함하지 않음** (백엔드 책임).
- `src/lib/jsonCell.ts` (신규) — `safeStringifyCell(value)` — circular / BigInt / Symbol 가드 한 줄 JSON 직렬화. (category 와 무관하므로 별도 파일.)
- `src/hooks/useColumnWidths.ts` (신규) — `useColumnWidths(columns, containerRef)`: mount 시 container 폭 + root font-size 측정, AC-238-03 (c) 산식 적용, drag-resize state 노출. **schema 변경 감지 없음** — within-instance 에서 columns prop 이 바뀌면 기존 column 은 state 보존, 새 column 은 category default 로 fallback (scaling 없음). cold-boot 재계산은 DataGridTable 리마운트 (tab/connection 전환 시 자연 발생) 로 트리거. 훅이 `reset()` 함수도 노출 — AC-238-12 toolbar 버튼이 호출.
- `src/components/datagrid/DataGridTable/DataRow.tsx` — `truncateCell` 제거, `line-clamp-3` 제거, ellipsis CSS, `dir="auto"` + `unicode-bidi: isolate`, JSON oneline + 가드
- `src/components/datagrid/DataGridTable/HeaderRow.tsx` — drag handle UI (resize)
- `src/components/datagrid/DataGridTable.tsx` — `useColumnWidths` 훅 wiring + `min-w-full` 제거. 폭 state 는 훅 내부 (외부 store 불요). `reset()` 함수를 props 또는 ref 로 노출해 toolbar 가 호출 가능하게 wiring.
- `src/components/datagrid/DataGridToolbar.tsx` — **"Reset column widths"** 버튼 추가 (`Columns3` 아이콘, tooltip). DataGrid 가 prop 으로 `onResetColumnWidths` 콜백 전달.
- `src/lib/format.ts` — `truncateCell` + `CELL_DISPLAY_LIMIT` 삭제

### 테스트
- `src/lib/columnCategory.test.ts` (신규) — category → rem 폭 / text-align lookup table 검증
- `src/lib/jsonCell.test.ts` (신규) — circular ref / BigInt / Symbol → `"[unserializable]"` fallback, nested deep serialization
- `src/hooks/useColumnWidths.test.ts` (신규) — (c) 산식 (sum < container 시 비례 확대 / sum ≥ container 시 default 유지), mount 1회 lock, container 폭 변동 시 재계산 안 함, drag 후 자기 column 만 변경, columns prop 변경 시 기존 column width 보존 + 새 column 은 category default 로 fallback (schema 자동 감지 없음), `reset()` 호출 시 (c) 산식 재실행 + drag 결과 폐기
- `src/components/datagrid/DataGridToolbar.test.tsx` — "Reset column widths" 버튼 렌더링 + onClick 시 콜백 호출
- `src/components/datagrid/DataGridTable/DataRow.test.tsx` — 1줄 정책, ellipsis, RTL bidi, NULL 유지, JSON oneline, edit 시 원본 가시
- Rust dialect 별 mapping unit test

## Data Flow

```
SELECT 쿼리 결과
  → Rust dialect adapter 가 raw data_type → ColumnCategory 매핑
  → IPC (`QueryColumn { name, data_type, category }`) 로 frontend 에 전송
  → Structure / Records 뷰는 raw data_type 노출
  → DataGrid: useColumnWidths(columns, containerRef) 훅이 mount 시
      ① container 폭 측정 (wrapper div getBoundingClientRect)
      ② root font-size 읽어 rem→px 변환
      ③ AC-238-03 (c) 산식: sum(defaultPx) < containerPx 면 비례 확대, 아니면 default 유지
  → category 별 text-align 적용
  → 1줄 fixed cell render (CSS ellipsis + bidi isolation)
  → 사용자 drag → 해당 column 만 width 변경 (persist 없음, 다른 column 영향 없음)
  → container 폭 변동 (사이드바 등) → 재계산 안 함, 잔여 공간 또는 scroll 허용
  → 사용자가 "Reset column widths" toolbar 버튼 → useColumnWidths.reset() → (c) 산식 재실행 (drag 결과 폐기)
  → cmd+R / F5 → data refetch 만 (layout state 건드리지 않음)
  → 긴 값 보고 싶으면 toolbar QuickLook 토글
  → 수정 시 원본 cell 그대로 edit mode (이미 분리된 layer)
```

## Edge Cases

1. **Backend 가 미지 raw type 반환** (예: postgres custom type) → category `unknown` fallback, rem 폭 12.5.
2. **Mongo 동적 schema** → 한 column 안에서 row 마다 다른 type. Mongo adapter 는 column 의 most-common type 기준 또는 fallback `unknown` (구체 정책은 generator 가 implementation 시 결정 — 단 unit test 로 행동 lock).
3. **Circular JSON / BigInt / Symbol** → try/catch → `"[unserializable]"` 한 줄 표시.
4. **RTL + LTR 혼합 cell** (예: 영문 SKU + 히브리어 description 동시 cell) → `dir="auto"` 가 첫 strong char 따라감. 사용자 시각적 일관성 ↓ 가능, 대신 격리는 보장.
5. **Drag 중 폭 0 미만** → 사용자 자유 정책 — 0 까지 허용. drag handle 자체는 항상 클릭 가능 (border 영역) 하게 z-index 보장.
6. **Drag 후 새 row 가 fetch** → 기존 width 유지 (column key 기반 state).
7. **Connection 전환 / table 전환** → DataGridTable 리마운트로 자연스럽게 cold-boot — AC-238-03 산식 재적용.
8. **같은 인스턴스에서 schema 변경** (within-tab 쿼리 교체, column 추가/삭제/리네임) → 기존 column 은 width state 보존 (column 이름 key), 새 column 은 category default 로 렌더 (scaling 없음). 사용자가 fresh layout 을 원하면 **toolbar "Reset column widths" 버튼** (AC-238-12) 으로 (c) 산식 재실행. cmd+R 은 data refetch 만 하고 layout 은 건드리지 않음. schema 자동 감지 로직 없음.
9. **Mount 후 container 폭 변동** (사이드바 열림/닫힘, 창 resize, 패널 분할) → 재계산 안 함 (AC-238-04). container 가 넓어지면 우측 잔여 공간, 좁아지면 horizontal scroll. 사용자 drag 로 적응.
10. **극단적 비율 — 적은 column × 넓은 container** (예: bool 1개 + text 1개, 1920px viewport) → (c) 산식이 비례 확대를 그대로 적용 (bool 도 함께 커짐). category default 비율은 보존되므로 시각적으로 grotesque 하지는 않으나, bool column 이 의도보다 넓어지는 trade-off 는 받아들인다 (사용자 drag-shrink 로 조정 가능).
11. **column 수가 0** (빈 결과 또는 schema-less Mongo collection) → 산식 분모 0 회피, container 폭 그대로 유지 (column header 줄만 빈 채로 렌더).

## Out of Scope (Sprint 239+ 또는 별도 backlog)

- Detail expansion 신규 UI (cell popover / row sidebar 등) — QuickLook 재사용
- Column width persist — 명시 lock
- Column reorder (drag-to-reorder)
- Column sort UI 변경
- Cell editor 수정 — 이미 별도 layer
- 사용자 보고 #1 (dry-run rolled back 메시지), #2 (connection 더블클릭 무시), #4 (RTL scroll glitch 의 다른 원인) — 각각 별도 sprint
- chip / badge 차별화 렌더링 (enum / array) — 추후 디자인 sprint
- monospace 강제 (uuid 등) — text 카테고리에서 자체 폭 충분, 미관 sprint 별도
- "Reset column widths" 키보드 단축키 — 이번 sprint 는 toolbar 버튼만 (AC-238-12). 단축키 (예: cmd+shift+R) 는 별도 backlog
- Structure view 의 column widths 정책 — 별도 컴포넌트 (ColumnsEditor 등) 사용 중, (c) 산식 적용 대상 아님. 필요 시 별도 sprint
- **`data_type` raw 노출 강화** — 현재 PG sqlx `type_info().to_string()` 은 "INT4" / "VARCHAR" / "TIMESTAMP" 같이 normalize 된 표시명을 반환. 사용자가 원하는 "serial" / "bigserial" / "smallint" / "timestamptz" 같이 DDL-level raw type 을 노출하려면 PG `pg_attribute` + `pg_type` join 으로 별도 조회 필요 (예: `format_type(atttypid, atttypmod)`). 이번 sprint 는 normalize 표시 그대로 통과시키고, raw 노출은 별도 sprint 에서 다룬다 (사용자 요청, 2026-05-10)
- **큰 정수 (i64 / bigint / Int64 / Decimal128) wire-format 정밀도 보존** — 현재 Rust → JSON → JS 경로에서 i64 가 JS Number 로 파싱되며 2^53 - 1 (Number.MAX_SAFE_INTEGER) 을 넘는 값이 손실됨. 백엔드가 큰 정수를 string 으로 직렬화하고 frontend 가 BigInt 로 parse 해서 cell 에 표시하는 변경은 IPC contract 변경 + 모든 cell renderer 수정 필요. 별도 sprint 에서 다룬다 (사용자 노트, 2026-05-10)
