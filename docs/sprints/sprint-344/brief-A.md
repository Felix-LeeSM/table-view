# Sprint Execution Brief: sprint-344 / Slice A — Ghost-node tree traversal

## Objective

`DocumentTreePanel` 의 트리 빌더를 확장해 `pendingByPath` 에만 존재하는
(value 에는 없는) path 들도 ghost node 로 렌더. `+ key` / `+ item` UI 가
commit 한 직후 화면에 새 항목이 보이게 하는 기반.

## Task Why

Sprint 341/342/343 의 inline JSON tree 는 leaf edit / delete 만 지원.
사용자는 새 key/item 추가 불가. Sprint 344 의 핵심 요구는 add UI 인데,
add UI 가 commit 해도 트리가 `value` 만 traversal 하면 ghost 가 화면에서
사라짐. 따라서 add UI 를 만들기 전에 ghost rendering 기반이 필요.

## Scope Boundary

- 데이터 traversal + 시각 표시만. UI 어포던스 (`+ key` / `+ item` 버튼) 는
  Slice B / C 에서.
- JSON.parse coercion (= `"42"` vs `42` 구분) 은 Slice D 에서.
- Generator dispatch (= sqlGenerator/mqlGenerator 변경) 은 Slice E 에서.
- Mongo / RDB grid 통합은 Slice F 에서.

## Invariants

- 기존 leaf edit / delete / diff toggle / regex toggle / collapse 모두
  회귀 0.
- `DocumentTreePanel` 의 paradigm-agnostic 유지 (Mongo / RDB 직접 import
  금지).
- `safeStringifyCell` 사용 (raw `JSON.stringify` 의 cell-domain 호출 금지).
- 신규 테스트마다 작성 이유 + `2026-05-15` 코멘트.

## Done Criteria

1. AC-344-A-01 ~ 06 모두 pass (contract-A.md 참조)
2. `pnpm vitest run` 전체 회귀 0
3. `pnpm tsc --noEmit && pnpm lint` clean
4. Ghost helper 가 pure unit test 가능한 형태로 분리됨

## Verification Plan

- Profile: command
- Required checks:
  1. `pnpm vitest run src/components/document/DocumentTreePanel.test.tsx`
  2. `pnpm vitest run` (전체)
  3. `pnpm tsc --noEmit`
  4. `pnpm lint`
- Required evidence:
  - 변경 파일 리스트 + 목적
  - 각 명령의 출력 요약 (pass/fail 카운트)
  - 각 AC 에 대응하는 테스트 경로 + describe/it 이름

## Evidence To Return

- 변경 파일과 목적
- 각 명령 출력 + 결과
- 각 AC 항목에 대한 구체적 cover 증거
- 구현 중 내린 가정 (예: TreeNode 타입에 새 필드 추가 vs 기존 필드 확장)
- 잔여 위험 또는 verification gap

## References

- Contract: `docs/sprints/sprint-344/contract-A.md`
- Spec: `docs/sprints/sprint-344/spec.md`
- 관련 파일:
  - `src/components/document/DocumentTreePanel.tsx`
  - `src/components/document/DocumentTreePanel.test.tsx`
  - `src/lib/jsonTree.ts` (있다면)
  - 직전 sprint 핸드오프: `docs/sprints/sprint-343/handoff.md`,
    `docs/sprints/sprint-342/handoff.md`
