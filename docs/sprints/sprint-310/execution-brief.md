# Sprint Execution Brief: sprint-310 (Phase 28 Slice A4 — Insert snippet menu)

## Objective

document-paradigm QueryTab Toolbar 에 `+ Insert ▾` 드롭다운 추가. 4
section (Query methods 6 / Mutation methods 7 / Operators 13 / Stages 14+)
popover. snippet 클릭 시 editor cursor 에 `<placeholder>` 마커 템플릿
삽입, Tab/Shift+Tab/Esc 로 placeholder 네비.

## Task Why

A3 가 토글을 지웠지만 사용자는 어떤 method 를 쓸 수 있는지 명시적인
힌트를 잃었다. `+ Insert ▾` 메뉴가 (1) 지원되는 13 method 의 단일 source
of truth 를 사용자에게 노출하고, (2) 표현식 작성 시 mongosh 문법의
boilerplate 를 줄이며, (3) 사용자가 BSON literal placeholder 의 위치를
바로 인지하도록 한다. A5 dispatch / A6 write 가 모두 이 메뉴를 통해
대표 method 가 등록되었다고 가정한다.

## Scope Boundary

**Touch**:
- `src/components/query/QueryTab/Toolbar.tsx`
- `src/components/query/QueryTab/InsertSnippetMenu.tsx` (NEW)
- `src/components/query/QueryTab/InsertSnippetMenu.test.tsx` (NEW)
- `src/lib/mongo/mongoshSnippets.ts` (NEW)
- `src/lib/mongo/mongoshSnippets.test.ts` (NEW)
- `src/lib/mongo/snippetEngine.ts` (NEW) — CodeMirror snippet API wrapper
- `src/lib/mongo/snippetEngine.test.ts` (NEW)

**DO NOT touch**:
- `useQueryExecution.ts` / dispatch 로직
- `mongoshParser.ts` (A1 동결)
- RDB editor
- `src-tauri/`
- `useMongoAutocomplete` (그 자체는 A3 산출물 유지)

## Invariants

- **RDB tab 회귀 zero**: RDB toolbar 에 `+ Insert ▾` 미노출.
- **단일 source of truth**: snippet 의 method 13 개는
  `MONGOSH_METHOD_WHITELIST` 를 직접 import. 이름 hard-code 금지.
- **No `any`** in TS, function components, `interface` for props.
- **Sprint header comment** Sprint 310.
- **TDD vertical slice** — 한 영역 / 한 동작씩 RED → GREEN.

## Done Criteria

1. `+ Insert ▾` 버튼 시각 + ARIA — document tab 에만.
2. Popover 4 section group (정해진 순서) + `aria-label` 정합.
3. Section 별 항목 개수 / 이름이 spec 매칭.
4. snippet 삽입 시 cursor 위치에 템플릿 + 첫 placeholder selection.
5. Tab / Shift+Tab / Esc placeholder 네비.
6. 같은 이름 placeholder 가 여러 개여도 순환 + 독립 편집.
7. 키보드 네비 (Arrow / Tab / Enter / Esc).
8. snippet 삽입 후 popover close + editor focus 복귀.
9. `MONGOSH_METHOD_WHITELIST` import — single source.
10. `pnpm vitest run` 3515 baseline 대비 회귀 0 (신규 테스트 추가만).
11. `pnpm tsc --noEmit` / `pnpm lint` / `pnpm build` 0.

## Verification Plan

- Profile: `mixed` (RTL + 정적 grep + 회귀)
- Required checks 위 done criteria 7개 항목과 대응

## Evidence To Return

- 변경 파일 목록 + 목적
- AC 별 RTL 테스트 이름
- baseline 매칭 (vitest)
- 자율 결정 (D-06+, snippet 의 placeholder syntax 채택, 키보드 시퀀스 등)
- placeholder Tab/Shift+Tab/Esc 의 구현 — CodeMirror `@codemirror/autocomplete`
  의 snippet API 그대로 쓸지 custom 구현할지 (자율 결정 + 의사결정 로그).

## TDD Workflow Reminder

1. Plan — 4 section 표시 / 항목 / 클릭 삽입 / 첫 placeholder / Tab nav /
   Shift+Tab / Esc / 키보드 메뉴 nav / popover 닫힘 / focus 복귀 / RDB 미노출 — 11 동작.
2. Tracer bullet — "document tab 에 `+ Insert ▾` 버튼이 보이고 RDB tab 에는
   없다" RTL → 버튼 구현.
3. 차례로 다음 동작 1개씩 RED→GREEN.
4. Refactor only on GREEN.

가로 슬라이싱 금지.

## References

- `docs/sprints/sprint-310/contract.md`
- `docs/sprints/sprint-307/spec.md` (A4 섹션)
- `docs/phases/phase-28-decision-log.md` — D-06+ 부터
- `src/lib/mongo/mongoAutocomplete.ts` — operator/stage constants
- `src/lib/mongo/mongoshParser.ts` — `MONGOSH_METHOD_WHITELIST`
- `@codemirror/autocomplete` snippet API 문서 (만약 도입)
