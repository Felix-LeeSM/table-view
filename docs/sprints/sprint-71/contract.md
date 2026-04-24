# Sprint Contract: sprint-71 (Phase 6 plan D-2 — QuickLookPanel document mode + DocumentDataGrid 통합)

## Summary

- Goal: Sprint 70 에서 완성된 `BsonTreeViewer` 를 실제 제품 경로에 **배선**한다. 구체적으로 ①`QuickLookPanel` 이 paradigm-aware 해지도록 `mode` prop 을 도입하고, ②`DocumentDataGrid` 가 행 선택 + Cmd+L 토글 + QuickLookPanel 마운트를 지원하며, ③센티널 판정을 `isDocumentSentinel()` 헬퍼로 교체한다.
- Audience: `paradigm === "document"` 탭을 연 사용자가 RDB 탭과 동일한 체감(행 클릭 → Cmd+L → 상세 패널)으로 문서 전체 BSON 구조를 탐색할 수 있도록. Sprint 72(Find/Aggregate 쿼리 모드) 가 동일한 패널 인프라 위에 쿼리 결과를 얹는 전제 조건.
- Owner: Sprint 71 harness generator.
- Verification Profile: `command` (vitest 변경 파일 + tsc + lint + cargo 회귀. 전체 vitest suite 는 orchestrator 가 돌림).

Sprint 70 out-of-scope 에서 이관된 범위:
- `QuickLookPanel`의 `mode` prop 도입 및 document 렌더 분기
- `DocumentDataGrid` row selection, `isDocumentSentinel()` 헬퍼 교체

## In Scope

- `src/components/shared/QuickLookPanel.tsx` (수정)
  - Props 를 discriminated union 으로 확장: `mode: "rdb"` (기본) | `mode: "document"`.
  - `"rdb"`: 기존 API(`data: TableData`, `schema`, `table`) 유지. 동작 불변.
  - `"document"`: `rawDocuments: Record<string, unknown>[]`, `database: string`, `collection: string` 필수. 내부적으로 `firstSelectedId` 를 인덱스로 사용해 `rawDocuments[firstSelectedId]` 를 `BsonTreeViewer` 에 `value` 로 전달.
  - 헤더 라벨: document 모드에서 `{database}.{collection}` 형식 + `Document Details —` 프리픽스. multi-select 표시("N selected, showing first") 재사용.
  - 선택된 인덱스가 `rawDocuments` 범위 밖이거나 `rawDocuments` 가 빈 배열이면 `null` 을 넘겨 BsonTreeViewer 내장 빈 상태("No document selected")가 나타나도록.
- `src/components/shared/QuickLookPanel.test.tsx` (수정)
  - 기존 RDB 테스트는 **전부 보존** (회귀 방지). 필요 시 `describe("rdb mode")` 로 그룹핑만 추가.
  - 신규 `describe("document mode")` 블록에 최소 5 테스트.
- `src/components/DocumentDataGrid.tsx` (수정)
  - 로컬 상태 `selectedRowIds: Set<number>` + `showQuickLook: boolean` 도입.
  - 행 `<tr>` 클릭 시 `selectedRowIds` 토글 (단일 선택만; 기 선택 행 재클릭 시 해제). 선택 행은 `bg-accent` 류 하이라이트.
  - Cmd+L (Mac) / Ctrl+L (기타) 으로 `showQuickLook` 토글. `DataGrid.tsx` 의 Cmd+L 구현을 그대로 복제.
  - 하단에 `<QuickLookPanel mode="document" ... />` 조건부 마운트: `showQuickLook && selectedRowIds.size > 0 && queryResult`.
  - 센티널 판정 하드코딩(L179-181) 을 `isDocumentSentinel(cell)` 로 교체 (`src/types/document.ts` 에서 import).
  - 페이지 변경 시 `selectedRowIds` 리셋.
- `src/components/DocumentDataGrid.test.tsx` (신규)
  - 최소 6 테스트. `runFind` 는 `vi.mock("@stores/documentStore", ...)` 로 moking.

## Out of Scope

- `MongoAdapter::find / aggregate` 실제 구현 (현재는 Sprint 66 minimum find 로 충분히 동작 중) — Sprint 72.
- Find/Aggregate 쿼리 탭, CodeMirror JSON extension — Sprint 72.
- 인라인 편집, pending diff, MQL Preview, Add Document 모달 — Sprint 73.
- Column resize / sort / FK navigation 등 RDB DataGrid 전용 기능 (DocumentDataGrid 는 read-only 그리드 유지).
- Multi-row range selection (Shift+클릭, Ctrl/Cmd+클릭). 단일 선택만.
- keyboard arrow 로 행 이동 (↑/↓ 네비게이션).
- QuickLookPanel 의 리사이즈 드래그 handle 재작업 (기존 공통 로직 재사용).
- `BsonTreeViewer.tsx` 본체 수정 — Sprint 70 에서 확정.
- `schemaStore`, `tabStore`, `documentStore` 인터페이스 변경.

