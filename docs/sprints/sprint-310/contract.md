# Sprint Contract: sprint-310 (Phase 28 Slice A4 — Insert snippet menu)

## Summary

- Goal: Toolbar 에 `+ Insert ▾` button + popover (4 section: Query methods /
  Mutation methods / Operators / Stages) 추가. snippet 클릭 시 cursor 에
  `<placeholder>` 마커 삽입. Tab/Shift+Tab/Esc placeholder 네비. snippet
  dict 단일 source 모듈 (`src/lib/mongo/mongoshSnippets.ts`).
- Verification Profile: `mixed` (RTL + 정적 grep + 회귀)

## In Scope

- `src/components/query/QueryTab/Toolbar.tsx` — `isDocument` 분기에 `+ Insert ▾`
  버튼 추가 + popover anchor.
- `src/components/query/QueryTab/InsertSnippetMenu.tsx` (NEW) — popover
  컴포넌트 (4 section, keyboard nav).
- `src/components/query/QueryTab/InsertSnippetMenu.test.tsx` (NEW).
- `src/lib/mongo/mongoshSnippets.ts` (NEW) — 4 section snippet 데이터.
  Query 6 / Mutation 7 / Operators 13 (`MONGO_QUERY_OPERATORS` 재사용) /
  Stages (`MONGO_AGGREGATE_STAGES` 재사용).
- `src/lib/mongo/mongoshSnippets.test.ts` (NEW).
- `src/lib/mongo/snippetEngine.ts` (NEW) — CodeMirror snippet API wrapper
  (placeholder Tab/Shift+Tab/Esc).
- `src/lib/mongo/snippetEngine.test.ts` (NEW).
- `src/lib/mongo/mongoshParser.ts` 의 `MONGOSH_METHOD_WHITELIST` import —
  snippet method 13 개 정합 (single source of truth).

## Out of Scope

- snippet 내용 자체의 dispatch (A5/A6 영역).
- `useMongoAutocomplete` 의 completion source 변경 — A4 는 명시적 메뉴만,
  자동완성은 sprint-309 결과 유지.
- RDB editor — 완전히 untouched.
- `src-tauri/`.

## Invariants

- **RDB tab 회귀 zero**: RDB paradigm 의 toolbar 에는 `+ Insert ▾` 버튼이
  나타나지 않음.
- **단일 source of truth**: snippet 의 method 13 은
  `MONGOSH_METHOD_WHITELIST` (A1) 를 직접 import. snippet 파일 안에 method
  이름 hard-code 금지.
- **No `any`**, function components, interfaces, no JS eval.
- **Sprint header comment** — 새 / 수정 블록에 Sprint 310 마커.

## Acceptance Criteria

- **AC-01** `+ Insert ▾` 버튼이 document-paradigm QueryTab Toolbar 에 존재
  (`aria-label="Insert mongosh snippet"`). RDB tab 에는 없음. RTL 양쪽 확인.
- **AC-02** 버튼 클릭 시 popover 가 열리고 4 `role="group"` 영역이 보임.
  `aria-label`: `"Query methods"`, `"Mutation methods"`, `"Operators"`,
  `"Stages"` (순서 고정).
- **AC-03** 각 영역 항목:
  - Query methods: `find`, `findOne`, `aggregate`, `countDocuments`,
    `estimatedDocumentCount`, `distinct` (6)
  - Mutation methods: `insertOne`, `insertMany`, `updateOne`, `updateMany`,
    `deleteOne`, `deleteMany`, `bulkWrite` (7)
  - Operators: 13 (`MONGO_QUERY_OPERATORS` 그대로, 빈도순)
  - Stages: 적어도 14 (`MONGO_AGGREGATE_STAGES` 의 핵심 set)
- **AC-04** snippet 클릭 시 editor cursor 에 템플릿이 삽입되고 첫
  placeholder 가 selection 됨. `Tab` 으로 다음 placeholder, `Shift+Tab`
  이전, `Esc` 종료 (cursor 가 마지막 placeholder 뒤로). RTL.
- **AC-05** 같은 이름의 placeholder 가 여러 개여도 `Tab` 은 문서 순서로
  순환. 하나 편집 시 다른 placeholder 가 자동 변경되지 않음.
- **AC-06** Popover 키보드 네비: 영역 내 `ArrowDown` / `ArrowUp`, 영역 간
  `Tab`, `Enter` 활성, `Esc` 닫기. RTL.
- **AC-07** snippet 삽입 후 popover 가 닫히고 focus 가 editor 로 돌아감.
  RTL.
- **AC-08** `MONGOSH_METHOD_WHITELIST` 가 `mongoshSnippets.ts` 에서 import
  되어 method 목록의 single source 로 사용 — import graph 검증
  (`grep -n "MONGOSH_METHOD_WHITELIST" src/lib/mongo/mongoshSnippets.ts`
  비어있지 않음).
- **AC-09** `pnpm vitest run` exit 0, sprint-309 baseline 3515 / 10 skipped
  대비 회귀 0 (신규 테스트만 증가).
- **AC-10** `pnpm tsc --noEmit` / `pnpm lint` / `pnpm build` exit 0.

## Verification Plan

### Required Checks

1. `pnpm vitest run` exit 0
2. `pnpm tsc --noEmit` exit 0
3. `pnpm lint` exit 0
4. `pnpm build` exit 0
5. RTL — RDB tab vs document tab Insert 버튼 visibility
6. RTL — 4 section group / 항목 / placeholder nav / 키보드 nav
7. grep `MONGOSH_METHOD_WHITELIST` in snippet 파일 비어있지 않음

### Required Evidence

- 변경 파일 목록 + 각 AC test name
- baseline vitest 매칭
- placeholder Tab/Shift+Tab/Esc 동작을 lock 한 테스트 이름

## Exit Criteria

- 모든 AC 통과
- Sprint 310 commit ready
