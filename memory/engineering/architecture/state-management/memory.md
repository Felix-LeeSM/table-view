---
title: State management architecture
type: memory
updated: 2026-05-27
surface: src/stores/**, src/hooks/useCurrentWindowConnectionId.ts, src-tauri/src/storage/**, src-tauri/src/events.rs
task: state-management, persistence, cross-window, local-storage, sqlite
trigger:
  signal: 새 state 추가 / persistence 변경 / cross-window sync 변경 / localStorage 사용
  layer: index
---

# State Management Architecture

새 state 는 durability, size, sync-read 필요, cross-window 필요, query 필요, privacy,
change frequency, loss cost 를 평가한 뒤 매체를 고른다. 과거 분석 원문은 archive 에
있고, 코딩 중 적용할 SOT 는 이 memory 다.

## Medium Rules

| Condition | Medium |
|---|---|
| Sensitive secret | encrypted file/keyring path 또는 encrypted SQLite contract |
| Structured query/search/filter 필요 | SQLite |
| Live process handle | backend AppState |
| Ephemeral | memory |
| Session + cross-window 불필요 | memory |
| Durable + sync first paint 필요 + small | localStorage cache 가능 |
| Durable + no sync-read + small/medium | SQLite 또는 current accepted store |
| Durable + large | SQLite |

Theme 은 FOUC 때문에 localStorage boot cache 예외를 유지할 수 있다. Safe Mode 는
FOUC critical 이 아니므로 SQLite truth 를 우선한다.

## Workspace Identity

- `connectionStore.focusedConnId` 는 launcher/sidebar focus 신호다.
- Workspace identity 는 window label 의 `workspace-{connection_id}` 와 active db 로
  `(connId, db)` 를 만든다.
- Workspace path 에서 `focusedConnId` 를 작업 identity 로 재도입하지 않는다.

## Persistence Boundaries

- Query result rows/columns, selected node, scroll position, dirty markers 같은
  runtime UI state 는 durable payload 에 넣지 않는다.
- Query tab 의 SQL text 는 사용자 작업물이므로 persist 할 수 있다.
- `dirtyTabIds` 는 `dataGridEditStore.pendingEdits` 에서 파생되는 window-local signal
  이다. Boot persisted marker 로 남기지 않는다.
- `closedTabHistory` 는 cap 을 두고 query result payload 를 dehydrate 한다.
- Query history 처럼 검색/filter/retention 이 필요한 durable log 는 SQLite 로 둔다.

## Cross-Window Sync

- Single-instance + in-process Tauri event 가 기본 모델이다.
- Store sync 는 allowlist 를 가진다. Loading/error/session-only flag 를 durable 또는
  broadcast state 로 승격하지 않는다.
- Schema cache invalidation 은 connection-wide, wide, eager invalidation 을 기본으로
  한다. Narrow invalidation 은 ROI 가 확인될 때만 추가한다.

## Persistent UI State Gate

새 persistent UI state 는 같은 PR 에 reset-to-default affordance 를 포함한다. Reset
위치는 [product memory](../../../product/memory.md) 가 소유한다.

## Related

- [frontend state boundary](../../conventions/frontend/memory.md)
- [historical strategy snapshot](../../../../docs/archives/design-snapshots/state-management-strategy-2026-05-15.md)
