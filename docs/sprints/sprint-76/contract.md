# Sprint Contract: Sprint 76 — Per-Tab Sort State

## Summary

- **Goal**: 테이블 탭의 정렬 상태가 해당 탭에 귀속되어, 탭 전환 시 각 탭의 sort order 가 독립적으로 보존/복원된다. 현재 `DataGrid.tsx:49` 의 `useState<SortInfo[]>` 는 컴포넌트 마운트별 로컬 상태라 탭 전환 시 사라진다.
- **Audience**: Generator / Evaluator 에이전트.
- **Owner**: Harness 오케스트레이터.
- **Verification Profile**: `mixed` (command + browser)

## In Scope

- `src/stores/tabStore.ts`:
  - `TableTab` 타입에 `sorts?: SortInfo[]` 필드 추가.
  - `updateTabSorts(tabId: string, sorts: SortInfo[])` (또는 `updateTab` 제네릭) 액션 추가.
  - `loadPersistedTabs` 마이그레이션에서 `sorts` 누락 시 `[]` 로 보정.
- `src/components/DataGrid.tsx`:
  - 로컬 `useState<SortInfo[]>` 제거, 활성 탭의 `tab.sorts` 를 읽어 렌더.
  - `handleSort` 이 store 액션을 호출하도록 수정.
  - `fetchData` 가 `tab.sorts` 를 `orderBy` 문자열로 변환.
  - 컬럼 width/order 리셋 `useEffect` 와 독립적이어야 함 (sort 는 탭 전환 시 유지, width/order 는 리셋 유지).
- `src/stores/tabStore.test.ts`:
  - Per-tab sort 독립 테스트, 마이그레이션 테스트, reopen/promoteTab 에 대한 sort 보존 테스트.
- `src/components/DataGrid.test.tsx` 또는 해당 동등 파일: 탭 전환 시 sort 표시/결과 순서 보존 테스트.

## Out of Scope

- Tab bar visuals / ephemeral 로직 (Sprint 77).
- Query 탭의 result sort (이 스프린트는 TableTab 에만 집중; QueryTab 은 `QueryExecutionState` 별도 흐름 유지).
- 새 정렬 알고리즘 / 프리셋 (사용자가 수동으로 설정한 `SortInfo[]` 만 다룸).
- 서버(Rust) 변경 — 기존 `queryTableData` IPC 시그니처 유지.
- 컬럼 width/order 의 탭 귀속 (별도 follow-up 가능, 이 스프린트는 sort 만).

## Invariants

1. **탭 persistence 규약**: `table-view-tabs` localStorage 키, 디바운스 200ms, 기존 `paradigm` 마이그레이션 흐름 보존. 새 `sorts` 필드는 기존 데이터와 하위 호환.
2. **Sprint 74/75 편집 경로 무회귀**: NULL 칩, typed editor, validation hint 모두 기존 대로 동작.
3. **multi-column sort UX**: `handleSort(column, shiftKey)` 현재 동작 보존 (shift → append/cycle, no-shift → replace single).
4. **ADR 0008** — 신규 raw px / 임의 색 금지.
5. **기존 1389 테스트 전부 통과**.
6. **Query 탭 regression 없음**: QueryTab 은 이번 변경의 영향을 받지 않아야 함.

## Acceptance Criteria

- **AC-01** — `TableTab` 타입에 `sorts?: SortInfo[]` 필드가 정의되고, `addTab` 은 미제공 시 `[]` (또는 `undefined`) 로 탭을 생성한다.
- **AC-02** — tabStore 에 sort 업데이트 액션 (`updateTabSorts(tabId, sorts)` 또는 이에 상응하는 제네릭 `updateTab`) 이 노출되어, `handleSort` 가 호출 시 해당 탭의 `sorts` 만 변경하고 다른 탭에 영향을 주지 않는다.
- **AC-03** — `DataGrid` 는 활성 탭의 `tab.sorts` 를 단일 진실원으로 사용한다. 탭 A 에 정렬 적용 후 탭 B 로 전환했다가 돌아오면, 탭 A 의 sort 가 그대로 복원된다 (컬럼 헤더 indicator + 데이터 ordering 양쪽). 탭 B 는 자신의 (없거나 다른) sort 를 유지.
- **AC-04** — `loadPersistedTabs` 는 `sorts` 필드가 없는 legacy 직렬화 탭을 읽을 때 `sorts: []` (또는 미정의 허용) 로 복원하고, 복원 직후 추가 쓰기 없이 앱이 정상 기동된다 (마이그레이션 경로에서 throw 없음).
- **AC-05** — Vitest 에 다음이 추가된다:
  - tabStore 단위 테스트: `addTab` sort 기본값, `updateTabSorts` 다른 탭에 미영향, persist → reload 시 sort 유지, legacy 직렬화 (sorts 누락) 마이그레이션.
  - `DataGrid` 또는 통합 컴포넌트 테스트: 두 탭간 sort 독립성 (탭 전환/복원 시 UI indicator + `orderBy` 파라미터 확인) — RTL 레벨에서 가능한 만큼.

