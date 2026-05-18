---
sprint: 389
title: git-policy active enforcement (hook educates) + agent-agnostic migration
date: 2026-05-17
owner: orchestrator
status: in_progress
---

# Sprint 389 Contract — Git Policy Active Enforcement

## Goal

`.claude/rules/git-policy.md` 가 markdown 으로만 존재하는 *수동* 룰 → hook 의
block 메시지가 *직접* 회복 sequence + memory pointer 를 stderr 로 가르치는
*능동* enforcement 로 진화. agent 가 push reject 등으로 튕겼을 때 "알아서
memory 잘 읽겠지" 대신 "Bash tool 결과에 inline 으로 instruction 이 전달된다"
보장.

사용자 2026-05-17 lock:

> "최소한 튕겼을 때, 이렇게 해야 한다는 instruction 이 전달됨을 보장해야 하는데,
> 지금은 알아서 memory 를 잘 읽겠지 에 그치니까."

## Scope

### In scope

1. **D1 — Hook block message 향상** (`scripts/hooks/check-dangerous-bash.sh`)
   - 패턴별 tailored 메시지 dispatch.
   - `git reset --hard` 차단 시 4-step recovery sequence + memory pointer 출력.
   - `--no-verify` / `LEFTHOOK=0` 차단 시 "hook 실패 근본 fix 가 정답" + memory pointer.
   - 나머지 패턴 (rm -rf, DROP DATABASE, dd, mkfs) 은 기존 generic 메시지 유지.
2. **D2 — `gh pr close` 경고** — `--delete-branch` 없는 호출 감지 시
   stderr WARNING + exit 0 (block 아님). stale ref 가 재 spawn 시
   non-fast-forward push reject 의 원인임을 명시.
3. **D3 — `memory/workflow/git-policy/memory.md` 확장**
   - **NEW**: Push reject 응급 처치 (4-step).
   - **NEW**: PR close cleanup (`--delete-branch` 의무화).
   - **NEW**: SHA refspec push 패턴 (race fix, zsh `:r` trap).
   - 200줄 cap 안에서 작성. 초과 시 sub-room 분할.
   - **AGENTS.md**: "git / PR / push reject" 매트릭스 행 추가.
4. **D4 — Smoke test** (`scripts/hooks/test-check-dangerous-bash.sh`)
   - case 1: `git reset --hard FETCH_HEAD` → exit 1 + stderr 4-step + memory pointer.
   - case 2: `gh pr close 123` → exit 0 + stderr WARNING + `--delete-branch`.
   - case 3: `gh pr close 123 --delete-branch` → exit 0 + stderr 없음.
   - case 4: `git log --oneline` → exit 0 + stderr 없음.
   - 회귀 가드: `rm -rf /` / `git commit --no-verify` 차단 유지.

### Out of scope (deferred)

- 의도적 우회 (변수 substitution, eval, PATH override) 차단 — sprint-387 명시.
  본 sprint 는 *부주의 방지* layer 강화만.
- Codex / Cursor 전용 wrapper 의 메시지 localization.
- lefthook 의 hook self-test 자동 트리거 — 수동 실행으로 충분 (contract 명시).

## Invariants

- 기존 dangerous pattern 0 개 제거. ADD only.
- 기존 callers (lefthook / Claude Code PreToolUse / 수동) interface 변경 0 —
  exit code semantics 보존 (block = 1, warn / allow = 0).
- Platform-neutral 보존 — bash 만, no zsh-ism, no GNU-only flag.
- `memory/` 트리는 여전히 `memory.md` 만, 200줄 cap.

## Acceptance Criteria

- `AC-389-01` `scripts/hooks/check-dangerous-bash.sh` 의 `block()` (또는 동등
  dispatch) 에 pattern→tailored message 매핑 존재.
- `AC-389-02` `bash scripts/hooks/check-dangerous-bash.sh` 에 stdin
  `{"tool_input":{"command":"git reset --hard FETCH_HEAD"}}` 전달 시
  exit 1 + stderr 에 모두 포함:
  - `git ls-remote origin`
  - `gh api -X DELETE`
  - `git pull --rebase`
  - `memory/workflow/git-policy/memory.md`
