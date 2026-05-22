# Sprint 207 — Handoff

prod `.expect("...")` 5곳 정리. panic → 명시적 종료 / 디펜시브 패턴.
행동 변경 0.

## 결과

| 검증 | 결과 |
|------|------|
| `cargo build` | exit 0 |
| `cargo clippy -- -D warnings` | exit 0 |
| `cargo test` | unit + integration + doc-tests pass |
| `pnpm tsc --noEmit` | exit 0 |
| `pnpm lint` | exit 0 |
| `pnpm vitest run` | 189 files / 2732 tests pass |
| 5 prod `expect` grep (lib.rs / postgres/mutations.rs / mongodb/schema.rs) | 0 매치 |

## 변경 파일

수정:
- `src-tauri/src/lib.rs` — 2곳 (build / run) → match + tracing + exit(1)
- `src-tauri/src/db/postgres/mutations.rs` — 1곳 (validate_identifier) → let-else
- `src-tauri/src/db/mongodb/schema.rs` — 2곳 (infer_columns_from_samples) → if-let

신규:
- `docs/sprints/sprint-207/{contract,findings,handoff}.md`

## 다음 후보

PLAN sequencing 갱신 후보:
- Sprint 208 = `tabStore.ts` (1002) 분해 (§1-1 frontend god #4)
- Sprint 209 = `commands/connection.rs` (1710) 분할 (§1-2 backend god #2)

후속 candidate (CODE_SMELLS cycle 외부):
- localStorage 접근 helper 통일 (Sprint 205 후속)
- archived-placeholders.md 의 11 outline 본문 작성 (Sprint 206 후속)
- Tauri panic_hook 등록 + file logging 인프라 (Sprint 207 후속)

CODE_SMELLS 7 카테고리 처리 진행:
- §1-1 frontend god #1/2/3 ✓ — Sprint 199/200/201
- §1-2 backend god #1 ✓ — Sprint 202
- §3 any / as-unknown-as ✓ — Sprint 203
- §5 console 정책 ✓ — Sprint 204
- §4 catch 정책 ✓ — Sprint 205
- §6 e2e skip ✓ — Sprint 206
- §7 Rust prod expect ✓ — Sprint 207
- §1-1 frontend god #4 → Sprint 208
- §1-2 backend god #2 → Sprint 209

본 cycle 종료 시 `/CODE_SMELLS.md` retire
예정 (Sprint 209 종료 시점).
