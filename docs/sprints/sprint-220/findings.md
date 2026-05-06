# Sprint 220 — Findings

Generator outputs for the post-209 cycle's P11 step 3 — `StructurePanel.test.tsx`
(2,156 lines / 1 root + 1 nested describe / 84 cases) → 4 behaviour-axis test
files + 1 shared helper file.

## Changed Files

| Path | Purpose |
|------|---------|
| `src/components/schema/StructurePanel.test.tsx` | **Removed** (옵션 1 채택). Sprint-220 entry consolidated into 4 axis files. |
| `src/components/schema/StructurePanel.overview.test.tsx` | **신규** axis file (28 cases). Read-only display + tab switching + error / empty / spinner + refresh-structure + table headers + em-dash null handling + clear-error-on-tab-switch (25 cases) + Sprint 179 paradigm-aware vocabulary nested describe (3 cases, 옵션 B). |
| `src/components/schema/StructurePanel.columns.test.tsx` | **신규** axis file (26 cases). Column-CRUD — Add Column / inline edit / cancel / save / delete / multiple pending / Review SQL modal / Execute / Cancel / preview/execute error / Actions header / Enter-Escape / Escape closes modal / refresh after execute / table prop reset / pending-add removal. |
| `src/components/schema/StructurePanel.indexes.test.tsx` | **신규** axis file (16 cases). Index-CRUD — Create Index button + modal + columns checkboxes + close / submit (preview + execute) + delete (PK skip / non-PK delete) + Actions header + drop modal cancel + createIndex preview error + dropIndex preview error + dropIndex execute error + Preview SQL disabled validation. |
| `src/components/schema/StructurePanel.constraints.test.tsx` | **신규** axis file (14 cases). Constraint-CRUD — Add Constraint button + dynamic modal (FK / CHECK / UNIQUE) + delete (3 row buttons + drop modal preview/execute/cancel) + Actions header + dropConstraint preview error + Preview SQL disabled validation. |
| `src/components/schema/__tests__/structurePanelTestHelpers.tsx` | **신규** shared helper (named export 9 = 3 mock fn + 3 fixture constant + 2 helper + 1 reset). 외부 import 0 — 4 axis 파일만. `vi.mock(...)` 호출 0 (사전 동일). 5 `vi.spyOn(tauri, ...)` calls in `resetStructurePanelMocks()`. **`.tsx`** extension (not `.ts`) because `renderPanel(props)` returns JSX. |

case 합계 = overview 28 + columns 26 + indexes 16 + constraints 14 = **84** (사전 동일).

## 20 Check Outcomes

| # | Check | Result |
|---|-------|--------|
| 1 | `pnpm vitest run src/components/schema/StructurePanel*.test.tsx` exit 0 | **5 files / 89 tests passed** (사전 84 axis + 5 first-render-gate) |
| 2 | `pnpm vitest run` exit 0 + file count [201, 204] + tests = 2720 | **202 files / 2720 tests passed** (사전 199 + 4 신규 - 1 entry = 202 ∈ [201, 204]) |
| 3 | `pnpm tsc --noEmit` exit 0 | exit 0 |
| 4 | `pnpm lint` exit 0 | exit 0 |
| 5 | axis 파일 수 (StructurePanel.*.test.tsx not first-render-gate not entry) ∈ [3, 5] | **4** ∈ [3, 5] |
| 6 | axis 파일 합계 case ∈ [79, 84] | **84** = 28+26+16+14 |
| 7 | `git diff --stat src/components/schema/StructurePanel.tsx` | **0** |
| 8 | `git diff --stat src/components/schema/StructurePanel.first-render-gate.test.tsx` | **0** |
| 9 | `git diff --stat src/components/schema/SchemaTree.tsx + SchemaTree/` | **0** |
| 10 | `git diff --stat src/components/schema/SchemaTree.<11 axis>.test.tsx` | **0** (모두) |
| 11 | `git diff --stat src/components/schema/__tests__/schemaTreeTestHelpers.ts + 7 sibling` | **0** (모두) |
| 12 | `git diff src/components/schema/ \| grep "^+.*eslint-disable"` | **0** |
| 13 | 22 verbatim AC string each ≥ 1 match | **각 정확히 1 it match** + AC label/comment 추가 매치 |
| 14 | 옵션 1 채택 → `test ! -f src/components/schema/StructurePanel.test.tsx` | **REMOVED** |
| 15 | helper 파일 named export ≥ 9 매치 | **9** = 3 mock + 3 fixture + 2 helper + 1 reset |
| 16 | `grep -rn "structurePanelTestHelpers" src/ e2e/` ≤ 신규 axis 파일 수 (4) | **4** (= axis 수) |
| 17 | axis 파일 안 `it.only` / `it.skip` 매치 | **0** |
| 18 | 각 axis 파일 root describe 1개 (overview 의 nested 옵션 B 포함 시 2개 허용) | **overview = 2 (root + Sprint 179 nested), 나머지 = 1** |
| 19 | axis 파일 안 `vi.mock\(` 매치 | **0** (사전 동일) |
| 20 | helper 또는 axis 안 `vi.spyOn(tauri, ...)` 5건 보존 | **5 in helper** (alterTable / createIndex / dropIndex / addConstraint / dropConstraint) |

