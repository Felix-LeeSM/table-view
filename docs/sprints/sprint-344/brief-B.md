# Sprint Execution Brief: sprint-344 / Slice B — `+ key` inline pair input

## Objective

Object node row 끝에 `+ key` 어포던스 추가. 클릭 시 key/value paired
input 인라인 등장. Tab 으로 이동, Enter commit (Slice D 의 helper 사용),
Esc cancel. 빈 key / 중복 key reject. Commit 결과는 `onCommitEdit`
콜백으로 grid 에 전달 → grid 의 pendingByPath 가 업데이트 → Slice A 의
ghost renderer 가 NEW row 표시.

## Task Why

사용자가 inline JSON tree 에서 새 key/value 를 추가할 수 없다는 게 Sprint
341/342/343 에서 명시 deferred 된 항목. Slice A (ghost) + D (coerce) 가
prerequisite 으로 완료. Slice B 는 사용자가 직접 만지는 첫 UI.

## Scope Boundary

- 오직 object node 의 `+ key` UI. Array 의 `+ item` 은 Slice C.
- `coerceTreeAddValue` 는 **이미 존재** — 호출만.
- Generator dispatch / grid 통합은 Slice E / F.
- Path validation (예: `_id` 보호) 은 Slice F.

## Invariants

- 기존 leaf edit / delete / collapse / search / diff / BSON 모두 회귀 0.
- `DocumentTreePanel` paradigm-agnostic — Mongo/RDB import leak 금지.
- `safeStringifyCell` rule 유지.
- Accessibility — keyboard 만으로 모든 동작 가능.

## Done Criteria

1. AC-344-B-01 ~ 11 모두 pass.
2. `pnpm vitest run` 전체 회귀 0.
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
  - 명령 결과 (pass/fail 카운트)

## Evidence To Return

- Changed files (오직 `DocumentTreePanel.tsx` + `DocumentTreePanel.test.tsx`)
- Checks run
- AC coverage 매핑
- Assumptions
- Residual risk

## References

- Contract: `docs/sprints/sprint-344/contract-B.md`
- Spec: `docs/sprints/sprint-344/spec.md`
- Slice A findings: `docs/sprints/sprint-344/findings-A.md`
- Slice D findings: `docs/sprints/sprint-344/findings-D.md`
- 관련 파일:
  - `src/components/document/DocumentTreePanel.tsx` (514 lines + Slice A
    additions)
  - `src/components/document/DocumentTreePanel.test.tsx`
  - `src/lib/jsonTree.ts` — `coerceTreeAddValue`, `joinPath`,
    `buildTreeNodesWithGhosts`
