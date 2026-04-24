# Sprint 71 Handoff — Phase 6 plan D-2 (QuickLookPanel document mode + DocumentDataGrid 통합)

## Status: PASS (9.5/10)

Sprint 71 scope 의 generator-scope check 5개 전부 PASS. Orchestrator-scope 회귀(`cargo test --lib`, 전체 `pnpm vitest run`) 도 모두 clean. Evaluator 1차 PASS, P1/P2 findings 0 건.

## Changed Files

| File | Purpose |
|---|---|
| `src/components/shared/QuickLookPanel.tsx` | discriminated-union props (`QuickLookPanelRdbProps` | `QuickLookPanelDocumentProps`) 도입. `mode` 생략/`"rdb"` → 기존 FieldRow 경로, `mode === "document"` → BsonTreeViewer 마운트. 공통 resize handle · first-selected 로직은 최상위 wrapper 에서 공유. |
| `src/components/shared/QuickLookPanel.test.tsx` | 기존 16 RDB 테스트 전부 보존 (`describe("rdb mode")` 그룹핑, 본문 diff 없음). 신규 `describe("document mode")` 블록에 8 테스트 추가 — AC-03~AC-06 + BLOB 미노출 + close + region role 커버. |
| `src/components/DocumentDataGrid.tsx` | `selectedRowIds: Set<number>` + `showQuickLook: boolean` local state 도입. 행 클릭 단일-선택 토글(`aria-selected` + `bg-accent` 하이라이트), `Cmd+L` / `Ctrl+L` 핸들러 (cleanup 포함), 페이지 전환 시 selection reset, sentinel 판정을 `isDocumentSentinel()` 호출로 교체, 하단에 `<QuickLookPanel mode="document" ...>` 조건부 마운트. |
| `src/components/DocumentDataGrid.test.tsx` | 신규 8 테스트 — 네임스페이스 헤더, sentinel muted 렌더, 행 선택 토글, Cmd+L zero-selection guard, Cmd+L 토글 + BsonTreeViewer 마운트, 페이지 리셋, 빈 결과 상태, store hydration. |
| `docs/sprints/sprint-71/contract.md` | 스프린트 계약서 (신규). |
| `docs/sprints/sprint-71/execution-brief.md` | 생성자용 브리핑 (신규). |
| `docs/sprints/sprint-71/findings.md` | Evaluator 평가 결과 (PASS 9.5/10). |
| `docs/sprints/sprint-71/handoff.md` | 이 파일. |

변경 범위 제약 준수: `DataGrid.tsx`, `src/components/datagrid/**`, `BsonTreeViewer.{tsx,test.tsx}`, `src/types/document.ts`, `src/stores/**`, `src-tauri/**` **전부 diff 0**.

## Generator-scope Check Results

### 1. `cd src-tauri && cargo fmt --all -- --check`
PASS — stdout 없음.

### 2. `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings`
PASS — 0 warnings.

### 3. `pnpm tsc --noEmit`
PASS — 0 errors.

### 4. `pnpm lint`
PASS — 0 errors.

### 5. `pnpm vitest run src/components/shared/QuickLookPanel.test.tsx src/components/DocumentDataGrid.test.tsx`
PASS — Test Files 2 passed, Tests 32 passed (16 rdb + 8 document + 8 DocumentDataGrid), duration ~1.0s.

## Orchestrator-scope Checks

### `cd src-tauri && cargo test --lib`
PASS — `215 passed; 0 failed; 0 ignored`. Rust 변경 0 증명.

### `pnpm vitest run` (전체 suite)
PASS — Test Files 70 passed, **Tests 1252 passed (1252)**, duration 13.76s.

Sprint 70 기준(1232) 대비 +20 = Sprint 71 신규 16 테스트(QuickLookPanel document 8 + DocumentDataGrid 8) + 기타 병렬 작업 중인 agent 들이 추가한 4 테스트 = 회귀 없음.

## AC → Test Mapping

| AC | 테스트 이름 | 파일 / 위치 |
|---|---|---|
| AC-01 | (type-level) `DataGrid.tsx:383` 가 `mode` 없이 호출해도 `pnpm tsc --noEmit` 통과 | `QuickLookPanel.tsx:149-169` (union 정의) + `QuickLookPanel.tsx:215-228` (narrow) |
| AC-02 | `describe("rdb mode")` 블록의 16 테스트 전부 | `QuickLookPanel.test.tsx:108-265` |
| AC-03 | `renders the document details header with the db.collection label` | `QuickLookPanel.test.tsx:290-297` |
| AC-04 | `mounts the BsonTreeViewer with top-level keys for the selected document` | `QuickLookPanel.test.tsx:299-310` |
| AC-05 | `shows the BsonTreeViewer empty state when the selection is out of bounds` + `shows the BsonTreeViewer empty state when rawDocuments is empty` | `QuickLookPanel.test.tsx:312-338` |
| AC-06 | `indicates multi-select in the header while still showing the first document` | `QuickLookPanel.test.tsx:341-355` |
| AC-07 | `toggles row selection with aria-selected when the row is clicked` | `DocumentDataGrid.test.tsx:152-169` |
| AC-08 | `does not mount QuickLookPanel when Cmd+L is pressed without a selection` + `mounts QuickLookPanel with BsonTreeViewer after selecting a row and pressing Cmd+L` | `DocumentDataGrid.test.tsx:171-222` |
| AC-09 | `renders composite sentinels via isDocumentSentinel with muted italic styling` + (grep 증거) `items\]\$` 0 matches in `DocumentDataGrid.tsx` | `DocumentDataGrid.test.tsx:129-150` |
| AC-10 | `resets row selection when the user pages forward with Next` | `DocumentDataGrid.test.tsx:224-253` |
| AC-11 | (본 문서 §"Generator-scope Check Results" 참조) | — |

