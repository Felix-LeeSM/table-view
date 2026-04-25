# Sprint Execution Brief: sprint-118

## Objective

MongoDB 도큐먼트 paradigm UI 의 `row` / `column` 용어를 `document` / `field` 로 교체. RDB 무회귀 보장.

## Task Why

`docs/ui-evaluation-results.md` `#PAR-2` — paradigm 정합성: MongoDB 컬렉션 그리드/도큐먼트 그리드의 RDB 용어가 사용자 mental model 을 흐리는 부분을 정합. sprint 121-123 의 paradigm 시각 cue / DocumentFilterBar / AddDocumentModal v2 가 본 정합을 전제.

## Scope Boundary

- **건드리지 말 것**:
  - RDB DataGrid wording (`Add row`, `Delete row`, `42 rows`) 유지.
  - `DataGridToolbar` 의 prop 시그니처 — optional 추가만, breaking 0.
  - sprint 117 의 `DocumentDataGrid.pagination.test.tsx` wording.
  - `MqlGenerationError.column` API 시그니처 (코드 식별자는 보존, 노출 텍스트만 변경).
- **반드시 보존**:
  - DataGridToolbar default props = RDB wording.
  - 1834 baseline tests.

## Invariants

- 1834 baseline tests + 갱신된 wording 단언 PASS.
- `pnpm tsc --noEmit` / `pnpm lint` 0.
- DataGridToolbar 의 default props (override 미전달 시) 는 RDB 시멘틱.

## Done Criteria

1. `DOCUMENT_LABELS` 가 `src/lib/strings/document.ts` 에 export.
2. DataGridToolbar 가 4 개 optional override props 수용 + default = RDB.
3. DocumentDataGrid 가 override 전달 + mqlErrors 의 `column` 용어 → `field`.
4. MqlPreviewModal 헤더 / 라인 prefix 에서 `row` → `document`.
5. Document 테스트 wording 갱신 (DocumentDataGrid.test, MqlPreviewModal.test).
6. RDB 테스트 회귀 0.
7. tsc / lint 0.

## Verification Plan

- Profile: `command`
- Required checks:
  1. `pnpm vitest run`
  2. `pnpm tsc --noEmit`
  3. `pnpm lint`
- Required evidence:
  - 변경 파일 + 한 줄 목적.
  - 갱신된 테스트 case ID + AC 매핑.
  - 명령 결과 (vitest pass count).

## Evidence To Return

- Changed files with purpose.
- Test wording 갱신 케이스 + AC 매핑.
- Command outputs.
- 가정 / 리스크.
