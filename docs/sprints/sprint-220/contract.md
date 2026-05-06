# Sprint Contract: sprint-220

## Summary

- Goal: `src/components/schema/StructurePanel.test.tsx` (2,156 lines / 1 root + 1 nested describe / 84 cases) 를 3-5 behavior-axis test 파일 + 1 shared helper 파일로 분해. 행동 변경 0; `StructurePanel.tsx` + `StructurePanel.first-render-gate.test.tsx` + 11+ sibling test 모두 변경 0. 사전 84 case 모두 사후 통과.
- Audience: Generator + Evaluator (multi-agent harness, post-209 cycle, P11 step 3).
- Owner: harness skill orchestrator.
- Verification Profile: `command`

## In Scope

- 신규 axis test 파일 3-5개: `src/components/schema/StructurePanel.{overview,columns,indexes,constraints}.test.tsx` (이름은 generator 재량, 단 `StructurePanel.first-render-gate.test.tsx` 와 충돌 0).
- 신규 shared helper 파일 (옵션 B 권고): `src/components/schema/__tests__/structurePanelTestHelpers.ts`. 사전 `__tests__/schemaTreeTestHelpers.ts` (Sprint 216) 와 분리 (mock 중복 0).
- 사전 entry `StructurePanel.test.tsx` 처리: 옵션 1 (제거, 권고) 또는 옵션 2 (smoke ≤ 5 case 잔존, 허용).
- 모든 신규 axis 파일이 사전 84 case 의 axis-별 분배.
- Sprint 179 nested describe (`paradigm-aware vocabulary`) 처리: 옵션 A (평탄화) 또는 옵션 B (보존, 권고).

## Out of Scope

- 행동 변경, 새 feature 추가.
- `StructurePanel.tsx` 본체 변경 (231 lines).
- `StructurePanel.first-render-gate.test.tsx` (sibling axis test) 변경.
- 11+ sibling test 파일 변경 (`SchemaPanel.test.tsx` + Sprint 216 의 11 axis test + DocumentDatabaseTree / ViewStructurePanel + treeShape + `__tests__/schemaTreeTestHelpers.ts`).
- store / hook / 외부 importer 변경.
- case 텍스트 / matcher / fixture data shape 변경.
- 새 unit test 작성 (case 추가/제거 0).
- AC label / sprint section header 변경.

## Invariants

- 사전 84 case 모두 사후 통과 + case 추가/제거 0.
- 22 verbatim AC string 모두 사후 axis 파일 안에 1건 이상 존재.
- vi.mock factory 0 건 사전 동일 (사전 0 — 추가 금지).
- vi.spyOn 5건 (`alterTable` / `createIndex` / `dropIndex` / `addConstraint` / `dropConstraint`) 사후 보존.
- 사전 import / mock pattern 보존 — 3 mock fn (`mockGetTableColumns` / `mockGetTableIndexes` / `mockGetTableConstraints`) + 3 fixture constant (`MOCK_COLUMNS` / `MOCK_INDEXES` / `MOCK_CONSTRAINTS`) + 2 helper (`setStoreState` / `renderPanel`).
- 사전 ARIA label / verbatim text 보존 (`getByRole("tab", ...)` / `getByLabelText(...)` / em-dash `—`).
- 사전 fixture data shape 보존 (`MOCK_COLUMNS` / `MOCK_INDEXES` / `MOCK_CONSTRAINTS` byte-equivalent).
- 사전 store seed pattern 보존 — `beforeEach` body verbatim (`vi.clearAllMocks()` + 3 mockResolvedValue + setStoreState + 5 vi.spyOn).
- public surface (`StructurePanelProps`) 동결.
- 새 `eslint-disable*` / silent `catch{}` 0.
- `it.only` / `it.skip` 0.

## Acceptance Criteria

- `AC-01`: 사후 StructurePanel*.test.tsx glob 합계 case = 사전 84 (옵션 1 채택 시 정확히 84, 옵션 2 채택 시 axis + entry smoke 합계 = 84) + first-render-gate 사전 case 변경 0. `pnpm vitest run src/components/schema/StructurePanel*.test.tsx` exit 0.
- `AC-02`: 신규 axis 파일 3-5개 + 각 ≥ 5 case + ≤ 30 case + first-render-gate sibling 충돌 0.
- `AC-03`: shared helper 파일 (옵션 B) 채택 시 named export 9 (3 mock + 3 fixture constant + 2 helper + 1 reset) 보유. 외부 import 0 (axis 파일만).
- `AC-04`: 사전 entry 처리 옵션 1 (파일 제거, 권고) 또는 옵션 2 (≤ 5 smoke case 잔존).
- `AC-05`: 22 verbatim AC string 모두 사후 axis 파일 안 1건 이상 매치. Global AC 1-10 모두 충족.

## Design Bar / Quality Bar

