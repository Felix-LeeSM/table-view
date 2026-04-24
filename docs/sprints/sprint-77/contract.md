# Sprint Contract: Sprint 77 — Compact Tab Bar + VS Code-style Ephemeral Promotion

## Summary

- **Goal**: Tab bar 가 TablePlus-class 로 더 낮아지고, 이미 거의 완성된 ephemeral/preview 로직에 **셀 편집 / 행 추가 / 행 삭제** 같은 "의미 있는 상호작용" 시에도 promotion 이 일어나도록 간극을 메운다. 재로드 시 ephemeral → 일반 탭 다운그레이드, query tab 비-ephemeral 보장은 현재 구현대로 유지.
- **Audience**: Generator / Evaluator.
- **Owner**: Harness 오케스트레이터.
- **Verification Profile**: `mixed` (command + browser)

## In Scope

- `src/components/layout/TabBar.tsx`:
  - 세로 metrics 축소 (`py-1.5` → 더 타이트하게), 글자 크기는 TablePlus 감각에 맞춰 12-13px 수준으로 확인.
  - 기존 `italic opacity-70` preview 스타일 유지, 활성 탭 하이라이트 일관성 유지.
- `src/components/datagrid/useDataGridEdit.ts` 또는 `src/components/DataGrid.tsx`:
  - **편집 시작** 시 활성 탭이 preview 면 `promoteTab(activeTabId)` 호출 — 현재는 sort/filter/page 변경 effect 만 promote.
  - **행 추가 / 행 삭제** 트리거도 마찬가지로 promote.
- `src/components/layout/TabBar.test.tsx`:
  - 축소된 height 회귀 테스트 (computed style 또는 rendered class 기반).
- `src/stores/tabStore.test.ts` / 관련 컴포넌트 테스트:
  - 편집 시작 시 promotion 발생 확인.
  - 행 추가/삭제 시 promotion 발생 확인.

## Out of Scope

- Preview → permanent transition 의 애니메이션 / 모션.
- Tab close 후 복원 (reopenLastClosedTab) 의 ephemeral 여부 재평가 — 현재 `loadPersistedTabs` 다운그레이드 정책 유지.
- Query tab 의 ephemeral 화 (contract AC-4 에 따라 `addQueryTab` 은 `isPreview` 미지정 유지).
- Sidebar / schema tree UI 변경 — 오픈 호출 경로는 그대로 사용.
- Sprint 74/75/76 이 건든 편집/검증/sort 흐름의 다른 변경 — 이 스프린트는 ephemeral/프로모션 누락분만.

## Invariants

1. **기존 preview 로직 보존**: `addTab` 의 preview 교체 (tabStore L192-208), `promoteTab` (L240-245), `loadPersistedTabs` 의 `isPreview: false` 다운그레이드 (L393).
2. **Query tab 은 preview 가 아님**: `addQueryTab` 는 `isPreview` 를 설정하지 않고, promotion 경로에서도 query tab 에 영향을 주지 않는다.
3. **Sprint 74/75/76 회귀 없음**: 편집 경로 (NULL 칩 → typed editor → validation hint), sort 탭 귀속.
4. **기존 1407 테스트 전부 통과**.
5. **ADR 0008 토큰 규칙 유지** — 신규 raw px / 임의 색 금지. 새 높이도 Tailwind spacing 토큰 사용 (`py-1`, `py-0.5`, `h-8` 등).
6. **접근성 유지**: 탭 close 버튼의 hit target (`size="icon-xs"`) 이 줄어든 높이에 맞춰서도 클릭 가능하고, `aria-label` 유지.

## Acceptance Criteria

- **AC-01** — Tab bar 의 전체 세로 높이가 줄어든다. Generator 는 변경 전후의 Tailwind 클래스 diff (또는 computed style pixel 값) 를 handoff 에 기록하고, `TabBar.test.tsx` 에 height 회귀 테스트를 추가한다. TablePlus 감각을 기준으로 tab 한 행의 높이는 ≤ 32px (주석/padding 포함). 폰트/아이콘 크기는 기존 유지 또는 감소만 허용.
- **AC-02** — **편집 시작 (셀 편집 진입)** 시 활성 탭이 preview 면 즉시 `promoteTab(activeTabId)` 를 호출해 이탤릭/opacity 스타일이 해제된다. 편집을 커밋 없이 취소해도 이미 promoted 상태 유지 → 다음 `addTab` 이 이 탭을 덮어쓰지 않는다.
- **AC-03** — **행 추가 / 행 삭제** 상호작용 시 동일하게 promotion 이 일어난다.
- **AC-04** — Sprint 76 에서 이미 걸린 sort / filter / page 변경 시 promotion 은 여전히 동작한다 (회귀 없음).
- **AC-05** — `loadPersistedTabs` 는 reload 후 ephemeral 탭을 일반 탭으로 다운그레이드한다 — 기존 동작 유지 + 관련 테스트가 유지된다.
- **AC-06** — Query tab 은 preview 로 생성되지 않고 promotion 경로의 영향을 받지 않는다 — 회귀 테스트 유지.
- **AC-07** — `TabBar.test.tsx` 에 축소 height 회귀 + `tabStore.test.ts` (또는 관련 컴포넌트 테스트) 에 편집 시작 / 행 추가 / 행 삭제 promotion 케이스 추가.