- `AC-389-03` `bash scripts/hooks/check-dangerous-bash.sh` 에 stdin
  `{"tool_input":{"command":"gh pr close 123"}}` 전달 시 exit 0 + stderr 에
  `WARNING` + `--delete-branch` + `memory/workflow/git-policy/memory.md`.
- `AC-389-04` `bash scripts/hooks/check-dangerous-bash.sh` 에 stdin
  `{"tool_input":{"command":"gh pr close 123 --delete-branch"}}` 전달 시
  exit 0, stderr 빈 문자열.
- `AC-389-05` `bash scripts/hooks/check-dangerous-bash.sh` 에 stdin
  `{"tool_input":{"command":"git log --oneline"}}` 전달 시 exit 0, stderr 빈.
- `AC-389-06` `bash scripts/hooks/check-dangerous-bash.sh` 에 stdin
  `{"tool_input":{"command":"git commit --no-verify"}}` 전달 시 exit 1 +
  stderr 에 `memory/workflow/git-policy/memory.md` 포함 (회귀 가드 + 회복 안내).
- `AC-389-07` `bash scripts/hooks/check-dangerous-bash.sh` 에 stdin
  `{"tool_input":{"command":"rm -rf /tmp/foo"}}` 전달 시 — 기존 동작과 동일
  (block 또는 allow, 단 본 hook 의 패턴이 매칭하면 exit 1).
- `AC-389-08` `bash scripts/hooks/test-check-dangerous-bash.sh` exit 0 (4 case
  all green + 회귀 case PASS).
- `AC-389-09` `memory/workflow/git-policy/memory.md` ≤ 200줄, 새 3 section
  포함 (Push reject 응급 처치 / PR close cleanup / SHA refspec push).
- `AC-389-10` `AGENTS.md` 의 work-type 매트릭스에 `git / PR / push reject` 행
  존재 → `memory/workflow/git-policy/memory.md`.
- `AC-389-11` `bash scripts/check-memory-structure.sh` exit 0 (memory.md only).
- `AC-389-12` `pnpm vitest run` PASS (baseline; 본 sprint 는 TS 코드 0).
- `AC-389-13` `pnpm tsc --noEmit` 0 error.
- `AC-389-14` `pnpm lint` 0 error.
- `AC-389-15` `git log --oneline` 에 sprint-389 commit 존재.

## Design Bar / Quality Bar

- **TDD 적용** — D4 (smoke test) RED 먼저, D1/D2 로 GREEN.
- **삭제 우선** — 새 패턴 추가 시 lookup table 의 elegant 함을 유지. 기존
  block() 의 fallback 경로 보존.
- **Caveman 톤** — 메시지는 짧고 정확. 5+ 줄 메시지는 indent 로 가독성 확보.
- **사용자 인터럽트 가능성** — PR 단계까지 가서 사용자 리뷰 후 머지. 자동
  머지 금지.

## Verification Plan

### Required Checks

1. `bash scripts/hooks/test-check-dangerous-bash.sh` — 4 + 회귀 case GREEN.
2. `bash scripts/check-memory-structure.sh`
3. `wc -l memory/workflow/git-policy/memory.md` ≤ 200.
4. `pnpm tsc --noEmit`
5. `pnpm lint`
6. `pnpm vitest run`

### Required Evidence

- Smoke test 4 case + 회귀 case PASS 출력.
- memory.md 줄수 cap 통과.
- tsc / lint / vitest clean.
- PR URL.

## Test Requirements

- Vitest 신규 0 (코드 변경 0). 기존 baseline 통과 확인만.
- Hook 자체 동작은 `scripts/hooks/test-check-dangerous-bash.sh` 가 fixture.

## Ownership

- Generator: TDD agent (본 세션).
- Write scope: D1-D4 의 4 deliverable.
- Merge order: 사용자 리뷰 통과 후 squash merge.

## Exit Criteria

- Open P1/P2: 0
- AC 15/15 PASS
- 사용자 PR 리뷰 통과
