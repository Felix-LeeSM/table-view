# Sprint Execution Brief: sprint-122 — DocumentFilterBar (Mongo filter 별도 viewer)

## Objective

- NEW `src/components/document/DocumentFilterBar.tsx` — Mongo collection filter UI 를 별도 viewer 로 신설.
- 두 모드: **Raw MQL** (CodeMirror JSON + `useMongoAutocomplete`) / **Structured** (MQL operators `$eq` `$ne` `$gt` `$lt` `$gte` `$lte` `$regex` `$exists`).
- NEW `src/lib/mongo/mqlFilterBuilder.ts` — pure function, structured → MQL JSON 변환.
- `DocumentDataGrid.tsx` 가 mount + filter state 를 `documentStore.runFind` 로 전달.
- 신규 테스트 ≥ +7.

## Task Why

- Read path 의 마지막 큰 adapter blindspot. Sprint 72 backend `find` 가 `filter` 수용; 현재 Mongo collection 의 filter toggle 은 no-op.
- 사용자 의문 "viewer 가 따로 있어야 한다" 의 가장 큰 leaf 분리 — RDB `FilterBar` 를 paradigm prop 으로 fork 하지 않고 별도 컴포넌트.
- mqlFilterBuilder 분리는 mqlGenerator (write-only) 와의 책임 분리 유지.

## Scope Boundary

- **Hard stop**:
  - `src/components/rdb/FilterBar.tsx` byte-identical (sprint-120 결과 보존)
  - `src/components/rdb/DataGrid.tsx` byte-identical
  - `src-tauri/**`
  - `src/components/datagrid/useDataGridEdit.ts`
  - `src/lib/mongo/mqlGenerator.ts` (write-only generator separate)
  - `src/lib/paradigm.ts` (sprint-120)
  - `src/components/document/AddDocumentModal.tsx` (sprint-121 결과 보존)
  - `src/hooks/useMongoAutocomplete.ts` (consume only)
  - `src/components/connection/ConnectionDialog.tsx`
  - `src/components/query/QueryEditor.tsx`
- **Write scope**:
  - 신규: `src/components/document/DocumentFilterBar.tsx` + `.test.tsx`
  - 신규: `src/lib/mongo/mqlFilterBuilder.ts` + `.test.ts`
  - 수정: `src/components/document/DocumentDataGrid.tsx` (mount + filter state)
  - 수정: `src/stores/documentStore.ts` (필요 시 `runFind` filter parameter surgical 추가)

## Invariants

- 기존 RDB FilterBar 회귀 0 — `FilterBar.test.tsx` (rdb 폴더) byte-for-byte 통과
- sprint-120/121 결과 byte-identical
- mqlGenerator (write-side) 와 mqlFilterBuilder (read-side) 책임 분리 유지
- `useMongoAutocomplete` extensions consume only — 재구현 금지
- `pnpm tsc --noEmit` + `pnpm lint` 0 errors
- Vitest baseline (sprint-121 결과) + ≥ +7

## Done Criteria

1. `src/components/rdb/FilterBar.tsx` 미변경 (git diff empty)
2. DocumentFilterBar 가 toggle + Raw MQL + Structured 모드 제공
3. Structured → MQL JSON 변환이 ≥ 5 operator 검증
4. Raw MQL 에디터가 fieldsCache field AC + `$`-operator AC 노출
5. Invalid MQL JSON 배너 + onApply 미호출
6. Mode switch (Structured → Raw prefill, Raw → Structured 는 "manual" 또는 best-effort)
7. DocumentDataGrid 가 DocumentFilterBar mount + runFind 가 filter 수용
8. RDB FilterBar.test.tsx byte-for-byte 통과 — regression by exclusion
9. v1 은 flat-field 만 — nested 는 handoff 에 deferred 명시
10. sprint-120/121 결과 byte-identical 검증

## Verification Plan

- **Profile**: `command`
- **Required checks**:
  1. `pnpm tsc --noEmit` → 0 errors
  2. `pnpm lint` → 0 errors
  3. `pnpm vitest run` → baseline + ≥ +7 신규
  4. `git diff --stat HEAD -- src-tauri/ src/components/datagrid/useDataGridEdit.ts src/lib/mongo/mqlGenerator.ts src/components/rdb/ src/lib/paradigm.ts src/components/document/AddDocumentModal.tsx` → empty
- **Required evidence**:
  - DocumentFilterBar mount + 모드 분기 file:line
  - mqlFilterBuilder 의 5 operator 처리 file:line
  - DocumentDataGrid 의 mount + filter state file:line
  - documentStore.runFind 의 filter 파라미터 위치 file:line
  - 신규 7 테스트 이름 + AC 매핑
  - hard-stop diff empty 캡처

## Evidence To Return

- 변경 파일 목록 + 목적 (신규 4 + 수정 2)
- 4 check 의 실행 명령 + 결과 수치
- AC-01 ~ AC-10 별 file:line 또는 test name
- Assumptions:
  - mqlFilterBuilder 가 flat-field 만 처리 — `field $op value` 형태
  - structured → raw prefill 시 JSON 직렬화 포맷 (들여쓰기 2 spaces) 사용
  - Raw → Structured 는 v1 에서 "manual edit required" 배너로 처리 (best-effort parse 는 후속)
  - documentStore.runFind 가 이미 filter parameter 를 수용하는 경우 surgical 추가 0
- Residual risk:
  - nested path / `$elemMatch` / `$in` array 미지원 — handoff 에 명시
  - structured 모드의 datatype 추측 (string vs number) — 단순 휴리스틱 적용 (숫자형이면 number, 아니면 string); follow-up 에서 명시 type 지정 가능

## References

- Master plan: `~/.claude/plans/idempotent-snuggling-brook.md`
- Contract: `docs/sprints/sprint-122/contract.md`
- Findings: `docs/sprints/sprint-122/findings.md` (Generator 작성)
- Handoff: `docs/sprints/sprint-122/handoff.md` (Generator 작성)
- Relevant files:
  - `src/components/document/DocumentFilterBar.tsx` (NEW)
  - `src/components/document/DocumentFilterBar.test.tsx` (NEW)
  - `src/lib/mongo/mqlFilterBuilder.ts` (NEW)
  - `src/lib/mongo/mqlFilterBuilder.test.ts` (NEW)
  - `src/components/document/DocumentDataGrid.tsx` (sprint-120 위치)
  - `src/components/rdb/FilterBar.tsx` (참고용; RDB 패턴, hard-stop)
  - `src/hooks/useMongoAutocomplete.ts` (consume)
  - `src/stores/documentStore.ts` (`runFind` 확장 후보)
