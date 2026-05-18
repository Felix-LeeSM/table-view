---
sprint: 400
title: git hook hardening — close sprint-389 review gaps (G1 investigation / G2 case-dispatch / G3 worktree-spawn verify)
date: 2026-05-17
owner: orchestrator
status: in_progress
---

# Sprint 400 Contract — Git Hook Hardening

## Goal

sprint-389 의 hook (`scripts/hooks/check-dangerous-bash.sh`) 은 *Claude Bash
PreToolUse* + *lefthook* 만 cover. 본 sprint 는 **3 개의 후속 gap** 을 닫는다:

- **G1** — sprint-389 / sprint-390 / sprint-385 agent 보고 "push 후 local HEAD 가
  FETCH_HEAD 로 reset" 패턴의 *source* 식별 + 차단/완화.
- **G2** — 현재 `git_reset_hard` 패턴은 *모든* `reset --hard` 차단. 본인-commit-wipe
  case 와 본인-commit-복구 case 를 구분해서 *맞춤 안내* 제공 (block 은 유지하되
  메시지가 case 를 인식).
- **G3** — Worktree 작업 시 *cross-worktree contamination* 방지 (sprint-381 /
  380 / 385 에서 3 회 발생). spawn script + runbook 강화.

## Scope

### In scope

1. **D1 (G1) — Internal-trigger 조사 보고** — read-only 조사 + 가설/증거 contract
   기록. `lefthook.yml` / `.githooks/*` / 모든 worktree reflog 검사.
2. **D2 (G2) — `git_reset_hard` 패턴 case-dispatch**
   - `FETCH_HEAD` / `origin/*` / `HEAD~N` / `HEAD^N` / `@~N` → 기존 destructive
     메시지 (4-step recovery + memory pointer) **block**.
   - 40-hex SHA → reflog 검색 → 발견되면 *복구 case* 안내 (block 유지하되 메시지
     가 "복구 case 로 추정, 사용자 명시 승인 시 진행" 명시).
   - 다른 ref (branch name 등) → 기존 destructive 메시지 block.
3. **D3 (G3) — `scripts/worktree-spawn.sh` path 검증** — spawn 한 worktree path
   가 *output* 일 뿐 아니라, *spawn 시 사후 검증* + *agent 가 첫 turn 에 실행할
   verification snippet 출력* 추가.
4. **D4 (G3 + 운영) — `memory/runbook/worktree/memory.md` 갱신** — 첫 turn 검증
   가이드 1 절 추가 (sprint-400 가 도입한 패턴).
5. **D5 — Smoke test 확장** (`scripts/hooks/test-check-dangerous-bash.sh`) —
   G2 의 4 case + spawn script 의 path-verify 의 1 case = 신규 5 case 추가
   (sprint-389 의 7 case + 본 sprint 5 case = 12 case).

### Out of scope (deferred / blocker)

- G1 의 source 가 *git core 동작* 이면 fix 강제 X — 본 sprint 는 **조사 보고만**.
  source 가 우리 인프라 (lefthook / hook wrapper) 면 fix 포함.
- Codex / Cursor brain 의 worktree spawn 패턴 — sprint-387 가 이미 wrapper
  추상화. 본 sprint 는 Claude Code 전용 추가 검증만.
- `wasm-pack --out-dir` 의 다른-worktree 누출 가능성 — `package.json` 의 현
  명령 `cd src-tauri/sql-parser-core && wasm-pack build --out-dir
  ../../src/lib/sql/wasm` 은 *상대* path 지만, pnpm 의 cwd 가 worktree root 라
  `cd src-tauri/sql-parser-core && ../../src/...` 가 worktree 안에 머문다 ✓.
  실측 안전 → 별 sprint 작업 없음.

## Invariants

- 기존 dangerous pattern 0 개 제거. case-dispatch 는 *기존 block 동작 유지*
  + 메시지 향상.
- exit code semantics 보존 — block = 1, warn / allow = 0.
- Platform-neutral 보존 — bash 만, GNU-only flag 금지.
- `memory/` 트리: `memory.md` 만, 200줄 cap.
- sprint-389 smoke test 7 case 회귀 0.

## Acceptance Criteria

### G1 — Internal-trigger investigation

