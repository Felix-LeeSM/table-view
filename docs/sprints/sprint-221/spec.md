# Feature Spec: tabStore.test.ts behavior-axis split (Sprint 221 — P11 step 4)

## Description

`src/stores/tabStore.test.ts` (2,234 lines, 1 root `describe("tabStore")` + 11 L1 nested describe + 2 L2 nested describe = 14 describe blocks total, 102 `it` cases) 가 단일 파일에 `tabStore` (post-Sprint 208 entry, 596 lines) 의 모든 회귀 가드를 누적 보유한다. Sprint section 헤더 (Sprint 25/29/38/45/66/73/76/84/97/129/130/136/153/158/195/209/212) + AC label (AC-S136-01..04, AC-158-01..03, AC-06..AC-10, AC-153-06, [AC-195-01-1..6], [AC-195-02-1..3]) 로 axis 추출 경계가 명확.

본 sprint 는 P11 candidate (`docs/archives/backlogs/refactoring-candidates-2026-05-06.md` §P11) 의 **fourth step**. Sprint 216 (P11 step 1, SchemaTree.test 2,891 / 104 cases → 6 axis + helper) / Sprint 218 (P11 step 2, QueryTab.test 2,308 / 80 cases → 6 axis + helper) / Sprint 220 (P11 step 3, StructurePanel.test 2,156 / 84 cases → 4 axis + helper) 의 model implementation 패턴 답습. 후속 P11 step 5 (`DataGrid.test.tsx` 1,906) 는 별도 sprint candidate.

행동 변경 0 강제. `tabStore.ts` (596 lines, post-Sprint 208 entry) + `tabStore/{types,persistence,tracker}.ts` (Sprint 208 sub-files) 변경 금지. test 만 axis 파일 split. 사전 102 case 모두 사후 통과. case 텍스트 / matcher / fixture / `useTabStore.setState(...)` reset pattern / 모든 verbatim AC string 사전과 byte-equivalent.

이 sprint 는 **test-only refactor + axis split** 패턴 — Sprint 216 / 218 / 220 와 동일 카테고리. 100% test 파일 재배치이며 src/stores 변경 0. 사전 mega test 가 `vi.mock(...)` factory 0 건 (Sprint 220 와 동일, Sprint 218 의 7 factory 와 다름). `vi.spyOn(...)` 0 건. `vi.useFakeTimers()` + `vi.stubGlobal("localStorage", {...})` 패턴이 persistence 관련 2개 nested describe 에 verbatim 중복 — axis 분리 후 단일 axis 로 흡수해 helper 안 통합 가능.

## Sprint Breakdown

### Sprint 221: tabStore.test.ts behavior-axis split

**Goal**: `tabStore.test.ts` (2,234 lines / 102 cases) 를 5-7 behavior-axis test 파일 + 1 shared helper 파일로 분해. 사전 1 root + 11 L1 nested + 2 L2 nested describe + 102 case → 사후 axis-별 root describe + 합계 102. 옵션 1 (entry 제거) 권고. 행동 변경 0. `tabStore.ts` + `tabStore/{types,persistence,tracker}.ts` + 9 sibling store test 변경 0.

**Verification Profile**: `command`

**Acceptance Criteria**:

1. **사후 tabStore*.test.ts 합계 102 case 통과.**
   `pnpm vitest run src/stores/tabStore*.test.ts` exit 0 + 102 cases.
   합계 case = 102 (사전 동일).

