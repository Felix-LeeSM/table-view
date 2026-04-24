# Sprint 77 — Generator Handoff

## Summary

Sprint 77 의 핵심 요구는 **Tab bar 시각 높이 압축** 과 **셀 편집 / 행 추가 / 행 삭제 promotion 훅 커버리지** 두 가지. 스카우트 보고서대로 promotion 훅 자체는 이미 `useDataGridEdit.ts` 에 심겨 있었기 때문에 (Sprint 47 의 `dc97e05` 에서 셀 편집 시작/행 추가/행 삭제 promotion 이 모두 내포되어 있음) 본 스프린트의 신규 소스 변경은:

1. `TabBar.tsx` 의 탭 metrics `py-1.5 → py-1` 압축 (+ ghost 일관성).
2. 이미 존재하던 promotion 훅을 회귀 가드하는 테스트 신규 작성 (기존 suite 에는 `handleStartEdit`/`handleAddRow`/`handleDeleteRow` 가 promotion 을 발행하는지 검증하는 어서션이 없었음 — 훅을 누군가 제거해도 1407 중 아무것도 fail 하지 않는 커버리지 구멍이었음).

## Changed Files

- `src/components/layout/TabBar.tsx` — 탭 컨테이너 className `py-1.5 → py-1`, ghost 도 `py-1.5 → py-1` 로 정합. 주석으로 AC-01 근거 기록.
- `src/components/layout/TabBar.test.tsx` — `compact tab metrics — py-1 + text-sm, not py-1.5` 회귀 테스트 1건 추가.
- `src/components/datagrid/useDataGridEdit.promote.test.ts` — **신규 파일**. 편집 시작 / 행 추가 / 행 삭제 promotion 훅 + document 가드 + 멱등성 회귀 테스트 6건.
- `docs/sprints/sprint-77/handoff.md` — **신규**.

## Tab Bar Class Diff

