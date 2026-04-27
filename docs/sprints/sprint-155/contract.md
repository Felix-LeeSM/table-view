# Sprint Contract: sprint-155 — Test Conversion, ADR Transition, Risk Closure

## Summary

- **Goal**: Phase 12 종결 sprint. `window-lifecycle.ac141.test.tsx`의 `it.todo()` 5개를 실제 `it()` 회귀 테스트로 변환하고 `describe.skip` 제거. ADR 0011을 ADR 0012로 supersede. RISK-025를 `resolved`로 전이. `appShellStore.screen` zombie 필드 완전 제거 (Sprint 154 P2 정리).
- **Audience**: Generator + Evaluator
- **Owner**: harness orchestrator
- **Verification Profile**: `mixed` (command + static)

## In Scope

- `src/__tests__/window-lifecycle.ac141.test.tsx` — `describe.skip` 제거, 5개 `it.todo` → 실제 `it()` 변환. Sprint 154 wiring + `@lib/window-controls` mock에 대한 회귀 단언 작성. Sprint 154에서 추가된 seam-call assertion 기반 케이스도 일관성 있게 정리.
- `memory/decisions/0012-multi-window-launcher-workspace/memory.md` (new) — ADR. `supersedes: 0011`.
- `memory/decisions/0011-single-window-stub-for-launcher-workspace/memory.md` — frontmatter 메타 필드 두 개만 갱신: `status: Superseded`, `superseded_by: 0012`. **본문 동결**.
- `memory/decisions/memory.md` — 인덱스에서 0011을 활성 → 역사 섹션 이동, 0012 활성 추가.
- `docs/RISKS.md` — RISK-025 status `deferred` → `resolved`. 해소 로그 항목 추가 (Sprint 150-155 인용). 요약 카운터 재계산.
- `src/stores/appShellStore.ts` — `screen` 필드 + `setScreen` action + `AppShellScreen` type 완전 제거. Sprint 154에서 vestigial test seam으로 남겼던 잔재 정리.
- `src/__tests__/cross-window-store-sync.test.tsx` — Sprint 153 AC-153-05 케이스만 한 곳 적응 (`setScreen` 호출 → `screen` 필드 미존재 단언으로 변경 또는 삭제). Sprint 153 byte-freeze는 이 한 곳에 대해 명시적으로 완화.
- `src/stores/appShellStore.test.ts` — `screen` 관련 4개 case 제거 또는 변환.
- 잔여 caller (App.test.tsx 등에서 `setState({ screen: "workspace" })` 호출하는 케이스) 정리 또는 deletion.

## Out of Scope

- Phase 13 이후 (PG preview tab, theme toggle, group DnD, MRU, MySQL/MariaDB/SQLite/Oracle 어댑터).
- Sprint 154에서 wired된 production 코드 재손질 (HomePage/WorkspacePage/window-controls.ts/window-lifecycle-boot.ts/main.tsx — 동결).
- Sprint 150~153 protected scope 외 변경.
- 추가 Tauri Rust 명령 신설.

## Invariants

- Sprint 150/151/152/154 protected scope 동결: `tauri.conf.json`, `launcher.rs`, `lib.rs`, `zustand-ipc-bridge.ts/.test.ts`, `connectionStore.ts/.test.ts`, `cross-window-connection-sync.test.tsx`, `tabStore.ts`, `mruStore.ts`, `themeStore.ts`, `favoritesStore.ts`, `window-controls.ts`, `window-lifecycle-boot.ts`, `HomePage.tsx`, `WorkspacePage.tsx`, `main.tsx`, `window-transitions.test.tsx`.
- Sprint 153 protected scope는 **`cross-window-store-sync.test.tsx`의 AC-153-05 케이스 한 곳에 한정해서만** 완화 — 다른 케이스(allowlist regression, sync direction, error-path 등) byte-identical.
- `connection-sot.ac142.test.tsx` AC-142-* invariants 유지.
- Vitest 총합 ≥ 2298 (Sprint 154 baseline). 5개 todo는 변환되어 실제 `it`이 되거나 제거. **최종 todo 수 0**.
- ADR 0011 본문 동결 — frontmatter 메타 필드(`status`, `superseded_by`)만 갱신.
- TDD strict: ADR 0012 본문 작성 시점 = 결정 동결 시점 (수정 금지). Test 변환은 빨간 → 초록 순서 (이미 wired 코드라 처음부터 초록일 가능성 → 그 경우 **새 단언을 먼저 명세하고 expected 값을 일부러 틀리게 한 뒤 wired 결과에 맞게 수정한 commit 순서**로 TDD 흔적 남김).

## Acceptance Criteria

