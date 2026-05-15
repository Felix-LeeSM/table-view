# Sprint Contract: sprint-350

## Summary

- Goal: Add Records/Structure sub-tab to Mongo collection tabs; Structure mounts a `MongoStructurePanel` with two sub-sub-tabs (Indexes RO list + existing ValidatorPanel). Frontend-only tracer slice.
- Audience: Mongo users who want to inspect collection metadata (indexes, validator) without leaving the data tab.
- Owner: Generator (sprint-350)
- Verification Profile: `mixed` (vitest + lint + typecheck; manual browser smoke optional)

## In Scope

- `src/components/layout/MainArea.tsx`: replace document-paradigm branch's "render `DocumentDataGrid` directly" with the Records/Structure tab bar pattern that RDB paradigms already use. Records mounts `DocumentDataGrid`; Structure mounts `MongoStructurePanel`.
- `src/components/document/MongoStructurePanel.tsx` (new): owns Indexes/Validator sub-sub-tab state, mounts `MongoIndexesPanel` + `ValidatorPanel`.
- `src/components/document/MongoIndexesPanel.tsx` (new): read-only list of indexes via existing `list_mongo_indexes` IPC. Loading / error / empty states.
- Tests: `MongoStructurePanel.test.tsx`, `MongoIndexesPanel.test.tsx` (RTL + vitest).
- Regression coverage: assert RDB tab still mounts the existing RDB `StructurePanel` and is not affected.

## Out of Scope

- Backend changes (zero Rust diff this sprint).
- Index create/drop UI (Sprint 351).
- Validator level/action toggles (Sprint 352).
- Inferred Fields panel (intentionally absent — fields appear as DataGrid columns).
- Options panel (capped/timeseries) — not scoped.
- Persisting the Indexes/Validator inner selection across app restarts.

## Invariants

- RDB Records/Structure sub-tab UI is byte-identical pre/post.
- DocumentDataGrid behavior unchanged when Records sub-tab is active.
- `list_mongo_indexes` Tauri command signature unchanged.
- `ValidatorPanel.tsx` not edited (mount move only).
- No new Tauri command registered.
- `pnpm tsc --noEmit`, `pnpm lint`, full `pnpm vitest run` all green at end-of-sprint.

## Acceptance Criteria

- `AC-350-01` Mongo collection tab renders sub-tab bar `role="tablist"` with two tabs `Records` and `Structure`; `Records` selected on first mount (testid `mongo-table-subtab-bar`).
- `AC-350-02` Activating Structure mounts a nested tab bar (testid `mongo-structure-subsubtab-bar`) with tabs `Indexes` and `Validator`; `Indexes` selected by default; switching via mouse or `ArrowLeft`/`ArrowRight` toggles content and the inner selection survives Structure-tab re-activation.
- `AC-350-03` Indexes panel issues exactly one `list_mongo_indexes` IPC per `(connectionId, database, collection)` mount; renders one row per `IndexInfo`; paints empty-state copy when list is empty; paints `role="alert"` with the error string on IPC failure; loading flag is `aria-busy` and follows the existing `useDelayedFlag(loading, 1000)` shape (no flash for <1s reads).
- `AC-350-04` Validator sub-sub-tab mounts the existing `ValidatorPanel` (testid `validator-panel`). Read/Save/Clear flows are byte-equivalent to the pre-Sprint-350 placement (i.e. moving the mount must not alter its observable behavior).
- `AC-350-05` RDB regression guard: an RTL test renders an RDB tab and asserts (a) the existing Records/Structure tab bar is intact; (b) the document-paradigm testids (`mongo-table-subtab-bar`, `mongo-structure-subsubtab-bar`) are NOT in the document.

## Design Bar / Quality Bar

- Accessibility: every tab carries `role="tab"`, `aria-selected`, focusable via keyboard; arrow keys roving-focus pattern.
- New components follow project conventions (`@components/*` import alias, named export for components, props interface named `<Component>Props`).
- Test comments include date + reason (per `feedback_test_documentation.md`).
- No sprint-prefix narrative in production comments (`feedback_sprint_comment_cleanup.md`).
- No comments narrating "what" — only load-bearing WHY.

## Verification Plan

### Required Checks

1. `pnpm tsc --noEmit` → exit 0.
2. `pnpm lint` → exit 0.
3. `pnpm vitest run` → all pre-existing passing tests still pass; new test files in scope pass.
4. Focused: `pnpm vitest run src/components/document/__tests__/MongoStructurePanel.test.tsx src/components/document/__tests__/MongoIndexesPanel.test.tsx src/components/layout/MainArea.test.tsx` → all green.
5. Cross-paradigm regression: `pnpm vitest run src/components/schema/StructurePanel.columns.test.tsx src/components/schema/StructurePanel.constraints.test.tsx` (RDB structure tests) → unchanged pass count.

### Required Evidence

- Generator must provide:
  - File-by-file diff summary with rationale.
  - Output of all required checks (or paste of failing/passing tallies).
  - For each AC, the testid / test name that proves it.
- Evaluator must cite:
  - Concrete RTL assertion paths for each AC pass.
  - Pre-existing tests confirmed not regressed (with count delta if any).

## Test Requirements

### Unit Tests (필수)
- 각 AC 항목 (350-01..350-05) 대응 RTL 테스트 ≥ 1개.
- IPC 실패 케이스 ≥ 1개 (`list_mongo_indexes` reject → role=alert).
- 빈 리스트 케이스 1개.

### Coverage Target
- 새 컴포넌트(`MongoStructurePanel`, `MongoIndexesPanel`) 라인 70% 이상.

### Scenario Tests (필수)
- [ ] Happy path: tab 전환 + indexes 표시.
- [ ] 에러/예외: IPC 실패 → alert + 패널 unmount 안 됨.
- [ ] 경계 조건: 빈 indexes, 빠른 fetch (delayed flag), tab 빠른 토글.
- [ ] 기존 기능 회귀 없음: RDB tab Structure 그대로.

## Test Script / Repro Script

1. `pnpm tsc --noEmit && pnpm lint`
2. `pnpm vitest run src/components/document/__tests__/MongoStructurePanel.test.tsx`
3. `pnpm vitest run src/components/document/__tests__/MongoIndexesPanel.test.tsx`
4. `pnpm vitest run src/components/layout/MainArea.test.tsx`
5. `pnpm vitest run` (full)
6. (옵션) `pnpm tauri dev` → Mongo connection 열고 collection 클릭 → Records ↔ Structure ↔ Indexes ↔ Validator 토글 확인.

## Ownership

- Generator: general-purpose Agent (one attempt at a time).
- Write scope: 위 In Scope에 명시된 파일 + 새 컴포넌트 + 새 test 파일만. RDB 영역, Rust 영역, `ValidatorPanel.tsx`, `DocumentDataGrid.tsx` 본문은 수정 금지.
- Merge order: Sprint 350 → 351 → 352 (직렬).

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes`
- Acceptance criteria evidence linked in `handoff.md`
