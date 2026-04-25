# Sprint Contract: sprint-112

## Summary
- Goal: 코드베이스의 8개 native `<select>` 사용처를 모두 design system `Select` (`@components/ui/select`, Radix 기반) 로 교체. 신규 native `<select>` 도입 차단 가드를 추가. 모든 기존 동작/테스트는 회귀 0.
- Profile: `command`

## Native `<select>` 사용처 (8개, 전수 교체 대상)
1. `src/components/structure/IndexesEditor.tsx:155` — Index Type (`INDEX_TYPES`)
2. `src/components/connection/ConnectionDialog.tsx:345` — Database Type (`postgresql/mysql/sqlite/mongodb/redis`)
3. `src/components/connection/ConnectionDialog.tsx:366` — Environment (`""` + `ENVIRONMENT_OPTIONS`)
4. `src/components/structure/ConstraintsEditor.tsx:167` — Constraint Type (4 hard-coded options)
5. `src/components/FilterBar.tsx:205` — Filter column
6. `src/components/FilterBar.tsx:221` — Filter operator
7. `src/components/query/GlobalQueryLogPanel.tsx:111` — Connection filter (`""` for All + `connectionIds`)
8. `src/components/datagrid/DataGridToolbar.tsx:292` — Page size (`PAGE_SIZE_OPTIONS`)

## In Scope
- 위 8 위치를 `Select` / `SelectTrigger` / `SelectValue` / `SelectContent` / `SelectItem` 조합으로 변경.
  - `value={x}`, `onValueChange={(v) => ...}` 패턴.
  - 기존 `aria-label` 은 `SelectTrigger` 로 이전.
  - 기존 `id`, `data-testid` 도 `SelectTrigger` 에 이전.
  - 기존 className(width/height/spacing) 은 `SelectTrigger` 에 보존 (디자인은 Radix Select 의 디폴트가 우선이지만 원래 사이즈 유지).
- Empty value 표현: Radix Select 는 `value=""` 를 허용하지 않음. `null/empty` 를 의미하는 옵션은 `__none__` 등 sentinel value 로 매핑하고 onValueChange 에서 다시 `null`/`""` 로 변환.
  - ConnectionDialog environment: `""` ↔ sentinel `__none__`
  - GlobalQueryLogPanel connection filter: `""` ↔ sentinel `__all__`
- jsdom 에서 Radix Select 동작에 필요한 polyfill 추가 (`src/test-setup.ts`):
  - `Element.prototype.hasPointerCapture = () => false`
  - `Element.prototype.releasePointerCapture = () => {}`
  - `Element.prototype.scrollIntoView = () => {}`
- 영향 받는 테스트의 migration: `fireEvent.change(select, { target: { value: ... } })` → `userEvent.click(trigger)` + `userEvent.click(option)` 패턴.
  - 영향 테스트 파일:
    - `src/components/connection/ConnectionDialog.test.tsx` (db_type select, environment select)
    - `src/components/query/GlobalQueryLogPanel.test.tsx` (connection filter select)
    - `src/components/DataGrid.test.tsx` (page size select)
    - `src/components/schema/StructurePanel.test.tsx` (constraint type select via IndexesEditor / ConstraintsEditor)
- 신규 native `<select>` 차단 가드:
  - `eslint.config.js` 에 `no-restricted-syntax` 또는 `no-restricted-elements` 룰 추가:
    - JSX `<select>` 사용 금지 (단, `src/components/ui/**` 화이트리스트는 불필요 — 모든 `<select>` 가 제거되므로).
  - 또는 `package.json` 에 grep-based npm 스크립트 추가: `lint:no-native-select` 가 src 전체에서 JSX `<select` 발견 시 실패. CI 에 통합.

## Out of Scope
- Radix Select 디자인 토큰 변경.
- 새로운 ARIA 패턴.
- Select 외 다른 form control 정규화 (`<input>`, `<textarea>` 등).

## Invariants
- 1799/1799 tsc/lint 0 유지 (회귀 0).
- 기능 회귀 0:
  - ConnectionDialog: db_type 변경 시 port/paradigm 동기화 (sprint-108 confirm dialog 포함) 유지.
  - FilterBar: column/operator 변경이 기존 onApply/updateFilter 콜백 호출 유지.
  - GlobalQueryLogPanel: connection filter 가 `null` 로 reset 가능.
  - DataGridToolbar: pageSize 변경이 `onSetPageSize(Number)` 호출 유지.
  - IndexesEditor / ConstraintsEditor: 기존 dialog 흐름 유지.

## Acceptance Criteria
- AC-01: `src/` 내 JSX `<select` 토큰 0건 (단, `src/components/ui/select.tsx` 자체는 native `<select>` 미사용 — Radix Trigger 라 면책 불필요).
- AC-02: 8 위치 모두 `Select` import 후 `Select`/`SelectTrigger`/`SelectValue`/`SelectContent`/`SelectItem` 사용.
- AC-03: 영향 받는 모든 테스트 통과 + 새 Select interaction 패턴 (`getByRole("combobox")` 또는 `getByLabelText` → click → `getByRole("option")`).
- AC-04: lint/CI 가드 추가 — `pnpm lint` 가 신규 native `<select>` 도입 시 실패하도록.
- AC-05: `pnpm vitest run` 1799+ 통과 (신규 polyfill 로 인해 기존 테스트 실패 0).
- AC-06: `pnpm tsc --noEmit` 0, `pnpm lint` 0.
- AC-07: 회귀 0.

## Verification Plan
1. `pnpm vitest run`
2. `pnpm tsc --noEmit`
3. `pnpm lint` (신규 가드 포함)
4. `grep -nE '<select(\s|>)' src/` 결과: 0 매치 (`isEditableTarget.ts` 의 주석 라인 `<select>` 는 매치되지 않음 — JSDoc 백틱 안의 텍스트라 정규식 `<select(\s|>)` 와 일치하지 않게 검증).

## Exit Criteria
- All checks pass + AC-01..07 evidence in handoff.md.
