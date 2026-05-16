# Sprint Contract: sprint-375

## Summary

- Goal: Phase 6 cleanup — (a) `session-storage.ts` → `scopedLocalStorage.ts` rename + 모든 import 갱신, (b) 모듈 변수 8개 정리 (store internal field 또는 reset API), (c) `tab_id IS NULL` history row 분석 (sidebar-prefetch 만 null 보장), (d) W4 `.legacy.json` 30일 cleanup CLI cron.
- Audience: state-management-strategy Phase 6 cleanup 항목.
- Owner: Generator (sprint-375)
- Verification Profile: `mixed` (cargo test + pnpm vitest + pnpm tsc + pnpm lint + grep CI)

## In Scope

- (a) Rename:
  - `src/lib/session-storage.ts` → `src/lib/scopedLocalStorage.ts`. 내부 함수 시그니처 그대로 (semantic rename only).
  - 모든 import 사이트 갱신 (`rg "from .*session-storage"` 결과 file:line 모두).
- (b) 모듈 변수 정리:
  - Generator 가 audit (`docs/code-smell-audit-2026-05-15.md` Part B 의 모듈 변수 8개 정확 식별) → 각각:
    - Store internal field 로 이전 (예: `let cachedFoo = null` → `useFooStore` 의 state slot)
    - 또는 reset API 제공 (예: `__resetForTests`).
  - Inventory + before/after 표 handoff.
- (c) `tab_id IS NULL` history 분석:
  - `src-tauri/src/storage/history_audit.rs` — boot 시 `SELECT COUNT(*) FROM query_history WHERE tab_id IS NULL AND source != 'sidebar-prefetch'` → 0 expected. 0 보다 크면 dev console error + Sentry-style log (Q10 zero-telemetry 라 외부 미전송, dev console 만).
- (d) W4 cron:
  - `scripts/cleanup-legacy-files.sh` — `.legacy.json` (strategy F.1 line 862 정합, 30 일 이상) delete + 사용자 toast 미사용 (silent cleanup).
  - `src-tauri/src/storage/legacy_cleanup.rs` — boot 시 1회 호출 (date check + delete).
- 테스트:
  - `scripts/check-no-session-storage-import.sh` — grep CI.
  - `src/stores/__resetForTests.test.ts` — 모듈 변수 retire 후 reset 가능.
  - `src-tauri/tests/history_tab_id_null_audit.rs`.
  - `src-tauri/tests/legacy_file_cleanup.rs`.

## Out of Scope

- ADR (sprint-374).
- Reset-to-default UI (sprint-376).

## Invariants

- Rename 은 semantic 동일 — 외부 API 호환.
- 모듈 변수 8개 모두 store / reset API 로 이전 — `let cachedXxx` / `const counter = ...` 패턴 사이트 0 grep CI.
- `tab_id NULL` audit 은 dev only — 사용자 visible 영향 0.
- legacy file cleanup 은 30일 이후 — 그 사이 retention 보장.

## Acceptance Criteria

- `AC-375-01` `src/lib/session-storage.ts` 파일 부재 + `src/lib/scopedLocalStorage.ts` 존재. Test: file existence.
- `AC-375-02` `rg "session-storage"` src/ 0 또는 docs-only. Test.
- `AC-375-03` 모듈 변수 8개 inventory + 모두 store / reset API 로 이전. Test: 8 사이트 before/after 표 + each unit test green.
- `AC-375-04` 모듈 변수 grep CI: `rg "^let\s+(cached|counter|state)" src/` 결과 0건 (또는 명시 whitelist).
- `AC-375-05` `tab_id NULL` 비-sidebar-prefetch row 0건 보장 — audit 함수가 0 외 값 보이면 dev console error log. Test: 부정 시나리오 (mock 으로 row 시드) → log 호출 1회.
- `AC-375-06` Legacy cleanup: 31일 전 `.legacy.json` 파일 시뮬 → boot 후 delete. 29일 전 파일은 유지. Test.
- `AC-375-07` Legacy cleanup silent: 사용자 toast 호출 0. Test: toast spy.

## Design Bar / Quality Bar

- TDD: grep CI failing test 먼저 → rename 적용 → green.
- 모듈 변수 inventory 는 `findings.md` 에 표 형식 (변수명 | 위치 | 이유 | 신규 위치).
- `let` 모듈 변수 vs `const` 상수 구분 — 상수는 retire 대상 아님.
- 테스트 작성 날짜 + 사유 코멘트.

## Verification Plan

### Required Checks

1. `bash scripts/check-no-session-storage-import.sh`
2. `pnpm vitest run src/stores/__resetForTests.test.ts`
3. `cd src-tauri && cargo test -p table-view-lib --test history_tab_id_null_audit --test legacy_file_cleanup`
4. `pnpm tsc --noEmit && pnpm lint && pnpm vitest run`
5. grep: `! rg -q "^let\s+(cached|counter|state)" src/ -g '!*test*' -g '!*.config.*'`

### Required Evidence

- 8 모듈 변수 inventory 표.
- grep CI raw (rename + 모듈 변수).
- Cleanup 시뮬 (31일/29일) 결과.

## Test Requirements

- Vitest + Cargo + grep CI.
- Coverage: 모듈 변수 retire 사이트 70%.
- Scenario: (a) rename round-trip, (b) 모듈 변수 reset, (c) audit log, (d) cleanup boundary.

## Test Script / Repro Script

1. `bash scripts/check-no-session-storage-import.sh`
2. `pnpm vitest run`
3. `cd src-tauri && cargo test -p table-view-lib --test history_tab_id_null_audit --test legacy_file_cleanup`
4. `pnpm tsc --noEmit && pnpm lint`

## Ownership

- Generator: general-purpose Agent.
- Write scope: In Scope.
- Merge order: 367 + 368 + 369 + 370 + 371 + 372 + 373 이후 (Phase 6 선행 = Phase 1~5 전체). 374 (ADR) 와 병렬 가능, 376 본 sprint 의존.

## Exit Criteria

- Open P1/P2: 0
- AC 7/7 PASS
- grep CI: session-storage import 0, 모듈 변수 사이트 0
