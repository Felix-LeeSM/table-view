# Sprint Execution Brief: Sprint 77 — Compact Tab Bar + Ephemeral Promotion Completeness

## Objective
Tab bar 의 세로 높이를 TablePlus-class 감각으로 줄이고, 이미 대부분 구현된 ephemeral (preview) 탭 로직에 **셀 편집 시작 / 행 추가 / 행 삭제** 트리거로도 promotion 이 일어나도록 누락 훅을 메운다.

## Task Why
Sprint 76 까지 확인된 바: `addTab` 의 preview-교체, `promoteTab`, `loadPersistedTabs` 의 reload-downgrade, TabBar 의 이탤릭/opacity 스타일, 더블클릭 promotion, sort/filter/page 변경 시 promotion 은 이미 구현되어 있다. 빠진 건 두 가지: (1) tab bar 시각적으로 높이가 아직 TablePlus 보다 두껍다. (2) **셀 편집 / 행 추가 / 삭제** 같은 "meaningful interaction" 은 현재 어떤 re-fetch 도 트리거하지 않으면 promotion 이 일어나지 않아, 사용자가 편집 후 저장 없이 다른 테이블을 열면 ephemeral 탭이 덮어써지는 footgun 이 남아 있다.

## Scope Boundary
- **범위 안**: TabBar height tokens, 편집 시작 / 행 추가 / 행 삭제 핸들러에 promotion 훅, 관련 테스트.
- **범위 밖**: Tab close 후 복원 (reopenLastClosedTab) 의 ephemeral 여부 재평가, preview → permanent 트랜지션 애니메이션, sidebar / schema tree 변경, Sprint 74/75/76 경로 변경.

## Invariants
1. 기존 `addTab` preview-교체 (tabStore L192-208), `promoteTab` (L240-245), `loadPersistedTabs` 다운그레이드 (L393) 유지.
2. Query tab 은 `isPreview` 없음 — `addQueryTab` 경로 무변경.
3. Sprint 74/75/76 편집/검증/sort 흐름 전부 회귀 없음.
4. 기존 1407 테스트 통과.
5. ADR 0008 토큰만 사용, 신규 `any` 금지, hit target ≥ 28px 유지.
6. Dark mode 가시성 유지.

## Done Criteria
1. Tab bar 세로 높이 ≤ 32px (TablePlus-class) — Tailwind 토큰 사용, handoff 에 전후 클래스 diff 기록.
2. 셀 편집 시작 시 활성 preview 탭 promotion.
3. 행 추가 / 행 삭제 시 동일 promotion.
4. Sprint 76 의 sort/filter/page 경로 promotion 여전히 동작.
5. reload 다운그레이드 + query tab 불간섭 기존 동작 유지.
6. 신규 테스트 추가 (height 회귀, edit/add/delete promotion).

## Verification Plan
- **Profile**: mixed (command + browser)
- **Required checks**:
  1. `pnpm tsc --noEmit` — 0 errors
  2. `pnpm lint` — 0 warnings
  3. `pnpm vitest run` — 1407+ 전부 통과
  4. `pnpm vitest run src/components/layout/TabBar.test.tsx src/stores/tabStore.test.ts` — 신규 케이스 출력 확인
  5. (선택) 브라우저: preview 탭에서 편집 → 다른 테이블 열기 → preview 유지되지 않는지 확인
- **Required evidence**:
  - 변경/추가 파일 목록 + 목적
  - Tab bar 클래스 변경 전후 diff
  - promotion hook 삽입 file:line
  - 각 AC → test file:line 매핑
  - 세 게이트 결과 last lines
  - 편집 시작 훅 선택 근거

## Evidence To Return
- 변경/추가 파일 목록 (path: 목적)
- 실행한 검증 명령 + 결과
- 각 AC 별 test file:line
- Tab bar class diff
- promotion hook 위치 + 근거
- 남은 위험/갭

## References
- **Contract**: `docs/sprints/sprint-77/contract.md`
- **Master spec**: `docs/sprints/sprint-74/spec.md` — Sprint 77 섹션
- **Relevant files**:
  - `src/components/layout/TabBar.tsx` — 루트 metrics L62-70, preview 스타일 L194, double-click L84-87
  - `src/stores/tabStore.ts` — `addTab` preview-교체 L192-208, `promoteTab` L240-245, `loadPersistedTabs` 다운그레이드 L393
  - `src/components/DataGrid.tsx` — 기존 promotion effect L111-116 (sort/filter/page/rawSql)
  - `src/components/datagrid/useDataGridEdit.ts` — `handleStartEdit` / add / delete 핸들러 (편집 시작 훅 후보)
  - `src/components/layout/TabBar.test.tsx` — 기존 preview 테스트
  - `src/stores/tabStore.test.ts` — 기존 addTab/promote 테스트
- **Prior sprints**: Sprint 74 (551ca0f), Sprint 75 (7698276), Sprint 76 (c6ed688)
