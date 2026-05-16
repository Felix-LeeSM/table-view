# Sprint Contract: sprint-370

## Summary

- Goal: Phase 4 W2 → W3 dogfood gate. 4 도메인 (connections/favorites/mru/settings) 의 dual-read 동안 mismatch log 0 — 1주일 dogfood 후 W3 진입 (SQLite primary, file/LS read 금지). file/LS read 사이트 0 — grep CI.
- Audience: state-management-strategy Phase 4 W2 → W3 — SQLite SOT 확정.
- Owner: Generator (sprint-370)
- Verification Profile: `frontend` + `mixed` (cargo test + pnpm vitest + pnpm tsc + pnpm lint + grep CI)

## In Scope

- `src-tauri/src/storage/mismatch_metric.rs` — boot 시 + W2 동안 file/LS 와 SQLite 의 4 도메인 row count + content hash 비교. mismatch 시 dev console log + counter 증가.
- `scripts/w2-dogfood-gate.sh` — 1주일 dogfood 기간 동안 매일 mismatch counter 확인 (사용자 머신 — local script). 결과 docs/sprints/sprint-370/dogfood-log.md 에 commit.
- W3 진입 cleanup:
  - `src/stores/connectionsStore.ts` / `favoritesStore.ts` / `mruStore.ts` / `safeModeStore.ts` 의 file/LS read 사이트 제거 — SQLite (snapshot IPC) 가 단일 source.
  - `src-tauri/src/commands/persist_*.rs` 의 file/LS write 분기 제거 — SQLite-only.
- `src/lib/legacy/connections-json.ts` — `connections.json` read helper retire 또는 boot import 1회 path 로 한정.
- 테스트:
  - `src-tauri/tests/mismatch_metric.rs` — mismatch counter 단위.
  - `src/stores/connectionsStore.no-file-read.test.ts` — file/LS read 사이트 0.
  - 통합 grep CI.

## Out of Scope

- query_history (sprint-371 — Phase 5).
- Reset-to-default UI audit (sprint-376).
- W4 legacy 파일 cleanup (sprint-375).

## Invariants

- W2 동안 (sprint-358 머지 후 ~1주일) — file/LS write + SQLite write 둘 다, **read 는 SQLite 우선 + file/LS fallback**.
- W3 진입 시 — file/LS read 사이트 0, write 사이트 0. SQLite 가 단일 source.
- W3 진입 결정은 mismatch counter 0 (1주일 dogfood 누적) — 본 sprint 의 gate 조건.
- Workspace 는 sprint-358 이후 이미 SQLite-only — 본 sprint 의 4 도메인 만 추가 retire.
- 사용자 visible 영향 0 — read SOT 가 SQLite 로 옮겨가도 같은 데이터.

## Acceptance Criteria

- `AC-370-01` `mismatch_metric` 모듈이 boot 시 4 도메인 비교 + counter exposed. Test: `mismatch_metric.rs`.
- `AC-370-02` Dogfood log: `docs/sprints/sprint-370/dogfood-log.md` 에 7일 동안 daily mismatch counter raw 결과 + 모두 0. Test: file commit + content check.
- `AC-370-03` W3 진입 후 `connectionsStore` 의 file (`connections.json`) read 사이트 0. grep CI: `rg "connections\.json" src/ src-tauri/src/` 결과 0 또는 legacy import path 1곳만.
- `AC-370-04` `favoritesStore` 의 LS `table-view-favorites` read 사이트 0. grep CI.
- `AC-370-05` `mruStore` 의 LS `table-view-mru` read 사이트 0. grep CI.
- `AC-370-06` `safeModeStore` / `settingsStore` 의 LS read 사이트 0 (theme `THEME_STORAGE_KEY` 의 FOUC cache read 1곳 제외 — sprint-368 의 AC). grep CI.
- `AC-370-07` `persist_*` IPC 의 file/LS write 분기 제거 — SQLite write 만. mismatch metric 도 retire (SQLite SOT 후 비교할 다른 source 0). Test: 코드 diff.
- `AC-370-08` 사용자 visible 회귀 0 — workspace round-trip / connections list / favorites / mru 가 W3 진입 후 정상. Test: 통합 e2e (smoke).

## Design Bar / Quality Bar

- TDD: grep CI failing test 먼저 → 코드 변경 → green.
- Mismatch metric 은 dev only — production build 에선 strip 또는 always-off.
- Dogfood log 는 사용자가 본 sprint 시작 시 7일 측정 후 commit. CI 에선 log 존재 + 7개 entry + 모두 0 만 검증.
- W3 진입 후 `mismatch_metric` 모듈 retire (옵션) — 또는 0 결과 보장 코드 (assertion) 로 변경.
- 테스트 작성 날짜 + 사유 코멘트.

## Verification Plan

### Required Checks

1. `cd src-tauri && cargo test -p table-view-lib --test mismatch_metric`
2. `pnpm vitest run src/stores/connectionsStore.no-file-read.test.ts`
3. `bash scripts/check-dogfood-log.sh` — 7일 entry + 0 mismatch
4. `pnpm tsc --noEmit && pnpm lint && pnpm vitest run`
5. grep CI: `! rg -q '"connections\.json"|"table-view-favorites"|"table-view-mru"|"view-table.safeMode"' src/`
6. `pnpm test:e2e:docker -- e2e/smoke.e2e.ts`

### Required Evidence

- 7일 dogfood log content.
- 4 도메인 read 사이트 grep raw.
- Smoke e2e 결과.
- mismatch metric retire 코드 diff.

## Test Requirements

- Cargo: mismatch metric.
- Vitest: 4 도메인 store no-file-read.
- e2e: smoke.
- Coverage: cleanup된 store 라인 80% (대부분 retire).
- Scenario: (a) W2 dual-read 정상, (b) W3 진입 후 SQLite SOT, (c) sample data round-trip, (d) grep CI strict.

## Test Script / Repro Script

1. `cd src-tauri && cargo test -p table-view-lib --test mismatch_metric`
2. `pnpm vitest run src/stores`
3. `bash scripts/check-dogfood-log.sh`
4. `pnpm tsc --noEmit && pnpm lint && pnpm vitest run`
5. `pnpm test:e2e:docker -- e2e/smoke.e2e.ts`

## Ownership

- Generator: general-purpose Agent.
- Write scope: In Scope.
- Merge order: 358 + 365 + 367 + 368 + 369 이후. Phase 5 (371 / 372 / 373) 와 Phase 6 (375) 본 sprint 의존.

## Exit Criteria

- Open P1/P2: 0
- AC 8/8 PASS
- 7일 dogfood log 모두 0 mismatch
- 4 도메인 file/LS read 사이트 0
