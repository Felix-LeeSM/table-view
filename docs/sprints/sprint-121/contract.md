# Sprint Contract: sprint-121 — AddDocumentModal v2 (CodeMirror + BSON-aware AC)

## Summary

- **Goal**: `AddDocumentModal` 의 plain `<textarea>` 를 CodeMirror 6 + `useMongoAutocomplete({ queryMode: "find", fieldNames })` 로 교체. `documentStore.fieldsCache` 의 inferred field name 을 부모 `DocumentDataGrid` 가 전달. `JSON.parse` submit semantics 보존, single-document scope.
- **Audience**: Frontend (React/TypeScript, CodeMirror 6, Mongo paradigm)
- **Owner**: Generator (sprint-121)
- **Verification Profile**: `command`

## In Scope

- `src/components/document/AddDocumentModal.tsx` (sprint-120 결과 위치) refactor:
  - textarea 제거 → CodeMirror 6 (`json()` lang + `useMongoAutocomplete` extensions)
  - 새 optional props: `connectionId`, `database`, `collection`
  - Cmd/Ctrl+Enter 제출 키바인딩
  - `parseError` 배너 + 서버 측 `error` prop 보존
- `src/components/document/AddDocumentModal.test.tsx` extend (+5 cases)
- `src/components/document/DocumentDataGrid.tsx` (sprint-120 위치): `fieldsCache[connId:db:coll]` 에서 fieldNames 도출 → AddDocumentModal 에 전달

## Out of Scope

- `insertMany` / JSON-array 입력 (Sprint 124+ candidate)
- 중첩 필드 경로 편집
- BSON 헬퍼 자동 변환 (string `"ObjectId(...)"` → BSON object) — 현재는 mongo 측이 거부 시 backend error 로 처리
- JSON Schema 검증 부재 — backend 가 거부할 키/타입은 server error 로
- `useDataGridEdit.ts` 변경
- 새 paradigm 시각 cue (Sprint 123)

## Invariants

- `src-tauri/**` byte-identical
- `src/components/datagrid/useDataGridEdit.ts` byte-identical (Sprint 86 보존)
- `src/hooks/useMongoAutocomplete.ts` byte-identical (consume only)
- `src/lib/mongo/mqlGenerator.ts` byte-identical (write-side generator separate)
- `src/components/rdb/DataGrid.tsx`, `src/components/rdb/FilterBar.tsx` byte-identical (sprint-120 결과 보존)
- `src/lib/paradigm.ts` byte-identical (sprint-120 결과 보존)
- Sprint 87 의 AddDocumentModal 테스트 모두 통과 (회귀 0)
- `onSubmit(parsed)` contract 보존

## Acceptance Criteria

- `AC-01`: Modal 이 CodeMirror editor 렌더 (`json()` lang + `useMongoAutocomplete` extensions); textarea 제거
- `AC-02`: `fieldsCache` 에 `${connectionId}:${database}:${collection}` 항목이 있을 때 JSON key 위치에서 cached field name completions 표시
- `AC-03`: BSON helper AC (ObjectId / ISODate / NumberLong / NumberDecimal) 가 value 위치에서 표시 (`queryMode: "find"` 의 operator completion source 활용)
- `AC-04`: Cmd/Ctrl+Enter 제출, Esc/Cancel 닫기, `onSubmit(parsed)` byte-for-byte 보존
- `AC-05`: Invalid JSON 은 동일한 `parseError` 배너; 서버 측 `error` prop 보존
- `AC-06`: 새 optional props `connectionId`, `database`, `collection` 수용. 누락 시 generic MQL AC fallback (no field completions)
- `AC-07`: Sprint 87 의 AddDocumentModal 테스트 모두 통과 + 신규 +5 cases
- `AC-08`: Single-document scope — `insertMany` / array 입력은 명시적 out
- `AC-09`: sprint-120 결과 (rdb/document 폴더 + paradigm.ts) byte-identical 보존

## Design Bar / Quality Bar

- CodeMirror 가 Radix Dialog 안에서 focus 탈취 회피 — QueryEditor 패턴 mirror
- `fieldNames` 를 stable reference 로 memo 하여 AC reconfigure thrash 방지
- 테스트는 사용자 관점 (role / 텍스트 query) 우선; CodeMirror 내부 구현 세부 의존 최소화
- Tailwind 다크 모드 지원 + 키보드 네비게이션

## Verification Plan

### Required Checks

1. `pnpm tsc --noEmit` → 0 errors
2. `pnpm lint` → 0 errors
3. `pnpm vitest run` → baseline (sprint-120 결과) + ≥ +5 신규
4. `git diff --stat HEAD -- src-tauri/ src/components/datagrid/useDataGridEdit.ts src/lib/mongo/mqlGenerator.ts src/hooks/useMongoAutocomplete.ts src/components/rdb/ src/lib/paradigm.ts` → empty

### Required Evidence

- Generator must provide:
  - `AddDocumentModal.tsx` 의 CodeMirror 호출 file:line + extensions 인자
  - `DocumentDataGrid.tsx` 의 fieldsCache 도출 + props 전달 file:line
  - 신규 테스트 5 케이스 + 테스트 이름
  - 4 check 결과 캡처
  - hard-stop 파일들의 git diff 가 empty 임 증명
- Evaluator must cite:
  - 각 AC 별 file:line 또는 test name
  - CodeMirror focus 거동 검증 (Radix Dialog 내부)
  - 회귀 없음 증거

## Test Requirements

### Unit Tests (필수)
- AC-01 ~ AC-07 각각에 대응하는 최소 1개 테스트
- 새 props 누락 시 fallback 시나리오 1개
- Invalid JSON parseError 시나리오 1개

### Coverage Target
- 신규/수정 코드: 라인 70% 이상
- CI 전체 baseline 유지

### Scenario Tests (필수)
- [x] Happy path: 유효한 JSON + Cmd+Enter → onSubmit
- [x] 에러: invalid JSON → parseError 배너, onSubmit 미호출
- [x] 경계: fieldsCache 비어있을 때 field AC 미노출 (generic MQL AC 만)
- [x] 회귀: Sprint 87 AddDocumentModal 테스트 모두 통과

## Test Script / Repro Script

1. `pnpm tauri dev` → mongo connection 추가 → collection 열기
2. 툴바 Add → modal 표시 (CodeMirror editor)
3. `{ "` 타이핑 → fieldsCache 에 항목 있으면 field name completion 노출
4. value 위치에서 `Object` 타이핑 → `ObjectId(...)` BSON helper 노출
5. invalid JSON 입력 → parseError 배너; 유효 JSON → Cmd+Enter → onSubmit + modal 닫힘 + grid refresh

## Ownership

- **Generator**: sprint-121 generator
- **Write scope**:
  - 수정: `src/components/document/AddDocumentModal.tsx`, `src/components/document/AddDocumentModal.test.tsx`, `src/components/document/DocumentDataGrid.tsx`
- **Merge order**: sprint-120 → 121 → 122 → 123

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes`
- Acceptance criteria evidence linked in `handoff.md`
- sprint-122 (DocumentFilterBar) 가 동일 폴더 구조 위에서 시작 가능
