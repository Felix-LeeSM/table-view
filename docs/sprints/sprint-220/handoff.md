# Sprint 220 — Handoff

다음 sprint 진입자가 알아야 할 사항.

## 완료 산출물

- 신규 4 axis test 파일 (사전 1 mega file 의 axis-별 분배):
  - `src/components/schema/StructurePanel.overview.test.tsx` (28 cases) — read-only display + tab switching + error / empty / spinner + refresh-structure event + table headers + em-dash null handling + clear-error-on-tab-switch (25 cases) + Sprint 179 paradigm-aware vocabulary nested describe (3 cases, **옵션 B 보존**).
  - `src/components/schema/StructurePanel.columns.test.tsx` (26 cases) — Column-CRUD edit + Add + Delete + Review-SQL modal + Execute + Cancel + preview/execute error.
  - `src/components/schema/StructurePanel.indexes.test.tsx` (16 cases) — Index-CRUD Create + Delete + form preview/execute + Preview SQL disabled validation + 3 error case.
  - `src/components/schema/StructurePanel.constraints.test.tsx` (14 cases) — Constraint-CRUD Add + Delete + dynamic FK/CHECK/UNIQUE + Preview SQL disabled validation + 1 error case.
- 신규 shared helper: `src/components/schema/__tests__/structurePanelTestHelpers.tsx` (9 named export = 3 mock fn + 3 fixture constant + 2 helper + 1 reset). 확장자 `.tsx` (renderPanel JSX 포함). vi.mock factory 0건 / vi.spyOn 5건 helper 안 통합.
- 삭제: `src/components/schema/StructurePanel.test.tsx` (사전 2,156 lines / 84 cases, 옵션 1 채택).
- `docs/sprints/sprint-220/{spec,contract,execution-brief,findings,evaluator-scorecard,handoff}.md`.

case 합계 = overview 28 + columns 26 + indexes 16 + constraints 14 = **84** (사전 동일).

## 다음 sprint 후보

PLAN.md 의 잔여 시퀀스 (post-209 cycle):

- **P11 step 4** — `tabStore.test.ts` (2,234 lines / 102 cases) axis split.
- **P11 step 5** — `DataGrid.test.tsx` (1,906 lines / 75 cases) axis split.
- **P10** (Sprint 219) — `connectionStore` / `schemaStore` 의 toast / session / IPC orchestration → use-case hook 점진 이동. risk 높음 — 사용자 hooks/lib 작업 안정 후 진입.

## 검증 결과

| 명령 | 결과 |
|------|------|
| `pnpm vitest run src/components/schema/StructurePanel*.test.tsx` | 5 files / 89 passed (84 axis + 5 first-render-gate, 사전 동일), exit 0 |
| `pnpm vitest run` (full suite) | 202 files / 2720 tests passed, exit 0 (사전 199 + 4 axis - 1 entry = 202 ∈ [201, 204] ✓) |
| `pnpm tsc --noEmit` | exit 0 |
| `pnpm lint` | exit 0 |
| 신규 axis 파일 수 | 4 (∈ [3, 5] ✓) |
| 신규 axis case 합계 | 84 (사전 동일 ✓) |
| `git diff --stat src/components/schema/StructurePanel.tsx` | 0 |
| `git diff --stat src/components/schema/StructurePanel.first-render-gate.test.tsx` | 0 |
| Sprint 216 산출물 11 + sibling 6 diff | 모두 0 |
| 새 `eslint-disable*` 매치 | 0 |
| 22 verbatim AC string 보존 | 각 정확히 1 매치 |
| Helper named export | 9 (3 mock + 3 fixture + 2 helper + 1 reset) |
| Helper 외부 import | 4 (= axis 파일 수, ≤ 신규 axis 수) |
| `it.only` / `it.skip` | 0 |
| 각 axis 파일 root describe | 1개씩 (overview axis 만 옵션 B nested 1개 보존 = 총 describe 2개) |
| 각 axis 파일 vi.mock factory | 0개 (사전 0 동일) |
| Helper 안 vi.spyOn | 5 (alterTable / createIndex / dropIndex / addConstraint / dropConstraint) |

## Acceptance Criteria 결과

