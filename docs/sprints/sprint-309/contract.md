# Sprint Contract: sprint-309 (Phase 28 Slice A3 — Editor surface)

## Summary

- Goal: Find/Aggregate `ToggleGroup` 제거 + `MongoQueryEditor` 의
  `queryMode` prop 제거 + `useMongoAutocomplete` unified dispatch +
  `tab.queryMode` 신규 tab 미설정 + 타입은 backward-compat 으로 잔존.
- Verification Profile: `mixed` (RTL + 정적 grep + 회귀)

## In Scope

- `src/components/query/QueryTab/Toolbar.tsx` — Find/Aggregate ToggleGroup
  블록 삭제, `onSetQueryMode` prop 삭제. `MongoQueryEditorProps` /
  Toolbar prop 변경 점.
- `src/components/query/MongoQueryEditor.tsx` — `queryMode` prop 제거,
  `aria-label`을 단일 `"MongoDB Query Editor"` 로 고정, `data-query-mode`
  attribute 제거.
- `src/components/query/QueryTab.tsx` — `MongoQueryEditor` 에 `queryMode`
  비-전달, `useMongoAutocomplete` 호출 변경, `onSetQueryMode` 더 이상 toolbar
  로 내려가지 않음. 신규 query tab 생성 시 `queryMode` 설정 안 함.
- `src/hooks/useMongoAutocomplete.ts(x)` — `queryMode` 매개변수 제거 (또는
  `"unified"` sentinel) 후 단일 dispatch surface 로 collapse. find/aggregate
  분기 dispatch 제거.
- `src/stores/workspaceStore/types.ts` — `queryMode` 필드에 JSDoc
  `@deprecated Slice A3 — toggle 제거 후 무시됨. 후속 sprint 에서 type
  union 자체를 제거 예정.` 추가. 타입 자체는 잔존 (legacy persisted tab
  parse 통과).
- `src/stores/workspaceStore` 의 `addQueryTab` (또는 `addTab` 등 신규 tab
  생성 액션) — document paradigm 분기에서 `queryMode: "find"` 미설정. 기존
  persisted tabs 가 queryMode 보유한 채 deserialize 되어도 throw 없음.
- 관련 test files — 위 변경에 정합. 기존 toggle 관련 RTL 단언 (예:
  "Find mode", "Aggregate mode") 은 삭제.

## Out of Scope

- `useQueryExecution.ts` 의 `tab.queryMode === "aggregate"` 분기 dispatch
  — A5 (Sprint 311) 에서 parser-driven dispatch 로 교체. A3 는 손대지
  않음 (legacy persisted tabs 에 대해 dispatch 가 계속 동작해야 함).
- `HistoryPanel` 의 `queryMode` 표시 — 히스토리 entry 의 raw mongosh
  expression 이 A5/A6 에 들어오기 전까지 그대로 둠.
- `mongoshParser`, snippet menu, write dispatch — 별도 slice.
- RDB editor (`SqlQueryEditor`) — 완전히 untouched.

## Invariants

- **RDB 회귀 zero** — `pnpm vitest run src/components/query/SqlQueryEditor`
  exit 0, 통과 수 sprint-308 baseline 매칭.
- **Mongo 기존 동작 유지** — `MongoQueryEditor` 가 mount/render 가능,
  CodeMirror 이 동기 마운트. Run 디스패치는 (A5 가 나오기 전이라) 여전히
  `useQueryExecution` 의 `tab.queryMode === "aggregate"` 분기에 의존하므로
  legacy persisted tab 은 그대로 동작. **신규 tab 은 queryMode 미설정 →
  `=== "aggregate"` false → find dispatch 됨**. 의도된 임시 상태이며 A5 에서
  교체.
- **store backward-compat** — localStorage 에 `queryMode: "find" |
  "aggregate"` 가 있는 페이로드를 로드해도 throw 없음. 신규 tab 은 필드
  미설정.
- **No `any`**, **convention discipline** (`.claude/rules/react-conventions.md`).
- **Sprint header comment** — 새 / 수정 블록에 `// Sprint 309` + 이유 1줄
  (`feedback_test_documentation.md`).

## Acceptance Criteria

- **AC-01** Toolbar 의 ToggleGroup 블록 (lines ~129-148 of current
  `Toolbar.tsx`) 제거. RTL: document-paradigm 으로 `QueryTab` 마운트 시
  `screen.queryByRole("group", { name: /Mongo query mode/i })` === `null`.
- **AC-02** `MongoQueryEditor` 가 `queryMode` prop 을 더 이상 받지 않음.
  컴파일 / RTL — `data-query-mode` attribute 가 wrapper `<div>` 에 없음.
  `aria-label` 가 `"MongoDB Query Editor"` 단일.
- **AC-03** `QueryTab.tsx` 가 `MongoQueryEditor` 에 `queryMode` 전달
  안 함, `onSetQueryMode` 를 Toolbar 에 내려보내지 않음. 정적 grep:
  `grep -n "queryMode\|onSetQueryMode" src/components/query/QueryTab.tsx
  src/components/query/QueryTab/Toolbar.tsx src/components/query/MongoQueryEditor.tsx`
  의 결과가 sprint-308 baseline 대비 줄어듦 + 남은 매치는 deprecated 잔존
  타입 reference 만.
- **AC-04** `useWorkspaceStore.addQueryTab` (또는 동등) 가 document
  paradigm 신규 tab 에 `queryMode` 설정 안 함. 기존 persisted 페이로드 가
  `queryMode: "find" | "aggregate"` 보유 시 load throw 없음. 단위 테스트
  로 검증.
- **AC-05** `useMongoAutocomplete` 가 `queryMode` 매개변수 없이 동작하고
  단일 completion source 를 반환. find/aggregate 분기 로직 제거. 단위 테스트
  통과.
- **AC-06** `tab.queryMode` 타입 union 은 `workspaceStore/types.ts` 에
  잔존하지만 JSDoc `@deprecated` 표시. type 자체 제거는 후속 sprint.
- **AC-07** `pnpm vitest run` 전체 exit 0. sprint-308 baseline 3516 passed
  / 10 skipped 대비 회귀 0 (toggle 관련 test 삭제분만큼 감소 허용).
- **AC-08** `pnpm tsc --noEmit` exit 0, `pnpm lint` exit 0, `pnpm build`
  exit 0.
- **AC-09** `grep -rn "Find mode\|Aggregate mode" src/components/query/`
  empty (toggle 관련 RTL assertion 모두 제거).
- **AC-10** `grep -rn "queryMode" src/components/query/MongoQueryEditor.tsx
  src/components/query/QueryTab/Toolbar.tsx` empty.

## Verification Plan

### Required Checks

1. `pnpm vitest run` 전체 exit 0
2. `pnpm tsc --noEmit` exit 0
3. `pnpm lint` exit 0
4. `pnpm build` exit 0
5. `grep -rn "queryMode" src/components/query/MongoQueryEditor.tsx
   src/components/query/QueryTab/Toolbar.tsx` empty
6. `grep -rn "Find mode\|Aggregate mode" src/components/query/` empty
7. RTL — document-paradigm `QueryTab` 에 ToggleGroup role 없음 (단위 테스트
   파일 또는 기존 테스트 수정)
8. store unit — legacy `queryMode: "find"` 페이로드 load 가 throw 없이
   통과

### Required Evidence

- Generator: 변경 파일 목록 + 각 AC 의 test name + grep 결과
- Evaluator: 모든 grep / RTL / type-check 재실행 + 회귀 0 확인

## Exit Criteria

- 모든 AC 통과
- Sprint 309 commit ready
