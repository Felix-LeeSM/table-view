# Sprint Contract: sprint-87 (Phase 6 plan F-3 — Document UI completion)

## Summary

- Goal: Phase 6 plan F 의 마지막 단계. Sprint 86 이 노출한 `useDataGridEdit({ paradigm: "document" })` + `mqlPreview` 상태를 실제 UI 에 연결하여 MongoDB 컬렉션에서 인라인 편집 / 신규 문서 삽입 / 삭제가 SQL 그리드와 동등한 사용자 흐름으로 동작하게 한다.
- Audience: 사용자가 MongoDB 연결을 열어 컬렉션 탭에서 셀 더블클릭 → 편집 → Commit → MQL Preview → Execute 의 풀-루프를 SQL 과 똑같이 사용 가능.
- Owner: harness Generator
- Verification Profile: `command`

## In Scope

- `src/components/DocumentDataGrid.tsx` — 기존 read-only 렌더 경로 위에 인라인 편집 인프라 추가:
  - `useDataGridEdit({ paradigm: "document", connectionId, schema=database, table=collection, ... })` 훅 호출
  - `DataGridToolbar` 사용 (RDB 와 동일 컴포넌트 재활용 — Filter/QuickLook 토글, Commit/Discard, Add/Delete/Duplicate)
  - 셀 더블클릭 → 인라인 input 편집 (스칼라만; sentinel `"{...}"` / `"[N items]"` 는 read-only 유지)
  - Pending 시각화: 편집된 셀 노란 배경, 삭제된 행 strikethrough + 빨간 배경, 신규 행 초록 배경/`new` 뱃지
  - MQL Preview Modal: `editState.mqlPreview` 가 non-null 이면 표시. SQL Preview Modal 과 동일한 키 핸들링 (Enter=Execute, Esc=Cancel)
  - AddDocumentModal trigger: 툴바 Add 버튼이 modal 을 열어 JSON 직접 편집 가능 (대안으로 빈 행을 만드는 기존 흐름 유지)
- `src/components/document/MqlPreviewModal.tsx` (NEW) — `mqlPreview.previewLines` 렌더링 + Cancel/Execute. RDB 의 inline preview modal 과 시각적으로 일치하도록 동일한 Radix Dialog 패턴.
- `src/components/document/AddDocumentModal.tsx` (NEW) — JSON textarea + parse/validate → `insertDocument` Tauri wrapper 직접 호출 → 성공 시 부모에 알려 fetchData. CodeMirror 의존 없이 monospace `<textarea>` + JSON.parse 로 v1 충분.
- 테스트:
  - `src/components/DocumentDataGrid.test.tsx` 확장 — 편집/Commit/Execute 통합 시나리오 ≥ 4개 (스칼라 편집 happy path, sentinel read-only, MQL preview 표시, Execute → fetchData)
  - `src/components/document/MqlPreviewModal.test.tsx` (NEW) — render preview lines, errors 표시, Execute/Cancel 콜백 ≥ 4개
  - `src/components/document/AddDocumentModal.test.tsx` (NEW) — JSON parse 성공/실패, submit 콜백, 닫기 ≥ 4개

## Out of Scope

- 중첩 필드 편집 (sentinel cell 진입). Phase 6 out-of-scope, Sprint F 에 명시됨.
- BulkDelete, Cmd+D batch duplicate 등 신규 단축키.
- `src/components/structure/SqlPreviewDialog.tsx` 일반화 (구조 에디터 전용; document 그리드는 자체 modal 사용).
- `useDataGridEdit.ts` 본체 추가 변경 (Sprint 86 산출물 그대로 소비). 단, 만약 paradigm-aware 도구가 필요하다면 *return type 만* 확장 가능 — RDB branch 의 내부 동작은 byte-for-byte 보존.
- `src-tauri/**` 전체 (Sprint 80 산출물 불변).
- `src/lib/mongo/mqlGenerator.ts` 본체 (Sprint 86 산출물 그대로 소비; preview 문자열 escape 정책 등 변경 금지).
- `src/components/DataGrid.tsx` (RDB 그리드 불변 — Filter/QuickLook/SQL Preview Modal 모두 그대로).
- 기존 워크스페이스 diff (`src/components/connection/ConnectionDialog.tsx`) 는 quarantine 상태 유지.

## Invariants