2. **신규 axis 파일 5-7개 + shared helper.**
   - naming: `src/stores/tabStore.<axis>.test.ts`.
   - 각 신규 ≥ 5 case + ≤ 30 case (Sprint 220 와 동일 envelope).
   - axis 후보 (6 권고):
     - `tabStore.lifecycle.test.ts` (~7): root describe 의 7 case (addTab / activates existing / removeTab / sets active to previous / setActiveTab / setSubView / subView persists across tabs).
     - `tabStore.query.test.ts` (~20): `query tab actions` (13) + `loadQueryIntoTab` (7). Sprint 73 paradigm/queryMode + Sprint 84 paradigm-aware restore.
     - `tabStore.preview.test.ts` (~19): `preview tab system` (14, Sprint 29 + 136 + 158) + `addTab permanent option` (5, Sprint 209). isPreview / promoteTab / preview slot replacement / permanent flag.
     - `tabStore.persistence.test.ts` (~13): `tab state persistence` (9, Sprint 38 + 66 + 129) + `per-tab sort persistence` (4, Sprint 76). 둘 다 `vi.useFakeTimers()` + `vi.stubGlobal("localStorage", {...})` setup 공유 → helper 안 `installFakeLocalStorage()` 로 통합.
     - `tabStore.sort.test.ts` (~19): `moveTab` (6) + `reopen last closed tab` (4) + `per-tab sort state` (9). tab collection mutation invariants (Sprint 45 + Sprint 76).
     - `tabStore.lifecycle-actions.test.ts` (~24): `setTabDirty / dirtyTabIds` (6, Sprint 97) + `RDB database autofill (Sprint 130)` (6) + `SYNCED_KEYS allowlist (AC-153-06)` (3) + `query lifecycle actions (sprint-195)` (9, **L2 nested 2개 보존 = 옵션 B**).
   - generator 재량: ±2 case 이동 / axis 이름 변경 / 5-7 재배치. 단 합계 102 invariant 보존.

3. **신규 shared helper 파일 (옵션 B 권고).**
   - 옵션 B: `src/stores/__tests__/tabStoreTestHelpers.ts` 신규.
   - **Lint 주의**: `eslint.config.js` 의 `no-restricted-imports` 규칙이 `src/stores/**/*.ts` 적용 (`ignores: ["**/*.test.ts"]`). 헬퍼 파일 (`.ts`, not `.test.ts`) 은 규칙 적용 대상 — 헬퍼 안 cross-store import 금지. `connectionStore` 의존은 axis 파일 안 inline `await import("./connectionStore")` 로 잔존 (사전 Sprint 130 6 case 와 동일 패턴).
   - named export 5-7 권고:
     - `makeTableTab(overrides)` (verbatim from L12-28).
     - `getTableTab(state, index)` (verbatim from L30-34).
     - `getQueryTab(state, index)` (verbatim from L36-40).
     - `resetTabStore()` — wraps `useTabStore.setState({ tabs: [], activeTabId: null, closedTabHistory: [], dirtyTabIds: new Set() })`.
     - `installFakeLocalStorage()` / `restoreLocalStorage()` — `vi.useFakeTimers()` + `vi.stubGlobal("localStorage", {...})` 통합. `storage: Record<string, string>` reference 반환.
     - (선택 7번째) `seedRunningQueryTab(tabId, queryId)` — `query lifecycle actions` 의 inline helper (L2075-2091) 승격.
   - vi.mock factory 0 건 (사전 0 — 추가 금지). vi.spyOn 0 건 (사전 0 — 추가 금지).
   - 외부 import 0 — `grep -rn "tabStoreTestHelpers" src/ e2e/` 매치 ≤ 6 (= 신규 axis 파일 수).

4. **사전 entry 처리.**
   - 옵션 1 (권고): `src/stores/tabStore.test.ts` 제거. 합계 102 = 신규 axis 합계.
   - 옵션 2 (허용): smoke ≤ 5 case 잔존. 합계 = axis + smoke.

