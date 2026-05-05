# Sprint 206 — Findings

e2e skip 16 → 2. placeholder 11 제거 + 파일 2개 삭제. outline 은 archive
보존. 행동 변경 0 — e2e 실행 면적 동일 (skip 표시만 사라짐).

## §1 — skip 분류 (16곳)

| 카테고리 | 갯수 | 처리 |
|----------|------|------|
| env-skip 정당 | 5 | 보존 (env 부재 시 fixture 의존 spec skip) |
| body-placeholder | 11 | 제거 (outline 은 archive 로 이전) |

env-skip 5곳 분포:
- `connection-switch.spec.ts:108` (`E2E_MONGO_HOST`) — 본문 보존, env-skip 보존.
- `keyboard-shortcuts.spec.ts:108` (`PGHOST` / `E2E_PG_HOST`) — 본문 보존, env-skip 보존.
- `db-switcher.spec.ts:34/56` — 파일 삭제로 동시 제거.
- `raw-query-db-change.spec.ts:24` — 파일 삭제로 동시 제거.

종료 skip 갯수: **2** (`connection-switch:108` + `keyboard-shortcuts:108`).

## §2 — 변경 요약

### 수정

`e2e/feedback-2026-04-27.spec.ts` (181 → 53 lines):
- 5 describe 제거 (#1 home picker REVIVE, #2 connection swap, #5 encrypted×3,
  #10 row count, #12 mongo persist).
- 머리주석 갱신 — "Sprint 206 후 #6 만 남음. 다른 시나리오는 권위
  component test 또는 archive (sprint-206/archived-placeholders.md) 로
  이전" 명시.
- #6 LIVE describe + 권위 component test 인용 코멘트 보존.

### 삭제

- `e2e/db-switcher.spec.ts` (61 lines) — Sprint 133 scaffold, 본문 미구현
  placeholder. PG / Mongo it() 둘 다 `this.skip()` + `expect(true).toBe(true)`.
- `e2e/raw-query-db-change.spec.ts` (41 lines) — Sprint 133 scaffold,
  본문 미구현 placeholder.

### 신규

- `docs/sprints/sprint-206/archived-placeholders.md` — 11 제거된
  placeholder 의 outline + 권위 component test 인용 + 후속 진입 트리거
  보존.
- `docs/sprints/sprint-206/{contract,findings,handoff}.md`

## §3 — 검증 결과

| 항목 | 결과 |
|------|------|
| `pnpm tsc --noEmit` | exit 0 |
| `pnpm lint` | exit 0 |
| `pnpm vitest run` | 189 files / 2732 tests pass |
| e2e skip grep | 2 match (`connection-switch:108`, `keyboard-shortcuts:108`) |

vitest baseline = Sprint 205 동일 (회귀 0). e2e 본 sprint 변경은
suite 의 skip 표시만 줄임 — e2e dry-load 시 syntax error 없음을 tsc 가
검증.

## §4 — Out-of-scope

- **e2e 본문 작성** — placeholder 가 명시한 시나리오 (#1 viewport, #2
  swap, #5 round-trip, #10 row count, #12 mongo, db-switcher PG/Mongo,
  raw-query \\c admin) 의 실제 본문은 후속 sprint. 본 sprint 는 정리만.
- **`describe.skip` / `it.todo` / `xit` 도입** — e2e-scenarios P6 "skip
  은 부채" — 정리한 부채를 새 형태로 다시 추가하지 않음.
- **CI workflow 수정** — `.github/workflows/ci.yml` 의 e2e job 은 ADR
  0019 로 이미 제거. lefthook pre-push 만 e2e 실행 — 본 sprint 변경
  없음.
- **`docs/refactor` skip enumeration 동기화** — refactor 문서 retire
  cycle 진행 중. 본 sprint 는 코드만.

## §5 — CODE_SMELLS §6 처리

§6 의 본질 ("CI 통과로 보이지만 실행되지 않는 케이스 누적") 은 16 →
2 로 환원되어 처리 완료. 잔존 2건은 fixture 환경 의존 정당 skip.
Sprint 206 archive 가 후속 sprint 진입 자료 역할.

## §6 — 후속 sprint 진입 정책

`archived-placeholders.md` 의 진입 정책 요약:
1. **권위 재검증** — outline 의 권위 component test 가 여전히 회귀 잡는
   가? P1 (피라미드 분리) 적용 — vitest 로 끝나면 e2e 추가하지 않음.
2. **CUJ 5종 매핑** — outline 이 e2e CUJ 5종 (연결→첫쿼리, paradigm
   전환, Home↔Workspace, 셀편집, 멀티윈도우 라이프) 중 하나에 해당하는
   가? 해당 시 `e2e/cuj/` 위치.
3. **회귀 고정 인용** — 사용자-가시 버그 보고 / sprint / ADR 인용을
   spec 머리주석에 명시.
4. **step 라벨** — outline 의 각 단계를 `step("...")` 라벨로 변환.
