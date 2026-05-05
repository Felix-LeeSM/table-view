# Sprint Contract: sprint-216

## Summary

- Goal: `src/components/schema/SchemaTree.test.tsx` (2891 lines / 104 cases) 를 4-6 behavior-axis test 파일 + 1 shared helper 파일로 분해. 행동 변경 0; `SchemaTree.tsx` + sub-file 5개 + 사전 5 axis 파일 모두 변경 0. 사전 104 case 모두 사후 통과.
- Audience: Generator + Evaluator (multi-agent harness, post-209 cycle).
- Owner: harness skill orchestrator.
- Verification Profile: `command`

## In Scope

- 신규 axis test 파일 4-6개: `src/components/schema/SchemaTree.{lifecycle,expand,refresh,search,actions,highlight}.test.tsx` (이름은 generator 재량, 단 사전 5 axis 와 충돌 0).
- 신규 shared helper 파일 (옵션 B 권고): `src/components/schema/__tests__/schemaTreeTestHelpers.ts` 또는 `src/components/schema/SchemaTree.testHelpers.ts`.
- 사전 entry `SchemaTree.test.tsx` 처리: 옵션 1 (제거, 권고) 또는 옵션 2 (smoke ≤ 5 case 잔존, 허용).
- 모든 신규 axis 파일이 사전 104 case 의 axis-별 분배.

## Out of Scope

- 행동 변경, 새 feature 추가.
- `SchemaTree.tsx` 본체 변경 (Sprint 199 entry).
- `SchemaTree/{body,dialogs,rows,treeRows,useSchemaTreeActions}.{tsx,ts}` 5 sub-file 변경.
- 사전 5 axis test 파일 변경 (`dbms-shape` / `preview` / `preview.entrypoints` / `rowcount` / `virtualization`).
- Sibling test 파일 변경 (`SchemaPanel.test.tsx` / `DocumentDatabaseTree.test.tsx` / `StructurePanel.test.tsx` / `StructurePanel.first-render-gate.test.tsx` / `ViewStructurePanel.test.tsx`).
- store / hook / 외부 importer 변경.
- case 텍스트 / matcher / fixture data shape 변경.
- 새 unit test 작성 (case 추가/제거 0).
- AC label 변경.

## Invariants

- 사전 104 case 모두 사후 통과 + case 추가/제거 0.
- 사전 5 axis 파일 35 case 그대로 유지 (총 사후 139 case).
- 사전 verbatim string 23개 모두 사후 axis 파일 안에 1건 이상 존재.
- 사전 import / mock pattern 보존.
- 사전 ARIA label / verbatim text 보존.
- 사전 fixture data shape 보존.
- 사전 store seed pattern 보존.
- public surface (SchemaTreeProps) 동결.
- 새 `eslint-disable*` / silent `catch{}` 0.

## Acceptance Criteria

- `AC-01`: 사후 SchemaTree*.test.tsx glob 합계 case = 사전 139 (옵션 1 채택 시 정확히 139, 옵션 2 채택 시 axis + entry smoke 합계 = 139). `pnpm vitest run` exit 0.
- `AC-02`: 신규 axis 파일 4-7개 + 각 ≥ 5 case + ≤ 35 case + 사전 axis 와 충돌 0.
- `AC-03`: shared helper 파일 옵션 B 채택 시 named export 5 mock + 2 helper 보유. 외부 import 0.
- `AC-04`: 사전 entry 처리 옵션 1 (파일 제거) 또는 옵션 2 (≤ 5 smoke).
- `AC-05`: 23 verbatim string 모두 사후 axis 파일 안 1건 이상 매치. 모든 사전 4-9 invariants (Global AC) 충족.

## Design Bar / Quality Bar

- test-only refactor — `SchemaTree.tsx` + sub-file + 사전 5 axis 파일 변경 0.
- case 1건도 추가/제거/변경 금지. axis-별 재배치만.
- helper 파일은 named export 만 (default export 0). 외부 import 0 (test 디렉토리 내부만).
- AC label / sprint number / 모든 comment 사전 동일하거나 axis context 추가 (의미 추가, 의미 변경 금지).
- 모든 sprint commit 의 git diff 가 "case 이동 + helper 추출" 으로 읽혀야 함.