- RDB paradigm 경로 (`DataGrid.tsx`, `useDataGridEdit.ts` rdb branch, `sqlGenerator.ts`, SQL Preview Modal) 동작 + 테스트 100% 보존.
- `useDataGridEdit.ts` 내부 구현 + 시그니처 + 반환 타입 추가 변경 0 (Sprint 86 결과 그대로 소비).
- `src-tauri/**` diff = 0.
- `src/lib/mongo/mqlGenerator.ts` + `src/types/documentMutate.ts` + `src/lib/tauri.ts` diff = 0 (Sprint 86 산출물 그대로 사용).
- Vitest baseline 1595 유지 + 신규 테스트 순증 ≥ +12.
- `pnpm tsc --noEmit` + `pnpm lint` 0 errors.
- `cargo test` 회귀 0 (Sprint 80 baseline `lib 226 + mongo_integration 11`).

## Acceptance Criteria

- `AC-01` `DocumentDataGrid` 가 `useDataGridEdit({ paradigm: "document", connectionId, schema=database, table=collection, page, fetchData, data })` 를 호출하고 반환된 상태/액션으로 편집 인프라를 구성한다.
- `AC-02` 스칼라 셀 더블클릭 → 인라인 input 표시 → 값 입력 → Enter/blur → `pendingEdits` 에 반영. RDB 의 `handleStartEdit`/`saveCurrentEdit` 동작과 동등.
- `AC-03` Sentinel cell (`"{...}"` / `"[N items]"`) 더블클릭 시 read-only 유지 (편집 인풋 미표시). 시각적 텍스트 그대로.
- `AC-04` 편집된 셀은 시각적으로 pending 표시 (배경색 또는 border). 새 행은 신규 마커, 삭제된 행은 strikethrough.
- `AC-05` 툴바 Commit 버튼 → `handleCommit()` 호출 → `mqlPreview` 가 non-null 이 되면 `MqlPreviewModal` 표시. `previewLines` 가 표시되어야 함.
- `AC-06` MqlPreviewModal Execute 버튼 → `handleExecuteCommit()` 호출 → 성공 시 modal 닫힘 + `fetchData` 재호출.
- `AC-07` MqlPreviewModal Cancel 버튼 / Esc 키 → modal 닫힘. `mqlPreview` 가 `null` 로 reset (`setMqlPreview(null)`) 되어야 함.
- `AC-08` `MqlPreviewModal` 에 `mqlPreview.errors` 가 있으면 별도 영역에 표시. `commands.length === 0` 이면 Execute 버튼이 disabled 또는 hidden.
- `AC-09` Toolbar Add 버튼 → `AddDocumentModal` 표시. JSON textarea 에 valid JSON object 입력 → Submit → `insertDocument` 호출 → 성공 시 modal 닫힘 + `fetchData`.
- `AC-10` `AddDocumentModal` 가 invalid JSON 또는 비-object 입력에 대해 에러 메시지 표시 (Submit 시도 시).
- `AC-11` `AddDocumentModal` Cancel 버튼 / Esc → modal 닫힘 (insertDocument 호출 없음).
- `AC-12` Toolbar Delete 버튼 → 선택된 행을 `pendingDeletedRowKeys` 에 추가 (Sprint 86 hook 동작 그대로). Commit → MqlPreview 가 `db.<coll>.deleteOne(...)` 라인 표시.
- `AC-13` `DocumentDataGrid.test.tsx` 가 인라인 편집 happy path / sentinel read-only / MQL preview 표시 / Execute 후 fetchData 의 4 시나리오 ≥ 1 케이스씩 포함.
- `AC-14` `MqlPreviewModal.test.tsx` ≥ 4 케이스: previewLines 렌더, errors 렌더, Execute 콜백, Cancel 콜백.
- `AC-15` `AddDocumentModal.test.tsx` ≥ 4 케이스: valid JSON submit, invalid JSON 에러, Cancel, 빈 입력.
- `AC-16` `pnpm tsc --noEmit` 0 errors.
- `AC-17` `pnpm lint` 0 errors.
- `AC-18` `pnpm vitest run` 전체 PASS, baseline 1595 + 신규 ≥ +12.
- `AC-19` `git diff --stat HEAD -- src-tauri/ src/lib/mongo/ src/types/documentMutate.ts src/lib/tauri.ts src/components/datagrid/useDataGridEdit.ts src/components/DataGrid.tsx` 가 모두 empty (Sprint 86/80 산출물 + RDB 경로 보존 증명).
- `AC-20` `src/components/connection/ConnectionDialog.tsx` 는 Sprint 87 에 의해 추가로 수정되지 않는다 (Sprint 79 pre-existing diff 보존).

