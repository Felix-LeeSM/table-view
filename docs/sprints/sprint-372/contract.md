# Sprint Contract: sprint-372

## Summary

- Goal: Phase 5 query history frontend integration — History panel WHERE `connection_id = ? AND tab_id = ?` derive (F.2 schema, Q13 반영), event-driven refetch (`history.create`), clear-all reset (`history.clear`). queryHistoryStore 는 thin wrapper.
- Audience: state-management-strategy Phase 5 — backend single source 로 전환.
- Owner: Generator (sprint-372)
- Verification Profile: `frontend` (pnpm vitest + pnpm tsc + pnpm lint)

## In Scope

- `src/stores/queryHistoryStore.ts` — `entries` / `globalLog` 의 read 사이트 모두 backend IPC 로 변경. Store 자체는 `recentVisible: ListHistoryRow[]` + `addOptimisticEntry` 만 (event 수신 시 refetch).
- `src/components/query/QueryLog.tsx` — `useQueryHistory(filter)` hook 호출 → `list_history(filter)` IPC + cursor pagination.
- `src/components/query/QueryHistoryPanel.tsx` (per-tab) — mount 시 `list_history({connectionId, tabId})` 호출.
- `src/components/query/QueryHistoryDetailModal.tsx` (또는 inline expand) — click 시 `get_history_detail(id)` 호출 → 원문 SQL display.
- `src/components/settings/ClearHistoryButton.tsx` — `clear_history()` 호출 + 응답 deletedCount toast.
- `src/hooks/useQueryHistory.ts` — `list_history` + cursor + event listener (`history.create`/`history.clear`).
- Event 수신 (sprint-365 기반):
  - `history.create` — visible page 가 첫 page 면 refetch + prepend.
  - `history.clear` — `entries=[]` set + page reset.
- 테스트:
  - `src/stores/queryHistoryStore.thinwrapper.test.ts`
  - `src/components/query/QueryLog.list-history.test.tsx`
  - `src/components/query/QueryHistoryPanel.per-tab.test.tsx`
  - `src/components/query/QueryHistoryDetailModal.test.tsx` — detail IPC 호출 단언.
  - `src/components/settings/ClearHistoryButton.test.tsx` — toast deletedCount.
  - `src/hooks/useQueryHistory.event-refetch.test.ts` — create + clear event 수신.

## Out of Scope

- queryHistoryStore 의 `entries`/`globalLog` 메모리 정리 (sprint-373).
- 5 source 분류 e2e + retention vacuum + disable toggle (sprint-373).
- Backend wire (sprint-371).

## Invariants

- list_history 응답에 `sql` 없음 — UI 표시는 `sqlRedacted` (panel/inline) + `get_history_detail` (click 시 모달).
- per-tab panel 은 mount 마다 IPC 1회 + event 수신 시 refetch.
- 첫 page 가 아닌 상태 (cursor 사용 중) 에서 create event → refetch skip, "New entry" 배지 표시 (사용자 직접 새로고침).
- queryHistoryStore 의 `entries`/`globalLog` 는 본 sprint 에선 retire 안 함 (전환 단계). sprint-373 에서 retire.

## Acceptance Criteria

- `AC-372-01` `QueryLog.tsx` mount 시 `list_history` IPC 1회 호출 + `recentVisible` 채움. Test.
- `AC-372-02` per-tab `QueryHistoryPanel.tsx` 가 `{connectionId: conn-1, tabId: "tab-1"}` filter 로 IPC 호출. Test.
- `AC-372-03` Detail click → `get_history_detail(id)` IPC + modal 열림, 원문 sql display. Test: RTL spy.
- `AC-372-04` `ClearHistoryButton` 클릭 → `clear_history()` IPC + 응답 `{deletedCount:N}` → toast "N rows cleared". Test.
- `AC-372-05` Event `history.create` 수신 (첫 page 상태) → `list_history` refetch + 새 entry prepend. Test.
- `AC-372-06` Event `history.create` 수신 (cursor pagination 중) → refetch 0, "New entry" 배지 표시. Test.
- `AC-372-07` Event `history.clear` 수신 → `recentVisible = []` + page reset. Test.
- `AC-372-08` UI 어디에도 detail 외에서 원문 sql 표시 0 — RTL 단위 (`expect(panel).not.toHaveTextContent("SELECT *"))`. Test: redact-only display.

## Design Bar / Quality Bar

- TDD: `list_history` IPC 호출 단언 먼저 → hook + 컴포넌트 구현.
- list 응답 → `sqlRedacted` 만 표시. Detail modal click 명시 액션에만 원문.
- Cursor pagination — `nextCursor` null 이면 "End of history" 표시.
- 테스트 작성 날짜 + 사유 코멘트.

## Verification Plan

### Required Checks

1. `pnpm vitest run src/stores/queryHistoryStore src/components/query src/hooks/useQueryHistory src/components/settings/ClearHistoryButton.test.tsx`
2. `pnpm vitest run` (full)
3. `pnpm tsc --noEmit && pnpm lint`

### Required Evidence

- 8 AC RTL spy 결과.
- Event handler 호출 trace.
- Detail modal IPC 호출 1회.

## Test Requirements

- Vitest: store + hook + 5 component.
- Coverage: 70% (각 컴포넌트).
- Scenario: (a) initial mount, (b) per-tab filter, (c) detail click, (d) clear toast, (e) create event first-page, (f) create event paginated, (g) clear event, (h) redact-only display.

## Test Script / Repro Script

1. `pnpm vitest run src/stores/queryHistoryStore src/components/query src/hooks/useQueryHistory`
2. `pnpm vitest run src/components/settings/ClearHistoryButton.test.tsx`
3. `pnpm tsc --noEmit && pnpm lint`

## Ownership

- Generator: general-purpose Agent.
- Write scope: In Scope.
- Merge order: 370 + 371 이후. 373 본 sprint 의존.

## Exit Criteria

- Open P1/P2: 0
- AC 8/8 PASS
- redact-only display verified
