# Sprint Contract: sprint-122 — DocumentFilterBar (Mongo filter 별도 viewer)

## Summary

- **Goal**: NEW `src/components/document/DocumentFilterBar.tsx` — Mongo collection 의 filter UI 를 별도 viewer 로 신설. RDB `FilterBar.tsx` (sprint-120 에서 `src/components/rdb/` 위치) 는 byte-identical hard-stop. 두 모드 (Raw MQL / Structured) + 신규 util `mqlFilterBuilder.ts`. `DocumentDataGrid` 가 mount + 결과 JSON 을 `documentStore.runFind` 에 전달.
- **Audience**: Frontend (React/TypeScript, CodeMirror 6, MongoDB MQL)
- **Owner**: Generator (sprint-122)
- **Verification Profile**: `command`

## In Scope

- 신규:
  - `src/components/document/DocumentFilterBar.tsx`
  - `src/components/document/DocumentFilterBar.test.tsx`
  - `src/lib/mongo/mqlFilterBuilder.ts` (read-filter 전용; mqlGenerator 는 write-only 분리 유지)
  - `src/lib/mongo/mqlFilterBuilder.test.ts`
- 수정:
  - `src/components/document/DocumentDataGrid.tsx` — `DocumentFilterBar` mount + filter state wiring
  - `src/stores/documentStore.ts` — `runFind` 가 filter parameter 미지원이면 surgical 추가; 기존 시그니처 보존
- DocumentFilterBar 모드:
  - **Raw MQL**: CodeMirror 6 (`json()` lang) + `useMongoAutocomplete` extensions
  - **Structured**: MQL operator 매핑 (`$eq` / `$ne` / `$gt` / `$lt` / `$gte` / `$lte` / `$regex` / `$exists`) → JSON filter 산출
- Mode switch:
  - Structured → Raw: 현재 structured MQL 을 raw 에디터에 prefill
  - Raw → Structured: "manual edit required" 또는 best-effort parse (handoff 명시)

## Out of Scope

- 중첩 필드 경로 (`a.b.c`) — flat-field 만 v1
- `$elemMatch`, `$in` array, `$or`, `$and` 복합 — 후속 sprint
- `FilterBar.tsx` (rdb 폴더) 변경 — byte-identical hard-stop
- `mqlGenerator.ts` (write-side) 변경
- `useDataGridEdit.ts` 변경

## Invariants

- `src/components/rdb/FilterBar.tsx` byte-identical (sprint-120 결과 보존; `git diff --stat HEAD -- src/components/rdb/FilterBar.tsx` empty)
- `src-tauri/**` byte-identical
- `src/components/datagrid/useDataGridEdit.ts` byte-identical
- `src/lib/mongo/mqlGenerator.ts` byte-identical (write-only generator separate)
- sprint-120 결과 (`src/lib/paradigm.ts`) byte-identical
- sprint-121 결과 (`AddDocumentModal.tsx` v2 본체) byte-identical — `git diff --stat HEAD -- src/components/document/AddDocumentModal.tsx` empty
- 기존 RDB 회귀 0 — `FilterBar.test.tsx` (rdb 폴더) byte-for-byte 통과
- `pnpm tsc --noEmit` + `pnpm lint` 0 errors

## Acceptance Criteria

- `AC-01`: `src/components/rdb/FilterBar.tsx` 미변경 (`git diff --stat HEAD -- src/components/rdb/FilterBar.tsx` empty)
- `AC-02`: `DocumentFilterBar` 가 toggle (open/close), Raw MQL 에디터 (CodeMirror JSON + `useMongoAutocomplete`), Structured 탭 (MQL operators) 제공
- `AC-03`: Structured filter 가 valid MQL JSON 산출 (예: `{"age":{"$gte":18}}`); `mqlFilterBuilder.test.ts` 가 ≥ 5 operator 검증
- `AC-04`: Raw MQL 에디터가 `fieldsCache` field AC + `$`-operator AC 노출
- `AC-05`: Invalid MQL JSON → inline 에러 배너; `onApply` 미호출
- `AC-06`: Structured → Raw 전환 시 raw 에디터 prefill; Raw → Structured 는 "manual edit required" 또는 best-effort parse (handoff 에 동작 명시)
- `AC-07`: `DocumentDataGrid.tsx` 가 `DocumentFilterBar` mount (FilterBar 미사용); `documentStore.runFind` 가 produced filter 수용
- `AC-08`: 기존 `FilterBar.test.tsx` (rdb 폴더) byte-for-byte 통과 — regression by exclusion
- `AC-09`: v1 은 flat-field operator 만; nested path / `$elemMatch` / `$in` array deferred (handoff 명시)
- `AC-10`: sprint-120/121 결과 byte-identical 보존