- AC-01 사후 StructurePanel*.test.tsx 합계 89 통과 (84 axis + 5 first-render-gate) ✓
- AC-02 신규 axis 4개 (∈ [3-5]) + 각 14-28 case + sibling 충돌 0 ✓
- AC-03 helper named export 9 + 외부 import 4 (= axis 수) ✓
- AC-04 사전 entry 옵션 1 (제거) 채택 ✓
- AC-05 22 verbatim AC string 모두 정확히 1 매치 + Global AC 1-10 충족 ✓

Evaluator: **PASS** (Correctness 9 / Completeness 9 / Reliability 10 / Verification Quality 9). P1/P2 finding 0건. F-001..F-003 모두 P3.

## 주의 사항

### Mock 격리 — vitest worker-per-file 의존

vitest 의 worker-per-file 격리에 의존해 helper 의 module-top-level `vi.fn()` instance 가 axis 파일마다 격리됨. `clearAllMocks` + `mockResolvedValue([...MOCK_*])` 재할당 패턴이 매 axis 파일 `beforeEach` 마다 helper 의 `resetStructurePanelMocks()` 호출 한 줄로 통합 — 사전 StructurePanel.test.tsx 의 inline 패턴과 동일.

### vi.mock factory 0건 — Sprint 218 와 다름

본 mega test 는 사전 0 factory (Sprint 218 의 7 factory 와 다름). ES hoisting 위험 없음 — helper 안 `vi.spyOn(tauri, ...)` 5건 호출 가능. axis 파일에서 `vi.mock("@lib/tauri", ...)` 추가 금지 (사전 동작 변경).

### Sprint 179 nested describe — 옵션 B 보존

`describe("paradigm-aware vocabulary (Sprint 179)", ...)` 3 case 가 `StructurePanel.overview.test.tsx` 안에 nested 로 보존. paradigm prop 분기 setup 격리.

### Helper 확장자 `.tsx` (spec headline `.ts` 와 다름)

spec.md headline 이 `__tests__/structurePanelTestHelpers.ts` 였으나, `renderPanel(props)` 가 `<StructurePanel ... />` JSX 반환 → 확장자 `.tsx` 불가피. evaluator note F-002 (P3) 인정.

### Constraints axis 14 vs spec 권고 17

generator 의 자연스러운 axis-별 case 분배 (의미적 axis 배치) 결과. spec headline 권고 28+26+16+17=87 ≠ baseline 84 (spec headline overlap). 합계 84 invariant 보존 우선. evaluator note F-001 (P3).

### 사용자 병행 작업 분리

본 sprint 작업은 `src/components/schema/StructurePanel.{axis}.test.tsx` + `__tests__/structurePanelTestHelpers.tsx` + `docs/sprints/sprint-220/` 안에 격리. 사용자 병행 작업 (hooks/lib) 은 본 sprint commit 에 미포함.

## 검증 명령 (재현)

```sh
pnpm vitest run src/components/schema/StructurePanel*.test.tsx
pnpm vitest run
pnpm tsc --noEmit
pnpm lint
ls src/components/schema/StructurePanel.{overview,columns,indexes,constraints}.test.tsx
for f in src/components/schema/StructurePanel.{overview,columns,indexes,constraints}.test.tsx; do
  echo "$f: $(grep -cE '^\s*it\(' $f) cases / $(grep -cE 'vi\.mock\(' $f) factories"
done
test -f src/components/schema/StructurePanel.test.tsx && echo "EXISTS" || echo "REMOVED"
grep -nE "^export (function|const)" src/components/schema/__tests__/structurePanelTestHelpers.tsx | wc -l
git diff --stat src/components/schema/StructurePanel.tsx src/components/schema/StructurePanel.first-render-gate.test.tsx  # 0
```

## 미완 / 후속

- **P11 step 4-5**: 잔여 2 mega test (`tabStore.test.ts` 2,234 / `DataGrid.test.tsx` 1,906). 본 sprint 의 axis split + helper extraction pattern reference template 으로 사용 권고.
- **P10** (Sprint 219): stores side-effects refactor — 사용자 hooks/lib 작업 안정 후 진입.
- 본 sprint 후속 candidate (informational, F-001..F-003 P3):
  - F-001: constraints axis 14 vs spec 권고 17 (-3) — 자연스러운 분배 우선.
  - F-002: helper 확장자 `.tsx` (JSX 포함 불가피).
  - F-003: findings.md table cosmetic ordering.
- cycle 종료 후 `refactoring-candidates.md` retire 예정.