## Verification Plan

### Required Checks

1. `pnpm vitest run src/components/schema/SchemaTree*.test.tsx` exit 0. Tests passed = 사전 139.
2. `pnpm vitest run` exit 0. file count [192, 196]. tests = 2720.
3. `pnpm tsc --noEmit` exit 0.
4. `pnpm lint` exit 0.
5. `find src/components/schema -name "SchemaTree.*.test.tsx" -not -name "SchemaTree.dbms-shape.test.tsx" -not -name "SchemaTree.preview.test.tsx" -not -name "SchemaTree.preview.entrypoints.test.tsx" -not -name "SchemaTree.rowcount.test.tsx" -not -name "SchemaTree.virtualization.test.tsx" | wc -l` ∈ [4, 7].
6. `for f in <new axis files>; do grep -c "^  it(" $f; done` 합계 ∈ [99, 104] (옵션 2 채택 시 ≥ 99).
7. `git diff --stat src/components/schema/SchemaTree.tsx` 0.
8. `git diff --stat src/components/schema/SchemaTree/` 0.
9. `git diff --stat src/components/schema/SchemaTree.dbms-shape.test.tsx src/components/schema/SchemaTree.preview.test.tsx src/components/schema/SchemaTree.preview.entrypoints.test.tsx src/components/schema/SchemaTree.rowcount.test.tsx src/components/schema/SchemaTree.virtualization.test.tsx` 모두 0.
10. `git diff --stat src/components/schema/SchemaPanel.test.tsx src/components/schema/DocumentDatabaseTree.test.tsx src/components/schema/StructurePanel.test.tsx src/components/schema/StructurePanel.first-render-gate.test.tsx src/components/schema/ViewStructurePanel.test.tsx` 모두 0.
11. `git diff src/components/schema/ | grep "^+.*eslint-disable"` 매치 0.
12. 23 verbatim string 별 `grep -rn "<verbatim>" src/components/schema/SchemaTree*.test.tsx | wc -l` ≥ 1.
13. 옵션 1 채택 시 `test ! -f src/components/schema/SchemaTree.test.tsx`. 옵션 2 채택 시 `wc -l < 200 + grep -c "^  it(" ≤ 5`.
14. helper 파일 (옵션 B) 존재 시 named export 5 mock + 2 helper 매치 ≥ 7.
15. helper 파일 외부 import 0 — `grep -rn "schemaTreeTestHelpers\|SchemaTree.testHelpers" src/ e2e/` 매치 ≤ 신규 axis 파일 수.
16. axis 파일 안 `it.only` / `it.skip` 매치 0.
17. axis 파일 안 nested describe 추가 0 (root describe 1개씩만).

### Required Evidence

- Generator must provide:
  - 변경 파일 목록 (신규 axis + helper + entry 처리).
  - check 1-17 실행 결과.
  - AC-01..AC-05 별 evidence.
  - 23 verbatim string 매치 결과.
- Evaluator must cite:
  - 각 AC 별 pass/fail 근거.
  - missing 또는 weak evidence finding.

## Test Requirements

- 본 sprint 는 test-only refactor — 신규 case 작성 0.
- 사전 104 case + 사전 5 axis 35 = 139 가 source-of-truth.

## Test Script / Repro Script

1. baseline:
   ```sh
   pnpm vitest run src/components/schema/SchemaTree*.test.tsx
   ```
2. Generator 작업 후 동일 명령 → exit 0 + 139 cases.
3. `pnpm vitest run && pnpm tsc --noEmit && pnpm lint`.
4. axis 파일 목록 + case 합계 검증.

## Ownership

- Generator: general-purpose agent (Phase 3).
- Write scope: `src/components/schema/SchemaTree.<axis>.test.tsx` 신규 + `src/components/schema/__tests__/schemaTreeTestHelpers.ts` (또는 sibling) + 사전 entry 처리.
- 변경 금지: `SchemaTree.tsx` / sub-file 5 / 사전 5 axis 파일 / sibling test 파일 / store / hook.

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes` (1-17 모두)
- Acceptance criteria evidence linked in `handoff.md`
