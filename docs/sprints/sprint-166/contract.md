# Sprint Contract: sprint-166

## Summary

- Goal: mruStore를 단일 ID에서 MRU 리스트(최대 5개, 타임스탬프 포함)로 확장
- Verification Profile: `command`

## In Scope

- mruStore 상태를 `lastUsedConnectionId: string | null` → `recentConnections: MruEntry[]` 로 확장
- `MruEntry = { connectionId: string; lastUsed: number }` (타임스탬프는 Date.now())
- `markConnectionUsed(id)` → 리스트 최상단에 추가, 중복 시 이동, 최대 5개 초과 시 오래된 것 제거
- localStorage persistence (기존 `"table-view-mru"` 키 재사용, JSON 배열로 저장)
- IPC bridge SYNCED_KEYS 업데이트 (`recentConnections`)
- 기존 `lastUsedConnectionId` 호환성 유지 (derived getter)

## Out of Scope

- UI 렌더링 (Sprint 168)
- E2E (Sprint 169)

## Invariants

- 기존 `markConnectionUsed`, `loadPersistedMru` API 시그니처 호환
- MainArea의 EmptyState CTA가 계속 동작 (lastUsedConnectionId → recentConnections[0])
- IPC bridge 동작 유지
- 기존 테스트 회귀 없음

## Acceptance Criteria

- `AC-166-01`: `markConnectionUsed(connId)` 호출 시 `recentConnections[0].connectionId === connId`, `lastUsed`는 현재 타임스탬프.
- `AC-166-02`: 이미 리스트에 있는 ID 재사용 시 기존 항목 제거 후 최상단에 추가 (중복 없음).
- `AC-166-03`: 최대 5개. 6번째 사용 시 가장 오래된 항목 제거.
- `AC-166-04`: localStorage에 JSON 배열로 persist. App 재시작 후 복원.
- `AC-166-05`: IPC bridge가 `recentConnections`를 동기화.
- `AC-166-06`: 기존 `lastUsedConnectionId`는 `recentConnections[0]?.connectionId ?? null`로 파생.

## Verification Plan

1. `pnpm vitest run` — 모든 테스트 통과
2. `pnpm tsc --noEmit` — 타입 체크 통과
3. `pnpm lint` — ESLint 에러 0건
