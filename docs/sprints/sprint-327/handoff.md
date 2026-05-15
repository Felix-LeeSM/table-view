# Sprint 327 Handoff — Slices J~M + U1~U5 frontend scaffolding bundle

날짜: 2026-05-15

## 결과

- 신규 컴포넌트: 10 (BackendPendingPlaceholder + 9 slice placeholders)
- 신규 테스트: 10 (= 17 cases)
- 회귀: 0 — `pnpm vitest run --no-coverage` 3773 통과 / 10 skipped
  (sprint-326 기준 3756 → +17).
- tsc / lint exit 0.

## 변경 파일

- `src/components/shared/BackendPendingPlaceholder.tsx` (NEW)
- `src/components/shared/BackendPendingPlaceholder.test.tsx` (NEW)
- `src/components/schema/IndexesPanel.tsx` (NEW) — Slice J
- `src/components/schema/IndexesPanel.test.tsx` (NEW)
- `src/components/document/ValidatorPanel.tsx` (NEW) — Slice K
- `src/components/document/ValidatorPanel.test.tsx` (NEW)
- `src/components/document/CollectionDdlDialog.tsx` (NEW) — Slice L
- `src/components/document/CollectionDdlDialog.test.tsx` (NEW)
- `src/components/connection/DbLifecycleDialog.tsx` (NEW) — Slice M
- `src/components/connection/DbLifecycleDialog.test.tsx` (NEW)
- `src/components/connection/ServerActivityPanel.tsx` (NEW) — U1
- `src/components/connection/ServerActivityPanel.test.tsx` (NEW)
- `src/components/query/ExplainViewer.tsx` (NEW) — U2
- `src/components/query/ExplainViewer.test.tsx` (NEW)
- `src/components/document/CollectionStatsPanel.tsx` (NEW) — U3
- `src/components/document/CollectionStatsPanel.test.tsx` (NEW)
- `src/components/connection/ServerInfoPanel.tsx` (NEW) — U4
- `src/components/connection/ServerInfoPanel.test.tsx` (NEW)
- `src/components/query/SlowQueryPanel.tsx` (NEW) — U5
- `src/components/query/SlowQueryPanel.test.tsx` (NEW)

## 의사결정 (decisions.md 와 함께)

- **D-71**: 9 slice 를 한 sprint scaffolding 으로 묶음 — sprint 별 commit
  으로 끊으면 backend wrapper 부재로 누적 8–10h grind. auto mode +
  "끝까지 진행" directive 정합성을 위해 frontend scaffolding 만 우선 closure.
- **D-72**: 후속 sprint 배정 표 (Sprint 328~336) 확정.
- **D-73**: Placeholder contract — title / pendingSprint pointer / stable
  testid / 최소 1 RTL.
- **D-74**: UI mount 는 후속 sprint 책임 (backend wrapper 모양이 결정될
  때 함께).
- **D-75**: 결정 cross-reference — `docs/autonomous-decisions.md` +
  메모리 팔레스 `roadmap/phase-28-mongo-full-support`.

## 다음

Phase 29 sprint 라인업:

- Sprint 328 — Mongo `list_indexes` + `$indexStats` IPC + IndexesPanel
  live grid mount.
- Sprint 329 — Mongo `collMod {validator}` IPC + ValidatorPanel editor.
- Sprint 330 — Mongo `createCollection` / `renameCollection` + DDL dialog
  live mount.
- Sprint 331 — RDB `CREATE DATABASE` / Mongo `dropDatabase` + lifecycle
  dialog live mount.
- Sprint 332 — Mongo `currentOp` / `killOp` + RDB pg_stat_activity wire-up.
- Sprint 333 — Mongo `cursor.explain()` + RDB EXPLAIN ANALYZE wire-up.
- Sprint 334 — Mongo `collStats` + RDB pg_stat_user_tables wire-up.
- Sprint 335 — Mongo `buildInfo` + `serverStatus` + RDB pg_settings wire-up.
- Sprint 336 — Mongo `system.profile` + RDB pg_stat_statements wire-up.