5. **20 verbatim AC string 보존** (각 ≥ 1 매치):
   - "adds a tab"
   - "activates existing tab for same connection+table"
   - "removes a tab"
   - "addQueryTab without opts defaults to paradigm=rdb + queryMode=sql"
   - "addQueryTab with paradigm=document defaults queryMode to find"
   - "addQueryTab with paradigm=rdb forces queryMode to sql even if caller asks otherwise"
   - "updates in place when the active query tab shares paradigm + connection (AC-06)"
   - "spawns a new tab when paradigms differ and leaves the original untouched (AC-07, AC-10)"
   - "flips queryMode from find to aggregate in place on a document tab (AC-08)"
   - "preserves the active tab's database/collection when loading a document entry in place"
   - "AC-S136-01: single-click creates a preview tab (isPreview === true)"
   - "AC-S136-02: promoteTab flips isPreview to false; further row clicks open a separate preview tab"
   - "AC-S136-04: clicking the same row twice is idempotent (no second tab, no promote)"
   - "AC-158-01: same table + different subView → creates new tab"
   - "AC-158-03: Data preview + Structure click → creates new Structure preview (no swap)"
   - "backfills database/collection on legacy document tabs (sprint 129)"
   - "exposes exactly the cross-window-synced tab keys"
   - `[AC-195-01-1] completeQuery transitions running → completed when queryId matches`
   - `[AC-195-01-2] completeQuery is a no-op when queryId mismatches (stale response)`
   - `[AC-195-02-1] allFailed → error with joined message`

6. **`tabStore.ts` + sub-file 3개 변경 0.** `git diff --stat` 모두 0:
   - `src/stores/tabStore.ts`
   - `src/stores/tabStore/types.ts`
   - `src/stores/tabStore/persistence.ts`
   - `src/stores/tabStore/tracker.ts`

7. **Sibling store test 변경 0.** 9 sibling 모두 `git diff --stat` = 0:
   - `src/stores/connectionStore.test.ts` / `connectionStore.ts`
   - `src/stores/documentStore.test.ts` / `documentStore.ts`
   - `src/stores/favoritesStore.test.ts` / `favoritesStore.ts`
   - `src/stores/mruStore.test.ts` / `mruStore.ts`
   - `src/stores/queryHistoryStore.test.ts` / `queryHistoryStore.ts`
   - `src/stores/safeModeStore.test.ts` / `safeModeStore.ts`
   - `src/stores/schemaStore.test.ts` / `schemaStore.ts`
   - `src/stores/themeStore.test.ts` / `themeStore.ts`

8. **Project-wide regression bar.**
   - `pnpm vitest run` exit 0. 사전 baseline (post-Sprint-220, 202 files / 2720 tests) → 사후 [206, 209] files / 2720 tests (옵션 1 채택 시 +6 axis -1 entry = +5; helper 파일은 test 파일 아님 → file count 영향 0).
   - `pnpm tsc --noEmit` exit 0 — 새 `any` 0.
   - `pnpm lint` exit 0 — 헬퍼 안 cross-store import 0 (lint 회피).
   - 새 `eslint-disable*` 0. 새 silent `catch{}` 0. `it.only` / `it.skip` 0.

**Components to Create/Modify**:

- 신규 6 axis test 파일 (위 axis 후보 분배):
  - `src/stores/tabStore.lifecycle.test.ts` (~7 case).
  - `src/stores/tabStore.query.test.ts` (~20 case).
  - `src/stores/tabStore.preview.test.ts` (~19 case).
  - `src/stores/tabStore.persistence.test.ts` (~13 case).
  - `src/stores/tabStore.sort.test.ts` (~19 case).
  - `src/stores/tabStore.lifecycle-actions.test.ts` (~24 case, L2 nested 2개 보존).
- `src/stores/__tests__/tabStoreTestHelpers.ts` (옵션 B 신규, named export 5-7).
- `src/stores/tabStore.test.ts` (옵션 1 제거 또는 옵션 2 smoke).

> Sprint 195 nested describe 처리 (`[AC-195-01]` + `[AC-195-02]`): 옵션 A (평탄화) 또는 옵션 B (보존, 권고). Sprint 220 model 답습 → 옵션 B 권고.

## Global Acceptance Criteria

1. **행동 변경 0.** `tabStore.ts` + `tabStore/{types,persistence,tracker}.ts` + 9 sibling store test/source 모두 변경 0.

2. **사전 102 case 모두 사후 통과 + 추가/제거 0.** vi.mock factory 사전 0 건 (사전과 동일). vi.spyOn 사전 0 건 (사전과 동일).

3. **사전 import / mock pattern 보존.** vitest / `./tabStore` (entry, `useTabStore` + types + `SYNCED_KEYS`) / `@/types/query` (`QueryState`) / `@/types/schema` (`SortInfo`) / dynamic `await import("./connectionStore")` (Sprint 130 axis 안 6 case) 사전 동일.

