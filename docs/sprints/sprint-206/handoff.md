# Sprint 206 — Handoff

e2e skip 16 → 2. placeholder 11 제거 + 파일 2개 삭제. outline archive
보존. 행동 변경 0.

## 결과

| 검증 | 결과 |
|------|------|
| `pnpm tsc --noEmit` | exit 0 |
| `pnpm lint` | exit 0 |
| `pnpm vitest run` | 189 files / 2732 tests pass (Sprint 205 baseline 동일) |
| e2e skip grep | 2 match (env-conditional 정당) |

종료 skip 분포:
- `connection-switch.spec.ts:108` (`E2E_MONGO_HOST` 부재)
- `keyboard-shortcuts.spec.ts:108` (`PGHOST` / `E2E_PG_HOST` 부재)

## 변경 파일

수정:
- `e2e/feedback-2026-04-27.spec.ts` (181 → 53 lines, 5 describe 제거)

삭제:
- `e2e/db-switcher.spec.ts` (61 lines, Sprint 133 scaffold)
- `e2e/raw-query-db-change.spec.ts` (41 lines, Sprint 133 scaffold)

신규:
- `docs/sprints/sprint-206/archived-placeholders.md` — 11 제거 placeholder
  outline + 권위 component test 인용 + 후속 진입 트리거.
- `docs/sprints/sprint-206/{contract,findings,handoff}.md`

## 다음 후보

PLAN sequencing 갱신 후보:
- Sprint 207 = §7 Rust prod expect (`lib.rs` 2곳 + invariant `expect` 3곳)
- Sprint 208 = `tabStore.ts` (1002) 분해 (§1-1 frontend god #4)
- Sprint 209 = `commands/connection.rs` (1710) 분할 (§1-2 backend god #2)

후속 candidate (CODE_SMELLS cycle 외부):
- localStorage 접근 helper 통일 (Sprint 205 후속, ~17곳)
- `archived-placeholders.md` 의 11 outline 본문 작성 (각 시나리오마다 별도 sprint)
