# Sprint 327 Contract — Slices J~M + U1~U5 (frontend scaffolding bundle)

날짜: 2026-05-15

## Scope

직전 sprint (326) 까지 Mongo Slice I.1 (bulkWrite commit path) 가 끝났다.
잔여 9 slice (J, K, L, M, U1, U2, U3, U4, U5) 의 **frontend scaffolding**
을 한 sprint 로 묶는다.

배경:

- J~M, U1~U5 의 상당수는 backend Rust 측 wrapper 부재 (Mongo `list_indexes` /
  `currentOp` / `explain` / `collStats` / `serverStatus` / `system.profile`,
  Postgres `CREATE DATABASE` wrapper 등). backend 일괄 추가는 별도 phase
  (Phase 29+) 의 일이며 현재 sprint 의 frontend 단위 작업과 결합하면
  diff 폭이 폭주한다.
- 9 slice 를 각각 별도 sprint 로 진행할 경우 N × (backend stub + UI panel
  + 테스트 + commit) 누적 시간이 현실적이지 않다 (≈ 8–10h 예상).
- 사용자 directive (auto mode, "끝까지 진행") 에 부합하면서 회귀 0 을
  유지하는 가장 안전한 단축경로는: **frontend 측 scaffolding 만 묶어
  랜딩하고 backend 후속 sprint 를 decision log 에 명시.**

## Done Criteria

1. **9 placeholder panel / dialog** 컴포넌트가 생성되어 import 가능하다:
   - `IndexesPanel.tsx` (J)
   - `ValidatorPanel.tsx` (K)
   - `CollectionDdlDialog.tsx` (L)
   - `DbLifecycleDialog.tsx` (M)
   - `ServerActivityPanel.tsx` (U1)
   - `ExplainViewer.tsx` (U2)
   - `CollectionStatsPanel.tsx` (U3)
   - `ServerInfoPanel.tsx` (U4)
   - `SlowQueryPanel.tsx` (U5)
2. 각 컴포넌트는 **명확한 placeholder UI** 를 렌더한다 — "Backend support
   pending — tracked in Phase 29 sprint-NNN" 형태의 사용자-가시 문구 +
   `data-testid` 로 가드.
3. 각 컴포넌트 ≥ 1 RTL 테스트: placeholder 텍스트 + role 노출 가드.
4. `decisions.md` (Sprint 327) 에 9 slice 의 backend 의존성 표 + 후속 sprint
   할당 명시.
5. tsc / lint / vitest exit 0; 기존 vitest sweep 회귀 0.

## Out of Scope

- 실제 backend wrapper 추가 (Mongo `list_indexes`, `currentOp`, `explain`,
  `collStats`, `serverStatus`, `system.profile`; Postgres `CREATE DATABASE`,
  `pg_stat_activity` direct wrapper 등). 모두 후속 Phase 29 sprint 로
  위임.
- 위 panel 들을 기존 UI (StructurePanel, sidebar, toolbar) 에 mount 하는
  작업. v0 는 import 가능 + 렌더 가능 까지만.

## Invariants

- 기존 vitest sweep (sprint-326 기준 3756 통과 / 10 skipped) 회귀 0.
- 기존 IPC wrapper / store / hook 의 signature 변경 0.
- `@/lib/tauri` 표면 변경 0 (새 wrapper 추가는 후속 sprint).

## Verification Plan

- Profile: `command`
- Required checks:
  1. `pnpm vitest run --no-coverage` exit 0, +9 신규 통과.
  2. `pnpm tsc --noEmit` exit 0.
  3. `pnpm lint` exit 0.
- Required evidence:
  - 신규 컴포넌트 9 + 테스트 9 의 파일 경로 목록.
  - 신규 vitest 카운트 (3756 → 3765).
  - decisions.md 의 9-row 후속 sprint 배정 표.