## Design Bar / Quality Bar

- DocumentFilterBar 의 toggle/모드 전환 UX 가 RDB FilterBar 와 *키 조작 호환* — 사용자 학습 곡선 최소화
- `mqlFilterBuilder` 는 pure function — 단위 테스트 용이
- CodeMirror focus 거동 + Radix tab/popover 충돌 회피
- Tailwind 다크 모드 + 키보드 네비게이션

## Verification Plan

### Required Checks

1. `pnpm tsc --noEmit` → 0 errors
2. `pnpm lint` → 0 errors
3. `pnpm vitest run` → baseline (sprint-121 결과) + ≥ +7 신규
4. `git diff --stat HEAD -- src-tauri/ src/components/datagrid/useDataGridEdit.ts src/lib/mongo/mqlGenerator.ts src/components/rdb/ src/lib/paradigm.ts src/components/document/AddDocumentModal.tsx` → empty

### Required Evidence

- Generator must provide:
  - `DocumentFilterBar.tsx` mount + 모드 분기 file:line
  - `mqlFilterBuilder.ts` 의 5 operator 처리 file:line
  - `DocumentDataGrid.tsx` 의 mount + filter state wiring file:line
  - 신규 7 테스트 케이스 + AC 매핑
  - 4 check 결과 캡처
  - hard-stop diff empty 증명
- Evaluator must cite:
  - 각 AC 별 file:line 또는 test name
  - RDB regression 0 증거 (FilterBar.test.tsx 전체 통과)

## Test Requirements

### Unit Tests (필수)
- `mqlFilterBuilder.test.ts`: ≥ 5 operator (`$eq`/`$gt`/`$gte`/`$regex`/`$exists`) 결과 JSON 검증
- `DocumentFilterBar.test.tsx`: mount, mode 전환, AC 노출, invalid JSON 배너, onApply 호출 시점 (≥ 5)
- 회귀: 기존 `FilterBar.test.tsx` 전체 통과

### Coverage Target
- 신규 코드: 라인 70% 이상
- CI baseline 유지

### Scenario Tests (필수)
- [x] Happy path: structured `age >= 18` → `{"age":{"$gte":18}}` → onApply 호출
- [x] 에러: Raw MQL invalid JSON → 배너 표시 + onApply 미호출
- [x] 경계: fieldsCache 비어있을 때 raw 에디터의 field AC 0
- [x] 회귀: rdb FilterBar 테스트 byte-for-byte 통과

## Test Script / Repro Script

1. `pnpm tauri dev` → mongo connection 추가 → collection 열기
2. Filter toggle 클릭 → DocumentFilterBar 표시
3. Structured 탭에서 `age $gte 18` 입력 → Apply → grid refresh
4. Raw MQL 탭에서 `{"_id": {"$exists": true}}` 입력 → Apply → grid refresh
5. Invalid JSON `{age` → 배너 표시; Apply 비활성/미호출

## Ownership

- **Generator**: sprint-122 generator
- **Write scope**:
  - 신규: `DocumentFilterBar.tsx` + `.test.tsx`, `mqlFilterBuilder.ts` + `.test.ts`
  - 수정: `DocumentDataGrid.tsx`, `documentStore.ts` (필요 시)
- **Merge order**: sprint-120 → 121 → 122 → 123

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes`
- Acceptance criteria evidence linked in `handoff.md`
- sprint-123 (TabBar/QueryLog cue) 가 시작 가능
