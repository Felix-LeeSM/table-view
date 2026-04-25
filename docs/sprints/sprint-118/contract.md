# Sprint Contract: sprint-118

## Summary

- Goal: MongoDB 컬렉션 그리드 / 도큐먼트 paradigm UI 에서 RDB 용어 (`row`, `column`) 가 노출된 문자열을 `document` / `field` 로 교체해 paradigm 정합성을 확보 (`#PAR-2`). DataGridToolbar 의 라벨은 optional override props 로 paradigm 별 분기. DocumentDataGrid 만 override 를 전달하므로 RDB 그리드는 무회귀.
- Audience: 메인테이너 + 후속 sprint 121-123 (paradigm 시각 cue / DocumentFilterBar / AddDocumentModal v2).
- Owner: 메인테이너 직접.
- Verification Profile: `command` — 정합성 검증은 jsdom + RTL 의 `getByText` / `getByLabelText` / `textContent.toContain` 로 모두 결정적이다. spec 의 `browser` 보다 신뢰성·재현성 면에서 우월.

## In Scope

- `src/lib/strings/document.ts` — `DOCUMENT_LABELS` 객체 추가 (`rowCountLabel`, `addRowLabel`, `deleteRowLabel`, `duplicateRowLabel`).
- `src/components/datagrid/DataGridToolbar.tsx` — 4 개 optional override props 추가. **default 는 기존 RDB wording 유지** (`"rows"`, `"Add row"`, `"Delete row"`, `"Duplicate row"`). 인라인 사용처 모두 props 값 사용.
- `src/components/DocumentDataGrid.tsx`:
  - `<DataGridToolbar>` 에 4 개 override 전달.
  - mqlErrors mapper 의 `cannot edit ${col} in a patch` / `nested ${col} is not editable` → `cannot edit field ${col} in a patch` / `nested field ${col} is not editable` (`column` 용어 제거).
- `src/components/document/MqlPreviewModal.tsx`:
  - `{errors.length} row{s} skipped:` → `{errors.length} document{s} skipped:`.
  - `row {err.row}: {err.message}` → `document {err.row}: {err.message}`.
- 테스트 갱신:
  - `src/components/DocumentDataGrid.test.tsx` — `2 rows` → `2 documents`, `Add row` → `Add document`.
  - `src/components/document/MqlPreviewModal.test.tsx` — `2 rows skipped` → `2 documents skipped`, `row 3:` / `row 5:` → `document 3:` / `document 5:`.
- Sprint artifacts (`contract.md`, `execution-brief.md`, `handoff.md`).

## Out of Scope

- RDB DataGrid 의 wording 변경 (RDB 는 row/column 정합).
- Sidebar / 컬렉션 탭 헤더 외부 텍스트 (이미 `collection` / `database` 용어 사용 중 — 회귀 검사만 수행).
- 빈 상태 메시지 (`No documents` 는 이미 정합).
- AddDocumentModal v2 (sprint 121).
- DocumentFilterBar (sprint 122).
- `UI-FU-08` Mongo 편집 P0 결정.

## Invariants

- 1834 baseline tests 회귀 0 (sprint 117 에서 추가된 5 개 포함).
- DataGridToolbar 의 default props 는 RDB wording 그대로 유지 → 기존 RDB 테스트 (`DataGrid.test.tsx`, `DataGridToolbar.test.tsx`, `QueryResultGrid.test.tsx`) 변경 0.
- `DataGridToolbar` 의 prop 시그니처 변경은 optional 추가만 — breaking 0.
- sprint 117 의 `DocumentDataGrid.pagination.test.tsx` 의 wording (`Page size`, `First page`, `Last page` 등) 보존.

## Acceptance Criteria

- `AC-01`: DocumentDataGrid 의 toolbar 에서 `getByLabelText("Add document")` / `getByLabelText("Delete document")` / `getByLabelText("Duplicate document")` 노출. `getByText(/N documents/)` 로 row count 단언. RDB DataGridToolbar 는 `"Add row"` 등 default wording 으로 무회귀.
- `AC-02`: MqlPreviewModal 의 errors 섹션이 `"N documents skipped:"` 헤더 + `"document {N}: {message}"` 라인 형태로 렌더.
- `AC-03`: DocumentDataGrid 의 mqlErrors 변환에서 `nested ${col} is not editable` / `cannot edit ${col} in a patch` → `nested field ${col} is not editable` / `cannot edit field ${col} in a patch` (`column` 용어 제거).
- `AC-04`: RDB 그리드 / SQL 결과 그리드 (`DataGrid.test.tsx`, `DataGridToolbar.test.tsx`, `QueryResultGrid.test.tsx`, `QueryResultGrid.multi-statement.test.tsx`) 회귀 0.
- `AC-05`: `pnpm vitest run` 1834 baseline + 갱신된 케이스 모두 PASS. `pnpm tsc --noEmit` 0. `pnpm lint` 0.

