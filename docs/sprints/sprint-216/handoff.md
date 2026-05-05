# Sprint 216 — Handoff

다음 sprint 진입자가 알아야 할 사항.

## 시퀀싱 변경 (사용자 의도와 불일치)

**PLAN.md** 는 Sprint 216 = `P10 (stores side-effects)` 으로 표시되어 있으나, 본 sprint 가 진행한 작업 = **P11 step 1 (SchemaTree.test.tsx axis split)**.

**사유**: Sprint 215 commit (사용자 GPG passphrase 오류) 처리 중 사용자가 hooks/lib 다수 영역 (`src/hooks/use*` / `src/lib/{tauri,mongo,sql,api}/`) 작업 진행 중이라 P10 (connection / schema store 의 toast / session / IPC orchestration) 침범 시 conflict risk 매우 큼. risk 낮은 P11 step 1 (test-only refactor) 우선 처리. P10 은 사용자 작업 안정 후 진입 권고.

PLAN.md 의 시퀀스 update 권고:
- `216 ✓` → P11 step 1 (SchemaTree.test split).
- `218` → P11 step 2-5 (tabStore / QueryTab / StructurePanel / DataGrid mega test 4건).
- `219` → P10 (stores side-effects, 사용자 작업 안정 후).

## 완료 산출물

- 신규 6 axis test 파일 (사전 1 mega file 의 axis-별 분배):
  - `src/components/schema/SchemaTree.lifecycle.test.tsx` (11 cases) — mount auto-load, connectionId change, edge cases, header label, root class, fallback, load reject cleanup.
  - `src/components/schema/SchemaTree.expand.test.tsx` (28 cases) — schema/category toggle, AC-CAT-01..06, keyboard, spinners, AC-EXPAND-01..02, view/function/procedure rows.
  - `src/components/schema/SchemaTree.refresh.test.tsx` (6 cases) — AC-07, AC-10, AC-CM-17/18 schema Refresh.
  - `src/components/schema/SchemaTree.search.test.tsx` (10 cases) — AC-SEARCH-01..10.
  - `src/components/schema/SchemaTree.actions.test.tsx` (31 cases) — AC-05, AC-CM-01..16, F2 rename, view/function clicks, AC-191-03 toast, AC-192-04 export.
  - `src/components/schema/SchemaTree.highlight.test.tsx` (18 cases) — AC-09, AC-SEL/ACTIVE/VIS/SEP/ICON, count badges.
- 신규 shared helper: `src/components/schema/__tests__/schemaTreeTestHelpers.ts` (51 lines, named export 7 = 5 mock + 2 helper).
- 삭제: `src/components/schema/SchemaTree.test.tsx` (사전 2891 lines / 104 cases, 옵션 1 채택).
- `docs/sprints/sprint-216/{spec,contract,execution-brief,findings,evaluator-scorecard,handoff}.md`.

case 합계 = lifecycle 11 + expand 28 + refresh 6 + search 10 + actions 31 + highlight 18 = **104** (사전 동일).

## 다음 sprint 후보

PLAN.md 의 잔여 시퀀스 (P10/P11 step 2-5 reschedule 가정):

- **P11 step 2** — `tabStore.test.ts` (2234 lines) axis split.
- **P11 step 3** — `QueryTab.test.tsx` (2308 lines) axis split.
- **P11 step 4** — `StructurePanel.test.tsx` (2156 lines) axis split.
- **P11 step 5** — `DataGrid.test.tsx` (1906 lines) axis split.
- **P10** — `connectionStore` / `schemaStore` 의 toast / session / IPC orchestration → use-case hook 점진 이동. risk 높음 — 사용자 hooks/lib 작업 안정 후 진입.

## 검증 결과

| 명령 | 결과 |
|------|------|
| `pnpm vitest run src/components/schema/SchemaTree*.test.tsx` | 11 files / 139 passed (사전 1 + 5 axis = 6 → 사후 6 신규 + 5 사전 = 11), exit 0 |
| `pnpm vitest run` (full suite) | 194 files / 2720 tests passed, exit 0 (사전 189 + 6 신규 - 1 삭제 = 194 ∈ [192, 196] ✓) |
| `pnpm tsc --noEmit` | exit 0 |
| `pnpm lint` | exit 0 |
| 신규 axis 파일 수 | 6 (∈ [4, 7] ✓) |
| 신규 axis case 합계 | 104 (사전 동일 ✓) |
| `git diff --stat src/components/schema/SchemaTree.tsx` | 0 |
| `git diff --stat src/components/schema/SchemaTree/` | 0 (5 sub-file 모두) |
| 사전 5 axis test diff (`dbms-shape` / `preview` / `preview.entrypoints` / `rowcount` / `virtualization`) | 모두 0 |
| Sibling test diff (`SchemaPanel` / `DocumentDatabaseTree` / `StructurePanel` / `StructurePanel.first-render-gate` / `ViewStructurePanel`) | 모두 0 |
| 새 `eslint-disable*` 매치 | 0 |
| 23 verbatim string 보존 | 각 정확히 1 매치 |
| Helper named export | 7 (5 mock + 2 helper) |
| Helper 외부 import | 6 (= axis 파일 수, ≤ 신규 axis 수) |
| `it.only` / `it.skip` | 0 |
| 각 axis 파일 root describe | 1개씩 |