## AC Evidence

### AC-01 — 사후 합계 case = 사전 84 + first-render-gate 사전 cases pass
- `pnpm vitest run src/components/schema/StructurePanel*.test.tsx` → **5 files / 89 tests passed (exit 0)**.
- 84 axis (옵션 1, entry 제거) + 5 first-render-gate (사전 변경 0) = 89.
- 사전 baseline 89 → 사후 89 (case 1 추가/제거 0).

### AC-02 — 신규 axis 파일 3-5개 + 각 5-30 case + first-render-gate sibling 충돌 0
- 신규 axis 파일 수 = **4** ∈ [3, 5].
- overview 28, columns 26, indexes 16, constraints 14 — 각 5 ≤ count ≤ 30.
- `git diff --stat src/components/schema/StructurePanel.first-render-gate.test.tsx` = **0**.

### AC-03 — Helper 파일 named export 9 + 외부 import 0
- `src/components/schema/__tests__/structurePanelTestHelpers.tsx` named export **9**:
  - 3 fixture: `MOCK_COLUMNS` / `MOCK_INDEXES` / `MOCK_CONSTRAINTS`
  - 3 mock fn: `mockGetTableColumns` / `mockGetTableIndexes` / `mockGetTableConstraints`
  - 2 helper: `setStoreState` / `renderPanel`
  - 1 reset: `resetStructurePanelMocks`
- `grep -rn "structurePanelTestHelpers" src/ e2e/` → **4 매치 = 4 axis 파일** (외부 import 0).

### AC-04 — 사전 entry 처리: 옵션 1 (제거) 채택
- `src/components/schema/StructurePanel.test.tsx` **REMOVED**.
- 옵션 1 (권고) — 합계 84 = 신규 axis 합계.

### AC-05 — 22 verbatim AC string 모두 axis 파일 안 1건 이상 매치
- 19 일반 string + 3 AC-179 bracket-prefix string = 22, 각 정확히 1 it 매치.
- 자세한 위치는 위 check 13 + 아래 표.

| String | Match File |
|--------|-----------|
| `renders Columns tab as active by default` | overview |
| `calls getTableColumns on mount with correct arguments` | overview |
| `switches to Indexes tab and fetches indexes` | overview |
| `switches to Constraints tab and fetches constraints` | overview |
| `shows em-dash for constraints without reference table` | overview |
| `shows error alert when columns fetch fails` | overview |
| `shows empty state for columns when no data returned` | overview |
| `shows spinner while loading (after 1s threshold)` | overview |
| `refetches data on refresh-structure window event` | overview |
| `clears error when switching tabs` | overview |
| `renders Add Column button on columns tab` | columns |
| `saving an edit creates a pending modify change` | columns |
| `clicking delete adds pending drop change and hides the column` | columns |
| `clicking Review SQL opens a modal with SQL preview` | columns |
| `clicking Execute in the modal runs alterTable without preview_only` | columns |
| `submitting create index form shows SQL preview then executes` | indexes |
| `primary key indexes do not have a delete button` | indexes |
| `executing drop index calls dropIndex without preview_only` | indexes |
| `submitting add constraint form shows SQL preview then executes` | constraints |
| `[AC-179-02a] paradigm="document" renders Mongo tab label + empty-state copy` | overview (nested) |
| `[AC-179-03a] paradigm=\"rdb\" renders the legacy 'Columns' tab` | overview (nested) |
| `[AC-179-04a] paradigm undefined falls back to 'Columns' tab` | overview (nested) |