4. **사전 verbatim text 보존.** `[AC-195-01-1]`, `[AC-195-02-1]`, `AC-S136-01`, `AC-158-01`, `(AC-06)`, `(AC-07, AC-10)`, `(AC-08)`, em-dash `—` (case description 안), `(sprint 129)` (lowercase), `(Sprint 130)` (Capital), `(sprint-195 §3.1 extraction)`, `→` (case description 안) byte-equivalent.

5. **사전 fixture data shape 보존.**
   - `makeTableTab` builder 의 default value (title `"Test Tab"` / connectionId `"conn1"` / type `"table"` / closable `true` / schema `"public"` / table `"users"` / subView `"records" as const`) byte-equivalent.
   - `getTableTab` / `getQueryTab` typed accessor verbatim (각 5 line, throw `Expected TableTab` / `Expected QueryTab` 메시지).
   - persisted JSON shape (Sprint 38 + 66 + 76 + 129 cases): `{tabs: [...], activeTabId: "tab-1"}` literal verbatim.

6. **사전 store seed pattern 보존.**
   - 각 axis 파일 root describe 의 `beforeEach` body verbatim:
     - lifecycle / query / preview axis: `useTabStore.setState({ tabs: [], activeTabId: null, dirtyTabIds: new Set<string>() })` (root describe 의 L43-49 패턴).
     - movement / sort axis: `useTabStore.setState({ tabs: [], activeTabId: null })` (moveTab L1405-1407) + `closedTabHistory: []` 추가 (reopen + sort L1485-1491 / L1559-1565).
     - persistence axis: `useTabStore.setState({...})` + `installFakeLocalStorage()` (helper 통합).
     - lifecycle-actions axis: `useTabStore.setState({...})` + axis-별 추가 (e.g. `dirtyTabIds: new Set()` for setTabDirty axis, `await import("./connectionStore"); useConnectionStore.setState({ connections: [], activeStatuses: {} })` for Sprint 130 axis).
   - axis 파일은 `resetTabStore()` helper 호출로 통합 가능 (옵션 B helper 채택 시).

7. **public surface 0 변경.** `useTabStore` API (18 actions) + `useActiveTab` selector + 7 type re-export + `SYNCED_KEYS` + 2 tracker helper 동결. 외부 importer 51건 변경 0.

8. **새 `eslint-disable*` 0, 새 silent `catch{}` 0.**

9. **vitest baseline file count 증가.** 사전 202 → 사후 [206, 209] (옵션 1 + 6 axis - 1 entry = +5). tests = 2720.

10. **Sibling drift 0.** 9 sibling store test/source + Sprint 216/218/220 산출물 모두 변경 0:
   - `src/components/schema/SchemaTree.<axis>.test.tsx` (Sprint 216, 6 파일) + `__tests__/schemaTreeTestHelpers.ts`.
   - `src/components/query/QueryTab.<axis>.test.tsx` (Sprint 218, 6 파일) + `__tests__/queryTabTestHelpers.ts`.
   - `src/components/schema/StructurePanel.<axis>.test.tsx` (Sprint 220, 4 파일) + `__tests__/structurePanelTestHelpers.tsx`.

## Data Flow

### Before

```
src/stores/
  ├─ tabStore.test.ts (2,234 lines, 1 root + 11 L1 nested + 2 L2 nested describe, 102 cases)
  │  ├─ inline: 3 module-top helper (makeTableTab / getTableTab / getQueryTab)
  │  │         + 1 root beforeEach (useTabStore.setState reset)
  │  │         + 11 L1 nested describe with axis-별 beforeEach
  │  │         + 2 L2 nested describe (Sprint 195) with shared seedRunningQueryTab + sampleResult + stmt factory
  │  │         + 0 vi.mock(...) factory + 0 vi.spyOn(...)
  │  │         + 2 vi.useFakeTimers + vi.stubGlobal("localStorage") (persistence 관련)
  │  │         + 6 dynamic await import("./connectionStore") (Sprint 130 axis 안 only)
  │  └─ 102 cases by Sprint section + AC label
  ├─ tabStore.ts (596, entry, 변경 0)
  └─ tabStore/{types,persistence,tracker}.ts (3 sub-file, 변경 0)
  └─ 9 sibling store test/source (변경 0)
```

