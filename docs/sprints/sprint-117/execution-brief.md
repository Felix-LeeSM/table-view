# Sprint Execution Brief: sprint-117

## Objective

DocumentDataGrid 페이지네이션이 RDB DataGrid 와 동일한 First/Prev/Jump/Next/Last + Radix Select 면을 노출함을 회귀 방지 테스트로 명시적 검증. 코드 변경 없음.

## Task Why

DocumentDataGrid 는 sprint 87 에서 DataGridToolbar 를 공유 마운트하는 형태로 정렬됐고, sprint 112 에서 size select 가 Radix 로 정규화됨. 정렬은 이미 완료된 상태지만 (a) 회귀 방지 테스트 부재, (b) 미래에 doc / RDB toolbar 가 분기될 위험, (c) sprint 121-123 후속 작업이 본 정렬을 전제 — 따라서 안전장치 sprint 가 필요.

## Scope Boundary

- **건드리지 말 것**:
  - `DataGridToolbar.tsx` (이미 정렬됨).
  - `DocumentDataGrid.tsx` (마운트 path 보존).
  - 기존 19 개 DocumentDataGrid 테스트.
  - sprint 112 의 Radix Select 정규화 / `src/test-setup.ts` 폴리필.
- **반드시 보존**:
  - sprint 87 / sprint 112 path.
  - 1829 baseline tests.

## Invariants

- 1829 + 신규 N tests pass.
- `pnpm tsc --noEmit` / `pnpm lint` 0.
- 신규는 `DocumentDataGrid.pagination.test.tsx` 단일 파일.

## Done Criteria

1. `DocumentDataGrid.pagination.test.tsx` 존재. 4 케이스 이상.
2. 5 개 페이지네이션 컨트롤 (First/Prev/Jump/Next/Last) + size select 마운트 단언.
3. Jump 입력 invalid / valid 분기 단언.
4. Radix Select trigger → option 노출 단언 (sprint 112 회귀 방지).
5. 기존 19 케이스 무회귀 + 1829 + 신규 테스트 통과.
6. tsc / lint 0.

## Verification Plan

- Profile: `command`
- Required checks:
  1. `pnpm vitest run`
  2. `pnpm tsc --noEmit`
  3. `pnpm lint`
- Required evidence:
  - 신규 테스트 파일 경로 + 케이스 ID 리스트.
  - 명령 결과 (vitest pass count).
  - AC-01..05 매핑.

## Evidence To Return

- 신규 / 변경 파일 + 목적.
- 신규 테스트 케이스 → AC 매핑.
- 명령어 결과.
- 가정 / 리스크.
