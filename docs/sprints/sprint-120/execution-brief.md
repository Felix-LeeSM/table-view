# Sprint Execution Brief: sprint-120 — 폴더 재조직

## Objective

- `src/components/{rdb,document}/` 폴더 경계를 신설하고 기존 RDB/Mongo 컴포넌트 6 파일 (DataGrid, FilterBar, DocumentDataGrid + 짝 테스트) 을 해당 폴더로 이동.
- import 경로 업데이트 (consumer ~ 6-8 곳).
- `src/lib/paradigm.ts` 신설 — `assertNever(p: never): never` 가드 + `Paradigm` re-export.
- 컴포넌트 내부 코드 변경 0.

## Task Why

- 사용자 의문 ("paradigm 별 viewer 가 따로 있어야 하지 않나") 의 가장 직접적 해소 — IDE 트리에서 RDB/document 가 시각적으로 갈라짐.
- Sprint 121-123 (AddDocumentModal v2 / DocumentFilterBar / TabBar cue) 이 새 폴더 구조 위에서 자연스럽게 안착.
- `assertNever` 는 Phase 7 capability adapter 진화 시 분기 누락 검출 도구.

## Scope Boundary

- **Hard stop**:
  - 컴포넌트 내부 코드 변경 (rename 대상 6 파일은 byte-identical)
  - `src-tauri/**`
  - `src/components/datagrid/useDataGridEdit.ts` (Sprint 86 결정 보존)
  - `src/components/datagrid/sqlGenerator.ts`, `src/lib/mongo/mqlGenerator.ts`
  - `src/lib/tauri.ts`, `src/types/documentMutate.ts`
  - `src/components/connection/ConnectionDialog.tsx` (Sprint 79 quarantine)
  - `src/components/query/QueryEditor.tsx`
- **Write scope**:
  - rename: 6 파일 (DataGrid 짝, FilterBar 짝, DocumentDataGrid 짝)
  - 수정: import 경로 ~8 파일 (consumer; MainArea, 테스트, lazy import 등)
  - 신규: `src/lib/paradigm.ts`, `src/lib/paradigm.test.ts`
  - 수정 1 라인: `MainArea.tsx` 의 paradigm 분기 끝에 `assertNever(tab.paradigm)` 추가

## Invariants

- rename 6 파일의 *내용물* byte-identical
- `src-tauri/` diff = 0
- `useDataGridEdit.ts` diff = 0
- Vitest baseline 1615 유지 (신규 paradigm.test.ts 의 1-2 개만 추가)
- `pnpm tsc --noEmit` + `pnpm lint` 0 errors

## Done Criteria

1. rename 후 모든 import 가 새 경로로 갱신; tsc 통과
2. `pnpm lint` 0 errors, `pnpm vitest run` baseline + paradigm.test.ts (1-2)
3. rename 으로 인한 코드 내용물 변경 0 — `git diff -M --stat HEAD~1 HEAD` 의 R 마크로 검증
4. `src/lib/paradigm.ts` 의 `assertNever` 가 export 되고 `MainArea.tsx` paradigm 분기 끝에서 호출됨 (file:line 명시)
5. `git diff --stat HEAD -- src-tauri/ src/components/datagrid/useDataGridEdit.ts` empty
6. 옛 경로 import (`@/components/(DataGrid|FilterBar|DocumentDataGrid)` 직접 참조) 0 매치

## Verification Plan

- **Profile**: `command`
- **Required checks**:
  1. `pnpm tsc --noEmit` → 0 errors
  2. `pnpm lint` → 0 errors
  3. `pnpm vitest run` → 모든 테스트 통과 + baseline 유지
  4. `git diff -M --stat HEAD~1 HEAD` 가 6 파일에 대해 R(rename) 마크 표시
  5. `git diff --stat HEAD -- src-tauri/ src/components/datagrid/useDataGridEdit.ts` → empty
  6. `grep -r "from [\"']@/components/\\(DataGrid\\|FilterBar\\|DocumentDataGrid\\)[\"']" src/` → 0 매치
- **Required evidence**:
  - 6 rename 파일의 새 경로
  - import 업데이트 위치 (file:line) 목록
  - `src/lib/paradigm.ts` 의 `assertNever` 시그니처
  - `MainArea.tsx` 의 `assertNever` 호출 line
  - 6 check 명령 결과 캡처

## Evidence To Return

- 변경 파일 목록 + 목적 (rename 6 + 신규 2 + 수정 ~8)
- 6 check 의 실행 명령 + 결과 수치
- AC-01 ~ AC-07 별 file:line 또는 명령 출력
- Assumptions:
  - 동적 import / lazy() 가 없거나 grep 으로 모두 잡힘
  - `assertNever` 도입 위치는 v1 으로 `MainArea.tsx` 1곳; 다른 paradigm 분기 (QueryTab, SchemaPanel) 로의 확산은 후속 sprint
- Residual risk:
  - import 경로 누락 시 tsc 가 잡지만 동적 import 는 런타임에서만 발견 — grep 검증으로 보강
  - `assertNever` 가 1곳에만 도입되면 다른 paradigm 분기는 여전히 누락 가능 — 후속 sprint 에서 확산

## References

- Master plan: `~/.claude/plans/idempotent-snuggling-brook.md`
- Contract: `docs/sprints/sprint-120/contract.md`
- Findings: `docs/sprints/sprint-120/findings.md` (Generator 작성)
- Handoff: `docs/sprints/sprint-120/handoff.md` (Generator 작성)
- Relevant files (rename 대상):
  - `src/components/DataGrid.tsx` + `.test.tsx`
  - `src/components/FilterBar.tsx` + `.test.tsx`
  - `src/components/DocumentDataGrid.tsx` + `.test.tsx`
- Consumer (import 업데이트 후보):
  - `src/components/layout/MainArea.tsx`
  - `src/components/layout/TabBar.tsx` (간접)
  - 모든 짝 테스트 파일
- 신규:
  - `src/lib/paradigm.ts` + `.test.ts`