### After

```
src/stores/
  ├─ __tests__/
  │   └─ tabStoreTestHelpers.ts (옵션 B 신규)
  │       3 helper (makeTableTab/getTableTab/getQueryTab) + 1 reset (resetTabStore)
  │       + 1-2 fake-storage helper (installFakeLocalStorage / restoreLocalStorage)
  │       + (선택) 1 seedRunningQueryTab = 5-7 named export
  │
  ├─ tabStore.lifecycle.test.ts (~7 cases) — root describe cases
  ├─ tabStore.query.test.ts (~20 cases) — query tab actions + loadQueryIntoTab
  ├─ tabStore.preview.test.ts (~19 cases) — preview tab system + addTab permanent option
  ├─ tabStore.persistence.test.ts (~13 cases) — tab state persistence + per-tab sort persistence (fake-localStorage 통합)
  ├─ tabStore.sort.test.ts (~19 cases) — moveTab + reopen + per-tab sort state
  ├─ tabStore.lifecycle-actions.test.ts (~24 cases) — setTabDirty + RDB autofill + SYNCED_KEYS + query lifecycle actions (L2 nested 2개 보존)
  │
  ├─ (옵션 1) tabStore.test.ts — 제거
  │   OR
  ├─ (옵션 2) tabStore.test.ts — smoke ≤ 5 case
  │
  ├─ tabStore.ts                       ─── 변경 0
  ├─ tabStore/{types,persistence,tracker}.ts ─── 변경 0
  └─ 9 sibling store test/source       ─── 변경 0

  Total: +6 (axis) + 1 (helper) - 1 (entry) = +6 file. 합계 case = 102.
```

### Cross-module dependency

```
tabStoreTestHelpers.ts (new, 옵션 B)
  ├─→ vi (vitest)
  ├─→ useTabStore + Tab + TableTab + QueryTab type from "../tabStore"
  └─→ no top-level cross-store import (lint 회피)

tabStore.<axis>.test.ts (each)
  ├─→ tabStoreTestHelpers (옵션 B) OR inline (옵션 A)
  ├─→ vitest
  ├─→ useTabStore + types + SYNCED_KEYS (lifecycle-actions axis only) from "./tabStore"
  ├─→ QueryState type from "@/types/query" (query / lifecycle-actions axis)
  ├─→ SortInfo type from "@/types/schema" (sort axis only)
  └─→ dynamic await import("./connectionStore") (lifecycle-actions axis 의 Sprint 130 6 case 안 inline only)

tabStore.ts → 변경 0
tabStore/{types,persistence,tracker}.ts → 변경 0
9 sibling store test/source → 변경 0
```

## Edge Cases

- **vi.mock factory hoisting**: 본 mega test 는 사전 0 factory — Sprint 220 와 동일, Sprint 218 의 7 factory 와 다름. 헬퍼 안 cross-store import 자체가 lint 위반이므로 helper 안 vi.spyOn 도 호출 불필요.
- **Mock leakage between axis 파일**: vitest worker-per-file 격리 + `resetTabStore()` beforeEach. tabCounter / queryCounter 도 module load 마다 0 reset → leakage 0.
- **Shared helper import 누락**: 옵션 B 채택 시 axis 파일에서 helper import 깜빡 시 makeTableTab undefined → 모든 case fail. evaluator check: 모든 axis 파일이 helper import 보유.
- **`useConnectionStore` cross-store dependency (lifecycle-actions axis 의 Sprint 130 nested only)**: 사전 6 case 모두 `await import("./connectionStore")` inline. 사후 axis 파일도 동일 패턴 — module-top import 금지 (lint).
- **`vi.useFakeTimers()` + `vi.stubGlobal("localStorage")` 패턴**: persistence axis 통합 시 helper 의 `installFakeLocalStorage()` 단일 호출로 일원화. 단 `vi.advanceTimersByTime(300)` (L1164, L1814) 호출은 case 안 verbatim 잔존.
- **Module-scope counter (tabCounter / queryCounter in tabStore.ts)**: 각 axis 파일이 별 worker → fresh counter. 하지만 hard-coded id 비교는 사전 0 건.
- **doubly-nested describe 처리** (`query lifecycle actions (sprint-195)` 의 `[AC-195-01]` + `[AC-195-02]`):
  - 옵션 A (평탄화): 9 case 평탄. nested 제거.
  - 옵션 B (보존, 권고): outer describe = axis-file root describe + 2 inner nested 보존. `seedRunningQueryTab` (L2075-2091) + `sampleResult` (L2093-2099) + `stmt` factory (L2168-2174) 는 outer scope 에 inline 잔존 (또는 `seedRunningQueryTab` 만 helper 승격).