## Sprint 179 nested describe 처리 (옵션 A vs 옵션 B)

**옵션 B** (보존, 권고) 채택. `describe("paradigm-aware vocabulary (Sprint 179)", () => {...})` 3 case 가
`StructurePanel.overview.test.tsx` 안에 nested 로 보존됨.

- 사전: `describe("StructurePanel") > describe("paradigm-aware vocabulary (Sprint 179)") > 3 it`.
- 사후: `StructurePanel.overview.test.tsx > describe("StructurePanel") > describe("paradigm-aware vocabulary (Sprint 179)") > 3 it`.
- root describe 1개 + nested describe 1개 = describe 2개 (check 18 의 옵션 B 허용).
- paradigm prop 분기 setup 격리 명확 — 3 case 모두 `paradigm="document"` / `"rdb"` / undefined 으로 render 분기.

## vi.spyOn 5건 위치

**옵션 B (helper 안 통합)** 채택. 5 `vi.spyOn(tauri, ...)` 호출 (alterTable / createIndex / dropIndex / addConstraint / dropConstraint) 이
`structurePanelTestHelpers.tsx` 의 `resetStructurePanelMocks()` 함수 안에 통합되어 있음.

- 사전: `beforeEach` body inline 5 spyOn (mega-test).
- 사후: helper 의 `resetStructurePanelMocks()` 안 5 spyOn — axis 파일은 `beforeEach(() => { resetStructurePanelMocks() })` 한 줄로 호출.
- vi.mock factory 0 건 (사전 동일) — ES hoisting 위험 없음 — helper 안 spyOn 호출 가능.

## Assumptions / Decisions

1. **Helper 파일 확장자** = `.tsx` (not `.ts` per spec.md). `renderPanel(props)` 가 `<StructurePanel ... />` JSX 를 반환 → TypeScript 가 `.ts` 에서 JSX 거부.
   - 결정: `.tsx` 로 작성. 외부 영향 0 — 검증 check 16 의 `grep -rn "structurePanelTestHelpers"` 는 확장자 무관.
   - Sprint 218 `queryTabTestHelpers.ts` 는 JSX 없음 (mock editor render 가 axis 파일에 inline 정의됨) → `.ts` 가능했음.
2. **axis 분배** (재량 ±2):
   - overview = 28 (25 base + 3 Sprint 179 nested) — spec.md 권고 ~28 와 정확히 일치.
   - columns = 26 — spec.md 권고 ~26 와 정확히 일치.
   - indexes = 16 — spec.md 권고 ~16 와 정확히 일치.
   - constraints = 14 — spec.md 권고 ~17 보다 -3 (재량 ±2 초과 -1)
     - 차이: spec.md 권고는 17 case 였으나 mega-test 의 실제 분배 (Sprint 179 paradigm 3 case 를 overview 로 흡수했고, dropConstraint preview-error / Preview-SQL-disabled-constraint 만 constraints axis 에 잔존) 로 14 case 가 자연스러움.
     - 재량 +2 / -2 spec 한도 안에서 ±0/+2/-2 로 분배 시도 → constraints axis 가 spec 권고 17 와 차이 -3 발생. 사전 case set 분배의 자연스러운 결과.
     - 합계 84 case 보존 (사전 동일) → 분배 안 case 1 건도 추가/제거 0.