## Design Bar / Quality Bar

- `any` 사용 0 — boundary 에서 `Record<string, unknown>` / `unknown` + 타입 가드 사용.
- 신규 컴포넌트는 함수형 + `interface ...Props` + `export default`. Tailwind + dark mode 지원.
- 키보드 접근성: 모달은 Esc 닫힘 + Enter 기본 액션. ARIA: `role="dialog"`, `aria-label`, `aria-describedby` 적절히.
- 테스트는 RTL `getByRole`/`getByText` 우선 (testid 최후 수단).
- 컴포넌트 1개 = 파일 1개. 파일명 PascalCase.

## Verification Plan

### Required Checks

1. `pnpm tsc --noEmit` → 0 errors.
2. `pnpm lint` → 0 errors.
3. `pnpm vitest run` → 전체 PASS, baseline 1595 → 1595+ (≥ +12).
4. `git diff --stat HEAD -- src-tauri/ src/lib/mongo/ src/types/documentMutate.ts src/lib/tauri.ts src/components/datagrid/useDataGridEdit.ts src/components/DataGrid.tsx` → empty.
5. `git diff --stat HEAD -- src/components/connection/ConnectionDialog.tsx` 가 Sprint 79 pre-existing diff 와 동일 (Sprint 87 추가 변경 없음).

### Required Evidence

- Generator must provide:
  - 변경 파일 목록 + 목적
  - 5 check 의 실행 명령 + 결과 수치
  - AC-01 ~ AC-20 별 file:line 또는 test name 증거
  - Assumptions (예: AddDocumentModal 가 textarea + JSON.parse 사용 / pendingNewRows 경로 vs 직접 Tauri 호출 선택 이유 등)
  - Residual risk (예: nested edit 미지원, 모달 안에서 키보드 트랩 부재 등)
- Evaluator must cite:
  - 각 AC 의 결정에 대한 file:line 증거
  - 약한/누락 증거를 finding 으로 기록
  - RDB 경로 보존이 git diff 로 검증되었는지

## Test Requirements

### Unit Tests (필수)

- AC-13 ~ AC-15 의 신규 테스트 파일 3 개:
  - `DocumentDataGrid.test.tsx` 확장: ≥ 4 신규 케이스
  - `MqlPreviewModal.test.tsx`: ≥ 4 케이스
  - `AddDocumentModal.test.tsx`: ≥ 4 케이스
- 각 컴포넌트의 에러/예외 케이스 ≥ 1.

### Coverage Target

- 신규/수정 코드 라인 70% 이상.
- CI baseline 라인 40% / 함수 40% / 브랜치 35% 유지.

### Scenario Tests (필수)

- [x] Happy path — 셀 편집 → Commit → MQL preview → Execute → refresh
- [x] 에러 — invalid JSON insert, sentinel cell 클릭
- [x] 경계 — 빈 pendingEdits 일 때 Commit 무반응, mqlPreview.errors 만 있을 때 Execute disabled
- [x] 회귀 — RDB grid 동작 + 기존 1595 테스트 PASS

## Test Script / Repro Script

1. `pnpm tsc --noEmit && pnpm lint`
2. `pnpm vitest run`
3. `git diff --stat HEAD -- src-tauri/ src/lib/mongo/ src/types/documentMutate.ts src/lib/tauri.ts src/components/datagrid/useDataGridEdit.ts src/components/DataGrid.tsx` (empty 확인)

## Ownership

- Generator: general-purpose Agent
- Write scope:
  - **Modify**: `src/components/DocumentDataGrid.tsx`, `src/components/DocumentDataGrid.test.tsx`
  - **Create**: `src/components/document/MqlPreviewModal.tsx`, `src/components/document/MqlPreviewModal.test.tsx`, `src/components/document/AddDocumentModal.tsx`, `src/components/document/AddDocumentModal.test.tsx`, `docs/sprints/sprint-87/{handoff.md,findings.md}`
- Merge order: 단일 commit. Sprint 87 끝나면 phase 6 plan F 완료.

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes`
- Acceptance criteria evidence linked in `handoff.md`
