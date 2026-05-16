# Sprint Contract: sprint-362

## Summary

- Goal: Phase 3 single-instance plugin 등록 + 2nd launch 시 기존 launcher window focus. Cold-boot regression < 50ms (Sprint 175 baseline 대비).
- Audience: state-management-strategy Q3 — multiple process 방지 (multi-window 는 single process 안 multi-window).
- Owner: Generator (sprint-362)
- Verification Profile: `mixed` (cargo test + cargo clippy + cold-boot benchmark + pnpm tsc + pnpm lint)

## In Scope

- `src-tauri/Cargo.toml` — `tauri-plugin-single-instance`.
- `src-tauri/src/main.rs` — plugin 등록 + 2nd launch callback (기존 launcher focus).
- `scripts/measure-cold-boot.sh` (있으면 사용) — Sprint 175 의 cold-boot 측정 protocol 재실행 + baseline 비교.
- 단위 / integration / e2e:
  - `src-tauri/tests/single_instance_2nd_launch.rs` (또는 e2e 안에서) — 두 번째 process spawn → 기존 launcher focus.
  - `e2e/single-instance.e2e.ts` — driver 시나리오.

## Out of Scope

- Window label per-conn migration (sprint-361 — 이미 머지됨, 본 sprint 구현 범위 아님).
- Q13 same-conn focus (sprint-363).
- Launcher hide (close 아님) 정책 — 본 sprint 에서 plugin 만 등록, hide 정책은 sprint-363 의 일부.

## Invariants

- Single-instance 등록은 launcher 첫 boot 의 cold-boot path 에 들어감 — 측정 시 < 50ms regression.
- Plugin 의 2nd-launch callback 은 launcher window focus 만 호출 — 다른 window 영향 0.
- 기존 e2e cold-boot test (Sprint 175) 와 호환.

## Acceptance Criteria

- `AC-362-01` Plugin 등록 후 `cargo build` 성공. Test: build CI.
- `AC-362-02` 2nd launch: 첫 process 실행 중 두 번째 process spawn → 두 번째 process 즉시 exit + 첫 process 의 launcher window focus. Test: e2e 시나리오.
- `AC-362-03` Cold-boot regression < 50ms vs Sprint 175 baseline (1404ms). 5-trial 측정 protocol. Test: `measure-cold-boot.sh` 5회 + p50 비교.
- `AC-362-04` 2nd launch callback 이 launcher window 만 focus — workspace window 영향 0. Test: 2 workspace 띄운 상태에서 2nd launch → focus event 가 `launcher` label 한정.

## Design Bar / Quality Bar

- TDD: 2nd launch e2e 시나리오 먼저 red — plugin 등록 전엔 두 process 가 동시 실행되는 것을 검증.
- Plugin args 는 ignored — 두 번째 process 가 args 전달했을 때 처리는 별 sprint.
- Cold-boot regression 측정은 trace markers 사용 (`reference_cold_boot_instrumentation.md`).
- 테스트 작성 날짜 + 사유 코멘트.

## Verification Plan

### Required Checks

1. `cd src-tauri && cargo fmt --check && cargo clippy --all-targets --all-features -- -D warnings`
2. `cd src-tauri && cargo build` (CI matrix)
3. `pnpm test:e2e:docker e2e/single-instance.e2e.ts` (또는 host docker e2e)
4. `bash scripts/measure-cold-boot.sh 5`
5. `pnpm tsc --noEmit && pnpm lint && pnpm vitest run`

### Required Evidence

- 2nd launch 시나리오 video 또는 driver log.
- Cold-boot 5-trial p50/p95 raw 결과 vs Sprint 175 baseline.
- 2nd launch callback 호출 로그 (focus event 1 회만).

## Test Requirements

- e2e: 1 시나리오.
- Cargo: build success.
- Coverage: plugin 등록 코드 라인 (얼마 안 됨).
- Scenario: (a) 2nd launch focus, (b) cold-boot regression, (c) workspace 영향 0.

## Test Script / Repro Script

1. `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings`
2. `cd src-tauri && cargo build`
3. `pnpm test:e2e:docker -- e2e/single-instance.e2e.ts`
4. `bash scripts/measure-cold-boot.sh 5`

## Ownership

- Generator: general-purpose Agent.
- Write scope: In Scope. 다른 plugin / 기존 window builder 영향 0.
- Merge order: 361 이후 (AC-362-04 가 2 workspace window 시나리오 → label per-conn migration 필요). 363 본 sprint 의존.

## Exit Criteria

- Open P1/P2: 0
- AC 4/4 PASS
- Cold-boot regression < 50ms p50
