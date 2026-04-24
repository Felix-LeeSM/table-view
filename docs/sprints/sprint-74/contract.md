# Sprint Contract: Sprint 74 — Type-Aware Editing and NULL Re-entry

## Summary
- **Goal**: NULL 칩에서 printable key로 편집을 재개할 때 컬럼의 데이터 타입에 맞는 에디터가 열리도록 한다. date/datetime/timestamp/time/numeric/integer/boolean/uuid 컬럼은 문자 string 에디터로 퇴보하지 않는다.
- **Audience**: 테이블 데이터 편집 중 실수로 NULL 로 바꿨다가 다시 값을 입력하려는 사용자.
- **Owner**: Generator (일반 general-purpose agent)
- **Verification Profile**: `mixed` (command + browser)

## In Scope
- `src/components/datagrid/useDataGridEdit.ts`: 컬럼 데이터 타입과 키스트로크를 입력받아 (a) 복귀할 에디터의 HTML input 타입, (b) 씨드 값을 반환하는 helper를 추가. `getInputTypeForColumn`과의 관계 명확화.
- `src/components/datagrid/DataGridTable.tsx`: NULL 칩 분기의 printable-key 처리를 새 helper로 라우팅. `onSetEditValue(e.key)` 맹목 호출을 제거하고 타입별 seed + 적절한 `<input type>`이 다음 렌더에 렌더되도록 한다.
- `DataGridTable`의 일반 `<input>` 분기: `getInputTypeForColumn(col.data_type)` 이미 쓰고 있으므로 NULL flip 후 바로 같은 타입이 나오도록 일관성 유지.
- 단위 테스트: `useDataGridEdit.cellToEditValue.test.ts` 혹은 신규 `useDataGridEdit.type-aware-seed.test.ts`에서 type-aware helper 케이스 커버. `DataGridTable.editing-visual.test.tsx`에서 NULL 칩 + key press → 타입별 input 렌더 회귀 방지 테스트.

## Out of Scope
- SQL 생성 레벨의 타입 변환 (Sprint 75 범위).
- 잘못된 형식에 대한 inline validation hint (Sprint 75 범위).
- 새 에디터 컴포넌트 도입 (boolean을 select로 바꾸는 정도의 UI 강화는 이 sprint 범위에서는 optional — 최소 요구는 기존 `<input>`의 `type` 속성을 타입에 맞게 변경).

## Invariants
- ADR 0009 tri-state 계약 (`string | null`) 유지. NULL 상태 진입/이탈은 Cmd/Ctrl+Backspace + printable key 경로 그대로.
- 기존 focus 관리(editorFocusRef) 유지 — NULL → typed editor flip 시에도 포커스가 새 요소로 이동해야 함.
- 포커스 / `autoFocus` 제거 (form control만 동작) 패턴 (lesson 2026-04-24) 유지.
- 텍스트 컬럼(text/varchar/char/citext/json)의 편집 동작은 변경 없음.

## Acceptance Criteria
- `AC-01`: `cellToEditValue`나 같은 파일의 새 helper가 (dataType, key) → { inputType, seed } 파생을 제공한다.
- `AC-02`: NULL 칩 상태에서 printable key를 누르면 date/datetime/timestamp 컬럼은 비어있는 date/datetime-local 에디터를, boolean은 비어있는 에디터(또는 직접 타입된 글자를 seed로 받지 않는 에디터)를, uuid는 비어있는 text를, 숫자는 숫자만 받는 에디터를 연다. text는 기존대로 글자를 seed로 받는다.
- `AC-03`: printable key가 해당 타입에서 합법적인 first character가 아니면 (예: integer에서 "a") 이벤트를 삼키고 상태 변화 없음.
- `AC-04`: Cmd/Ctrl+Backspace는 모든 타입 에디터에서 NULL 칩으로 복귀시킨다 (ADR 0009 보존).
- `AC-05`: 단위 테스트가 NULL → date, NULL → integer, NULL → boolean, NULL → text 각 경로의 결과 에디터 타입과 seed 값을 검증.

