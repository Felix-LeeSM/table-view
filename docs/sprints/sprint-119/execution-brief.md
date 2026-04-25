# Sprint Execution Brief: sprint-119

## Objective

MainArea EmptyState 의 default connection 정책을 first-connected → MRU 우선 (fallback first-connected) 로 변경. localStorage 영구 저장.

## Task Why

`docs/ui-evaluation-results.md` `#SHELL-1` — 다중 연결 사용자가 자주 쓰는 연결을 매번 다시 선택해야 하는 마찰 해소. 사용자 mental model 은 "방금 작업한 연결" 이지 "처음 연결한 연결" 이 아님.

## Scope Boundary

- **건드리지 말 것**:
  - `connectionStore` 의 connection list / status 동작.
  - 사이드바 click 등 weaker 신호의 MRU 반영 (후속 sprint).
  - tab 의 외부 가시 동작 (`tabs`, `activeTabId`).
- **반드시 보존**:
  - 1834 baseline tests.
  - 기존 MainArea 21 케이스 (description 갱신은 허용, 단언 보존).

## Invariants

- 1834 + 신규 N 테스트 PASS.
- `pnpm tsc --noEmit` / `pnpm lint` 0.
- MRU empty / disconnected 시 동작 = sprint 118 baseline.

## Done Criteria

1. `mruStore` 신규 + 단위 테스트 4-6 케이스.
2. `tabStore.addTab` / `addQueryTab` 가 markConnectionUsed 호출.
3. MainArea EmptyState 의 정책: MRU 우선 → fallback first-connected → fallback "select a connection".
4. App boot path 에서 `loadPersistedMru()` 호출.
5. MainArea 신규 테스트: MRU 우선 / disconnect fallback.
6. 1834 baseline 회귀 0.
7. tsc / lint 0.

## Verification Plan

- Profile: `command`
- Required checks:
  1. `pnpm vitest run`
  2. `pnpm tsc --noEmit`
  3. `pnpm lint`
- Required evidence:
  - 신규 / 변경 파일 + 한 줄 목적.
  - 테스트 케이스 ID + AC 매핑.
  - 명령 결과 (vitest pass count).

## Evidence To Return

- Changed files with purpose.
- 신규 테스트 ID + AC 매핑.
- Command outputs.
- 가정 / 리스크.
