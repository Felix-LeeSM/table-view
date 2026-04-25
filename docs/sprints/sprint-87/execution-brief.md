# Sprint Execution Brief: sprint-87 (Phase 6 plan F-3 — Document UI completion)

## Objective

Sprint 86 이 만든 `useDataGridEdit({ paradigm: "document" })` 훅과 `mqlPreview` 상태를 실제 UI 에 연결한다:
- `DocumentDataGrid.tsx` 를 read-only → editable 로 업그레이드 (인라인 편집 + 툴바 + pending 시각화)
- `MqlPreviewModal` 컴포넌트 신설 — Sprint 86 `mqlPreview.previewLines` 를 렌더링 + Execute/Cancel
- `AddDocumentModal` 컴포넌트 신설 — JSON textarea → `insertDocument` 직접 호출
- 신규 테스트 파일 3 종 (≥ +12 케이스)

## Task Why

- Phase 6 plan F 의 **마지막 UI 단계**. Sprint 80 backend → Sprint 86 generator/dispatch → Sprint 87 UI 의 체인 중 세 번째.
- Sprint 86 까지는 훅 안에서만 dispatch 가 동작하고 UI 진입점이 없어 사용자가 mongo 컬렉션에서 편집 흐름을 트리거할 수 없음.
- DocumentDataGrid 를 SQL DataGrid 와 동등한 워크플로우로 끌어올려야 phase 6 완료 기준 ("로컬 mongo → 컬렉션 탐색 → 인라인 편집 → MQL Preview → Commit → mongosh 확인") 의 마지막 칸을 채울 수 있음.

## Scope Boundary

- **Hard stop**:
  - `src-tauri/**` 전체 (backend 불변, Sprint 80 산출물)
  - `src/components/DataGrid.tsx` (RDB 경로 불변)
  - `src/components/datagrid/useDataGridEdit.ts` (Sprint 86 산출물 본체 불변)
  - `src/components/datagrid/sqlGenerator.ts`, `src/lib/mongo/mqlGenerator.ts` (생성기 불변)
  - `src/types/documentMutate.ts`, `src/lib/tauri.ts` (Sprint 86 산출물 불변)
  - `src/components/connection/ConnectionDialog.tsx` (pre-existing Sprint 79 diff, Sprint 87 scope 밖)
  - `docs/**` 중 `docs/sprints/sprint-87/` 외
- **Write scope (수정)**: `src/components/DocumentDataGrid.tsx`, `src/components/DocumentDataGrid.test.tsx`.
- **Write scope (신규)**:
  - `src/components/document/MqlPreviewModal.tsx` + `.test.tsx`
  - `src/components/document/AddDocumentModal.tsx` + `.test.tsx`
  - `docs/sprints/sprint-87/handoff.md` (Generator 작성)

## Invariants

- RDB paradigm 경로 (`DataGrid.tsx`, `useDataGridEdit.ts` rdb branch, sqlGenerator, SQL Preview Modal) 동작 + 테스트 100% 보존.
- `useDataGridEdit.ts` / `mqlGenerator.ts` / `documentMutate.ts` / `tauri.ts` 전부 diff 0 (Sprint 86 산출물 그대로 소비).
- `src-tauri/**` 전부 diff 0.
- Vitest baseline 1595 유지 + 신규 테스트 순증 ≥ +12.
- `pnpm tsc --noEmit` + `pnpm lint` 0 errors.
- Pre-existing `ConnectionDialog.tsx` diff 는 Sprint 87 이 추가로 변경하지 않음.

## Done Criteria