## Design Bar / Quality Bar

- 라벨 분기는 **default 가 RDB** 패턴을 유지 — 이는 (a) 호출부가 명시적이지 않으면 RDB 시멘틱으로 해석되는 안전한 fallback, (b) 기존 RDB 테스트의 wording-기반 invariant 를 그대로 보존. paradigm prop 한 개로 분기하는 대안은 toolbar 가 paradigm 로직을 알게 되어 결합도가 높아져 기각.
- DOCUMENT_LABELS 는 단일 모듈 (`@/lib/strings/document`) 에 모아 향후 i18n catalog 통합 시 swap 지점이 단일.
- 에러 메시지의 `${col}` → `field ${col}` 변환은 변수 이름 자체 (`column`) 를 바꾸지 않고 사용자 노출 텍스트만 수정 — `MqlGenerationError.column` API 시그니처는 무변경 (RDB / 도큐먼트 양쪽 호환).

## Verification Plan

### Required Checks

1. `pnpm vitest run` — 1834 baseline (회귀 0) + 갱신된 케이스 PASS. 단언 wording 변경 외 새 케이스 추가는 선택.
2. `pnpm tsc --noEmit` — 0.
3. `pnpm lint` — 0.

### Required Evidence

- Generator must provide:
  - 변경된 파일 + 한 줄 목적.
  - 변경된 테스트 케이스 ID + AC 매핑.
  - 검증 명령 결과 (vitest pass count).
- Evaluator must cite:
  - DataGridToolbar.tsx 의 default props 가 RDB wording 유지함을 직접 확인.
  - DocumentDataGrid.tsx 의 mqlErrors 변환 결과가 `field ${col}` 형식임을 확인.
  - 기존 RDB 테스트 무회귀 (특히 `DataGrid.test.tsx:1206`, `:844`, `DataGridToolbar.test.tsx:76,84,92`, `QueryResultGrid.test.tsx:114`).

## Test Requirements

### Unit Tests (필수)

- `DocumentDataGrid.test.tsx`:
  - line 142: `screen.getByText(/2 rows/)` → `screen.getByText(/2 documents/)`.
  - line 383: `getByRole("button", { name: "Add row" })` → `... { name: "Add document" }`.
- `MqlPreviewModal.test.tsx`:
  - line 43: `"row 3: missing or unsupported _id"` → `"document 3: missing or unsupported _id"`.
  - line 44: `"row 5: nested meta is not editable"` → `"document 5: nested meta is not editable"`.
  - line 46: `"2 rows skipped"` → `"2 documents skipped"`.

### Coverage Target

- 신규 코드 (`DOCUMENT_LABELS` constant export) 는 trivial constant — runtime 분기 없음. 기존 테스트가 props 통과를 wording 으로 단언 → 자연 커버.

### Scenario Tests (필수)

- [x] Happy path — DocumentDataGrid 가 document wording 으로 마운트.
- [x] 회귀 0 — RDB DataGrid 가 default wording 으로 무회귀 (`DataGrid.test.tsx`).
- [x] 에러 메시지 — MqlPreviewModal 의 plural / singular 양쪽 (`document` / `documents`).

## Test Script / Repro Script

1. `pnpm vitest run src/components/DocumentDataGrid.test.tsx src/components/DocumentDataGrid.pagination.test.tsx src/components/document/MqlPreviewModal.test.tsx`.
2. `pnpm vitest run src/components/DataGrid.test.tsx src/components/datagrid/DataGridToolbar.test.tsx src/components/query/QueryResultGrid.test.tsx` — RDB 무회귀 확인.
3. `pnpm vitest run` — 전체.
4. `pnpm tsc --noEmit`.
5. `pnpm lint`.

## Ownership

- Generator: 메인테이너 직접 (소규모 wording sprint).
- Write scope: `src/lib/strings/document.ts`, `src/components/datagrid/DataGridToolbar.tsx`, `src/components/DocumentDataGrid.tsx`, `src/components/document/MqlPreviewModal.tsx`, `src/components/DocumentDataGrid.test.tsx`, `src/components/document/MqlPreviewModal.test.tsx`, `docs/sprints/sprint-118/{contract,execution-brief,handoff}.md`.
- Merge order: contract → execution brief → 구현 → 검증 → handoff.

## Exit Criteria

- Open `P1`/`P2` findings: `0`.
- Required checks passing: `yes`.
- Acceptance criteria evidence linked in `handoff.md`.