## Invariants

- RDB `DataGrid.tsx` 경로 기능 **완전 동일**. 기존 `QuickLookPanel` 호출(L383) 에서 `mode` 를 생략해도 정상 동작 (기본값 `"rdb"`).
- 기존 `QuickLookPanel.test.tsx` 의 15 테스트 전부 유지·통과.
- Sprint 70 `BsonTreeViewer.{tsx,test.tsx}` 파일 diff 0.
- `src/types/document.ts`, `src/stores/documentStore.ts` shape 불변.
- `DataGridTable.tsx`, `useDataGridEdit.ts` 등 RDB 편집 경로 diff 0.
- cargo / Rust 변경 0.
- React convention 준수: 함수 컴포넌트, `interface Props`, `any` 금지, `dark:` prefix 유지.

## Acceptance Criteria

- `AC-01` `QuickLookPanel` props 에 `mode` 필드 존재. `mode` 생략 시 기본적으로 기존 RDB 경로(`data`/`schema`/`table` 필수)가 동작하고 `mode: "document"` 를 주면 `rawDocuments`/`database`/`collection` 이 필수가 된다. TypeScript discriminated union 으로 구현해 타입 레벨에서 정확히 강제.
- `AC-02` `mode === "rdb"` (또는 생략) 분기에서 기존 15 테스트 시나리오(FieldRow, BLOB, JSON pretty print, multi-select indicator, close 버튼, empty selection, out-of-bounds 등) 모두 동일하게 통과.
- `AC-03` `mode === "document"` 분기에서 헤더는 `Document Details — {database}.{collection}` 이 표시되고, 본문에는 `BsonTreeViewer` 가 `role="tree"` 로 마운트된다.
- `AC-04` document 모드 + 선택 있음 + `rawDocuments[firstSelectedId]` 존재 → 해당 문서가 `BsonTreeViewer` 의 `value` 로 전달되어 최상위 필드 키들이 트리에 렌더된다 (예: `_id`, `name`).
- `AC-05` document 모드 + 선택 인덱스가 `rawDocuments` 범위 밖이거나 `rawDocuments` 가 빈 배열 → BsonTreeViewer 의 빈 상태 (`No document selected` 메시지 + tree role 유지) 가 렌더.
- `AC-06` document 모드에서 `selectedRowIds.size > 1` 이면 "N selected, showing first" 표시가 나타난다 (RDB 모드와 동일 UX).
- `AC-07` `DocumentDataGrid`: 문서 행 `<tr>` 클릭 → `selectedRowIds` 에 해당 인덱스가 토글(add/remove). 선택 상태의 행은 시각적 하이라이트(`aria-selected="true"` 또는 동등한 클래스).
- `AC-08` `DocumentDataGrid`: `Cmd+L` / `Ctrl+L` 키보드 입력 시 내부 `showQuickLook` 상태가 토글. 선택 있음 + `showQuickLook === true` 일 때만 `QuickLookPanel` 이 DOM 에 존재한다 (둘 중 하나라도 거짓이면 부재).
- `AC-09` `DocumentDataGrid`: cell 값이 `"{...}"` 또는 `"[N items]"` (정규식 `^\[\d+ items\]$`) 이면 muted 스타일 sentinel 렌더. 판정은 `isDocumentSentinel()` 헬퍼 호출로 일원화 (더 이상 인라인 정규식 없음). grep 으로 `^\[\\d\+ items\\]\$` 인라인 패턴이 `DocumentDataGrid.tsx` 에 없음을 확인 가능해야 함.
- `AC-10` 페이지 전환(Prev/Next) 시 `selectedRowIds` 가 빈 `Set` 으로 리셋(행 인덱스는 페이지 local 이므로 유지되면 잘못된 문서를 가리킴).
- `AC-11` Verification Plan 체크 5건 모두 통과.

## Design Bar / Quality Bar

- 선택 행 하이라이트: Tailwind 시맨틱 토큰(`bg-accent` 또는 `bg-muted`) 재사용. 새 색상 변수 도입 금지.
- `aria-selected` 속성으로 스크린 리더 지원.
- Cmd+L 키보드 핸들러는 `useEffect` cleanup 필수.
- `QuickLookPanel` discriminated union 에서 `mode` 를 `mode?: "rdb"` 처럼 선택적으로 두어 기본 호출 호환성 유지. TypeScript 추론으로 narrow 된 경우 필드명이 자동 구별되도록.
- BlobViewerDialog import 는 `"rdb"` 분기에서만 활성 — document 분기에서 렌더되지 않아야 함.

## Verification Plan

### Required Checks

1. `cd src-tauri && cargo fmt --all -- --check`
2. `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings`
3. `pnpm tsc --noEmit`
4. `pnpm lint`
5. `pnpm vitest run src/components/shared/QuickLookPanel.test.tsx src/components/DocumentDataGrid.test.tsx`

**Orchestrator 가 별도로 실행하는 체크 (generator 책임 아님)**:
- `cd src-tauri && cargo test --lib`
- `pnpm vitest run` (전체 suite 회귀 확인)

