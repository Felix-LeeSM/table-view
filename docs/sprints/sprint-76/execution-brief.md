# Sprint Execution Brief: Sprint 76 — Per-Tab Sort State

## Objective
테이블 탭마다 자신의 정렬 상태를 가지고, 탭 전환 시 sort indicator 와 결과 ordering 이 보존된다. 현재 `src/components/DataGrid.tsx:49` 의 로컬 `useState<SortInfo[]>` 는 탭 변경 시 컴포넌트가 언마운트되며 sort 가 사라지는 UX 회귀를 만든다.

## Task Why
TablePlus-like UX 의 기본값은 "각 탭이 자기 상태를 기억한다" — 컬럼 width/order 는 이미 탭별로 분리되어 있지만 sort 만 독립 관리에서 벗어나 있다. 사용자가 탭 2개 띄워 서로 다른 정렬로 비교하는 기본 워크플로우를 매번 재설정해야 하는 상태. 이는 Sprint 77 (ephemeral tabs) 로 넘어가기 전에 정리되어야 할 store-level 기반이다.

## Scope Boundary
- **범위 안**: `TableTab` 에 `sorts` 필드 추가, tabStore 액션, DataGrid 에서 store 통한 읽기/쓰기, 마이그레이션, 테스트.
- **범위 밖**: tab bar 시각 변경 (Sprint 77), ephemeral 로직 (Sprint 77), QueryTab result sort, 컬럼 width/order 탭 귀속 (별도), backend 변경.

## Invariants
1. localStorage key `"table-view-tabs"` + 200ms 디바운스 + 기존 `paradigm` 마이그레이션 경로 유지.
2. Sprint 74/75 편집 경로 (NULL 칩, typed editor, validation hint) 무회귀.
3. multi-column sort UX 유지 (shift → append/cycle, no-shift → replace single, rank 번호 superscript).
4. QueryTab 동작 불변.
5. ADR 0008 토큰만 사용, 신규 `any` 금지.
6. 기존 1389 테스트 통과.

## Done Criteria
1. `TableTab.sorts?: SortInfo[]` 필드 정의 (`src/types/schema.ts` 는 기존 `SortInfo` 그대로 사용).
2. tabStore 에 sort 업데이트 액션이 노출되고, 한 탭 수정이 다른 탭에 유출되지 않음.
3. `DataGrid` 가 탭의 `sorts` 를 단일 진실원으로 소비 — 탭 A/B 간 전환 시 각자 sort 복원.
4. legacy persisted tab (sorts 없음) 이 마이그레이션 없이도 로드 가능 (기본값 `[]` 또는 undefined 허용).
5. tabStore 단위 테스트 + DataGrid 동작 테스트 신규 추가.

## Verification Plan
- **Profile**: mixed (command + browser)
- **Required checks**:
  1. `pnpm tsc --noEmit` — 0 errors
  2. `pnpm lint` — 0 warnings
  3. `pnpm vitest run` — 1389+ tests 통과
  4. `pnpm vitest run src/stores/tabStore.test.ts` — sort 관련 신규 케이스 출력 확인
  5. (선택) 브라우저: 두 탭간 sort 독립 + 복귀 시 보존
- **Required evidence**:
  - 변경/추가 파일 목록 + 목적
  - AC → test file:line 매핑
  - 세 게이트 결과 last lines
  - 마이그레이션 전략 근거

## Evidence To Return
- 변경/추가 파일 목록 (path: 목적)
- 실행한 검증 명령 + 결과
- 각 AC 별 test file:line
- `TableTab` 새 필드 + 신규 액션 시그니처
- 마이그레이션 decision (기본값 `[]` vs `undefined`)
- 남은 위험/갭 (예: QueryTab sort 는 별도, 브라우저 smoke 미실행)

## References
- **Contract**: `docs/sprints/sprint-76/contract.md`
- **Master spec**: `docs/sprints/sprint-74/spec.md` — Sprint 76 섹션
- **Relevant files**:
  - `src/stores/tabStore.ts` — TableTab 정의 L24-48, 액션 L121-150, 마이그레이션 L340-382
  - `src/components/DataGrid.tsx` — 현재 sort useState L49, handleSort L207-236, fetchData 변환 L126-170
  - `src/components/datagrid/DataGridTable.tsx` — sort indicator 렌더 L511-516, click handler L496
  - `src/stores/tabStore.test.ts` — 기존 persistence 테스트 L509-677
  - `src/types/schema.ts` — `SortInfo` 정의 L71-74
- **Prior sprints**:
  - Sprint 74 handoff: `docs/sprints/sprint-74/handoff.md`
  - Sprint 75 handoff: `docs/sprints/sprint-75/handoff.md`
