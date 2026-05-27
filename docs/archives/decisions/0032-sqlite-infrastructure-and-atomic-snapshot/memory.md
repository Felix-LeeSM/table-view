---
id: 0032
title: SQLite 인프라 + atomic snapshot bootstrap (Q1/Q9 + SQLite 도입)
status: Accepted
date: 2026-05-17
supersedes: null
superseded_by: null
---

**결정**: 영속 상태의 single source of truth 를 SQLite (`sqlx` feature
`sqlite`) 로 통일하고, 모든 boot critical store 의 hydration 은 단일
IPC `get_initial_app_state()` 로 처리한다.

1. **`sqlx` `sqlite` feature 추가** — `src-tauri/Cargo.toml` 에
   `[features] default = ["sqlite"]`. ADR 0001 시점엔 sqlite feature 미사용.
2. **9 table schema** — `migrations/0001_initial.sql`: `connections`,
   `connection_groups` (with `collapsed`), `workspaces` (PK
   `(connection_id, db_name)` per Q13), `mru`, `settings` (key-value),
   `query_history` (FK soft → connections.id), `favorites`,
   `datagrid_column_prefs` (PK 5-tuple per Q20.4), `meta` (legacy_imported
   4-state + sentinels).
3. **Atomic snapshot IPC** — `get_initial_app_state(window: tauri::Window)`
   가 SQLite atomic snapshot 으로 5 store (`connections`, `workspaces`,
   `mru`, `theme`, `safeMode`) 를 1회 round-trip 에 hydrate. 응답 p95
   < 50ms (10 conn seed).
4. **Window-partition snapshot** — workspace window 는 자기 connection
   의 workspace state 만, launcher window 는 빈 `byConnectionId` 받음.
   100 conn × 5 db = 500 row boot 폭주 방지.
5. **Domain-별 migration split** — `workspaces` 는 W1 시작부터 SQLite-only
   (legacy global blob race 회피). `connections`/`favorites`/`mru`/
   `settings` 는 W1 dual-write → W2 dual-read → W3 SQLite primary →
   W4 legacy 정리 4단계.
6. **Export envelope = connections only (Q1)** — ADR 0021 envelope 모델
   유지. favorites/mru/workspaces 는 새 머신서 재생성.

**이유**:

1. **Single source of truth** — file/LS 분산 영속을 SQLite 로 모으면
   atomic transaction + 단일 read path 로 race 차단. workspace 의
   global blob race (M-1) 가 dual-write 윈도우에서도 안 생기도록 W1
   부터 SQLite-only.
2. **Atomic snapshot vs N IPC** — boot 시 5 store 각각 IPC = N×IPC
   overhead + 부분 hydrate race. 단일 snapshot = round-trip 1회 + listener
   선등록 후 처리 (F.4 §Subscribe lifecycle). 100ms boot 예산 충족 가능.
3. **Window-partition scope** — 100 conn × 5 db 환경에서 모든 workspace
   row 를 launcher 가 hydrate 하면 IPC payload 폭주. Tauri command
   `window: tauri::Window` 인자가 호출 source 보장 (codex 2차 #8 fix —
   `app_handle.get_focused_window()` 는 boot 중 focus race).
4. **Domain split migration** — workspaces 만 W1 SQLite-only 인 이유:
   workspace blob 은 IPC + LS dual-write 가 race 윈도우 (~200ms debounce)
   안에 두 source 에서 다른 dehydration 결과를 만들 수 있어 W2 dual-read
   에서 mismatch 가 일상적. connections/favorites/mru/settings 는 mutation
   IPC 가 짧고 동기적이라 dual-write 안전.

**트레이드오프**:

- **+** Cross-window 일관성 자동 — 모든 window 가 같은 SQLite 를 보고,
  in-process event 로 invalidation 만 broadcast. F.4 의 single-source
  refetch 원칙 자연.
- **+** Boot p95 < 50ms 보장 (snapshot 1 IPC + atomic SELECT).
- **+** Workspaces W1 SQLite-only 로 legacy global blob race 차단.
- **+** Migration rollback (`--rollback-state` CLI flag) W3 까지 가능 —
  `.legacy.json` 복사 후 file-based degraded 모드.
- **−** SQLite feature 도입으로 cross-platform 빌드 매트릭스 검증 비용
  (Win/Mac/Linux CI). ADR 0001 이 sqlx 만 가져왔던 시점엔 미사용 feature.
- **−** Dual-state 윈도우 (W1~W2) 동안 코드가 두 write target 유지 —
  mismatch log + W3 진입 전 1주일 dogfood 의무.
- **−** Atomic snapshot 의 partial hydrate (`partial: true`) 경로 별도
  처리 — store 하나가 SELECT 실패해도 boot 는 진행 (다른 store 우선),
  실패 store 만 default 로 시작 + dev log.

**관련**:

- state-management-strategy-2026-05-15.md §Q1 line 404 (envelope 범위)
- state-management-strategy-2026-05-15.md §Q9 line 420 (boot hydration)
- state-management-strategy-2026-05-15.md §F.1 line 835–909 (migration contract W0~W4)
- state-management-strategy-2026-05-15.md §F.2 line 911–1009 (snapshot payload contract)
- state-management-strategy-2026-05-15.md §Phase 1 line 524–752 (SQLite 인프라)
- ADR 0001 — Tauri v2 + sqlx (sqlite feature 본 ADR 이 처음 활성)
- ADR 0021 — Export envelope (Q1 의 envelope 모델 유지)
- ADR 0033 — Single-instance + cross-window sync (snapshot 의 in-process
  event 의존)
- ADR 0035 — Corrupt recovery (snapshot SELECT 실패 시 quarantine 정책)
- ADR 0039 — Workspace window per-connection (snapshot window scope 의
  window label 의존)
- ADR 0042 — Query history privacy (snapshot 에 history 미포함 — Phase 5
  별 IPC `list_history`)
