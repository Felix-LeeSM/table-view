---
id: 0038
title: Theme/SafeMode SOT — SQLite truth + theme-only LS FOUC cache
status: Accepted
date: 2026-05-17
supersedes: null
superseded_by: null
---

**결정**: `theme` 과 `safeMode` 의 single source of truth (SOT) 는
SQLite `settings` table. LS 의 역할은 `theme` 에만 한정한 boot FOUC
방지 cache (write-only mirror, 다음 boot read 용). `safeMode` 는 LS
read/write 모두 0.

1. **Write flow (Backend-first, F.3)** — Frontend action → IPC
   `set_setting(key, value_json)` → backend SQLite write → `emit_all
   ({domain:"setting", op:"update", entityId:key, version, originWindow})`
   → 모든 window 가 `get_setting(key)` refetch → store mutate.
2. **Theme 특수처리 — LS sync write** — 각 window 가 mutate 후 자기
   `table-view-theme` LS 에 sync write. ThemeBoot 가 다음 boot 에 LS
   read → 즉시 paint (FOUC 0). LS read 사이트는 **ThemeBoot 1개만**.
3. **SafeMode = LS read/write 0** — Boot FOUC critical 아님 (IPC 응답
   전까지 default safe 가정 안전). 기존 `view-table.safeMode` LS key
   는 Phase 6 cleanup 대상. `setSafeMode` action 의 LS 직접 write 회귀
   금지 — grep CI 차단.
4. **Reset path** — `reset_setting(key)` IPC = `DELETE FROM settings
   WHERE key = ?` + `emit_all({op:"reset", entityId:key})`. 수신 window
   는 `SETTING_DEFAULTS[key]` (frontend 상수) 즉시 적용. Theme 인 경우
   LS sync write 도 동반.
5. **Reset-to-default UI (Q21)** — 설정 패널 안 "Reset to defaults"
   버튼 (global settings 카테고리). Phase 6 AC 의 audit 항목.

**이유**:

1. **SOT 단일화 = cross-window 일관성** — 두 window 가 동시에 theme
   변경하면 SQLite version + emit_all + refetch 가 자동 직렬화. LS 단독
   SOT 이면 두 window 가 동시 write 시 last-write-wins race.
2. **Theme 의 FOUC critical 성** — Boot 직후 `:root` 의 `data-mode` 값
   이 늦게 적용되면 사용자가 잘못된 모드 (dark 설정인데 light flash)
   를 본 후 jump. ThemeBoot 의 LS sync read (boot 의 첫 paint 전 동기
   `localStorage.getItem`) 가 이 jump 0 으로 만듦. LS 는 *SOT 아니라*
   *FOUC cache* — IPC 응답 도착 후 그 값으로 즉시 갱신.
3. **SafeMode 는 FOUC critical 아님 (codex 5차 #1 fix)** — Production
   warning chrome / destructive confirm gate 는 boot 직후 ~200ms 사이에
   사용자가 trigger 할 수 없음 (워크플로우 진입 시간 필요). IPC 응답
   기다려도 안전. LS 도입은 불필요 한 mirror state 만 만들고 disable/
   enable race 위험 (사용자가 LS 만 수정 → SQLite 값 다름).
4. **Reset op 의 refetch 안 함 (F.4 §Reset op 처리 흐름)** — `DELETE`
   후 `get_setting` 은 null 반환할 수밖에 없어 refetch 무의미. Frontend
   `SETTING_DEFAULTS` 상수가 default 값 single-source. Theme 의 경우
   default reset 도 LS sync write 동반 (다음 boot FOUC default 정확).
5. **명시적 reset IPC 분리** — `set_setting(key, "null")` 과 `reset_setting
   (key)` 둘 다 row 삭제 같은 효과지만 emit `op` 가 `update` vs
   `reset` 으로 다름. 수신자 처리 분기 (default 적용 vs refetch) 가
   명확해짐.

**트레이드오프**:

- **+** Cross-window 일관성 — 두 window 의 theme/safeMode 가 자동 동기화.
- **+** Theme 의 FOUC 0 — ThemeBoot 의 LS sync read 1사이트로 첫 paint
  보장.
- **+** SafeMode 의 LS 코드 cleanup — Phase 6 에서 `view-table.safeMode`
  key 제거, 동기 mirror 책임 0.
- **+** Reset op 의 명시적 wire — `update` 와 `reset` 분리로 수신자
  처리 분기 명확.
- **−** Theme 변경 시 IPC round-trip 후 LS write 까지 — 자기 window 는
  optimistic IPC 응답 시점에 store mutate (self-echo skip), 다른 window
  는 event 수신 후 refetch (50ms 목표).
- **−** SafeMode 의 IPC 대기 윈도우 (~200ms) 동안 default `none` 가정
  — 사용자가 boot 직후 destructive 액션 시도하면 ProductionWarning chrome
  이 아직 안 올라와 있을 수 있음. 단 사용자 워크플로우 진입 시간 충분
  하다는 가정 (codex 5차 #1 fix 의 검토 결과).
- **−** Theme LS write 사이트 = 모든 window. 두 window 가 동시 setTheme
  IPC 호출 시 last-write-wins 의 race 는 SQLite version 기준 — 다른
  window 의 LS 가 stale 가능. 단 다음 boot 의 ThemeBoot 가 IPC 응답
  으로 정확값 갱신해 1 frame 후 동기화.
- **−** `view-table.safeMode` LS key 의 legacy 사용자 — Phase 6 cleanup
  까지 기존 LS 값이 SQLite migrate (W1 dual-write) 의 source 로 사용
  됨. 그 후 LS read 사이트 0 으로 cleanup.

**관련**:

- state-management-strategy-2026-05-15.md §Q12 line 423 (SQLite truth + theme LS sync
  분리)
- state-management-strategy-2026-05-15.md §F.3 line 1280–1286 (write ownership —
  theme/safeMode backend-first)
- state-management-strategy-2026-05-15.md §F.4 line 1416–1432 (Reset op 처리 흐름)
- state-management-strategy-2026-05-15.md §Phase 4 AC line 1649–1653 (LS key cleanup
  + theme FOUC 시뮬레이션)
- ADR 0007 — ThemePicker DOM-only hover preview (preview 자체는 LS/SQLite
  미접촉 — 본 ADR 과 layer 다름)
- ADR 0022 — Safe Mode destructive-only confirm + dry-run preview (Safe
  Mode 의 사용 시점)
- ADR 0032 — SQLite infrastructure (settings table 의 boot snapshot)
- ADR 0033 — Cross-window sync (`emit_all` event "setting" domain)
- ADR 0042 — Query history privacy (history retention 도 settings 의
  `query_history_retention_days` key 로 영속)