1. `DocumentDataGrid.tsx` 가 `useDataGridEdit({ paradigm: "document", ... })` 를 호출하고 반환된 상태/액션으로 인라인 편집 인프라를 구성.
2. 스칼라 셀 더블클릭 → 인라인 input 편집; sentinel cell 은 read-only 유지.
3. 편집/신규/삭제 행 시각화 (배경색, strikethrough, 뱃지 중 하나 이상).
4. 툴바 Commit → `handleCommit` → `mqlPreview` 표시 → `MqlPreviewModal` 렌더.
5. MqlPreviewModal Execute → `handleExecuteCommit` → 성공 시 modal 닫힘 + fetchData. Cancel/Esc → mqlPreview reset.
6. AddDocumentModal — JSON textarea + parse/validate + submit → `insertDocument` 직접 호출 → fetchData.
7. 신규 테스트 ≥ +12 (DocumentDataGrid.test.tsx ≥ +4, MqlPreviewModal.test.tsx ≥ 4, AddDocumentModal.test.tsx ≥ 4).
8. 기존 RDB 경로 + 백엔드 회귀 0.
9. `pnpm tsc --noEmit` + `pnpm lint` 0 errors.
10. `git diff --stat HEAD -- src-tauri/ src/lib/mongo/ src/types/documentMutate.ts src/lib/tauri.ts src/components/datagrid/useDataGridEdit.ts src/components/DataGrid.tsx` empty.
11. Pre-existing `ConnectionDialog.tsx` diff 가 Sprint 87 에 의해 추가로 수정되지 않음.

## Verification Plan

- Profile: `command`
- Required checks:
  1. `pnpm tsc --noEmit` → 0 errors.
  2. `pnpm lint` → 0 errors.
  3. `pnpm vitest run` → 전체 PASS, baseline 1595 + 신규 ≥ +12.
  4. `git diff --stat HEAD -- src-tauri/ src/lib/mongo/ src/types/documentMutate.ts src/lib/tauri.ts src/components/datagrid/useDataGridEdit.ts src/components/DataGrid.tsx` → empty.
  5. `git diff --stat HEAD -- src/components/connection/ConnectionDialog.tsx` 가 Sprint 79 pre-existing diff 와 동일.
- Required evidence:
  - `DocumentDataGrid.tsx` 의 `useDataGridEdit` 호출 file:line + paradigm 인자.
  - sentinel cell 분기 file:line.
  - MqlPreviewModal 의 Execute/Cancel 콜백 wiring file:line.
  - AddDocumentModal 의 JSON.parse + insertDocument 호출 file:line.
  - 신규 테스트 파일 3 종 + 케이스 수.
  - vitest 통계 (total / passed / failed).
  - `git diff --stat` 결과 캡처.
  - RDB 경로 (`DataGrid.tsx`, `useDataGridEdit.ts`) 가 변경되지 않았다는 git 증명.

## Evidence To Return

- 변경 파일 목록 + 목적 (수정 2 + 신규 5).
- 5 check 의 실행 명령 + 결과 수치.
- AC-01 ~ AC-20 별 file:line 또는 test name.
- Assumptions:
  - AddDocumentModal 가 textarea + JSON.parse 사용 vs CodeMirror — Sprint 87 v1 은 textarea 로 충분.
  - AddDocumentModal 가 pendingNewRows 경로 vs `insertDocument` 직접 호출 — 직접 호출이 단순하고 단일 문서 단일 작업이라 합리적.
  - sentinel cell 의 더블클릭 동작 — 기본 noop / 시각적 변경 없음 / "Read-only" tooltip 등 중 무엇.
- Residual risk:
  - 중첩 필드 편집 미지원 (Phase 6 out-of-scope 명시).
  - AddDocumentModal 이 `_id` 자동 생성을 Mongo 서버에 위임 (frontend 에서 ObjectId 생성 안 함).
  - JSON 스키마 검증 부재 — Mongo 가 거부할 키나 타입은 backend 가 에러 반환.

## References

- Contract: `docs/sprints/sprint-87/contract.md`
- Findings: `docs/sprints/sprint-87/findings.md` (작성 후)
- Relevant files:
  - `src/components/DocumentDataGrid.tsx`
  - `src/components/datagrid/useDataGridEdit.ts` (Sprint 86, 호출만)
  - `src/lib/mongo/mqlGenerator.ts` (Sprint 86, 호출만)
  - `src/lib/tauri.ts` (Sprint 86, 호출만)
  - `src/components/DataGrid.tsx` (참고용, RDB 모달 패턴)
  - `src/components/structure/SqlPreviewDialog.tsx` (Radix Dialog 패턴 참고)
  - `src/components/shared/ConfirmDialog.tsx` (Radix AlertDialog 참고)