- `AC-400-01` 본 contract 의 "G1 Findings" 절에 다음 4 항목 명시:
  1. `lefthook.yml` 의 모든 hook 명령 list (pre-commit / pre-push / commit-msg).
     `git fetch` / `git reset` / `git pull` 호출 여부 진단.
  2. `.githooks/*` wrapper 의 동작 진단 — pre-commit / pre-push / commit-msg.
  3. 현재 활성 worktree (sprint-391 / 400 / 401) 의 reflog 에서 `reset:
     moving to FETCH_HEAD` 패턴 검색 결과.
  4. 가설: source 가 *git core* 인지 *agent self-action* 인지 + 근거.
- `AC-400-02` G1 fix 가 *우리 인프라* 라면 hook / wrapper / runbook 수정 commit
  포함. *agent 행동* 이라면 G2 의 메시지가 agent 학습을 돕는다는 점을 contract
  에 명시 (별도 코드 변경 없음).

### G2 — `git reset --hard` case dispatch

- `AC-400-03` `git reset --hard FETCH_HEAD` → exit 1 + stderr 에 기존 4-step
  recovery + memory pointer (sprint-389 의 AC-389-02 회귀 유지).
- `AC-400-04` `git reset --hard origin/main` → exit 1 + stderr 에 "remote ref
  reset → 본인 commit wipe 위험" 명시 + 4-step recovery.
- `AC-400-05` `git reset --hard HEAD~1` → exit 1 + stderr 에 "HEAD~N relative
  ref reset → 직전 commit wipe" 명시 + 회복 옵션 (`git reset --soft HEAD~1`).
- `AC-400-06` `git reset --hard <40-hex-sha-existing-in-reflog>` → exit 1 +
  stderr 에 **"복구 case 로 추정, 사용자 명시 승인 시만 진행"** 안내.
  메시지에 다음 포함:
  - SHA 가 reflog 에 발견됐다는 보고
  - "본인 commit 복구일 가능성 — 사용자 명시 승인 후 재시도" 안내
  - destructive 안내도 함께 (false-positive 가능성 인정)
- `AC-400-07` `git reset --hard <40-hex-sha-NOT-in-reflog>` → exit 1 + stderr
  에 "SHA reflog 에 없음 — 알 수 없는 ref" + destructive 안내 + 4-step recovery.
- `AC-400-08` `git reset --hard some-branch-name` → exit 1 + stderr 에 기존
  destructive 안내 (회귀 유지).

### G3 — Worktree-spawn verification

- `AC-400-09` `scripts/worktree-spawn.sh` 가 spawn 후 *생성한 worktree 안에서
  git rev-parse --show-toplevel 검증* 수행. 불일치 시 ABORT + stderr.
- `AC-400-10` `scripts/worktree-spawn.sh` 가 *stderr* 로 agent 가 첫 turn 에
  붙여넣을 검증 명령 스니펫 출력 (예: `test "$(git rev-parse --show-toplevel)"
  = "<path>" || exit 1`). path 자체는 stdout (단일 라인) 에 출력하여 caller 가
  capture 할 수 있도록 stream 분리.
- `AC-400-11` `memory/runbook/worktree/memory.md` 에 "첫 turn 검증" 절 추가.
  worktree path mismatch 시 abort 책임 명시.
- `AC-400-12` `memory/runbook/worktree/memory.md` ≤ 200줄 cap 유지.

### 회귀 가드 + 인프라

- `AC-400-13` `bash scripts/hooks/test-check-dangerous-bash.sh` exit 0
  (sprint-389 의 7 case + 본 sprint 의 5 case = 12 case all PASS).
- `AC-400-14` `bash scripts/check-memory-structure.sh` exit 0.
- `AC-400-15` `pnpm tsc --noEmit` 0 error.
- `AC-400-16` `pnpm lint` 0 error.
- `AC-400-17` `pnpm vitest run` PASS (baseline; 본 sprint 는 TS 코드 0).
- `AC-400-18` `git log --oneline` 에 sprint-400 commit 존재.

## Design Bar / Quality Bar

- **TDD 적용** — D5 의 5 신규 case 를 RED 먼저 작성, D2 + D3 로 GREEN.
- **case dispatch 의 elegant 함** — `case "$target" in ... esac` 패턴으로
  분기 가독성 확보. 정규식 분기는 ERE 한 줄 안에서 처리.
- **메시지 명확성** — 4 case 의 메시지는 *case-specific* 정보 포함 (어떤 ref
  로 가는지, 어떤 commit 이 위험한지) — agent 가 "어 이거 내 commit 인가" 판단
  가능.
- **Platform-neutral** — `git rev-parse --verify <sha>` + `git reflog --format="%H"
  | grep -F` 만 사용. GNU-only flag 금지.
