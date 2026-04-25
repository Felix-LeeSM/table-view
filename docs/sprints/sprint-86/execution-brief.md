# Sprint Execution Brief: sprint-86 (Phase 6 plan F-2 — Frontend mqlGenerator + paradigm dispatch)

## Objective

Sprint 80 이 완성한 backend mutate (3 Tauri commands) 를 소비할 프론트엔드 중간 레이어를 구축:
- `DocumentId` TS 타입 미러 + helper 3 개
- `mqlGenerator.ts` (grid diff → `{$set}` bson + MQL preview 문자열 + 3 variant commands)
- `src/lib/tauri.ts` 에 3 Tauri wrapper 추가
- `useDataGridEdit` 훅의 document paradigm 분기 실구현 (현재는 no-op guard 만 존재)

## Task Why

- Phase 6 plan F 의 **중간 레이어**. Sprint 80 backend → Sprint 86 generator/dispatch → Sprint 87 UI 의 체인 중 두 번째.
- Sprint 87 이 `DocumentDataGrid` 인라인 편집 UI 를 붙이려면 훅이 document paradigm 에서도 편집 경로를 제공해야 함. 현재 `handleStartEdit` 은 document 에서 no-op.
- `sqlGenerator.ts` 와 대응하는 `mqlGenerator.ts` 가 없으면 Sprint 87 UI 가 `{$set}` 을 직접 만들어야 해서 레이어가 깨짐. Generator 로 먼저 분리.

## Scope Boundary

- **Hard stop**:
  - `src-tauri/**` 전체 (backend 불변, Sprint 80 산출물)
  - `src/components/DataGrid.tsx`, `src/components/DocumentDataGrid.tsx` (Sprint 87)
  - `src/components/shared/**` (QueryPreviewModal 일반화 = Sprint 87)
  - `src/components/datagrid/sqlGenerator.ts` (RDB 경로 불변)
  - `src/types/document.ts`, `src/types/connection.ts` (이미 올바름)
  - `src/stores/**`
  - `src/components/connection/ConnectionDialog.tsx` (pre-existing workspace diff, Sprint 86 scope 밖)
  - `docs/**` 중 `docs/sprints/sprint-86/` 외
- **Write scope (수정)**: `useDataGridEdit.ts`, `useDataGridEdit.paradigm.test.ts`, `src/lib/tauri.ts`.
- **Write scope (신규)**: `src/types/documentMutate.ts` + `.test.ts`, `src/lib/mongo/mqlGenerator.ts` + `.test.ts`, `src/components/datagrid/useDataGridEdit.document.test.ts`.

## Invariants

- RDB paradigm 경로의 `useDataGridEdit` / `sqlGenerator` / preview 모달 동작 / 테스트 **완전 불변**.
- 기존 `src/lib/tauri.ts` wrapper 순서 / 시그니처 / 구현 불변 — 추가만.
- `src-tauri/**` + `src/components/DataGrid.tsx` + `src/components/DocumentDataGrid.tsx` + `src/components/shared/**` 전부 diff 0.
- Sprint 80 cargo 테스트 회귀 0 (`cargo test --lib`, `cargo test --test mongo_integration`).
- Vitest baseline 1558 유지 + 신규 테스트 순증 ≥ +18.
- `pnpm tsc --noEmit` + `pnpm lint` 0 errors.
- Pre-existing ConnectionDialog.tsx diff 는 Sprint 86 이 추가로 변경하지 않음.

## Done Criteria

1. `src/types/documentMutate.ts` — `DocumentId` tagged union + `parseObjectIdLiteral` / `documentIdFromRow` / `formatDocumentIdForMql` helper 3 개 + tests.
2. `src/lib/mongo/mqlGenerator.ts` — `generateMqlPreview(input) → MqlPreview { previewLines, commands, errors }` 실구현, `MqlCommand` 3 variants + `MqlGenerationError` 4 variants.
3. Generator 가 `$set` 래핑, `_id` in-patch guard, sentinel-edit guard, missing-id guard, empty-diff 처리 전부 커버.
4. `src/lib/tauri.ts` 에 3 wrapper (`insertDocument` / `updateDocument` / `deleteDocument`) 추가, `DocumentId` import.
5. `useDataGridEdit.ts` — document no-op guard 제거, `handleCommit` / `handleExecuteCommit` paradigm 분기 추가, 반환 타입에 `mqlPreview: MqlPreview | null` 추가, `hasPendingChanges` document 반영.
6. 신규 테스트 ≥ +18 (types 6, mqlGenerator 7, useDataGridEdit 5).
7. 기존 RDB 경로 테스트 + Sprint 80 backend 테스트 회귀 0.
8. `pnpm tsc --noEmit` + `pnpm lint` 0 errors.
9. `git diff --stat HEAD -- src-tauri/` empty.
10. `git diff --stat HEAD -- src/components/DataGrid.tsx src/components/DocumentDataGrid.tsx src/components/shared/` empty.
11. Pre-existing ConnectionDialog.tsx diff 가 Sprint 86 에 의해 추가로 수정되지 않음.

## Verification Plan

- Profile: `command`
- Required checks:
  1. `pnpm tsc --noEmit` → 0 errors.
  2. `pnpm lint` → 0 errors.
  3. `pnpm vitest run` → 전체 PASS, baseline 1558 + ≥+18 신규 테스트.
  4. `git diff --stat HEAD -- src-tauri/` → empty.
  5. `git diff --stat HEAD -- src/components/DataGrid.tsx src/components/DocumentDataGrid.tsx src/components/shared/` → empty.
  6. `cd src-tauri && cargo test --lib` → Sprint 80 baseline 226 유지.
  7. `cd src-tauri && cargo test --test mongo_integration` → Sprint 80 baseline 11 유지 (docker 가동 시).
- Required evidence:
  - `DocumentId` 타입 정의 file:line.
  - `mqlGenerator.generateMqlPreview` 구현 body file:line.
  - `useDataGridEdit.ts` paradigm 분기 file:line (document vs rdb branch).
  - 3 Tauri wrapper file:line.
  - 신규 테스트 파일 3 개 이름 + 케이스 수.
  - vitest 통계 (total / passed / failed).
  - `git diff --stat` backend + UI 컴포넌트 empty 증명.
  - 기존 `useDataGridEdit.paradigm.test.ts` 의 Sprint 66 "no-op guard" 테스트 제거 / 재목적화 증거.

## Evidence To Return

- Changed files + purpose (기존 3 수정 + 신규 5 + sprint-86/ 아티팩트).
- 7 check 실행 커맨드 + 결과 수치.
- AC-01 ~ AC-17 각각 증거 (file:line 또는 test name).
- Assumptions (DocumentId tagged union serde format, sentinel detection 함수 재사용/신규, preview 문자열 escape 정책 등).
- Residual risk (예: Sprint 87 이 모달 분기를 안 하면 document 편집이 UI 에 노출되지 않음, 중첩 편집 미지원 등).