## Design Bar / Quality Bar

- Tab 라인 높이: `py-1 text-sm` 또는 `py-0.5 text-xs` 로 실험해 TablePlus 감각에 맞추되 hit target ≥ 28px 유지. 최종 결정은 Generator 가 handoff 에 근거와 함께 기록.
- promotion 트리거는 **side effect free**: promote 한 번이면 족하고, 각 상호작용 핸들러에서 중복 호출해도 `promoteTab` 자체가 멱등이어야 한다.
- 신규 테스트는 사용자 관점 (RTL `role`/`text`) 으로 작성. height 회귀 테스트는 `toHaveClass` 로 핵심 Tailwind 토큰을 고정하거나 `getComputedStyle` 로 pixel 값을 확인 (둘 중 실용적인 것 선택).
- 편집 시작 훅 선택 시, `useDataGridEdit.ts` 의 가장 이른 지점 (예: `handleStartEdit` 의 첫 라인) 에서 promotion 호출 — 나중에 `onKeyDown` 경로나 `context-menu edit` 경로로 편집이 들어와도 한 곳에서 잡힘.

## Verification Plan

### Required Checks

1. `pnpm tsc --noEmit` → 에러 0.
2. `pnpm lint` → 에러/경고 0.
3. `pnpm vitest run` → 기존 1407 + 신규 전부 통과.
4. `pnpm vitest run src/components/layout/TabBar.test.tsx src/stores/tabStore.test.ts` — AC-01, AC-02, AC-03, AC-05, AC-06 관련 신규 케이스 출력 확인.
5. (선택) 브라우저: 스키마 트리에서 테이블 A 열기 (preview) → 다른 테이블 B 열기 (A 가 B 로 replace) → A 다시 열기 → 셀 편집 (promotion) → 다른 테이블 열기 (A 가 더 이상 replace 되지 않음).

### Required Evidence

- Generator 는 `docs/sprints/sprint-77/handoff.md` 에:
  - 변경/추가 파일 + 목적
  - Tab bar 클래스 변경 전후 diff
  - promotion hook 이 추가된 정확한 파일:라인
  - 각 AC → test file:line 매핑
  - 세 게이트 결과 마지막 몇 줄
  - 구현 중 가정 (예: 편집 시작 훅 위치 선택 근거)
  - 남은 위험 / 갭
- Evaluator 는 각 AC 에 대해 file:line 인용.

## Test Requirements

### Unit Tests (필수)
- 각 AC 에 대응하는 최소 1개 테스트.
- height 회귀: computed style 또는 class assertion.
- promotion 트리거: 편집 시작 / 행 추가 / 행 삭제 각각 1개 이상.

### Coverage Target
- 신규/수정 코드: 라인 70% 이상.

### Scenario Tests (필수)
- [ ] Happy path: preview tab 에서 편집 시작 → promoted 상태로 전환.
- [ ] 에러: promotion 이 query tab 에 영향을 주지 않음 (addQueryTab 로 만든 tab 의 `isPreview` 는 여전히 undefined).
- [ ] 경계: 이미 promoted 된 tab 에서 편집 시작 시 추가 부작용 없음 (멱등성).
- [ ] 회귀: Sprint 74/75/76 이 건든 흐름 전부 통과.

## Test Script / Repro Script

1. `pnpm vitest run src/components/layout/TabBar.test.tsx` — AC-01.
2. `pnpm vitest run src/stores/tabStore.test.ts` — AC-02/03/05/06.
3. `pnpm vitest run src/components/DataGrid.test.tsx` — AC-04 회귀.
4. `pnpm tsc --noEmit && pnpm lint && pnpm vitest run` — 전체.

## Ownership

- **Generator**: general-purpose agent.
- **Write scope**: `src/components/layout/TabBar.tsx`, `src/components/layout/TabBar.test.tsx`, `src/components/datagrid/useDataGridEdit.ts` (또는 관련 훅), `src/components/DataGrid.tsx`, `src/stores/tabStore.test.ts`, `docs/sprints/sprint-77/handoff.md`.
- **Merge order**: Sprint 76 (c6ed688) 이후.

## Exit Criteria

- 오픈된 P1/P2 finding: `0`.
- 필수 검증 통과: `yes`.
- 모든 AC 증거가 `handoff.md` 에 파일:라인 인용.
- Evaluator 각 차원 점수 ≥ 7.0/10.
