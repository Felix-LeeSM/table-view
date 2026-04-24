# Sprint Execution Brief: Sprint 74 — Type-Aware NULL Re-entry

## Objective
NULL 칩(아이템 에디터가 `editValue === null`일 때 렌더되는 "NULL" 칩)에서 사용자가 printable key를 눌러 편집을 재개할 때, 컬럼 데이터 타입에 맞는 에디터(`<input type="date">`, `type="datetime-local">`, `type="number">`, 텍스트 등)가 열리도록 한다. 현재는 모든 경우 `onSetEditValue(e.key)` 를 호출해 plain text input + seeded char가 되어, date/timestamp 컬럼에서도 문자열을 입력받을 수 있다.

## Task Why
사용자가 `/harness` 요청에서 "date 객체를 null로 바꾸게 되면 일반 string을 입력할 수 있게 되는군. 수정해야 한다" 로 명시한 버그. 미수정 시 commit 단계에서 DB가 invalid literal을 거부하거나, 사용자가 유효하지 않은 데이터를 붙여 저장할 수 있다.

## Scope Boundary
- **범위 안**: NULL 칩 onKeyDown의 printable key 분기, helper 추출, typed editor 분기 렌더.
- **범위 밖**: SQL 생성 단계 coercion (Sprint 75), commit 단계 validation hint (Sprint 75), boolean/uuid용 custom UI 컴포넌트 (필요하면 Sprint 75+ 에서).

## Invariants
1. ADR 0009 tri-state 계약 보존 — `editValue: string | null`, `pendingEdits: Map<string, string | null>`.
2. Cmd/Ctrl+Backspace → NULL 칩 경로 보존.
3. text/varchar/char/citext/json 컬럼은 기존 동작 그대로 (seed + text input).
4. `editorFocusRef` 기반 포커스 관리 보존 — 모든 타입 에디터가 첫 렌더 시 포커스 받아야 함.
5. 기존 1236개 vitest가 전부 통과해야 함.

## Done Criteria
1. 새 helper (예: `deriveEditorSeed(dataType, key): { inputType, seed, accept }`)가 `useDataGridEdit.ts`에서 export.
2. `DataGridTable`의 NULL 칩 onKeyDown에서 printable key 분기가 helper를 호출, 결과에 따라 `onSetEditValue(seed)` 또는 이벤트 무시.
3. `DataGridTable`의 일반 input 분기는 컬럼 타입에 맞는 `<input type>`를 렌더 (`getInputTypeForColumn` 기존 사용 확인).
4. 각 데이터 타입에 대한 helper + flip 시나리오 테스트 추가 (`DataGridTable.editing-visual.test.tsx` 확장 또는 신규).
5. `pnpm tsc --noEmit`, `pnpm lint`, `pnpm vitest run` 모두 통과.

## Verification Plan
- **Profile**: mixed (command + browser)
- **Required checks**:
  1. `pnpm tsc --noEmit` → 에러 0
  2. `pnpm lint` → 에러 0
  3. `pnpm vitest run` → 전부 통과 (기존 + 신규)
  4. (선택) 브라우저에서 date 컬럼 편집 → Cmd+Backspace → 'a' 입력 → `<input type="date">` 가 뜨는지 확인 (tauri dev 연결 필요, 수동 확인 가능 시).
- **Required evidence**:
  - 변경/추가 파일 목록 + 목적
  - helper 시그니처 + 각 테스트의 AC 매핑
  - 세 검증 명령의 출력 마지막 몇 줄 (tests passed count, error count).

## Evidence To Return
- 변경/추가 파일 목록 (path: 목적)
- 실행한 검증 명령 + 결과 (tsc/lint/vitest)
- 각 Done Criterion 별 evidence (test 파일 + 라인 번호)
- 구현 중 한 가정이나 결정 (예: boolean을 어떻게 렌더하기로 했는지)
- 남은 위험/갭 (예: boolean select UI는 Sprint 75로 미룸)

## References
- **Contract**: `docs/sprints/sprint-74/contract.md`
- **Master spec**: `docs/sprints/sprint-74/spec.md` (Sprint 74 섹션)
- **Relevant files**:
  - `src/components/datagrid/useDataGridEdit.ts` — helper 추가 위치
  - `src/components/datagrid/DataGridTable.tsx` — NULL 칩 + input 분기
  - `src/components/datagrid/DataGridTable.editing-visual.test.tsx` — 테스트 확장 주 대상
  - `src/components/datagrid/useDataGridEdit.cellToEditValue.test.ts` — helper 테스트 추가 위치
  - ADR 0009 (`memory/decisions/0009-null-vs-empty-string-tri-state/memory.md`)
  - Lesson 2026-04-24-react-autofocus-form-control-only (`memory/lessons/2026-04-24-react-autofocus-form-control-only/memory.md`)
