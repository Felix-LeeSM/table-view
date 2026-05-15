# Sprint Execution Brief: sprint-344 / Slice D — JSON coercion helper

## Objective

`coerceTreeAddValue(input: string): unknown` pure helper. Outer-quotes
rule: 따옴표 없으면 `JSON.parse` 시도, 실패 시 raw string.
Slice B/C 의 commit 단계가 호출할 작은 빌딩 블록.

## Task Why

`+ key` / `+ item` UI 가 사용자 입력을 받을 때, `42` (number) 와 `"42"`
(string) 를 시각적으로만 구분해선 안 됨 — commit 단계에서 JSON 타입으로
정확히 변환되어 `pendingByPath` 에 들어가야 Slice A 의 ghost renderer
가 nested object/array 도 펼치고, Slice E 의 generator 가 올바른 SQL/MQL
을 emit 함.

## Scope Boundary

- 오직 pure 함수 추가 + unit test. UI / dispatch 변경 없음.

## Invariants

- Pure / deterministic / throw 안 함.
- 기존 helper (`buildTreeNodes`, `buildTreeNodesWithGhosts`,
  `filterTreeNodes`, `renderLeafValue`) 미터치.

## Done Criteria

1. AC-344-D-01 ~ 11 모두 pass.
2. `pnpm vitest run` 전체 회귀 0.
3. `pnpm tsc --noEmit && pnpm lint` clean.

## Verification Plan

- Profile: command
- Required checks:
  1. `pnpm vitest run src/lib/jsonTree.test.ts`
  2. `pnpm vitest run`
  3. `pnpm tsc --noEmit`
  4. `pnpm lint`
- Required evidence:
  - 변경 파일과 목적
  - 각 AC 매핑 + test 위치
  - 명령 출력 요약

## Evidence To Return

- Changed files
- Checks run
- AC coverage
- Assumptions
- Residual risk

## References

- Contract: `docs/sprints/sprint-344/contract-D.md`
- Spec: `docs/sprints/sprint-344/spec.md`
- Slice A findings: `docs/sprints/sprint-344/findings-A.md`
- 관련 파일:
  - `src/lib/jsonTree.ts`
  - `src/lib/jsonTree.test.ts`