- test-only refactor — `StructurePanel.tsx` + `StructurePanel.first-render-gate.test.tsx` + 11+ sibling test + Sprint 216 산출물 모두 변경 0.
- case 1건도 추가/제거/변경 금지. axis-별 재배치만.
- helper 파일은 named export 만 (default export 0). 외부 import 0 (axis 파일 only).
- vi.mock factory 0건 (사전 mega test 가 factory 사용 안 함) — helper 안 `vi.spyOn(tauri, ...)` 호출 가능.
- AC label / sprint section header / 모든 comment 사전 동일하거나 axis context 추가 (의미 추가, 의미 변경 금지).
- 모든 sprint commit 의 git diff 가 "case 이동 + helper 추출" 으로 읽혀야 함.
- Sprint 179 nested describe 보존 (옵션 B 권고) — paradigm prop 분기 setup 격리.

## Verification Plan

### Required Checks

1. `pnpm vitest run src/components/schema/StructurePanel*.test.tsx` exit 0. Tests passed = 사전 84 + first-render-gate 사전 case.
2. `pnpm vitest run` exit 0. file count [201, 204]. tests = 2720.
3. `pnpm tsc --noEmit` exit 0.
4. `pnpm lint` exit 0.
5. `find src/components/schema -maxdepth 1 -name "StructurePanel.*.test.tsx" -not -name "StructurePanel.test.tsx" -not -name "StructurePanel.first-render-gate.test.tsx" | wc -l` ∈ [3, 5].
6. `for f in <new axis files>; do grep -cE "^\s*it\(" $f; done` 합계 ∈ [79, 84] (옵션 2 채택 시 ≥ 79).
7. `git diff --stat src/components/schema/StructurePanel.tsx` 0.
8. `git diff --stat src/components/schema/StructurePanel.first-render-gate.test.tsx` 0.
9. `git diff --stat src/components/schema/SchemaTree.tsx src/components/schema/SchemaTree/` 0 (모두).
10. `git diff --stat src/components/schema/SchemaTree.{lifecycle,expand,refresh,search,actions,highlight,dbms-shape,preview,preview.entrypoints,rowcount,virtualization}.test.tsx` 0 (모두).
11. `git diff --stat src/components/schema/__tests__/schemaTreeTestHelpers.ts src/components/schema/SchemaPanel.test.tsx src/components/schema/SchemaPanel.tsx src/components/schema/DocumentDatabaseTree.test.tsx src/components/schema/DocumentDatabaseTree.tsx src/components/schema/ViewStructurePanel.test.tsx src/components/schema/ViewStructurePanel.tsx src/components/schema/treeShape.ts` 0 (모두).
12. `git diff src/components/schema/ | grep "^+.*eslint-disable"` 매치 0.
13. 22 verbatim AC string 별 `grep -rnF "<verbatim>" src/components/schema/StructurePanel*.test.tsx | wc -l` ≥ 1.
14. 옵션 1 채택 시 `test ! -f src/components/schema/StructurePanel.test.tsx`. 옵션 2 채택 시 `wc -l < 200 + grep -cE "^\s*it\(" ≤ 5`.
15. helper 파일 (옵션 B) 존재 시 named export ≥ 9 매치 (3 mock + 3 fixture constant + 2 helper + 1 reset).
16. helper 파일 외부 import 0 — `grep -rn "structurePanelTestHelpers" src/ e2e/` 매치 ≤ 신규 axis 파일 수.
17. axis 파일 안 `it.only` / `it.skip` 매치 0.
18. 각 axis 파일 root describe 1개 (Sprint 179 nested 옵션 B 채택 시 `StructurePanel.overview.test.tsx` 의 root + nested 1개 = 총 describe 2개 허용).
19. axis 파일 안 `vi.mock\(` 매치 = 0 (사전 0건 — 추가 금지).
20. axis 파일 또는 helper 파일 안 `vi.spyOn(tauri, ...)` 5건 보존 (axis 안 inline 또는 helper 안 통합).

### Required Evidence

- Generator must provide:
  - 변경 파일 목록 (신규 axis + helper + entry 처리).
  - check 1-20 실행 결과.
  - AC-01..AC-05 별 evidence.
  - 22 verbatim AC string 매치 결과.
  - Sprint 179 nested describe 처리 옵션 (A 또는 B) 명시.
- Evaluator must cite:
  - 각 AC 별 pass/fail 근거.
  - missing 또는 weak evidence finding.

## Test Requirements

- 본 sprint 는 test-only refactor — 신규 case 작성 0.
- 사전 84 case + first-render-gate 사전 case 가 source-of-truth.

## Test Script / Repro Script

1. baseline:
   ```sh
   pnpm vitest run src/components/schema/StructurePanel*.test.tsx
   ```
2. Generator 작업 후 동일 명령 → exit 0 + 84 + first-render-gate 사전 cases.
3. `pnpm vitest run && pnpm tsc --noEmit && pnpm lint`.
4. axis 파일 목록 + case 합계 검증.

## Ownership

- Generator: general-purpose agent (Phase 3).
- Write scope: `src/components/schema/StructurePanel.<axis>.test.tsx` 신규 + `src/components/schema/__tests__/structurePanelTestHelpers.ts` (옵션 B) + 사전 entry 처리.
- 변경 금지: `StructurePanel.tsx` / `StructurePanel.first-render-gate.test.tsx` / 11+ sibling test 파일 / Sprint 216 산출물 / `__tests__/schemaTreeTestHelpers.ts` / store / hook.

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes` (1-20 모두)
- Acceptance criteria evidence linked in `handoff.md`
