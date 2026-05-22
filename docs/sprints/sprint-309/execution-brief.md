# Sprint Execution Brief: sprint-309 (Phase 28 Slice A3 — Editor surface)

## Objective

Find/Aggregate 토글을 editor surface 에서 완전히 제거하고, `MongoQueryEditor`
가 paradigm 단일 mongosh editor 로 동작하도록 prop 표면을 simplify.
`tab.queryMode` 는 backward-compat 을 위해 타입 union 에만 잔존
(`@deprecated`), 신규 tab 에는 미설정. `useQueryExecution` 의 dispatch
브랜치는 A5 가 교체 — A3 는 손대지 않음.

## Task Why

A1 (Sprint 307) 이 mongosh 표현식의 method 를 파싱 하므로 사용자 입력
자체가 "find / aggregate" 선택을 내포. 토글이 사용자에게 잘못된 mental
model 을 강제하던 burden 을 제거하고 query editor 의 입력 표면을
단일화. A4 (snippet menu) / A5 (parser dispatch) / A6 (write surface) 가
모두 "토글 없는 단일 editor" 위에서 동작한다고 가정 — A3 가 그 토대.

`useMongoAutocomplete` 가 queryMode 별 dispatch 였던 것을 단일 surface 로
collapse 하지 않으면 A4 snippet menu 와 sprint-309 사이에 dead branch 가
남음.

## Scope Boundary

**Touch**:
- `src/components/query/QueryTab/Toolbar.tsx` (MODIFY)
- `src/components/query/MongoQueryEditor.tsx` (MODIFY)
- `src/components/query/QueryTab.tsx` (MODIFY)
- `src/hooks/useMongoAutocomplete.ts(x)` + 동반 test (MODIFY)
- `src/stores/workspaceStore/types.ts` (MODIFY — JSDoc 만)
- `src/stores/workspaceStore` 의 `addQueryTab` 또는 동등 (MODIFY)
- 위에 영향받는 RTL / 스토어 test files (MODIFY / 삭제)

**DO NOT touch**:
- `src/components/query/QueryTab/useQueryExecution.ts` 의 dispatch
  로직 (A5 에서 교체)
- `src/components/query/QueryTab/HistoryPanel.tsx` (별도 sprint)
- `src/lib/mongo/mongoshParser.ts` (A1 산출물, 동결)
- 모든 RDB editor 경로 (`SqlQueryEditor*` 등)
- `src-tauri/` 어느 것도 (백엔드는 무관)
- `mongoAutocomplete.ts` constants — 그 자체는 A4 가 재사용

## Invariants

- **RDB 회귀 zero**.
- **Mongo legacy persisted tabs**: localStorage 의 `queryMode: "find" |
  "aggregate"` 페이로드를 deserialize 해도 throw 없음. 토글 UI 가 사라졌으니
  사용자가 다시 변경 못 함 — A5 에서 무시되도록 됨.
- **신규 tab 은 `queryMode` 미설정** — `tab.queryMode === undefined` 가
  `useQueryExecution` 의 `tab.queryMode === "aggregate"` 분기 입장에서
  false 라 find dispatch 가 default 가 됨. A5 가 이 분기를 교체할 때까지
  의도된 임시 상태.
- **No `any`**, `interface` for props, function components 만, no JS eval.
- **Sprint header comment** — 새/수정 블록에 `Sprint 309` + 이유 1줄.
- **TDD discipline** — RTL 로 "토글이 없다", "queryMode prop 이 없다"
  를 먼저 RED 하고 그에 맞게 제거. 한꺼번에 6 파일을 일괄 수정하지 말 것.

## Done Criteria

1. `pnpm vitest run` exit 0 — sprint-308 baseline 3516 passed 대비 toggle
   관련 테스트 삭제분만큼만 감소.
2. `pnpm tsc --noEmit` exit 0
3. `pnpm lint` exit 0
4. `pnpm build` exit 0
5. ToggleGroup 블록이 `Toolbar.tsx` 에 없음 (grep `ToggleGroup` 결과 0 또는
   다른 컴포넌트 인스턴스만).
6. `MongoQueryEditor` 가 `queryMode` prop / `data-query-mode` attribute /
   `aria-label="Mongo query mode"` 가 없음.
7. `QueryTab.tsx` 가 `queryMode` 또는 `onSetQueryMode` 를 자식에게 전달
   하지 않음.
8. `useMongoAutocomplete` 가 `queryMode` 매개변수 없이 동작.
9. `addQueryTab` (document) 가 `queryMode` 미설정.
10. `workspaceStore/types.ts` 의 `queryMode` 필드에 `@deprecated` JSDoc.
11. `grep -rn "Find mode\|Aggregate mode" src/components/query/` empty.
12. 새 / 수정 파일 헤더 / 블록에 Sprint 309 마커.

## Verification Plan

- Profile: `mixed` (RTL + 정적 grep + 회귀)
- Required checks (위 10 done criteria 와 대응)
- Required evidence:
  - 변경 파일 목록 + 목적
  - grep 결과 (queryMode / Find mode / data-query-mode)
  - sprint-308 vitest baseline 매칭 또는 toggle test 삭제분 명시
  - tsc/lint/build exit 0

## Evidence To Return

- Changed files with purpose
- 7 required checks 의 exit + 핵심 출력
- 12 done criteria 별 evidence (테스트 이름 / 파일 경로)
- 결정 (특히: `useMongoAutocomplete` 의 queryMode 인자를 (a) 완전 제거할지
  (b) `"unified"` sentinel 로 유지할지 — A4 snippet menu 가 단일 dispatch
  를 받는다는 invariant 만 지키면 둘 다 가능. Generator 가 결정 + 의사결정
  로그에 기재).
- Residual risk

## TDD Workflow Reminder

수직 슬라이스:
1. **Plan** — 토글 제거 / queryMode prop 제거 / 자동완성 단일화 / 신규 tab /
   legacy load — 5 동작.
2. **Tracer bullet** — "document-paradigm QueryTab 렌더 시 ToggleGroup 이
   없다" RTL 테스트 RED → Toolbar 에서 ToggleGroup 블록 삭제 → GREEN.
3. **Incremental** — 다음 동작 1개씩 RED→GREEN.
4. **Refactor only on GREEN**.

가로 슬라이싱 금지 — 5 파일 한꺼번에 다 고치지 말 것.

## References

- `docs/sprints/sprint-309/contract.md`
- `docs/sprints/sprint-307/spec.md` (A3 섹션)
- `docs/phases/phase-28-decision-log.md` — D-04 부터 시작
- `.claude/rules/react-conventions.md`, `.claude/rules/testing.md`
