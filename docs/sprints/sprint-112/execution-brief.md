# Sprint Execution Brief: sprint-112

## Objective
8개 native `<select>` 사용처를 `@components/ui/select` 의 Radix 기반 `Select` 컴포넌트로 정규화하고, 신규 native `<select>` 도입 차단 가드를 추가한다.

## Task Why
디자인 시스템 일관성/접근성 향상. 동일한 트리거 모양/포커스 링/키보드 동작을 모든 dropdown 에 일관 적용.

## Scope Boundary
- **건드리지 말 것**:
  - Radix Select 내부 컴포넌트(`src/components/ui/select.tsx`).
  - 다른 form control (`<input>`, `<textarea>`, `<button>`).
  - sprint-108 ConfirmDialog flow (ConnectionDialog 의 `pendingDbTypeChange` 로직 보존).
- **반드시 변경**:
  - 8개 native `<select>` → Radix Select 매핑.
  - 영향 받는 테스트 파일의 interaction 패턴 migration.
  - jsdom polyfill 추가 (`src/test-setup.ts`).
  - lint/CI 가드 추가.

## Invariants
- ConnectionDialog: db_type 변경 시 port/paradigm 동기화 + custom port 시 ConfirmDialog 노출 (sprint-108).
- FilterBar onApply / updateFilter 동작.
- GlobalQueryLogPanel: 검색/connection filter/clear log 흐름.
- DataGridToolbar: pageSize 변경 → `onSetPageSize(Number)`.
- 기존 `id`/`data-testid`/`aria-label` 모두 `SelectTrigger` 로 이전.

## Done Criteria
1. `grep -RnE '<select(\\s|>)' src/` (JSX 가 아닌 isEditableTarget.ts 주석 라인 제외) 결과 0건.
2. 8 위치 모두 `Select` 컴포넌트 사용.
3. ESLint 또는 npm script 가드 작동 (테스트 케이스: 임의 컴포넌트에 `<select>` 추가 시 lint 실패).
4. 1799+ vitest 모두 통과.
5. tsc/lint 0.

## Verification Plan
- Profile: `command`
- Required checks:
  1. `pnpm vitest run`
  2. `pnpm tsc --noEmit`
  3. `pnpm lint`
  4. `grep -RnE '<select(\\s|>)' src/` (JSX usage 0 검증; `<select>` 텍스트가 주석/문서 안에 있는 것은 무방하지만, 실제 JSX 토큰 패턴은 0)
- Required evidence:
  - 변경된 파일 리스트
  - 추가/수정된 polyfill
  - 추가한 lint 가드 형식 (eslint rule or npm script)
  - 영향 테스트 migration 요약

## Evidence To Return
- 변경 파일 + 목적
- 명령어 결과 (vitest 통과 수, tsc/lint 0)
- AC-01..07 단언
- 이슈/가정/리스크