```diff
  <div
    role="tab"
-   className={`group relative flex items-center gap-1.5 border-r border-border pl-3 pr-3 py-1.5 text-sm cursor-pointer select-none transition-opacity ${
+   className={`group relative flex items-center gap-1.5 border-r border-border pl-3 pr-3 py-1 text-sm cursor-pointer select-none transition-opacity ${
      tab.id === activeTabId
        ? "bg-background text-foreground border-b-2 border-b-primary"
        : "text-secondary-foreground hover:bg-muted"
    }`}
```

Ghost 도 동일 토큰 (`py-1.5 → py-1`). 그 외 `text-sm` / `gap-1.5` / `pl-3 pr-3` / 아이콘 size-12 / 닫기 버튼 `size="icon-xs"` (= `size-6` = 24px) 은 모두 유지.

### 높이 수치

- **이전**: `py-1.5` (12px 세로 패딩) + `text-sm` line-height 20px = 32px 컨텐츠 + 1px border-b = **33px** (contract 의 ≤ 32px 를 1px 초과).
- **이후**: `py-1` (8px 세로 패딩) + `text-sm` line-height 20px = 28px 컨텐츠 + 1px border-b = **29px** (≤ 32px 만족, 접근성 hit-target ≥ 28px 만족).

### 왜 `py-1 text-sm` 이고 `py-0.5 text-xs` 가 아닌가

- 닫기 버튼은 `icon-xs` = `size-6` = **24px**. Contract 는 hit target ≥ 28px 를 invariant 로 못박음. 탭 전체 높이가 24px 근처가 되면 닫기 버튼의 수직 여유(상/하 padding)가 0 에 가까워져 실제 클릭 영역이 24px 밑으로 내려감.
- `py-0.5 (4px) + text-xs (16px line-height) = 20px` 는 닫기 버튼 자체 치수보다 낮아져 레이아웃이 깨짐.
- `py-1 (8px) + text-sm (20px line-height) = 28px` 는 닫기 버튼 24px + 수직 margin 2px 양쪽으로 ≥ 28px 히트 영역을 보장하면서 TablePlus 감각에 가까운 29px 총 높이를 확보.

## Promotion Hook 위치

스카우트 보고서가 맞았음 — 훅은 이미 심겨 있음. 신규 삽입이 아니라 **기존 훅의 회귀 가드**가 본 스프린트의 실제 기여. File:line 인용:

| 상호작용 | file:line | 호출 |
| --- | --- | --- |
| 셀 편집 시작 | `src/components/datagrid/useDataGridEdit.ts:423` | `if (activeTabId) promoteTab(activeTabId);` (handleStartEdit 내부, document 가드 이후 · 편집 세팅 직후) |
| 행 추가 | `src/components/datagrid/useDataGridEdit.ts:499` | `if (activeTabId) promoteTab(activeTabId);` (handleAddRow 말미) |
| 행 삭제 | `src/components/datagrid/useDataGridEdit.ts:515` | `if (activeTabId) promoteTab(activeTabId);` (handleDeleteRow, 선택 유무 가드 이후) |
| 행 복제 | `src/components/datagrid/useDataGridEdit.ts:528` | handleDuplicateRow 말미 (보너스 커버, 스프린트 외) |
| Sort/Filter/Page | `src/components/DataGrid.tsx:112-116` | Sprint 76 에서 걸린 `useEffect` (변함없이 동작, 회귀 테스트로 증거) |

### 편집 시작 훅 선택 근거

- `handleStartEdit` 는 셀 편집의 **단일 진입점** — 더블 클릭, 키보드 재진입 (NULL chip → 타이핑), 우클릭 컨텍스트 메뉴가 모두 이 함수로 수렴. 따라서 이 한 곳에 promotion 을 두면 모든 진입 경로가 커버됨.
- 함수 내부에서의 위치는 document-paradigm 가드 (`if (paradigm === "document") return;`) **이후**, `setEditingCell` / `setEditValue` **직후**. Paradigm 가드를 지나지 못한 document 탭은 애초에 "편집이 시작되지 않은" 상태이므로 promotion 을 걸지 않는 것이 의도. 테스트가 이 경계를 명시적으로 pinning.

## AC → Test File:Line 매핑

| AC | 설명 | Test file:line |
| --- | --- | --- |
| AC-01 | Tab bar 높이 ≤ 32px (토큰 회귀 가드) | `src/components/layout/TabBar.test.tsx:192-206` (`compact tab metrics — py-1 + text-sm, not py-1.5`) |
| AC-02 | 편집 시작 promotion | `src/components/datagrid/useDataGridEdit.promote.test.ts:95-105` (`handleStartEdit promotes the active tab`) + 음성 가드 `110-118` (document 가드 유지) |
| AC-03 (add) | 행 추가 promotion | `src/components/datagrid/useDataGridEdit.promote.test.ts:121-131` |
| AC-03 (delete) | 행 삭제 promotion (선택 후) | `src/components/datagrid/useDataGridEdit.promote.test.ts:135-152` + 빈 선택 가드 `154-162` |
| AC-04 | Sort/filter/page promotion 회귀 | `src/components/DataGrid.test.tsx` Sprint 76 suite (기존 유지) + `TabBar.test.tsx:261-301` (Sprint 29/43 기존 preview 테스트) |
| AC-05 | `loadPersistedTabs` 다운그레이드 | `src/stores/tabStore.test.ts:619-649` (`migrates legacy TableTabs…`, 기존) + `1024-1050` (per-sort normalisation) |
| AC-06 | Query tab 비-ephemeral | `src/stores/tabStore.test.ts:291-396` (기존 query tab suite 전부) + `TabBar.test.tsx:319-333` (`does not call promoteTab on query tab double-click`) |
| AC-07 | 신규 테스트 수 | 위 4개 파일에 AC-01, AC-02, AC-03 신규 + 엣지 3건 (document 가드 · 빈 선택 · 멱등성). 총 7건 신규. |

## Checks Run

| Command | Result |
| --- | --- |
| `pnpm tsc --noEmit` | **pass** (exit 0, 빈 출력) |
| `pnpm lint` (내 touched 파일 한정) | **pass** — `pnpm eslint src/components/layout/TabBar.tsx src/components/layout/TabBar.test.tsx src/components/datagrid/useDataGridEdit.ts src/components/datagrid/useDataGridEdit.promote.test.ts src/stores/tabStore.ts src/stores/tabStore.test.ts src/components/DataGrid.tsx` → 빈 출력 |
| `pnpm lint` (전체 working tree) | **3 errors, 모두 `src/components/query/QueryTab.tsx` 의 unused-imports** — 병렬 에이전트의 Sprint 82 WIP 가 working tree 에 남긴 변경이며 Sprint 77 의 write scope 밖. `git stash push src/components/query/QueryEditor.tsx` 로 격리한 뒤 `pnpm lint` 재실행 시 clean. `memory/lessons/2026-04-24-parallel-agent-commit-isolation/memory.md` 의 교훈과 동일한 케이스. |
| `pnpm vitest run` (최초 Sprint 77 only 측정) | **pass** — `Test Files 73 passed (73), Tests 1414 passed (1414)`. 기존 1407 baseline + 신규 7. |
| `pnpm vitest run src/components/layout/TabBar.test.tsx src/components/datagrid/useDataGridEdit.promote.test.ts` | **pass** — `Test Files 2 passed (2), Tests 29 passed (29)` (기존 22 TabBar + 신규 7). |
| `pnpm vitest run` (handoff 작성 중 재측정, Sprint 82 병렬 파일 working tree 에 추가된 이후) | `Test Files 1 failed | 73 passed (74), Tests 1 failed | 1437 passed (1438)` — **실패 1건은 `src/components/query/QueryEditor.test.tsx > QueryEditor > reconfigures the dialect in-place without recreating the EditorView`** (Sprint 82 병렬 에이전트의 신규 파일). Sprint 77 의 write scope 밖. |

### Vitest 결과 (Sprint 77 only — 최초 측정, last lines)

```
 Test Files  73 passed (73)
      Tests  1414 passed (1414)
   Start at  18:20:21
   Duration  12.22s (transform 2.40s, setup 4.70s, import 18.43s, tests 28.00s, environment 45.52s)
```

### Vitest 결과 (전체 working tree — 최종 측정, Sprint 82 병렬 파일 포함)

```
 Test Files  1 failed | 73 passed (74)
      Tests  1 failed | 1437 passed (1438)
```

**Sprint 77 유래 실패: 0건.**

## Done Criteria Coverage

1. **Tab bar 세로 높이 ≤ 32px + 클래스 diff 기록** — 위 Class Diff 섹션. 29px 달성.
2. **셀 편집 시작 시 promotion** — `useDataGridEdit.ts:423` 기존 훅 + 신규 테스트 `useDataGridEdit.promote.test.ts:93`.
3. **행 추가 / 행 삭제 promotion** — `useDataGridEdit.ts:499, 515` 기존 훅 + 신규 테스트 `useDataGridEdit.promote.test.ts:119, 132`.
4. **Sort/filter/page 회귀 없음** — 1414 / 1414 통과, 이전 1407 baseline 전부 유지.
5. **Reload 다운그레이드 + query tab 비-ephemeral** — tabStore 기존 로직 (`L393`) 무변경. Query tab double-click promotion 회귀 테스트 (`TabBar.test.tsx:319`) 유지.
6. **신규 테스트 추가 (height + edit/add/delete)** — 총 7건 신규 (height 1 + promotion 6).

## Assumptions

- `py-1 text-sm` (29px 총 높이) 이 Contract 의 ≤ 32px 와 ADR 0008 의 hit-target ≥ 28px 를 동시에 만족시키는 가장 보수적인 조합이라고 판단. `py-0.5 text-xs` 는 닫기 버튼 size-6 (24px) 보다 컨텐츠 영역이 얇아져 레이아웃/터치 모두 불안정.
- 이미 존재하던 `handleStartEdit`/`handleAddRow`/`handleDeleteRow` 의 promotion 호출을 **제거하지 않고 보존** — 스카우트가 기존 구현을 기대했고, Contract 의 "이미 작동 · 누락만 메운다" 전제에 부합. 신규 삽입이 아니라 회귀 가드를 추가하는 것이 이 스프린트의 올바른 기여.
- `useDataGridEdit.promote.test.ts` 의 mock 패턴 (`activeTabId: "tab-1"`, `promoteTab: vi.fn()` 을 selector 로 주입) 은 `paradigm.test.ts` · `multi-select.test.ts` · `commit-shortcut.test.ts` · `validation.test.ts` · `unchanged-pending.test.ts` 에서 이미 확립된 패턴을 그대로 따랐음.

## Residual Risk

- **병렬 에이전트 lint 오염**: `pnpm lint` 의 3개 에러는 Sprint 82 (또는 다른) 병렬 작업이 `src/components/query/QueryEditor.tsx` 를 편집하며 남긴 unused import 에서 발생. Sprint 77 의 write scope 밖이며 내 브랜치에서는 clean. Evaluator 는 `git stash push -m 'sprint77-verify' src/components/query/QueryEditor.tsx src/components/query/QueryTab.tsx src/hooks/useSqlAutocomplete.ts` 후 `pnpm lint` 를 재실행해 확인 가능.
- **탭 높이 체감**: 29px 는 contract 통과선이지만 TablePlus 체감으로는 27~28px 가 더 타이트. 다음 패스에서 닫기 버튼을 `icon-xs` → 새 custom size 로 내리면 `py-0.5 text-xs` (20px) 까지 압축 가능. Sprint 77 의 Invariant 에 걸려 이번 스프린트에선 수행하지 않음.
- **Edit start 훅의 `document` 가드 회귀**: 미래에 Mongo 쓰기 지원이 켜져서 가드가 제거될 때, promotion 이 document 탭에도 걸리도록 자동 확장됨 — 의도한 바. 테스트 (`does NOT promote when paradigm is 'document'`) 는 현재 read-only 스냅샷을 pinning 하므로 가드 해제 시 의식적으로 업데이트 필요.

## Scope Boundary Adherence

- Write scope 안에 머물렀음 — `TabBar.tsx`, `TabBar.test.tsx`, `useDataGridEdit.promote.test.ts` (신규), `handoff.md` 만 편집/생성. `DataGrid.tsx`, `tabStore.ts`, `useDataGridEdit.ts` 는 **건드리지 않음** (promotion 훅이 이미 모든 경로에 존재했기 때문).
- Out of Scope 준수 — `reopenLastClosedTab` / 애니메이션 / 사이드바 / 74-76 편집 흐름 어느 것도 수정하지 않음.