- `AC-155-01` — `src/__tests__/window-lifecycle.ac141.test.tsx`에서 `describe.skip`, `it.todo`, `it.skip`, `xit`, `this.skip()` 모두 제거. 5개 AC-141-* (real) 케이스가 live `it(...)`으로 존재. 각 케이스는 Sprint 154의 `@lib/window-controls` seam mock 또는 `WebviewWindow` mock에 대한 단언으로 검증.
- `AC-155-02` — `grep -rE "it\.skip|this\.skip\(\)|it\.todo|xit\(|describe\.skip" src/__tests__/window-lifecycle.ac141.test.tsx` empty.
- `AC-155-03` — `memory/decisions/0012-multi-window-launcher-workspace/memory.md` 생성. frontmatter `supersedes: 0011`, `status: Accepted`, `date: 2026-04-27`. 본문 3줄 ADR 템플릿 (결정/이유/트레이드오프).
- `AC-155-04` — `memory/decisions/0011-single-window-stub-for-launcher-workspace/memory.md` frontmatter `status: Superseded`, `superseded_by: 0012`. **본문 동결** (`git diff`가 frontmatter 두 줄만 보여야 함).
- `AC-155-05` — `memory/decisions/memory.md` 인덱스 갱신: 0011 활성 → 역사 섹션 이동, 0012 활성 행 추가.
- `AC-155-06` — `docs/RISKS.md` RISK-025 status `resolved`. 해소 로그 entry 추가 (Sprint 150-155 인용). 요약 카운터(active/resolved/deferred) 재계산.
- `AC-155-07` — `src/stores/appShellStore.ts`에서 `screen` 필드, `setScreen` action, `AppShellScreen` type 완전 제거. `useAppShellStore`는 다른 책임이 있다면 보존, 비어있으면 의미 있는 책임으로 축소.
- `AC-155-08` — `grep -rE "useAppShellStore.*screen|appShellStore.*screen|setScreen|AppShellScreen" src/` 결과 0 hit (코멘트 포함 — Sprint 154에서 남긴 코멘트도 정리).
- `AC-155-09` — `pnpm vitest run`, `pnpm tsc --noEmit`, `pnpm lint` exit 0. Total ≥ 2298 + N new (변환된 5개 + α). **5 todo → 0 todo**.
- `AC-155-10` — `connection-sot.ac142.test.tsx` 동일한 AC-142-* 케이스 수가 green 유지.
- `AC-155-11` — Sprint 150/151/152/154 protected scope `git diff HEAD` empty. Sprint 153 scope는 `cross-window-store-sync.test.tsx` 외 byte-identical.

## Design Bar / Quality Bar

- 5개 변환 케이스는 stub의 의도(launcher 720×560 fixed / workspace 1280×800 / show/focus/hide 순서 / close → app_exit / 4-stage visibility integration)를 그대로 검증해야 한다. seam mock으로 보강.
- ADR 0012 본문 3줄: + 별도 두 창 + IPC sync bridge + 5개 store cross-window propagation 완료 / - jsdom에서 실제 WebviewWindow lifecycle 직접 검증 불가 (seam mock 의존).
- `appShellStore.screen` 제거 시 store 자체가 비게 되면 file 자체를 제거하거나 다른 적절한 ownership으로 흡수. 빈 store는 코드 위생상 남기지 않는다.

## Verification Plan

### Required Checks

1. `pnpm vitest run src/__tests__/window-lifecycle.ac141.test.tsx` — green, 5개 변환 케이스 모두 통과.
2. `pnpm vitest run src/__tests__/connection-sot.ac142.test.tsx` — green, AC-142-* 동일.
3. `pnpm vitest run src/__tests__/cross-window-store-sync.test.tsx` — green, AC-153-05 외 케이스 동일.
4. `pnpm vitest run` — green; total ≥ 2298 + N new; **0 todo**.
5. `pnpm tsc --noEmit` — exit 0.
6. `pnpm lint` — exit 0.
7. `cargo build --manifest-path src-tauri/Cargo.toml` — exit 0.
8. `grep -rE "it\.skip|this\.skip\(\)|it\.todo|xit\(|describe\.skip" src/__tests__/window-lifecycle.ac141.test.tsx` — empty.
9. `grep -rE "useAppShellStore.*screen|setScreen|AppShellScreen" src/` — 0 hit.
10. `git diff HEAD <Sprint 150/151/152/154 protected scope>` empty.
11. ADR 0011 frontmatter diff: 정확히 2줄 (`status`, `superseded_by`). 본문 unchanged.
12. ADR 0012 file 존재, frontmatter `supersedes: 0011`.
13. RISKS.md RISK-025 row `resolved`.

### Required Evidence

- Generator는 다음을 제공:
  - 변경 파일 + 한 줄 purpose.
  - 명령 + 결과.
  - AC-155-01..11 매핑 (구체적 artifact).
  - 5개 변환된 테스트 이름.
  - ADR 0011 frontmatter diff 인용.
- Evaluator는 각 pass/fail에 대한 구체 인용.

## Test Requirements

### Unit Tests (필수)
- 5개 AC-141-* (real) 케이스 변환 — 각각 1 case.
- `appShellStore.test.ts` 정리 — `screen` 관련 케이스 제거 후 잔여 책임만 테스트.

### Coverage Target
- 변경 파일: 회귀 게이트 — 새 라인 누락 없음.

### Scenario Tests (필수)
- [x] Happy path — 5개 lifecycle invariants 단언.
- [x] 회귀 없음 — AC-142-* + AC-153-* (단 AC-153-05 한 곳 적응) preserved.

## Test Script / Repro Script

1. `pnpm vitest run src/__tests__/window-lifecycle.ac141.test.tsx` — green.
2. `pnpm vitest run` && `pnpm tsc --noEmit` && `pnpm lint` — all 0, **0 todo**.
3. ADR + RISK 정적 검사.

## Ownership

- Generator: general-purpose Agent.
- Write scope: only In Scope paths.
- Phase 12 종결 — 이 sprint 종료 후 Phase 12 exit gate 검증.

## Exit Criteria

- Open `P1`/`P2` findings: `0`.
- 13개 required checks 모두 통과.
- ADR 0011 → 0012 전이 완료.
- RISK-025 `resolved`.
- todo 0.
