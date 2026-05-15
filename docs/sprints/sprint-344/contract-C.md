# Sprint Contract: sprint-344 / Slice C — `+ item` inline value input on array nodes

## Summary

- Goal: 모든 array node 의 자식 끝에 `+ item` 어포던스 추가. 클릭 시
  단일 value input 등장 (index 는 `[N]` 자동 표시, 편집 불가). Enter
  commit (Slice D 의 `coerceTreeAddValue` 호출 후 `onCommitEdit`), Esc
  cancel. 연속 add 시 `[N]`, `[N+1]` 순차 인덱스. Slice B 의 패턴 거의
  동일하지만 input 1개 (value 만), key 검증 없음.
- Audience: DocumentTreePanel 사용자.
- Owner: Generator agent
- Verification Profile: `command`

## In Scope

- `DocumentTreePanel.tsx` 의 array node 자식 끝에 `+ item` 어포던스 (단
  `onCommitEdit` 있을 때만).
- 클릭 시 index label `[N]` (read-only, muted) + value input 등장.
  value input auto-focus.
- N = `value` (현재 array length) + pendingByPath 안의 동일 array path 에
  대한 prior pending `[K]` 인덱스 중 max(K) + 1 → "다음 빈 인덱스".
- Enter (value input) — `coerceTreeAddValue(valueInput)` 호출 후
  `onCommitEdit(joinPath(arrayPath, "[N]"), coerced)`. input 닫힘, 어포던스
  다시 보임.
- Esc — input 닫힘, commit 안 함.
- 빈 value + Enter → commit 됨 (사용자가 의도적으로 빈 string append).
- 연속 add (commit 후 다시 `+ item` 클릭) → N+1 인덱스. ghost row 가 Slice
  A 의 traversal 로 즉시 보임.
- Path 표기: `joinPath` 의 `[N]` bracket-notation 사용 (기존 jsonTree
  컨벤션).

## Out of Scope

- Object `+ key` (Slice B 에서 완료).
- `coerceTreeAddValue` 자체 (Slice D 완료).
- Generator dispatch — Slice E.
- Grid 통합 — Slice F.
- Drag-and-drop reorder, mid-array insert (always-append only).
- ARRAY 시작이 빈 array `[]` 일 때 special-case — 자연스럽게 `[0]` 으로
  처리 (별도 가드 불필요).

## Invariants

- 기존 기능 회귀 0.
- `DocumentTreePanel` paradigm-agnostic 유지.
- `safeStringifyCell` rule.
- Slice A 의 ghost insertion order 와 일관 — Slice C 가 commit 한 `[N]`
  ghost 는 array node 의 자식 맨 끝에 표시.
- 모든 신규 테스트마다 `2026-05-15` 코멘트.

## Acceptance Criteria

- `AC-344-C-01` — Array node 의 자식 끝에 `+ item` button. `onCommitEdit`
  prop 있을 때만 렌더.
- `AC-344-C-02` — `+ item` 클릭 시 index label `[N]` (값 = current array
  length) + value input 등장. Value input auto-focus.
- `AC-344-C-03` — Enter → commit 1회. Path = `arrayPath` + `[N]` (예:
  `tags[0]` 또는 `meta.tags[2]`). Value = Slice D coerced.
- `AC-344-C-04` — Esc → input 사라짐, commit 안 됨.
- `AC-344-C-05` — 빈 value + Enter → commit 됨 (`""` append).
- `AC-344-C-06` — 두 번 연속 add → 첫 commit `[N]`, 두 번째 `+ item` 후
  index label `[N+1]`. 두 commit 모두 별개 ghost row 로 traversal 에 보임.
- `AC-344-C-07` — Nested array (object 안 array) 도 동일 동작. Path
  표기 `parent.arr[N]`.
- `AC-344-C-08` — Index label 은 read-only — 사용자 클릭/타이핑 무시
  (input 이 아니라 span/label).
- `AC-344-C-09` — Value 의 coerce — `42` → number, `"42"` → string, `[1,2]` →
  array (Slice A 가 nested ghost 펼침).
- `AC-344-C-10` — 빈 array `[]` 에 첫 add → index `[0]`.

## Design Bar / Quality Bar

- Button text: `+ item` (Slice B 의 `+ key` 와 시각 일관).
- Index label: `[N]` muted color (`text-muted-foreground`), monospace.
- Same focus ring, validation 메시지 없음 (value 검증 없음).
- Aria: `aria-label="Add item to <arrayPath>"`.

## Verification Plan

### Required Checks

1. `pnpm vitest run src/components/document/DocumentTreePanel.test.tsx` —
   AC-344-C-01 ~ 10 모두 pass.
2. `pnpm vitest run` 전체 — Slice B 의 33 + Slice C 신규 모두 통과.
   (autocompleteTheme.test.ts 2개 fail 은 user parallel 이슈로 무관.)
3. `pnpm tsc --noEmit` — clean.
4. `pnpm lint` — clean.

### Required Evidence

- Generator must provide:
  - 변경 파일 + 목적
  - 각 AC 매핑
  - 명령 결과
- Evaluator must cite:
  - 각 AC pass evidence

## Test Requirements

### Unit Tests (필수)
- AC-344-C-01 ~ 10 각각 ≥ 1 case
- Edge: 빈 array 의 첫 add (`[0]`), nested array, 연속 add 3회 (`[0]`,
  `[1]`, `[2]`), value 가 nested object/array
- 모든 신규 case 에 `2026-05-15` 코멘트

### Coverage Target
- DocumentTreePanel.tsx 의 변경 부분 라인 70% 이상

### Scenario Tests (필수)
- [ ] Happy path: array 에 item add
- [ ] 경계: 빈 array, nested array, 연속 add
- [ ] coerce 흐름: number/string/object/array value
- [ ] 회귀: Slice B `+ key` / leaf edit / delete / collapse / search

## Test Script

1. `pnpm vitest run src/components/document/DocumentTreePanel.test.tsx`
2. `pnpm vitest run`
3. `pnpm tsc --noEmit && pnpm lint`

## Ownership

- Generator: general-purpose agent
- Write scope: **오직** 다음 두 파일.
  - `src/components/document/DocumentTreePanel.tsx`
  - `src/components/document/DocumentTreePanel.test.tsx`

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes`
- AC evidence linked in `findings-C.md`
