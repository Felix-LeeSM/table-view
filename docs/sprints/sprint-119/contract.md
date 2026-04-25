# Sprint Contract: sprint-119

## Summary

- Goal: MainArea EmptyState 의 "어떤 연결을 default 로 노출할까" 정책을 "first connected" → "MRU(최근 사용)" 로 변경. MRU 신호는 사용자가 connection 에 대해 tab 을 연 시점 (`addTab` / `addQueryTab` 호출). MRU 가 비어 있거나 (첫 실행) MRU 연결이 현재 disconnected 면 기존 first-connected 로 fallback. localStorage 영구 저장.
- Audience: 메인테이너 + UX evaluator (`#SHELL-1` 후속).
- Owner: 메인테이너.
- Verification Profile: `command` — MRU 정책의 결정성·persistence 모두 jsdom + RTL 의 localStorage / `useConnectionStore` setState / `useMruStore` setState 시드로 단언 가능. spec 의 `browser` 보다 신뢰성 우월.

## In Scope

- 신규 `src/stores/mruStore.ts` — Zustand store:
  - 상태: `lastUsedConnectionId: string | null`.
  - actions: `markConnectionUsed(id: string)` (write + persist), `loadPersistedMru()` (boot-time 복원), `__resetMruStoreForTests()` (테스트 격리).
  - persistence: `localStorage` key `"table-view-mru"`.
- 신규 `src/stores/mruStore.test.ts` — Zustand 액션 + persistence 단위 테스트.
- 변경 `src/stores/tabStore.ts`:
  - `addTab` 진입 시 `useMruStore.getState().markConnectionUsed(tab.connectionId)`.
  - `addQueryTab` 진입 시 동일.
- 변경 `src/components/layout/MainArea.tsx`:
  - `EmptyState` 의 connection lookup 정책 변경 — MRU 우선, fallback first-connected.
  - 정책 lookup 함수는 component-internal (별도 export 불필요).
- 변경 `src/components/layout/MainArea.test.tsx`:
  - `beforeEach` 에서 mruStore 리셋.
  - 신규 테스트 (MRU 우선 / MRU disconnected fallback / MRU 페르시스턴스).
  - 기존 "picks the first connected connection when multiple exist" 테스트 description 갱신 — 단언은 그대로 (MRU 미시드 → fallback → c2).
- App boot path 에 `loadPersistedMru()` 호출 추가 (다른 store 의 `loadPersisted*` 호출처와 동일한 위치).
- Sprint artifacts (`contract.md`, `execution-brief.md`, `handoff.md`).

## Out of Scope

- 정책 결정 ADR — 본 sprint 는 코드 변경 (MRU 정책 시행) 으로 만족. ADR 은 더 큰 정책 결정이 필요할 때 발행.
- 사이드바의 connection click 을 MRU 신호로 사용 (현재는 tab 생성 신호만 사용).
- Connection 자체의 "최근 연결한 시각" 정렬 (connectionStore 변경 0).

## Invariants

- 1834 baseline tests 회귀 0 (신규 mruStore 테스트 + MainArea MRU 테스트 추가만).
- `pnpm tsc --noEmit` / `pnpm lint` 0.
- `addTab` / `addQueryTab` 의 외부 가시 동작 (tabs / activeTabId 갱신) 변경 0 — MRU 호출은 side-effect 추가.
- MRU 가 비어 있거나 MRU 연결이 disconnect 상태면 동작이 sprint 118 baseline 과 동일 (first-connected fallback).

## Acceptance Criteria

- `AC-01`: MRU 가 시드돼 있고 그 연결이 currently `connected` 이면 MainArea EmptyState 의 New Query CTA / 안내 텍스트가 MRU 연결을 가리킴 (e.g. seed MRU=c3, active=[c1,c3], expect c3 표시).
- `AC-02`: localStorage `"table-view-mru"` 에 마지막 markConnectionUsed 호출 id 가 영구 저장. `loadPersistedMru()` 가 부팅 시 복원.
- `AC-03`: MRU 가 빈 (`null`) 상태면 fallback 으로 first-connected 가 표시 (기존 동작 유지). 또한 MRU 가 시드돼 있어도 그 연결이 disconnect 상태면 first-connected fallback.
- `AC-04`: 기존 MainArea 17 케이스 + Empty state CTA 4 케이스 회귀 0 (총 21 케이스 그대로 유지). 테스트 description 갱신 가능, 단언은 그대로.
- `AC-05`: `pnpm vitest run` 1834 + 신규 N (>=4) PASS. `pnpm tsc --noEmit` 0. `pnpm lint` 0.

