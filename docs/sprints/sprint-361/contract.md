# Sprint Contract: sprint-361

## Summary

- Goal: Phase 3 window label per-connection migration. 현재 단일 `"workspace"` label → per-conn `workspace-${connection_id}` 패턴. `open_workspace_window(connection_id)` IPC 신설 + `KnownWindowLabel` union 확장.
- Audience: state-management-strategy Q13/Q15 의 선행 조건. 본 sprint 가 없으면 `useCurrentWindowConnectionId()` (sprint-366) 와 cross-window event routing (sprint-365) 가 동작 안 함.
- Owner: Generator (sprint-361)
- Verification Profile: `mixed` (cargo test + cargo clippy + pnpm vitest + pnpm tsc + pnpm lint)

## In Scope

- `src-tauri/src/launcher.rs` (`launcher.rs:71` 영역) — `"workspace"` 하드코딩 제거. label resolver 가 `workspace-{connection_id}` 생성.
- `src-tauri/src/commands/open_workspace_window.rs` — `open_workspace_window(connection_id: String)` IPC:
  - 기존 `workspace-{connection_id}` window 존재하면 focus 만.
  - 없으면 신규 create.
  - idempotent.
- `src/lib/window-label.ts:19` — `KnownWindowLabel` union 을 `"launcher" | \`workspace-${string}\`` 으로 확장. type helper `parseWorkspaceLabel(label) → connection_id | null`.
- `src/router` / `src/App.tsx` / `src/pages/WorkspacePage.tsx` — label resolve 로직 새 패턴 인식.
- `src/lib/tauri/window.ts` — `openWorkspaceWindow(connId)` wrapper.
- 단위 / integration 테스트:
  - `src-tauri/tests/open_workspace_window_idempotent.rs`.
  - `src/lib/window-label.test.ts` — parse + format 라운드트립.
  - `src/router/window-resolve.test.tsx` — new label 인식.

## Out of Scope

- `useCurrentWindowConnectionId()` hook (sprint-366).
- Single-instance plugin (sprint-362).
- ConnectionStatus enum 확장 (sprint-364).
- workspace state per-conn 영속 (이미 sprint-355 의 `workspaces` PK `(connection_id, db_name)` 에 반영).

## Invariants

- 기존 launcher window label `"launcher"` 변경 0.
- 한 process 안 multiple workspace window 가능 (서로 다른 conn).
- 같은 conn 두 번 호출 시 새 window 생성 0 (idempotent).
- `KnownWindowLabel` 의 type narrowing 동작 — TS exhaustiveness.

## Acceptance Criteria

- `AC-361-01` `open_workspace_window("conn-1")` 첫 호출 → 새 window 생성, label `"workspace-conn-1"`. Test: `open_workspace_window_idempotent.rs`.
- `AC-361-02` Idempotent: 같은 conn 두 번째 호출 → 기존 window focus 만, 새 window 0개 추가. Test.
- `AC-361-03` 서로 다른 conn → window 2개: `open_workspace_window("conn-1")` + `open_workspace_window("conn-2")` → label 2개 (`workspace-conn-1`, `workspace-conn-2`) 동시 존재. Test.
- `AC-361-04` `parseWorkspaceLabel("workspace-abc-123")` → `"abc-123"`. `parseWorkspaceLabel("launcher")` → `null`. Test: round-trip.
- `AC-361-05` `KnownWindowLabel` exhaustiveness: switch 의 모든 branch 가 type narrow. Test: type-check assertion + e.g. `never` branch.
- `AC-361-06` Router 가 `workspace-${connId}` label 받으면 `WorkspacePage` 렌더 + `launcher` 받으면 `HomePage` 렌더. Test: window-resolve.

## Design Bar / Quality Bar

- TDD: parse helper 의 round-trip 테스트 먼저 → 구현 → integrate.
- IPC `open_workspace_window` 는 backend 가 `WindowBuilder::label(format!("workspace-{conn_id}"))` 호출. focus 는 `Window::set_focus()`.
- Label 충돌 회피: `connection_id` 에 `-` 포함 가능 → backend 가 escape (URL-safe base64 not 필요, conn_id 가 이미 UUID format).
- 테스트 작성 날짜 + 사유 코멘트.

## Verification Plan

### Required Checks

1. `cd src-tauri && cargo fmt --check && cargo clippy --all-targets --all-features -- -D warnings`
2. `cd src-tauri && cargo test -p table-view-lib --test open_workspace_window_idempotent`
3. `pnpm vitest run src/lib/window-label.test.ts src/router/window-resolve.test.tsx`
4. `pnpm tsc --noEmit && pnpm lint && pnpm vitest run`

### Required Evidence

- IPC 호출 시퀀스 + window count log.
- TS type-check 결과 (no errors).
- parseLabel round-trip raw.

## Test Requirements

- Cargo + Vitest mixed.
- Coverage: `launcher.rs` + `commands/open_workspace_window.rs` + `window-label.ts` 70%.
- Scenario: (a) idempotent same conn, (b) 2 conn 동시, (c) launcher 변경 0, (d) label parse round-trip.

## Test Script / Repro Script

1. `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings`
2. `cd src-tauri && cargo test -p table-view-lib --test open_workspace_window_idempotent`
3. `pnpm vitest run src/lib/window-label.test.ts`
4. `pnpm tsc --noEmit && pnpm lint`

## Ownership

- Generator: general-purpose Agent.
- Write scope: In Scope. workspace store / connection store mutate 0.
- Merge order: 355 이후 (Phase 1 과 병렬 가능 — codex 피드백). 363 / 364 / 365 / 366 본 sprint 의존.

## Exit Criteria

- Open P1/P2: 0
- AC 6/6 PASS
- TS exhaustiveness type-check green
