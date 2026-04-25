# Sprint Execution Brief: sprint-121 — AddDocumentModal v2 (CodeMirror + BSON-aware AC)

## Objective

- `src/components/document/AddDocumentModal.tsx` 의 `<textarea>` 를 CodeMirror 6 + `useMongoAutocomplete({ queryMode: "find", fieldNames })` 로 교체.
- `documentStore.fieldsCache[connId:db:coll]` 에서 inferred field name 을 부모 `DocumentDataGrid` 가 도출 → modal 에 props 로 전달.
- `JSON.parse` submit semantics + `parseError` 배너 + 서버 측 `error` prop 모두 보존.
- 신규 테스트 +5 cases.

## Task Why

- Phase 6 plan F 의 사용자 명시 요청 — "MongoDB document 추가". v1 textarea 는 field name + BSON helper 를 손으로 입력해야 함.
- QueryEditor 와 동등한 JSON insert UX 달성.
- sprint-120 의 폴더 재조직 결과 (`src/components/document/`) 위에서 자연스럽게 안착.

## Scope Boundary

- **Hard stop**:
  - `src-tauri/**`
  - `src/components/datagrid/useDataGridEdit.ts`
  - `src/components/datagrid/sqlGenerator.ts`, `src/lib/mongo/mqlGenerator.ts`
  - `src/lib/tauri.ts`, `src/types/documentMutate.ts`
  - `src/hooks/useMongoAutocomplete.ts` (consume only)
  - `src/components/rdb/**` (sprint-120 결과 보존)
  - `src/lib/paradigm.ts` (sprint-120 결과 보존)
  - `src/components/connection/ConnectionDialog.tsx`
  - `src/components/query/QueryEditor.tsx`
- **Write scope**:
  - 수정: `src/components/document/AddDocumentModal.tsx` (refactor)
  - 수정: `src/components/document/AddDocumentModal.test.tsx` (extend)
  - 수정: `src/components/document/DocumentDataGrid.tsx` (props 전달)

## Invariants

- Sprint 87 의 AddDocumentModal 테스트 모두 통과 (회귀 0)
- sprint-120 결과 (rdb/document 폴더 구조 + `paradigm.ts`) byte-identical
- `useMongoAutocomplete` extensions 그대로 소비 (재구현 금지)
- `onSubmit(parsed)` contract byte-for-byte 보존
- Vitest baseline (sprint-120 결과 기준) + ≥ +5
- `pnpm tsc --noEmit` + `pnpm lint` 0 errors

## Done Criteria

1. Modal 이 CodeMirror editor (`json()` + `useMongoAutocomplete` extensions) 렌더; textarea 제거
2. `fieldsCache` 항목 있을 때 JSON key 위치 field name completion 노출
3. BSON helper AC 가 value 위치 노출
4. Cmd/Ctrl+Enter 제출 + Esc/Cancel 닫기 + `onSubmit(parsed)` 보존
5. Invalid JSON parseError 배너 + 서버 `error` prop 보존
6. 새 optional props `connectionId`/`database`/`collection` 수용 + 누락 시 generic AC fallback
7. Sprint 87 테스트 모두 통과 + 신규 ≥ +5
8. Single-document scope 명시 (insertMany 보류)
9. sprint-120 결과 byte-identical (`git diff` 검증)

## Verification Plan

- **Profile**: `command`
- **Required checks**:
  1. `pnpm tsc --noEmit` → 0 errors
  2. `pnpm lint` → 0 errors
  3. `pnpm vitest run` → baseline + ≥ +5 신규
  4. `git diff --stat HEAD -- src-tauri/ src/components/datagrid/useDataGridEdit.ts src/lib/mongo/mqlGenerator.ts src/hooks/useMongoAutocomplete.ts src/components/rdb/ src/lib/paradigm.ts` → empty
- **Required evidence**:
  - CodeMirror 호출 file:line + extensions 인자
  - DocumentDataGrid 의 fieldsCache 도출 file:line + props 전달 file:line
  - 신규 5 테스트의 이름 + 어떤 AC 에 대응하는지
  - hard-stop diff empty 캡처
  - vitest 통계 (total / passed / failed)

## Evidence To Return

- 변경 파일 목록 + 목적 (수정 3)
- 4 check 의 실행 명령 + 결과 수치
- AC-01 ~ AC-09 별 file:line 또는 test name
- Assumptions:
  - `useMongoAutocomplete` 가 BSON helper AC 를 value 위치에서 자연스럽게 노출 (Sprint 83 의 operator completion source 가 그 역할)
  - `fieldsCache` 키 형식 `${connId}:${db}:${coll}` 가 Sprint 65/66 이후 안정
  - CodeMirror 의 `EditorView` 가 Radix Dialog 마운트 라이프사이클과 정상 동작 (QueryEditor 패턴 미러링)
- Residual risk:
  - 중첩 필드 편집 미지원 (Phase 6 out-of-scope 명시)
  - JSON 스키마 검증 부재 — backend 거부 의존
  - `_id` 자동 생성을 Mongo 서버에 위임 (frontend ObjectId 생성 안 함)

## References

- Master plan: `~/.claude/plans/idempotent-snuggling-brook.md`
- Contract: `docs/sprints/sprint-121/contract.md`
- Findings: `docs/sprints/sprint-121/findings.md` (Generator 작성)
- Handoff: `docs/sprints/sprint-121/handoff.md` (Generator 작성)
- Relevant files:
  - `src/components/document/AddDocumentModal.tsx` (refactor)
  - `src/components/document/AddDocumentModal.test.tsx` (extend)
  - `src/components/document/DocumentDataGrid.tsx` (props 전달)
  - `src/hooks/useMongoAutocomplete.ts` (Sprint 83, consume only)
  - `src/stores/documentStore.ts` (`fieldsCache` 참조)
  - `src/components/query/QueryEditor.tsx` (CodeMirror + Radix 패턴 참고)
