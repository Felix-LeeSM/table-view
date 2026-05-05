# Sprint 208 — Handoff

다음 sprint 진입자가 알아야 할 사항.

## 완료 산출물

- `src/stores/tabStore.ts` (entry, 668 lines) — zustand `create()` + 모든 actions + persist subscribe + tracker init/subscribe + IPC bridge + `useActiveTab` + re-export.
- `src/stores/tabStore/types.ts` (270 lines) — Tab 타입 union + `TabState` interface.
- `src/stores/tabStore/persistence.ts` (117 lines) — `STORAGE_KEY` + persist 헬퍼 + `migrateLoadedTabs` (Sprint 73/76/129) + `resolveActiveDb`.
- `src/stores/tabStore/tracker.ts` (75 lines) — last-active-tab tracker (`initTracker` 주입 패턴).
- `docs/sprints/sprint-208/{contract,findings,handoff}.md`.
- `docs/PLAN.md` Sprint 207 commit hash 추가 + Sprint 208 ✓.

## 다음 sprint = Sprint 209

[`docs/PLAN.md`](../../PLAN.md) line 96:

> | 11 | 209 | refactor | §1-2 (backend god file #2) | `commands/connection.rs` (1710) 분할 — postgres.rs 패턴 답습. |

마지막 sprint of refactor cycle 199-209. 종료 시 [`/CODE_SMELLS.md`](../../../CODE_SMELLS.md) retire (이전 cycle `refactoring-{plan,smells}.md` 처리와 동일).

## 주의 사항

### eslint `no-restricted-imports` 패턴

`./*Store` 패턴이 `./tabStore/persistence` 같은 same-store sub-dir 까지 매치. 본 sprint 는 entry 의 sub-file import 블록을 `eslint-disable no-restricted-imports` 로 감쌌다 (cross-store 와 동일 패턴, 다만 코멘트로 same-store 임을 명시). `commands/connection.rs` 같은 Rust split 은 eslint 와 무관하지만, 이후 frontend god-file split 이 또 발생하면 같은 처리 필요.

### entry 666 → 668 lines

eslint-disable 블록 코멘트가 +6 lines. AC-208-02 의 500-700 범위 안. 추가 압축은 slice pattern (next sprint candidate) 으로 가능.

### types.ts 270 lines

AC contract 의 ~150-200 보다 약간 초과. 원본 타입 정의의 doc-comment 가 풍부 (Sprint 66/73/76/97/129/195/196/208 의 변경 이력 모두 보존) 라 tighter 압축 불가. 타입 전용 모듈이라 런타임 영향 없음.

### tracker 의존성 주입 패턴

`initTracker(() => useTabStore.getState().tabs)` 호출이 `tabStore.ts` 의 entry 마지막 부분에 위치. tracker 의 defensive prune 이 작동하려면 entry import 후 `initTracker` 호출 전까지 `getLastActiveTabIdForConnection` 호출 금지 (현재 코드는 호출 사이트가 entry 의 actions 본문이라 자연스럽게 init 후 사용 보장).

### 사용자 병행 작업과의 격리

본 sprint 작업 중 사용자가 다음 영역에 병행 수정 중:

- `src-tauri/src/launcher.rs` / `src-tauri/Cargo.toml` / `src-tauri/Cargo.lock` / `src-tauri/tauri.{,e2e.}conf.json` / `src-tauri/src/storage/crypto.rs` / `src-tauri/src/commands/connection.rs`
- `src/components/connection/{ConnectionGroup,ConnectionGroup.test,ImportExportDialog}.tsx` / `src/lib/tauri.ts`

본 sprint 변경은 `src/stores/tabStore.ts` + 신규 `src/stores/tabStore/` + `docs/PLAN.md` + `docs/sprints/sprint-208/` 만 건드림 — 영역 disjoint.

## 검증 명령 (재현)

```sh
pnpm tsc --noEmit                                                # exit 0
pnpm lint                                                        # exit 0
pnpm vitest run                                                  # 189 files / 2737 tests pass
wc -l src/stores/tabStore.ts src/stores/tabStore/*.ts            # 668 / 270 / 117 / 75
grep -rn "from \"@stores/tabStore\"" src/ e2e/ | grep -v "src/stores/tabStore" | wc -l   # 50
```

## 미완 / 후속

- Sprint 209 — `commands/connection.rs` (1710) 분할. cycle 의 마지막 refactor.
- cycle 종료 후 `CODE_SMELLS.md` retire.
- cycle 종료 후 feature backlog (Phase 13 / 21 / 22 / 24 / 25 / 26 등) 진입.