## Design Bar / Quality Bar

- 액션 이름은 기존 naming convention 에 맞춰 `updateTabSorts` 혹은 `setTabSorts` (`setSubView`, `promoteTab` 스타일).
- `DataGrid.tsx` 안에 로컬 sort state 의 흔적 (ex. 주석처리된 `useState`) 을 남기지 말 것.
- 탭이 `undefined` 인 edge case (DataGrid 가 탭 없이 렌더되는 경로가 있다면) 에 대해 graceful fallback — 아무 rank 도 표시하지 않음.
- multi-column sort 렌더가 기존 대로 `▲`/`▼` + rank superscript 를 보여줘야 함 (`DataGridTable.tsx:511-516`).

## Verification Plan

### Required Checks

1. `pnpm tsc --noEmit` → 에러 0.
2. `pnpm lint` → 에러/경고 0.
3. `pnpm vitest run` → 기존 1389 + 신규 전부 통과.
4. `pnpm vitest run src/stores/tabStore.test.ts` — sort 관련 신규 테스트 명이 출력에 포함되는지 확인.
5. (선택) 브라우저: 2개 테이블 탭 열고 각각 다른 컬럼으로 sort → 탭 전환 → 복귀 시 sort indicator 보존 확인.

### Required Evidence

- Generator 는 `docs/sprints/sprint-76/handoff.md` 에:
  - 변경/추가 파일 + 목적
  - `TableTab` 새 필드 / 액션 시그니처
  - 각 AC → test file:line 매핑
  - 세 게이트 결과 마지막 몇 줄
  - 마이그레이션 전략 (기본값 `[]` vs `undefined` 선택 근거)
  - 남은 위험 / 다음 스프린트 위임 항목
- Evaluator 는 각 AC 에 대해 테스트 또는 코드 file:line 을 인용.

## Test Requirements

### Unit Tests (필수)
- 각 AC 별 최소 1개 케이스.
- tabStore 단위 테스트: sort 격리 / persist round-trip / legacy migration.

### Coverage Target
- 신규/수정 코드: 라인 70% 이상.

### Scenario Tests (필수)
- [ ] Happy path: 탭 A 에 sort 적용 → 탭 B 전환 → 탭 A 복귀 → sort 복원.
- [ ] 에러: legacy persisted tab 에서 `sorts` 누락 시 마이그레이션이 throw 하지 않음.
- [ ] 경계: 빈 sort 배열, 5개+ multi-column sort, shift-click 로 rank cycle.
- [ ] 회귀: Sprint 74 편집, Sprint 75 validation hint, 기존 tab persistence 테스트 전부 통과.

## Test Script / Repro Script

1. `pnpm vitest run src/stores/tabStore.test.ts` — AC-01/02/04 확인.
2. `pnpm vitest run src/components/DataGrid` — AC-03 확인.
3. `pnpm tsc --noEmit && pnpm lint && pnpm vitest run` — 전체 게이트.
4. 브라우저 smoke (선택): 두 탭 간 sort 전환 검증.

## Ownership

- **Generator**: general-purpose agent.
- **Write scope**: `src/stores/tabStore.ts`, `src/stores/tabStore.test.ts`, `src/components/DataGrid.tsx`, `src/components/DataGrid.test.tsx` (존재 시), `src/types/schema.ts` (필요 시 주석/export만), `docs/sprints/sprint-76/handoff.md`.
- **Merge order**: Sprint 75 (7698276) 이후. Sprint 77 (ephemeral tabs) 이 동일한 store 를 터치하므로 Sprint 76 이 먼저 merge.

## Exit Criteria

- 오픈된 P1/P2 finding: `0`.
- 필수 검증 통과: `yes`.
- 모든 AC 증거가 `handoff.md` 에 파일:라인 인용.
- Evaluator 각 차원 점수 ≥ 7.0/10.