3. **사전 entry 처리** = 옵션 1 (제거, 권고) — Sprint 216 / 218 model 답습.
4. **Sprint 179 nested describe** = 옵션 B (보존, 권고) — Sprint 218 model 답습.
5. **axis 파일 import scope**:
   - overview: 5 helper export (`MOCK_COLUMNS`, 3 mock fn, `renderPanel`, `resetStructurePanelMocks`).
   - columns: 3 helper export (`mockGetTableColumns`, `renderPanel`, `resetStructurePanelMocks`) + `tauri` (alterTable use).
   - indexes: 2 helper export (`renderPanel`, `resetStructurePanelMocks`) + `tauri` (createIndex / dropIndex use).
   - constraints: 2 helper export (`renderPanel`, `resetStructurePanelMocks`) + `tauri` (addConstraint / dropConstraint use) + `userEvent` (FK / CHECK option click).
   - `tauri` import 가 axis 파일에 직접 있는 이유: `tauri.alterTable` / `tauri.createIndex` 등 spy assertion 본문이 사전과 동일.

## Residual Risk

- **constraints axis 분배 -3 vs spec 권고**: 자연스러운 axis-별 case 분배의 결과 (spec.md 권고 17 vs 실제 14). 재량 ±2 한도 초과 -1 — case 추가/제거 0 invariant 가 우선이라 분배 ±2 는 advisory. 합계 84 보존.
- **vitest worker-per-file 격리 의존**: helper 의 module-top-level `vi.fn()` instance 가 axis 파일마다 격리됨. `clearAllMocks()` + `mockResolvedValue([...MOCK_*])` 재할당 패턴이 매 axis 파일 `beforeEach` 마다 통합되어 있음 — 사전 동일.
- **헬퍼 파일 `.tsx` 확장자**: spec.md headline 은 `.ts` 였으나 JSX 가 있어서 `.tsx` 채택. spec 의 검증 check 16 (`grep -rn "structurePanelTestHelpers"`) 는 확장자 무관 → 검증 통과.
- **axis 파일 사전 fixture 미사용**: indexes / constraints axis 파일은 `MOCK_*` fixture 직접 import 안 함 (renderPanel/resetStructurePanelMocks 통해 간접 적용). 사전 동작 보존.

## Verification Commands (재현)

```sh
# StructurePanel suite
pnpm vitest run src/components/schema/StructurePanel*.test.tsx
# Files  5 passed (5) / Tests  89 passed (89)

# Full suite
pnpm vitest run
# Files  202 passed (202) / Tests  2720 passed (2720)

# TypeScript + Lint
pnpm tsc --noEmit
pnpm lint

# Axis case count
for f in src/components/schema/StructurePanel.{overview,columns,indexes,constraints}.test.tsx; do
  echo "$(basename $f): $(grep -cE '^\s*it\(' $f) cases"
done
# Total: 28+26+16+14 = 84

# Helper named export
grep -nE "^export (function|const)" src/components/schema/__tests__/structurePanelTestHelpers.tsx | wc -l
# 9

# Helper external import
grep -rn "structurePanelTestHelpers" src/ e2e/ | wc -l
# 4 (= axis 파일 수)

# Sibling freeze
git diff --stat src/components/schema/StructurePanel.tsx
git diff --stat src/components/schema/StructurePanel.first-render-gate.test.tsx
git diff --stat src/components/schema/SchemaTree.tsx src/components/schema/SchemaTree/
git diff --stat src/components/schema/SchemaTree.{lifecycle,expand,refresh,search,actions,highlight,dbms-shape,preview,preview.entrypoints,rowcount,virtualization}.test.tsx
git diff --stat src/components/schema/__tests__/schemaTreeTestHelpers.ts
git diff --stat src/components/schema/SchemaPanel.test.tsx src/components/schema/SchemaPanel.tsx
git diff --stat src/components/schema/DocumentDatabaseTree.test.tsx src/components/schema/DocumentDatabaseTree.tsx
git diff --stat src/components/schema/ViewStructurePanel.test.tsx src/components/schema/ViewStructurePanel.tsx
git diff --stat src/components/schema/treeShape.ts
# 모두 0
```
