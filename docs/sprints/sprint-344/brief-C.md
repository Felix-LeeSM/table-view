# Sprint Execution Brief: sprint-344 / Slice C — `+ item` inline value input

## Objective

Array node 의 자식 끝에 `+ item` 어포던스. 클릭 시 index label `[N]`
(read-only, auto-derived) + value input 등장. Enter commit (Slice D 의
`coerceTreeAddValue` 호출 후 `onCommitEdit`), Esc cancel. 연속 add 시
순차 인덱스.

## Task Why

Slice B 가 object 의 `+ key` 를 완료했으니, array 도 같은 패턴으로 add
지원. Slice E 의 generator dispatch (sqlGenerator `ARRAY[..., new]`, MQL
`$set: { "tags.N": value }`) 가 이 path 표기를 그대로 사용.

## Scope Boundary

- Array node 의 `+ item` UI 만. Object 는 이미 Slice B 완료.
- `coerceTreeAddValue` 는 호출만.
- Generator dispatch / grid 통합 / 한정 column type 검증은 Slice E/F.

## Invariants

- 기존 leaf edit / delete / Slice B `+ key` / collapse / search / diff /
  BSON 모두 회귀 0.
- `DocumentTreePanel` paradigm-agnostic.
- `safeStringifyCell` rule.
- Slice A 의 ghost insertion order 와 일관.

## Done Criteria

1. AC-344-C-01 ~ 10 모두 pass.
2. `pnpm vitest run` 전체 회귀 0 (autocompleteTheme.test.ts 의 user
   parallel 실패 2개 제외).
3. `pnpm tsc --noEmit && pnpm lint` clean.

## Verification Plan

- Profile: command
- Required checks:
  1. `pnpm vitest run src/components/document/DocumentTreePanel.test.tsx`
  2. `pnpm vitest run`
  3. `pnpm tsc --noEmit`
  4. `pnpm lint`
- Required evidence:
  - 변경 파일 + 목적
  - 각 AC test 매핑
  - 명령 결과

## Evidence To Return

- Changed files
- Checks run
- AC coverage
- Assumptions
- Residual risk

## References

- Contract: `docs/sprints/sprint-344/contract-C.md`
- Spec: `docs/sprints/sprint-344/spec.md`
- Slice A findings: `docs/sprints/sprint-344/findings-A.md`
- Slice B findings: `docs/sprints/sprint-344/findings-B.md` (B 의 `AddKeyRow`
  를 모델로 — Slice C 는 `AddItemRow` 비슷한 패턴)
- Slice D findings: `docs/sprints/sprint-344/findings-D.md`
- 관련 파일:
  - `src/components/document/DocumentTreePanel.tsx`
  - `src/components/document/DocumentTreePanel.test.tsx`
  - `src/lib/jsonTree.ts` — `coerceTreeAddValue`, `joinPath`,
    `buildTreeNodesWithGhosts`