## Design Bar / Quality Bar

- MRU 신호 source 는 `addTab` / `addQueryTab` 한 군데 — 일관성 보장. 사이드바 click 등 weaker 신호는 후속 sprint 에서 결정 가능.
- mruStore 는 favoritesStore 의 manual localStorage persistence 패턴 그대로 따름 (zustand persist middleware 미사용 — 프로젝트 컨벤션 일치).
- MRU 가 disconnect 상태인 경우 fallback 처리는 EmptyState 의 same render path 유지 — UX 변동 최소.
- 보안: MRU 는 connection id 만 저장 — 자격 증명 / 호스트 정보 0.

## Verification Plan

### Required Checks

1. `pnpm vitest run` — 1834 baseline + 신규 PASS.
2. `pnpm tsc --noEmit` — 0.
3. `pnpm lint` — 0.

### Required Evidence

- Generator must provide:
  - 신규 / 변경 파일 목록 + 한 줄 목적.
  - 신규 테스트 케이스 ID + AC 매핑.
  - 검증 명령 결과 (vitest pass count).
- Evaluator must cite:
  - mruStore 가 favoritesStore 패턴 일관성 유지하는지.
  - MainArea 의 fallback 로직이 MRU empty / MRU disconnected 양쪽에서 작동.
  - 기존 21 케이스 무회귀.

## Test Requirements

### Unit Tests (필수)

- `mruStore.test.ts` — 4-6 케이스:
  1. 초기 상태 `lastUsedConnectionId === null`.
  2. `markConnectionUsed("c1")` → 상태 변경 + localStorage 쓰기.
  3. `markConnectionUsed("c2")` 후 `loadPersistedMru()` → `c2` 복원.
  4. localStorage parse 실패시 안전 fallback (`null`).
- `MainArea.test.tsx` 추가 케이스:
  1. MRU=c3 + active=[c1,c3] → CTA 가 c3 가리킴 (AC-01).
  2. MRU=c2 + active=[c1] (c2 disconnect) → fallback first-connected = c1 (AC-03).
  3. MRU empty → 기존 first-connected fallback (AC-03 — 기존 케이스가 자연 커버).

### Coverage Target

- mruStore 신규 코드 커버리지 ≥ 80% (액션 + persistence 모두).

### Scenario Tests (필수)

- [x] Happy path — MRU 시드 → MainArea 가 MRU 연결 표시.
- [x] 빈 상태 — MRU empty → fallback first-connected.
- [x] 에러 복구 — MRU 연결 disconnect → fallback first-connected.
- [x] 영구 저장 — markConnectionUsed → localStorage write → loadPersistedMru() restore.

## Test Script / Repro Script

1. `pnpm vitest run src/stores/mruStore.test.ts`.
2. `pnpm vitest run src/components/layout/MainArea.test.tsx`.
3. `pnpm vitest run src/stores/tabStore.test.ts` (회귀 검사).
4. `pnpm vitest run` (전체).
5. `pnpm tsc --noEmit`.
6. `pnpm lint`.

## Ownership

- Generator: 메인테이너 직접.
- Write scope: `src/stores/mruStore.ts`, `src/stores/mruStore.test.ts`, `src/stores/tabStore.ts`, `src/components/layout/MainArea.tsx`, `src/components/layout/MainArea.test.tsx`, App boot path (e.g., `src/App.tsx`), `docs/sprints/sprint-119/{contract,execution-brief,handoff}.md`.
- Merge order: contract → brief → 구현 → 검증 → handoff.

## Exit Criteria

- Open `P1`/`P2` findings: `0`.
- Required checks passing: `yes`.
- Acceptance criteria evidence linked in `handoff.md`.