- **Sprint 212 trailing comment block (L2226-2232)**: `recordHistory` 제거 + AC-195-03 (3 case) + AC-196-02 (2 case) 의 신규 case 추가 없음 명시 — 사후 axis 파일 (`tabStore.lifecycle-actions.test.ts`) 끝에 verbatim 보존 의무.
- **Axis 파일 case 합계 != 102**: 옵션 1 채택 시 정확히 102.
- **Case 텍스트 변경**: backtick / single-vs-double quote / em-dash `—` / `→` / 한글 / 특수 문자 보존 의무. 특히 `[AC-195-01-1..6]` / `[AC-195-02-1..3]` bracket-prefix 보존 — `grep -F` 매치 필요.
- **AC label prefix 충돌**: AC-06..AC-10 (loadQueryIntoTab) vs AC-S136-01..04 (preview semantics) vs AC-158-01..03 (subView) vs AC-153-06 (SYNCED_KEYS) vs [AC-195-01-1..6] / [AC-195-02-1..3] — axis 별 prefix 보존.
- **`it.only` / `it.skip` 잔존**: 사전 0 → 사후 0.
- **`closedTabHistory limits to 20 entries`** (L1542): 25 회 add+remove 루프. counter 25 회 tick — sort axis 안 fresh worker 에서 영향 0.
- **Sprint 195 inline helper `seedRunningQueryTab`** (L2075-2091): 5+ 회 사용. helper 승격 또는 axis-file outer scope 잔존 — generator 재량.
- **Phase 13 AC-13-06 comment label** (L842): 사전 1건 — preview axis 보존.

## Verification Hints

- **Primary regression**:
  ```sh
  pnpm vitest run src/stores/tabStore*.test.ts
  # exit 0 + Tests passed (102)
  ```

- **Axis file shape**:
  ```sh
  ls src/stores/tabStore.{lifecycle,query,preview,persistence,sort,lifecycle-actions}.test.ts 2>&1
  for f in src/stores/tabStore.{lifecycle,query,preview,persistence,sort,lifecycle-actions}.test.ts; do
    [ -f "$f" ] && echo "$f: $(grep -cE '^\s*it\(' "$f") cases"
  done
  # 합계 = 102 (옵션 1) 또는 102 - 옵션 2 잔존
  ```

- **Helper file**:
  ```sh
  test -f src/stores/__tests__/tabStoreTestHelpers.ts
  grep -nE "^export (function|const) (makeTableTab|getTableTab|getQueryTab|resetTabStore|installFakeLocalStorage|restoreLocalStorage|seedRunningQueryTab)" \
    src/stores/__tests__/tabStoreTestHelpers.ts | wc -l
  # ≥ 5
  ```

- **Helper 외부 import**:
  ```sh
  grep -rn "tabStoreTestHelpers" src/ e2e/ | wc -l
  # ≤ 6 (= 신규 axis 파일 수)
  ```