## Acceptance Criteria 결과

- AC-01 사후 SchemaTree*.test.tsx 합계 139 통과 ✓
- AC-02 신규 axis 6개 (∈ [4-7]) + 각 5-35 case + 사전 axis 충돌 0 ✓
- AC-03 helper named export 7 + 외부 import 6 (= axis 수) ✓
- AC-04 사전 entry 옵션 1 (제거) 채택 ✓
- AC-05 23 verbatim 모두 정확히 1 매치 + Global AC 9/9 충족 ✓

Evaluator: **PASS 10/10** (Correctness 10 / Completeness 10 / Reliability 10 / Verification Quality 10). P1/P2 finding 0건. F-001..F-003 모두 P3 (positive observation 또는 spec 재량 valid choice).

## 주의 사항

### Mock 격리 — vitest worker-per-file 의존

vitest 의 worker-per-file 격리에 의존해 5 mock fn instance 가 axis 파일마다 격리됨. `clearAllMocks` + `mockResolvedValue(undefined)` 재할당 + `resetStores()` 패턴이 매 axis 파일 `beforeEach` 마다 verbatim 보존 — 사전 SchemaTree.test.tsx 와 동일.

### 3 local async helper inline 잔존

`expandSchemaWithTables` / `expandSchemaWithMultipleTables` / `expandSchemaWithView` 3 helper 가 cross-axis 사용 발생 시 후속 sprint 가 `__tests__/schemaTreeTestHelpers.ts` 으로 승격 권고. 본 sprint 는 inline 잔존 (각 axis 자체 보유).

### `vi.mock` 호이스팅 회피

helper 파일은 mock fn 만 export. `vi.mock("@stores/schemaStore", ...)` 호출은 사전 SchemaTree.test.tsx 가 사용 안 함 (`useSchemaStore.setState` 직접 주입 패턴). helper 파일 안 vi.mock 호출 0 — ESM 호이스팅 issue 회피.

### 사용자 병행 작업 분리

본 sprint 작업 자체는 `src/components/schema/SchemaTree.{axis}.test.tsx` + `__tests__/` 디렉토리 + `docs/sprints/sprint-216/` 안에 격리. Working tree 의 사용자 doc-comments 정리 작업 (다수 sprint docs 의 narrative trim) + memory/lessons reorganize 는 사용자의 별도 working state — 본 sprint commit 에 미포함.

## 검증 명령 (재현)

```sh
pnpm vitest run src/components/schema/SchemaTree*.test.tsx
pnpm vitest run
pnpm tsc --noEmit
pnpm lint
ls src/components/schema/SchemaTree.{lifecycle,expand,refresh,search,actions,highlight}.test.tsx
for f in src/components/schema/SchemaTree.{lifecycle,expand,refresh,search,actions,highlight}.test.tsx; do
  echo "$f: $(grep -c '^  it(' $f) cases"
done
test -f src/components/schema/SchemaTree.test.tsx && echo "EXISTS" || echo "REMOVED"
grep -nE "^export (function|const)" src/components/schema/__tests__/schemaTreeTestHelpers.ts
git diff --stat src/components/schema/SchemaTree.tsx src/components/schema/SchemaTree/  # 0
```

## 미완 / 후속

- **P11 step 2-5**: 잔여 4 mega test (`tabStore.test.ts` 2234 / `QueryTab.test.tsx` 2308 / `StructurePanel.test.tsx` 2156 / `DataGrid.test.tsx` 1906). 본 sprint 의 axis split + helper extraction pattern reference template 으로 사용 권고.
- **P10**: stores side-effects refactor — 사용자 hooks/lib 작업 안정 후 진입.
- 본 sprint 후속 candidate (informational, F-001..F-003 P3):
  - 3 local async helper (`expandSchemaWith*`) cross-axis 사용 발생 시 helpers.ts 승격.
  - vitest pool config 변경 시 mock 격리 재검증.
- cycle 종료 후 `refactoring-candidates.md` retire 예정.