## Discriminated Union — 핵심 위치

- `QuickLookPanel.tsx:149-169` — `QuickLookPanelRdbProps` + `QuickLookPanelDocumentProps` + 두 타입의 union.
  - `QuickLookPanelRdbProps.mode?: "rdb"` 로 선택적 discriminant (기본값).
  - `QuickLookPanelDocumentProps.mode: "document"` 로 필수 discriminant.
- `QuickLookPanel.tsx:215-228` — `if (props.mode === "document") { ... } else { ... }` 런타임 분기, TS 가 자동으로 narrow 하여 각 분기에서 다른 필드셋 사용 가능.

## DocumentDataGrid 핵심 위치

| 역할 | 위치 |
|---|---|
| `isDocumentSentinel` import | `DocumentDataGrid.tsx:5` |
| `QuickLookPanel` import | `DocumentDataGrid.tsx:6` |
| `selectedRowIds` state | `DocumentDataGrid.tsx:40-42` |
| `showQuickLook` state | `DocumentDataGrid.tsx:43` |
| Cmd+L/Ctrl+L handler (+ cleanup) | `DocumentDataGrid.tsx:69-78` |
| Page 전환 selection reset | `DocumentDataGrid.tsx:83-85` |
| 행 single-select toggle | `DocumentDataGrid.tsx:87-95` |
| sentinel 판정 호출 | `DocumentDataGrid.tsx:225` |
| `aria-selected` on `<tr>` | `DocumentDataGrid.tsx:216` |
| QuickLookPanel 마운트 조건 | `DocumentDataGrid.tsx:128-129` (계산) + `:275-284` (JSX) |

## Invariant 증거

```
$ git diff --stat HEAD -- src/components/DataGrid.tsx                  → (empty)
$ git diff --stat HEAD -- src/components/datagrid/                     → (empty)
$ git diff --stat HEAD -- src/types/document.ts                        → (empty)
$ git diff --stat HEAD -- src/stores/documentStore.ts src/stores/tabStore.ts → (empty)
$ git diff --stat HEAD -- src-tauri/                                   → (empty)
$ grep -n 'items\]\$' src/components/DocumentDataGrid.tsx              → (no matches)
```

`BsonTreeViewer.{tsx,test.tsx}` 는 Sprint 70 에서 생성된 untracked 상태를 유지 — 본 스프린트에서 write 하지 않음.

## Assumptions

- **단일 행 선택만 지원**: 재클릭 = 해제. Shift/Cmd 범위 선택, Ctrl/Cmd 다중 개별 선택은 out-of-scope (Sprint 73 이후 편집 경로가 들어올 때 재검토).
- **페이지 전환 = selection 리셋**: 행 인덱스는 page-local 이므로 carry-over 시 잘못된 문서를 가리킴.
- **`mode` prop 은 optional**: 기존 `DataGrid.tsx:383` 호출은 변경 없이 `"rdb"` 로 동작.
- **`BsonTreeViewer` 의 built-in empty state 재사용**: `value={null}` 을 넘기면 뷰어가 "No document selected" 를 자동으로 렌더. Quick Look 이 자체 빈 상태 UI 를 만들 필요 없음.

## Residual Risk

- **Sprint 73 편집 통합 시점의 selection 로직 재조직**: 현재 `DocumentDataGrid` 는 local `selectedRowIds` 를 사용하지만, 편집이 들어가면 `useDataGridEdit` 계열의 공유 selection 로직(멀티 선택, pendingEdits 와의 연동 등)이 필요. 그때 `useDocumentDataGridEdit` 같은 훅을 분리해 paradigm 별로 재사용할 수 있도록 리팩터 권장.
- **keyboard arrow 행 이동 부재**: 마우스 클릭으로만 선택. TablePlus-like 체감 관점에서는 추후 ↑/↓ 네비게이션이 필요할 수 있으나 Phase 6 master plan 상 out-of-scope.

## Sprint 72 준비물

- `QuickLookPanel mode="document"` + `DocumentDataGrid` selection/Cmd+L 인프라가 이번 스프린트로 확정됨. Sprint 72(Find/Aggregate 쿼리 모드) 는 동일 QuickLookPanel 을 쿼리 결과에 재사용할 수 있음.
- `useDocumentStore.queryResults[key]` 가 `raw_documents` 를 포함하므로 쿼리 탭도 동일 경로로 소비 가능.
- `DocumentDataGrid` 는 read-only 유지; 편집은 Sprint 73.

## References

- Contract: `docs/sprints/sprint-71/contract.md`
- Execution brief: `docs/sprints/sprint-71/execution-brief.md`
- Evaluator findings: `docs/sprints/sprint-71/findings.md`
- 이전 Sprint 70 handoff: `docs/sprints/sprint-70/handoff.md`
- Master plan: `/Users/felix/.claude/plans/idempotent-snuggling-brook.md` (Sprint D 섹션, D-1/D-2 분할)