## Design Bar / Quality Bar
- Helper 함수는 순수 함수로 추출 (쉽게 테스트 가능). `dataType` 파싱은 기존 `getInputTypeForColumn` 로직과 일관된 lowercasing / includes 패턴.
- `DataGridTable`의 onKeyDown 내부 로직은 최소 분기로 유지. Helper에 위임.
- `<input type="number">` 같은 native 입력 필터에 의존하되, first-key 필터는 helper에서 판별.

## Verification Plan

### Required Checks
1. `pnpm tsc --noEmit` 에러 0.
2. `pnpm lint` 에러 0.
3. `pnpm vitest run` 전체 통과. 신규 type-aware 테스트 포함.
4. (Manual, optional during generation): Postgres 연결 상태에서 date 컬럼 편집 → Cmd+Backspace → "a" 입력 시 text input이 나타나지 않고 date input이 빈 상태로 나타난다.

### Required Evidence
- Generator must provide:
  - 변경/추가 파일 목록 + 각 파일의 목적
  - helper 시그니처와 테스트 케이스 리스트
  - `pnpm tsc --noEmit`, `pnpm lint`, `pnpm vitest run` 실행 결과
  - AC별 커버리지: 어떤 테스트가 어떤 AC를 검증하는지 매핑
- Evaluator must cite:
  - 각 AC에 대한 구체 증거 (test 파일 이름 + 라인 번호 혹은 코드 인용)
  - 누락/약한 증거는 finding으로 기록

## Test Requirements

### Unit Tests (필수)
- AC-01: helper 시그니처 케이스 — text/varchar, date, datetime, timestamp, time, integer, numeric, boolean, uuid, jsonb, unknown(fallback) 각각.
- AC-02: "NULL + printable key" 시나리오 — date 컬럼 + "a" → editValue가 "" (not "a") 로 flip, editor type = "date".
- AC-02: boolean 컬럼 + "t" → seed 적절 처리 (boolean은 어떻게 표현할지 generator가 판단; select가 아니면 "t"를 받아 나중에 coercion 단계에서 true로 변환할 수 있어야 함).
- AC-03: integer 컬럼 + "x" (숫자 아닌 키) → editValue 변화 없음, editingCell 유지.
- AC-04: 각 타입 에디터에서 Cmd+Backspace → editValue === null.
- AC-05: NULL → text 경로는 기존대로 seed="a" 로 flip (회귀 방지).

### Coverage Target
- 신규 helper: 라인 90% 이상.
- `DataGridTable` 추가 분기: 라인 80% 이상.

### Scenario Tests (필수)
- [x] Happy path (각 타입의 NULL → typed editor flip)
- [x] 에러/예외 (integer에 비숫자 키 / boolean에 아무 키나)
- [x] 경계 (text 컬럼은 변화 없음)
- [x] 기존 기능 회귀 없음 (DataGridTable 기존 테스트 전부 통과)

## Test Script / Repro Script
1. Cell 편집 시작 (double-click).
2. Cmd+Backspace → NULL 칩 렌더.
3. 'a' 입력 → 컬럼 타입에 맞는 에디터가 렌더되고 포커스.
4. Cmd+Backspace → NULL 칩 복귀.
5. 반복으로 회귀 없는지 확인.

## Ownership
- Generator: general-purpose agent.
- Write scope: `src/components/datagrid/useDataGridEdit.ts`, `src/components/datagrid/DataGridTable.tsx`, 신규/기존 test 파일.
- Merge order: 이 sprint 단독 commit. Sprint 75 전에 병합 (Sprint 75가 해당 helper에 의존).

## Exit Criteria
- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes`
- 모든 AC 증거가 `handoff.md` 에 기록됨 (generator evidence packet 에서 발췌).