- **사용자 인터럽트 가능성** — PR 단계까지 가서 사용자 리뷰 후 머지. 자동 머지
  금지 (사용자 2026-05-17 lock).

## Verification Plan

### Required Checks

1. `bash scripts/hooks/test-check-dangerous-bash.sh` — 12 case GREEN.
2. `bash scripts/check-memory-structure.sh`
3. `wc -l memory/runbook/worktree/memory.md` ≤ 200.
4. `pnpm tsc --noEmit`
5. `pnpm lint`
6. `pnpm vitest run`

### Required Evidence

- Smoke test 12 case PASS 출력.
- memory.md 줄수 cap 통과.
- tsc / lint / vitest clean.
- worktree-spawn.sh 의 path 검증 manual run 결과 (positive + negative).
- PR URL.

## G1 Findings (read-only investigation)

### `lefthook.yml` 명령 audit

- `pre-commit` (parallel): `cargo fmt --check` / `cargo clippy` / `cargo
  llvm-cov` / `cargo pg-test` / `cargo mongo-test` / `prettier --write` /
  `eslint --fix` / `tsc --noEmit` / secret-grep. **`git fetch` / `git reset` /
  `git pull` 호출 0건**.
- `pre-push` (piped): `tsc --noEmit` / `npm run lint` / `cargo check` / `cargo
  deny check` / `cargo machete` / `cargo llvm-cov --test ...` / `npm run test`.
  **`git fetch` / `git reset` / `git pull` 호출 0건**.
- `commit-msg`: conventional commit regex 검증만. git 호출 0건.

### `.githooks/*` wrapper audit

- 세 파일 (`pre-commit`, `pre-push`, `commit-msg`) 모두 `exec lefthook run
  <stage> --no-auto-install "$@"` 한 줄 핵심. lefthook 위임 외 git 명령 0건.
- `core.hooksPath = .githooks` 는 `.git/config` (common-dir, worktree 공유)
  에 설정. 모든 worktree 가 같은 `.githooks/` (working tree 의 그 파일) 호출.

### Worktree reflog audit

- `/Users/felix/Desktop/study/view-table/.git/worktrees/sprint-{391,400,401}/logs/HEAD`
  모두 spawn 시점의 `reset: moving to HEAD` 1 줄 (no-op self-reset, worktree
  무결성 확인용) 만 존재. **`reset: moving to FETCH_HEAD` 0건**.
- main 의 `.git/logs/HEAD` 도 `reset: moving to FETCH_HEAD` 0건. `reset:
  moving to origin/main` 은 2 건 발견 (HEAD@{494}, HEAD@{529}) — 둘 다 본
  hook 도입 *이전* 시점.

### 가설

- sprint-389 / 390 / 385 의 agent 보고 "push 후 local HEAD 가 FETCH_HEAD
  로 reset" 패턴의 *source* 는 **git core 동작이 아니라 agent self-action**
  (push reject 후 agent 가 `git reset --hard FETCH_HEAD` 를 *의도* 한 흔적).
  hook 의 block 메시지가 그 의도를 *실행 전* 에 끊는 것이 sprint-389 의 정확한
  해결책이었음.
- 본 sprint 의 G2 case-dispatch 가 **agent 학습 효과** — agent 가 reset --hard
  를 시도할 때마다 *어떤 case 인지* + *어떤 회복 옵션이 있는지* 를 inline 으로
  학습 → 같은 case 재발 줄임.

### G1 결론

- **Fix 가 우리 인프라에 있지 않음** — git core 도 lefthook 도 reset --hard
  FETCH_HEAD 를 호출하지 않는다. 과거 sprint 보고는 *agent 가 push reject 응급
  처치로 실행하려 했던 명령* 을 의미한 것 → sprint-389 의 block hook 이 이미
  정답이었다.
- **G2 가 G1 의 educational 후속 작업** — agent 가 "복구 case" 와 "destructive
  case" 를 구분 학습.

## Test Requirements

- Vitest 신규 0 (코드 변경 0). 기존 baseline 통과 확인만.
- Hook 자체 동작은 `scripts/hooks/test-check-dangerous-bash.sh` 가 fixture.
  본 sprint 가 5 case 추가.

## Ownership

- Generator: TDD agent (본 세션).
- Write scope: D1-D5 의 5 deliverable.
- Merge order: 사용자 리뷰 통과 후 squash merge.

## Exit Criteria

- Open P1/P2: 0
- AC 18/18 PASS
- 사용자 PR 리뷰 통과
