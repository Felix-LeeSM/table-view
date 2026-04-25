# Sprint 119 → next Handoff

## Sprint 119 Result

- **PASS** (Generator 직접 적용, 1 attempt) — 1845/1845 tests, tsc 0, lint 0. 1834 → 1845 (+11): mruStore 7 + MainArea MRU 4.

## 산출물

- **NEW** `src/stores/mruStore.ts` — Zustand store + manual localStorage persistence (`table-view-mru` key). Actions: `markConnectionUsed(id)`, `loadPersistedMru()`. Test reset helper `__resetMruStoreForTests`.
- **NEW** `src/stores/mruStore.test.ts` — 7 케이스: 초기값 / markConnectionUsed 상태+localStorage / overwrite / load restore / 빈 상태 fallback / 빈 문자열 fallback / reset helper.
- **MODIFIED** `src/stores/tabStore.ts`:
  - `addTab` / `addQueryTab` 진입 시 `useMruStore.getState().markConnectionUsed(connectionId)` 호출.
  - 외부 가시 동작 (tabs / activeTabId 갱신) 변경 0.
- **MODIFIED** `src/components/layout/MainArea.tsx`:
  - `EmptyState` 의 `firstConnected` lookup → `mruConnection ?? firstConnected` chain.
  - mruConnection: id 일치 + currently `connected` 둘 다 만족할 때만 선택.
  - target / CTA 텍스트 / addQueryTab 호출 모두 `target` 으로 통합.
- **MODIFIED** `src/components/layout/MainArea.test.tsx`:
  - `beforeEach` 에서 `__resetMruStoreForTests()` 호출.
  - 기존 "picks the first connected ..." 테스트 → "falls back to first-connected when MRU is empty (multiple actives)" 로 명칭만 갱신, 단언 보존.
  - 신규 describe block "Empty state MRU policy (sprint 119)" 4 케이스:
    - AC-01: MRU=c3 + active=[c2,c3] → CTA c3 가리킴 + tab open against c3.
    - AC-03: MRU=c2 + active=[c1] (c2 disconnect) → fallback c1.
    - AC-03 (edge): MRU=`c-deleted` (목록에 없음) → fallback c1.
    - AC-01/AC-04: New Query 클릭 → `addQueryTab` → mruStore 가 markConnectionUsed("c1") 반영.
- **MODIFIED** `src/App.tsx` — boot path 에 `loadPersistedMru()` 호출 추가 (favoritesStore 와 동일 패턴, useEffect dep 갱신).
- `docs/sprints/sprint-119/{contract.md, execution-brief.md, handoff.md}`.

## AC Coverage

- AC-01 ✅ — MainArea.test.tsx 의 sprint 119 describe block 첫 번째 케이스 (MRU=c3, active=[c2,c3] → c3 표시 + 클릭 시 c3 tab). `MainArea.tsx:124-135` 의 `mruConnection ?? firstConnected` chain 이 구현.
- AC-02 ✅ — mruStore.test.ts 의 markConnectionUsed → localStorage `"table-view-mru"` 단언 + loadPersistedMru restore 단언. `App.tsx:32` 가 boot 시 `loadPersistedMru()` 호출 → 앱 재시작 후 MRU 유지.
- AC-03 ✅ — MainArea.test.tsx 의 sprint 119 describe 두 번째 케이스 (MRU disconnect → fallback) + 세 번째 케이스 (MRU id 삭제됨 → fallback). 코드 `MainArea.tsx:124-130` 이 disconnect 시 mruConnection=undefined → fallback.
- AC-04 ✅ — MainArea 기존 21 케이스 + 추가 4 케이스 = 25 → 실제 29/29 PASS (mock subview 등 베이스 케이스 포함). 기존 테스트 description 1 개만 갱신, 단언 보존.
- AC-05 ✅ — `pnpm vitest run` 1845/1845. `pnpm tsc --noEmit` 0. `pnpm lint` 0.

## 검증 명령 결과

- `pnpm vitest run src/stores/mruStore.test.ts` → 7/7 pass.
- `pnpm vitest run src/components/layout/MainArea.test.tsx` → 29/29 pass.
- `pnpm vitest run src/stores/tabStore.test.ts` → 68/68 pass (markConnectionUsed side-effect 무회귀 — tabStore 테스트가 connectionId 검증만 하므로 mruStore 호출이 부작용 없이 통과).
- `pnpm vitest run` → 109 files / **1845/1845** pass.
- `pnpm tsc --noEmit` → 0.
- `pnpm lint` → 0.

## 구현 노트

- MRU 신호 source 를 `addTab` / `addQueryTab` 한 군데로 한정. 사이드바 click 등 weaker 신호는 후속 sprint 에서 결정 가능 — 본 sprint 는 "tab 생성 = 사용자가 적극 작업한 연결" 만을 가장 강한 신호로 인정.
- mruStore 는 favoritesStore 의 manual localStorage persistence 패턴 그대로 따름 (zustand persist middleware 미사용 — 프로젝트 컨벤션 일치).
- store-to-store 호출 (`tabStore` → `mruStore`) 은 한 방향이라 circular import 위험 0. mruStore 는 connectionStore / tabStore 어느 쪽도 import 하지 않음.
- React 컴포넌트 (`MainArea.tsx`) 는 mruStore selector 를 통해 reactivity 보장 — useMruStore subscribe → MRU 변경 시 자동 rerender.
- `loadPersistedMru` 의 빈 문자열 fallback (`raw && raw.length > 0`) — 사용자가 어떤 경로로 빈 값을 강제로 쓴 경우도 안전.
- App.tsx boot useEffect 의 dep 배열 갱신 — `loadPersistedMru` 추가, ESLint react-hooks/exhaustive-deps 통과.

## 가정 / 리스크

- 가정: 단일 사용자 MRU. 멀티-프로필 (e.g., 이메일/비밀번호 매니저처럼) MRU 는 고려 안 함 — 본 앱은 단일-OS-사용자 데스크톱 도구.
- 리스크 (낮음): 사용자가 MRU 연결을 수동으로 disconnect 한 직후 New Query CTA 가 갑자기 다른 연결로 점프 → UX 의도치 않은 깜빡임 가능. 그러나 disconnect 후 first-connected fallback 이 의도된 동작 (MRU disconnect = 작업 불가 = 다른 가용 연결 안내). 후속 UX 개선 시 disconnect 직후 빈 EmptyState 로 polished 가능.
- 리스크 (낮음): MRU id 가 서버에 의해 회전(rotation)되거나 사용자가 connection 을 삭제 후 동일 이름으로 재생성 → 새 connection 의 id 가 다르면 MRU stale → fallback. 즉, stale-MRU 처리 path 가 자연스럽게 처리.

## 회귀 0

- MainArea 기존 21 케이스 (Empty state CTA 4 + others 17) 무회귀.
- tabStore 68 케이스 무회귀.
- 1834 baseline → 1845 (+11) 모두 PASS.

## 다음 sprint

- Sprint 120: 폴더 재구성 (#ARCH-2).
- Sprint 121: AddDocumentModal v2 (#PAR-3).
- Sprint 122: DocumentFilterBar (#PAR-4).
- Sprint 123: paradigm 시각 cue (#PAR-5).