이 분리의 목적은 generator 의 단일 명령 idle-timeout 위험을 낮추는 것. generator 는 **변경 파일 범위에 한정**된 체크만 돌린다.

### Required Evidence

- Generator must provide:
  - 변경/추가 파일 목록과 역할
  - 5개 generator-scope check 실행 결과 (통과/실패 + 핵심 지표: 테스트 수, clippy warning 수)
  - 각 AC 에 대응하는 테스트 이름 + 파일 경로
  - `QuickLookPanel` discriminated union 의 타입 정의 위치 및 런타임 분기 위치
  - `DocumentDataGrid` 의 selection/Cmd+L/QuickLookPanel 마운트/sentinel 교체 위치 (파일:라인)
- Evaluator must cite:
  - `QuickLookPanel.test.tsx` 의 document mode 테스트 케이스 5+ 인용
  - `DocumentDataGrid.test.tsx` 의 selection/shortcut/sentinel 테스트 인용
  - Discriminated union 타입 정의 코드 스니펫
  - Invariant 증거: 기존 RDB `QuickLookPanel` 15 테스트가 여전히 pass 함 (test count 인용)
  - Orchestrator 가 돌린 전체 회귀 결과(handoff 에 인용되어야 함)

## Test Requirements

### Unit Tests (필수)

**QuickLookPanel (document mode 추가)**:
- AC-03: document 헤더 `Document Details — db.coll` 렌더.
- AC-04: `rawDocuments[0]` 의 최상위 키(`_id`, `name` 등)가 `role="tree"` 내부에 렌더.
- AC-05: 선택 인덱스 out-of-bounds → "No document selected" 메시지.
- AC-05 변형: `rawDocuments = []` → "No document selected".
- AC-06: `selectedRowIds = new Set([0, 1, 2])` → "3 selected, showing first" indicator.

**DocumentDataGrid (신규)**:
- AC-07: 행 클릭 → 선택 하이라이트 (`aria-selected="true"`), 재클릭 → 해제.
- AC-08 (a): Cmd+L 토글 → QuickLookPanel 마운트/언마운트. 선택 없으면 Cmd+L 을 눌러도 패널 미마운트 (선택 guard).
- AC-08 (b): 선택 후 Cmd+L → QuickLookPanel 내부에 BsonTreeViewer tree role 존재.
- AC-09: `{...}` 셀 + `[3 items]` 셀이 muted 스타일(또는 italic class) 로 렌더. 구현은 `isDocumentSentinel()` 호출 기반.
- AC-10: Next 클릭으로 페이지 전환 시 선택이 빈 Set 으로 리셋 (이전에 `aria-selected="true"` 였던 행이 다시 `aria-selected="false"` 또는 속성 부재).
- 회귀: 빈 `rows` 일 때 "No documents" 빈 상태 여전히 정상.

### Coverage Target

- `QuickLookPanel.tsx` (document 분기 포함): 라인 80% 이상.
- `DocumentDataGrid.tsx`: 라인 75% 이상.

### Scenario Tests (필수)

- [x] Happy path — 행 선택 → Cmd+L → BsonTreeViewer tree 렌더.
- [x] 에러/예외 — 선택 없이 Cmd+L, rawDocuments 빈 배열, out-of-bounds 인덱스.
- [x] 경계 — 다중 선택 indicator, sentinel cell 렌더, 페이지 전환 reset.
- [x] 기존 기능 회귀 없음 — 기존 QuickLookPanel RDB 테스트 15건 전부 유지, DataGrid.tsx 호출 시 `mode` 생략해도 타입 및 런타임 정상.

## Test Script / Repro Script

1. `pnpm vitest run src/components/shared/QuickLookPanel.test.tsx src/components/DocumentDataGrid.test.tsx`
2. `pnpm tsc --noEmit && pnpm lint`
3. `cd src-tauri && cargo fmt --all -- --check && cargo clippy --all-targets --all-features -- -D warnings`

## Ownership

- Generator: Sprint 71 harness generator.
- Write scope:
  - 수정: `src/components/shared/QuickLookPanel.tsx`, `src/components/shared/QuickLookPanel.test.tsx`, `src/components/DocumentDataGrid.tsx`
  - 신규: `src/components/DocumentDataGrid.test.tsx`
  - 그 외 파일 diff 금지. 특히 `DataGrid.tsx`, `DataGridTable.tsx`, `BsonTreeViewer.{tsx,test.tsx}`, `useDataGridEdit.ts`, `src/types/document.ts`, `src/stores/documentStore.ts` 는 **읽기만**.
- Merge order: Sprint 72(Find/Aggregate) 가 이 패널 + selection 인프라를 소비하므로 이 스프린트 PASS 후에만 Sprint 72 착수.

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes` (5개 generator-scope 체크 + orchestrator 가 돌리는 전체 회귀 2개)
- Acceptance criteria evidence linked in `handoff.md`
