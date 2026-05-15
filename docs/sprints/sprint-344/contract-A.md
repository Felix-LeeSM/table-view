# Sprint Contract: sprint-344 / Slice A — Ghost-node tree traversal

## Summary

- Goal: `DocumentTreePanel` 의 트리 traversal 이 `value` 의 자식뿐 아니라
  `pendingByPath` 안에만 존재하는 (= ghost) path 들도 함께 렌더하도록 확장.
  Sprint 344 의 나머지 slice (`+ key` / `+ item` UI) 가 commit 한 직후
  ghost row 가 화면에 나타나기 위한 prerequisite. UI 어포던스는 **이 slice
  에서 추가하지 않음** — 오로지 ghost 데이터의 렌더링만.
- Audience: DocumentTreePanel 사용자 (Mongo grid + RDB grid 양쪽).
- Owner: Generator agent
- Verification Profile: `command`

## In Scope

- Tree node 빌더가 `pendingByPath` Map 을 받아 unresolved key/index 들을
  ghost node 로 생성.
- Ghost node 의 시각 표시: 기존 "● edited" 와 구분되는 "NEW" badge (또는
  amber 변형). 색상은 기존 pending 톤과 일관.
- Ghost node 의 hierarchy: nested 구조 (`pendingByPath` 의 값이 JSON-parseable
  object/array 인 경우) 펼침. parse 실패 시 string leaf fallback.
- Ghost node 의 collapse, search, diff toggle 호환.
- Helper 함수 분리 (`buildTreeNodesWithGhosts` 또는 `mergeWithPendingPaths`)
  — pure 하게 unit test 가능한 형태.

## Out of Scope

- `+ key` / `+ item` UI 어포던스 (Slice B / C).
- JSON.parse coercion 헬퍼 (Slice D — 이 slice 에서는 ghost 값을 raw
  string 으로 받아 단순히 펼침만).
- Generator dispatch (Slice E).
- Mongo / RDB grid 통합 (Slice F).
- `_id` 보호 같은 paradigm-specific 규칙 (Slice B 에서 다룸).

## Invariants

- 기존 leaf edit / leaf delete (`__op__:unset`) 렌더링 동작 유지.
- 기존 BSON inline editor, regex toggle, diff toggle, header pending pill
  기존 테스트 모두 통과.
- `DocumentTreePanel` 은 paradigm-agnostic — Mongo / RDB import leak 금지.
- `safeStringifyCell` 사용 (raw `JSON.stringify` 의 cell-domain 직접 호출
  금지) — lint rule `no-restricted-syntax` 준수.
- Test 코멘트 컨벤션: 신규 case 마다 작성 이유 + 날짜 `2026-05-15`.

## Acceptance Criteria

- `AC-344-A-01` — Root-level ghost: `value = { name: "Felix" }`,
  `pendingByPath = Map { "tag" => "alpha" }` → 트리에 `name` 과 `tag`
  모두 leaf 로 렌더. `tag` 에 "NEW" badge.
- `AC-344-A-02` — Edit + add 공존: 같은 parent object 에 대해 existing-key
  edit (`name` → "Bob") 과 new-key add (`tag` → "alpha") 모두 동시 렌더.
  de-duplicate 되지 않음.
- `AC-344-A-03` — Ghost 위치: parent 의 자식 리스트 맨 끝. `pendingByPath`
  에 추가된 순서 보존 (insertion order).
- `AC-344-A-04` — Nested ghost: `pendingByPath["meta"] = '{"role":"owner"}'`
  → `meta` 는 object 로 펼쳐지고 `role: "owner"` leaf 가 보임. parse 실패
  케이스 (`pendingByPath["raw"] = "not-json"`) 는 string leaf 로 렌더,
  crash 없음.
- `AC-344-A-05` — 기존 행위 회귀 0: leaf edit, leaf delete, diff toggle,
  search filter, collapse — 모두 ghost 포함 트리에서도 정상.
- `AC-344-A-06` — Helper 단독 테스트 가능: pure 함수 (input: value +
  pending paths, output: TreeNode[]). DocumentTreePanel 없이 unit test.

## Design Bar / Quality Bar

- Helper 는 deep module — 단순 인터페이스 (인자 2개: value, pendingByPath),
  복잡한 traversal/merge 내부.
- Mutation 없음, 순수.
- Type 명확 — `TreeNode` 의 `kind` enum 에 `"ghost"` 추가 또는 `isPending`
  플래그 (Generator 가 기존 자료구조 보고 결정).

## Verification Plan

### Required Checks

1. `pnpm vitest run src/components/document/DocumentTreePanel.test.tsx` —
   AC-344-A-01 ~ 05 케이스 추가, 모두 pass.
2. `pnpm vitest run src/lib/jsonTree.test.ts` (혹은 helper 가 옮긴 경로)
   — AC-344-A-06 helper unit, pass.
3. `pnpm vitest run` 전체 — 이전 sprint 의 테스트 전부 pass.
4. `pnpm tsc --noEmit` — clean.
5. `pnpm lint` — clean (특히 `no-restricted-syntax` `JSON.stringify` rule
   에 새 위반 없음).

### Required Evidence

- Generator must provide:
  - 변경 파일 리스트 + 각각의 목적
  - 위 5개 명령 실행 결과 (테스트 파일 수, pass/fail 카운트)
  - 각 AC 항목에 대해 어떤 테스트가 cover 하는지 mapping
- Evaluator must cite:
  - 각 AC pass/fail 판단의 구체적 evidence (테스트 파일 경로 + line)
  - 누락된 evidence 는 finding 으로 분류

## Test Requirements

### Unit Tests (필수)
- AC-344-A-01 ~ 06 각각 ≥ 1 케이스
- Edge: 빈 `pendingByPath` (회귀 0), 모든 path 가 ghost (value 자체가 빈
  `{}`), nested ghost 가 nested ghost 안에 (2단계 깊이)
- 모든 신규 case 에 작성 이유 + `2026-05-15` 코멘트

### Coverage Target
- 신규 helper 와 변경된 `DocumentTreePanel.tsx` 부분: 라인 70% 이상

### Scenario Tests (필수)
- [ ] Happy path: ghost 한 개 추가, 정상 렌더
- [ ] 빈 입력: `pendingByPath` 가 빈 Map, 기존과 동일
- [ ] 경계 조건: nested ghost 깊이 2, parse 실패 fallback
- [ ] 회귀: 기존 leaf edit / delete / collapse / search 모두 정상

## Test Script / Repro Script

1. `pnpm vitest run src/components/document/DocumentTreePanel.test.tsx` —
   AC-344-A-01 ~ 05 케이스 pass 확인
2. `pnpm vitest run src/lib/jsonTree.test.ts` — AC-344-A-06 helper pass
3. `pnpm vitest run` — 전체 회귀 확인
4. `pnpm tsc --noEmit && pnpm lint` — clean

## Ownership

- Generator: general-purpose agent
- Write scope:
  - `src/components/document/DocumentTreePanel.tsx`
  - `src/components/document/DocumentTreePanel.test.tsx`
  - `src/lib/jsonTree.ts` (생성 또는 기존 헬퍼 활용)
  - `src/lib/jsonTree.test.ts` (생성 또는 기존 테스트 확장)
- Merge order: Slice A 단독 commit 또는 Sprint 344 전체 1-commit 의 일부
  (사용자가 sprint-comment-cleanup 컨벤션에 따라 결정)

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes`
- Acceptance criteria evidence linked in `findings-A.md`
