# Sprint Contract: Sprint 51

## Summary

- Goal: DataGrid 행에 우클릭 컨텍스트 메뉴를 추가하고, 선택된 행을 다양한 포맷으로 클립보드에 복사
- Audience: Generator, Evaluator
- Owner: harness
- Verification Profile: `command`

## In Scope

- DataGrid 행 우클릭 시 컨텍스트 메뉴 표시
- 컨텍스트 메뉴 항목: Edit Cell, Delete Row, Duplicate Row, Copy Row As (Plain Text, JSON, CSV, SQL Insert)
- Edit Cell: 더블클릭과 동일하게 해당 셀 편집 모드 진입
- Delete Row: 선택된 행 삭제 (Sprint 50의 다중 선택 활용)
- Duplicate Row: 선택된 행의 데이터로 새 행을 pendingNewRows에 추가
- Copy Row As: Plain Text(탭 구분), JSON, CSV, SQL Insert 포맷
- 다중 행 선택 시 선택된 모든 행이 복사/삭제/복제 대상
- 컨텍스트 메뉴 외부 클릭 또는 Escape로 닫기
- 복사 유틸리티 함수: rowsToPlainText, rowsToJson, rowsToCsv, rowsToSqlInsert

## Out of Scope

- Column drag reorder (Sprint 52)
- BLOB viewer (Sprint 53)
- SQL Uglify / Format selection (Sprint 53)
- Schema tree visuals (Sprint 54)
- 컨텍스트 메뉴 서브메뉴 (Copy Row As 항목 4개를 평면 리스트로 나열)

## Invariants

- `pnpm test` 기존 728개 테스트 모두 통과
- `pnpm tsc --noEmit` 타입 에러 0건
- `pnpm lint` ESLint 에러 0건
- `pnpm build` 성공
- Sprint 50의 selectedRowIds / handleSelectRow 인터페이스 변경 없음
- 기존 ContextMenu 컴포넌트 재사용 (SchemaTree와 동일 스타일)
- 다크/라이트 테마 모두 정상
- Rust 백엔드 변경 없음

## Acceptance Criteria

- AC-01: 데이터 행에서 우클릭하면 컨텍스트 메뉴가 행 위치에 나타난다
- AC-02: 컨텍스트 메뉴 항목이 모두 표시된다: Edit Cell, Delete Row, Duplicate Row, Copy as Plain Text, Copy as JSON, Copy as CSV, Copy as SQL Insert
- AC-03: "Edit Cell" 선택 시 해당 셀이 편집 모드로 진입한다
- AC-04: "Delete Row" 선택 시 선택된 모든 행이 pendingDeletedRowKeys에 추가된다
- AC-05: "Duplicate Row" 선택 시 선택된 행의 데이터로 새 행이 pendingNewRows에 추가된다
- AC-06: "Copy as Plain Text" 선택 시 탭 구분 텍스트(컬럼명 헤더 포함)가 클립보드에 복사된다
- AC-07: "Copy as JSON" 선택 시 JSON 객체 배열이 클립보드에 복사된다
- AC-08: "Copy as CSV" 선택 시 CSV 텍스트(필드 이스케이프 포함)가 클립보드에 복사된다
- AC-09: "Copy as SQL Insert" 선택 시 INSERT INTO 구문이 클립보드에 복사된다
- AC-10: 다중 행 선택 상태에서 복사 시 선택된 모든 행이 포함된다
- AC-11: 컨텍스트 메뉴 외부 클릭 또는 Escape로 메뉴가 닫힌다
- AC-12: 빈 데이터(0행)에서 우클릭 시 컨텍스트 메뉴가 나타나지 않는다
- AC-13: 단위 테스트가 컨텍스트 메뉴 동작과 복사 포맷을 커버한다

## Verification Plan

### Required Checks

1. `pnpm tsc --noEmit` — 타입 체크 통과
2. `pnpm vitest run` — 전체 테스트 통과
3. `pnpm lint` — ESLint 에러 0건
4. `pnpm build` — 빌드 성공

### Required Evidence

- Generator must provide:
  - changed files with purpose
  - checks run and outcomes
  - acceptance criteria coverage with concrete evidence
- Evaluator must cite:
  - concrete evidence for each pass/fail decision
  - any missing or weak evidence as a finding

## Test Requirements

### Unit Tests (필수)
- Copy 유틸리티: Plain Text, JSON, CSV, SQL Insert 포맷 각각에 대한 테스트
- Context menu: 렌더링, 항목 클릭, 외부 클릭 닫기
- Duplicate Row: 데이터 복사, pendingNewRows 추가
- 다중 행 복사: 여러 행이 올바르게 포매팅되는지

### Coverage Target
- 신규/수정 코드: 라인 70% 이상 권장

### Scenario Tests (필수)
- [x] Happy path: 우클릭 → 메뉴 → Copy as JSON → 클립보드 확인
- [x] 에러/예외: 빈 데이터, null 값 포함 행, 특수 문자 포함 행
- [x] 경계 조건: 대용량 데이터(1000행), CSV 이스케이프(따옴표, 콤마 포함 필드)
- [x] 기존 기능 회귀 없음

## Exit Criteria

- Open P1/P2 findings: 0
- Required checks passing: yes
- Acceptance criteria evidence linked in handoff.md
