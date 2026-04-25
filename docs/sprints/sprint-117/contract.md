# Sprint Contract: sprint-117

## Summary

- Goal: DocumentDataGrid 의 페이지네이션 컨트롤이 RDB DataGrid 와 **동일한 surface** (First/Prev/Jump/Next/Last + size select) 를 노출하도록 정렬되었음을 명시적으로 검증. 현재 DocumentDataGrid 는 sprint 87 에서 RDB 와 동일한 `DataGridToolbar` 를 마운트하도록 구현되어 있고 sprint 112 에서 size select 가 Radix `Select` 로 정규화됨 — 즉, **구현은 이미 정렬**. 본 sprint 는 (a) 정렬 사실의 회귀 방지 테스트 추가 + (b) 사용자 페이지 jump 입력 검증 (숫자/범위) 의 확정 + (c) 추후 코드 리팩토링 시 doc/RDB toolbar 가 분기되지 않게 하는 안전장치.
- Audience: 메인테이너 + 후속 sprint (sprint 121-123 의 DocumentFilterBar / paradigm visual cues 는 본 정렬을 전제).
- Owner: 메인테이너.
- Verification Profile: `command` — spec 은 `browser` 였지만 실제 검증 가능한 단언이 모두 jsdom + RTL 에서 가능 (toolbar 단일 컴포넌트 마운트, 페이지 jump 입력 / Radix Select / aria-label 검증). 실측 (브라우저 페이지 jump 키 입력) 은 `UI-FU-05` (창 크기) 와 별개로 본 sprint 의 회귀 방지에 필요 없음.

## In Scope

- 신규 `src/components/DocumentDataGrid.pagination.test.tsx`:
  - **AC-01** — `screen.getByLabelText("First page" | "Previous page" | "Next page" | "Last page" | "Jump to page")` 5 개 단언. RDB `DataGrid.test.tsx` 의 동일 케이스와 wording 일치.
  - **AC-01** — page size `Select` 의 `getByLabelText("Page size")` trigger 마운트 단언 (Radix Select trigger 는 button role + aria-label).
  - **AC-02** — Jump 입력 invalid (음수, 초과, 빈 문자열) 시 `onSetPage` mock 미호출.
  - **AC-02** — Jump 입력 valid 시 `onSetPage` 가 정확한 숫자로 호출.
  - **AC-03** — page size `Select` trigger 클릭 → option list 가 `role="option"` 로 렌더 (sprint 112 normalize 의 회귀 방지). userEvent 클릭 패턴 (sprint 112 testing pattern 일치).
  - **AC-04** — 기존 19 개 DocumentDataGrid 테스트 무회귀.
- 코드 변경 0. 본 sprint 는 검증 추가 sprint.
- 신규 sprint artifact 3 개 (`contract.md`, `execution-brief.md`, `handoff.md`).

## Out of Scope

- DataGridToolbar 자체의 동작 변경 (이미 정렬됨).
- DocumentFilterBar (sprint 122).
- AddDocumentModal v2 (sprint 121).
- paradigm 시각 cue (sprint 123).
- Mongo 편집 P0 결정 (`UI-FU-08`).

## Invariants

- 1829 baseline tests 회귀 0.
- DocumentDataGrid 의 prop API / 외부 호출 변경 없음.
- DataGridToolbar 미수정.
- sprint 87 의 DocumentDataGrid → DataGridToolbar 마운트 path 보존.
- sprint 112 의 Radix Select 정규화 보존.

## Acceptance Criteria

- `AC-01`: DocumentDataGrid 가 First/Prev/Next/Last (4 개 button + Jump input + size select) 5 개 컨트롤을 모두 마운트. `getByLabelText` 단언으로 검증.
- `AC-02`: Jump 입력 — 빈 문자열 / 음수 / `totalPages` 초과 시 `onSetPage` 미발화. 유효 숫자 시 정확히 호출.
- `AC-03`: size select 는 native `<select>` 가 아닌 Radix Select. trigger 클릭 → `role="option"` 노드가 노출.
- `AC-04`: 기존 19 개 DocumentDataGrid 테스트 회귀 0. 신규 테스트는 별도 파일 (`DocumentDataGrid.pagination.test.tsx`) 에서 격리.
- `AC-05`: `pnpm vitest run` 1829 + 신규 N. `pnpm tsc --noEmit` 0. `pnpm lint` 0.

## Design Bar / Quality Bar

- 테스트는 RDB `DataGrid.test.tsx` 의 동등 케이스와 **identical wording / aria-label** 사용 — 미래에 DataGridToolbar 가 분기되면 양쪽이 동시에 깨져야 함.
- userEvent 패턴 (sprint 112) 일치 — `userEvent.setup()` + `await user.click(...)`.
- jsdom 폴리필 (`hasPointerCapture`, `releasePointerCapture`, `scrollIntoView`) 은 sprint 112 가 이미 `src/test-setup.ts` 에 idempotent 로 추가했으므로 본 sprint 는 그대로 사용.

## Verification Plan

### Required Checks

1. `pnpm vitest run` — 1829 + 신규 (>= 4 신규 케이스 권장) 통과.
2. `pnpm tsc --noEmit` — 0.
3. `pnpm lint` — 0.

### Required Evidence

- Generator must provide:
  - 신규 테스트 파일 경로 + 케이스 리스트.
  - 검증 명령 결과 (vitest pass count).
  - AC-01..05 단언 매핑 (테스트 ID → AC ID).
- Evaluator must cite:
  - 신규 테스트 파일 직접 inspect (jsdom + RTL 사용 확인).
  - userEvent 패턴 일치 여부 (sprint 112).
  - 기존 19 케이스 회귀 0.

## Test Requirements

### Unit Tests (필수)

- `DocumentDataGrid.pagination.test.tsx` — 4-6 케이스:
  1. 5 개 컨트롤 마운트 (AC-01).
  2. Jump invalid → `onSetPage` 미발화 (AC-02).
  3. Jump valid → 정확 호출 (AC-02).
  4. Radix Select trigger → option 노출 (AC-03).
  5. (선택) Last/First button 클릭 → `onSetPage(totalPages)` / `onSetPage(1)` 호출.

### Coverage Target

- 신규 / 수정 코드 0. CI 전체 기준 유지.

### Scenario Tests (필수)

- [x] Happy path — Jump 정상 입력.
- [x] 에러/예외 — Jump invalid 입력.
- [x] 경계 조건 — `totalPages` 초과.
- [x] 회귀 0 — 기존 19 케이스 무회귀.

## Test Script / Repro Script

1. `pnpm vitest run src/components/DocumentDataGrid.pagination.test.tsx`.
2. `pnpm vitest run` (전체).
3. `pnpm tsc --noEmit`.
4. `pnpm lint`.

## Ownership

- Generator: 메인테이너 직접 (소규모 검증 sprint).
- Write scope: `src/components/DocumentDataGrid.pagination.test.tsx` (신규), `docs/sprints/sprint-117/{contract,execution-brief,handoff}.md`.
- Merge order: 본 문서 → execution brief → 테스트 추가 → 검증 → handoff.

## Exit Criteria

- Open `P1`/`P2` findings: `0`.
- Required checks passing: `yes`.
- Acceptance criteria evidence linked in `handoff.md`.
