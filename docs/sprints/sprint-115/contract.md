# Sprint Contract: sprint-115

## Summary
- Goal: SchemaTree 의 가시 노드 (펼친 상태에서 화면에 나올 행들) 가 임계값을 초과하면 `@tanstack/react-virtual` 기반 가상화로 전환. 1000+ 테이블에서도 DOM 노드 수 ≤ 100 행 수준 유지. 기존 100개 SchemaTree 테스트 회귀 0.
- Profile: `command`

## In Scope
- `src/components/schema/SchemaTree.tsx`:
  - `VIRTUALIZE_THRESHOLD = 200` 정의.
  - 현재 펼쳐진 schemas/categories 를 평탄화하는 helper `getVisibleRows(schemas, expandedSchemas, expandedCategories, tables, ...)` → `Array<{ kind: 'schema'|'category'|'item', ... }>` 산출.
  - 평탄 리스트 길이 > 임계값 → `useVirtualizer` 사용. 이하 → 기존 nested render.
  - 가상화 path 에서:
    - 외부 wrapper `<div className="overflow-y-auto">` 가 scroll container 역할 + ref 부여.
    - leading/trailing spacer `<div aria-hidden="true">` 로 높이 유지.
    - 각 visible row 는 평탄 리스트의 `kind` 에 따라 schema/category/item 셀 분기 렌더 (기존 JSX 재사용 helper 추출).
  - F2 rename / 키보드 네비 / search filter / context menu 등 기존 기능 그대로 동작.
- 신규 `SchemaTree.virtualization.test.tsx`:
  - mock 1000 테이블 → DOM `<button>` 행 ≤ 100 (대략) 단언.
  - 펼침/접힘 시 가시 노드 재계산.
  - F2 rename 동작 확인.
- 회귀 0 보장: 기존 fixture 수가 200 미만이면 eager path 가 발동하므로 sprint-107 F2 rename 테스트 등 100개 SchemaTree 테스트는 변경 불필요.

## Out of Scope
- 좌우 컬럼 가상화.
- 무한 스크롤 / 페이지네이션.
- ContextMenu 자체 변경.

## Invariants
- 1822 baseline tests 회귀 0.
- ARIA: `aria-expanded`, `aria-label` 정확.
- 키보드: ArrowUp/Down/Left/Right/Enter/Space/F2 동작.
- Search filter (기존 `Filter tables in public` 등) 동작.
- F2 rename Dialog (sprint-107) 동작.

## Acceptance Criteria
- AC-01: 1000 테이블 mock 으로 SchemaTree 렌더 시 visible-row `<button>` 또는 `<tr>` 개수 ≤ ~100 (header / wrapper 제외).
- AC-02: schema/category 펼침/접힘 시 가시 노드 평탄 리스트가 정확히 재계산되어 가상화 viewport 가 갱신.
- AC-03: 가상화 활성 상태에서 F2 키로 rename Dialog 가 열리고 input 에 포커스/select.
- AC-04: 가상화 path 에서도 키보드 네비 (ArrowDown 등) 가 다음 visible row 로 이동.
- AC-05: ≤ 200 visible nodes (기존 fixture) 시 eager path 가 발동, 모든 행이 DOM.
- AC-06: 1822+ vitest pass, tsc/lint 0.
- AC-07: 회귀 0 (기존 100 SchemaTree 테스트 전부 통과).

## Verification Plan
1. `pnpm vitest run`
2. `pnpm tsc --noEmit`
3. `pnpm lint`

## Exit Criteria
- All checks pass + AC-01..07 evidence in handoff.md.