- **Sibling + component freeze**:
  ```sh
  git diff --stat src/stores/tabStore.ts src/stores/tabStore/
  git diff --stat \
    src/stores/connectionStore.test.ts src/stores/connectionStore.ts \
    src/stores/documentStore.test.ts src/stores/documentStore.ts \
    src/stores/favoritesStore.test.ts src/stores/favoritesStore.ts \
    src/stores/mruStore.test.ts src/stores/mruStore.ts \
    src/stores/queryHistoryStore.test.ts src/stores/queryHistoryStore.ts \
    src/stores/safeModeStore.test.ts src/stores/safeModeStore.ts \
    src/stores/schemaStore.test.ts src/stores/schemaStore.ts \
    src/stores/themeStore.test.ts src/stores/themeStore.ts
  git diff --stat src/components/schema/SchemaTree*.test.tsx \
    src/components/schema/__tests__/schemaTreeTestHelpers.ts \
    src/components/query/QueryTab*.test.tsx \
    src/components/query/__tests__/queryTabTestHelpers.ts \
    src/components/schema/StructurePanel*.test.tsx \
    src/components/schema/__tests__/structurePanelTestHelpers.tsx
  # 모두 0
  ```

- **Project-wide gates**:
  ```sh
  pnpm vitest run    # exit 0, file count [206, 209], tests = 2720
  pnpm tsc --noEmit  # exit 0
  pnpm lint          # exit 0
  ```

- **Verbatim string preservation**:
  ```sh
  for s in \
    "AC-S136-01: single-click creates a preview tab (isPreview === true)" \
    "AC-158-01: same table + different subView → creates new tab" \
    "backfills database/collection on legacy document tabs (sprint 129)" \
    "exposes exactly the cross-window-synced tab keys"; do
    grep -rnF "$s" src/stores/tabStore*.test.ts | wc -l
  done
  for s in \
    "[AC-195-01-1] completeQuery transitions running → completed when queryId matches" \
    "[AC-195-02-1] allFailed → error with joined message"; do
    grep -rnF "$s" src/stores/tabStore*.test.ts | wc -l
  done
  # 각 ≥ 1
  ```

- **vi.mock factory + vi.spyOn 0 건 보존**:
  ```sh
  for f in src/stores/tabStore.{lifecycle,query,preview,persistence,sort,lifecycle-actions}.test.ts \
           src/stores/__tests__/tabStoreTestHelpers.ts; do
    [ -f "$f" ] && echo "$f: $(grep -cE 'vi\.mock\(' "$f") factory / $(grep -cE 'vi\.spyOn\(' "$f") spy"
  done
  # 모두 0 / 0 (사전 0 — 추가 금지)
  ```

- **Lint 회피 (helper 안 cross-store import 0)**:
  ```sh
  grep -nE "^import.*connectionStore|^import.*queryHistoryStore|^import.*mruStore|^import.*schemaStore|^import.*documentStore|^import.*favoritesStore|^import.*safeModeStore|^import.*themeStore" \
    src/stores/__tests__/tabStoreTestHelpers.ts | wc -l
  # 0 (lint rule: src/stores/**/*.ts excluding *.test.ts forbids cross-store import)
  ```

- **Entry test 처리**:
  - 옵션 1: `test ! -f src/stores/tabStore.test.ts`.
  - 옵션 2: `wc -l src/stores/tabStore.test.ts` < 200 + `grep -cE "^\s*it\("` ≤ 5.

- **Sprint 195 nested describe 처리**:
  - 옵션 A: `grep -c "describe(\"\\[AC-195-0" src/stores/tabStore.lifecycle-actions.test.ts` = 0.
  - 옵션 B (권고): `grep -c "describe(\"\\[AC-195-0" src/stores/tabStore.lifecycle-actions.test.ts` = 2.

### Critical Files for Implementation

- /Users/felix/Desktop/study/view-table/src/stores/tabStore.test.ts
- /Users/felix/Desktop/study/view-table/src/stores/tabStore.ts
- /Users/felix/Desktop/study/view-table/src/stores/tabStore/types.ts
- /Users/felix/Desktop/study/view-table/docs/sprints/sprint-220/spec.md
- /Users/felix/Desktop/study/view-table/eslint.config.js
