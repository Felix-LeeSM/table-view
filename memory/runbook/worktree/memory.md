---
title: Multi-agent worktree
type: runbook
updated: 2026-06-12
task: worktree, multi-agent, parallel, spawn-verify, agent-hard-rule
---

# Multi-agent worktree

다중 brain (Claude Code / Codex / Cursor) 또는 다중 agent 가 동일 repo 에서
병렬 작업할 때 worktree 로 인스턴스 격리. 각 worktree 는 독립 디렉토리 +
독립 branch + 독립 git hook → 충돌 없이 동시 실행.

## 소유권 / SOT

- 본 파일은 worktree 사용 시점, 격리 의미, lifecycle guardrail 을 소유한다.
- 정확한 CLI 옵션과 side effect 는 `scripts/worktree-spawn.sh`,
  `scripts/worktree-cleanup.sh`, `scripts/worktree-bootstrap-deps.sh`,
  `scripts/target-cache.sh` 의 `--help` 와 구현이 소유한다.
- commit / push / PR / merge 행동 계약은 [delivery](../../workflow/delivery/memory.md)
  가 소유한다. hook 우회 금지와 push reject 회복 정책은
  [git-policy](../../workflow/git-policy/memory.md) 가 소유한다.

## 사용 시점

- 여러 sprint 를 병렬 진행 (각 sprint = 1 worktree)
- 같은 sprint 의 다른 phase (generator / evaluator / delivery) 가 동시에
  진행해야 할 때 — 단 evaluator 는 readonly 라 일반 main worktree 에서
  spawn 해도 충돌 없음
- 사용자가 같은 repo 에서 다른 brain (예: Codex review + Claude implement)
  을 동시에 돌리고 싶을 때

## 명령

정확한 옵션과 최신 동작은 각 script 의 `--help` 를 확인한다.

```bash
# 새 worktree + branch
bash scripts/worktree-spawn.sh sprint-388/foo

# cold spawn (deps 복사 생략)
bash scripts/worktree-spawn.sh --no-deps sprint-388/foo

# src-tauri/target 전체 복사 (기본은 pruned copy)
bash scripts/worktree-spawn.sh --full-target sprint-388/foo

# 머지 끝난 worktree 정리
bash scripts/worktree-cleanup.sh sprint-388/foo

# main 머지된 worktree 일괄 정리
bash scripts/worktree-cleanup.sh --merged

# stale 메타데이터만 정리
bash scripts/worktree-cleanup.sh --prune
```

## 격리 동작

- worktree 디렉토리: `worktrees/<branch-sanitized>/` (repo 안, gitignored)
  - 예: `sprint-388/foo` → `worktrees/sprint-388__foo/`
  - `worktrees/` 는 platform-neutral — Claude Code / Codex / Cursor 어떤
    brain 이든 같은 경로. `.gitignore` 처리.
  - `.claude/worktrees/` 와 별개 — 그쪽은 Claude Code 의 sub-agent 전용
    (sprint-387 이전 부터 존재).
- git hook 은 worktree 별 `.git/worktrees/<name>/hooks/` 에 분리되어
  `lefthook install` 자동 실행
- working tree state (untracked / staged) 는 worktree 별 독립

## 의존성 warm-start

기본 spawn 은 `scripts/worktree-bootstrap-deps.sh` 를 호출해 새 worktree 의
의존성을 보정한다. node_modules 는 복사하지 않고 새 worktree lockfile 기준
`pnpm install --frozen-lockfile --prefer-offline` 로 설치한다 — pnpm store
hardlink 라 물리 디스크 추가 없이 rsync 복사보다 빠르다. `cargo fetch
--manifest-path src-tauri/Cargo.toml` 가 Rust 의존성을 보정한다.

`src-tauri/target/` warm-start 의 목적은 pre-push Rust/coverage 산출물 재사용이다.
기본은 volatile output 을 제외한 pruned copy 이며, 전체 복사는 `--full-target`
으로 명시한다. 정확한 제외 목록은 bootstrap script 가 소유한다.

수동 target cache 보충은 `scripts/target-cache.sh` 로만 한다. 이 helper 는 stale
판단 / lock / 자동 spawn 소비를 하지 않는다. routine cache lane 계약은
`scripts/hooks/test-target-cache.sh` 가 고정한다.

## 책임

- spawn: orchestrator (현재 메인 세션) 가 명시 호출. agent 가 자율로
  worktree 생성하지 않음 (사용자가 보지 못하는 디스크 공간 차지 위험).
- cleanup: PR 머지 직후 또는 sprint 종료 시. `gh pr merge --delete-branch`
  는 branch 만 삭제 — worktree 디스크는 별도 정리 필요.
- `scripts/worktree-cleanup.sh` 는 dirty worktree 를 제거하지 않고 SKIP 한다.
  dirty 는 진행 중이거나 보존 사유가 필요한 상태로 보고 먼저 확인한다.

## Primary worktree guard

primary worktree 는 orchestration-only. `memory/` 와 `AGENTS.md` 같은 agent
계약 수정, `worktrees/*` linked target 생성/수정만 허용한다. `docs/`,
`scripts/`, `.claude/`, `.codex/`, `.agents/`, app source/config/manifest 는 모두
linked worktree 에서 수정한다.

`scripts/hooks/check-edit-policy.sh` 가
`scripts/hooks/check-main-worktree-source-edit.sh` 를 호출해 Edit/Write/MultiEdit 과
obvious Bash writes(redirection, tee, sed/perl -i, cp/mv 등)를 차단한다. primary
에서 repo 파일을 바꾸려다 막히면 우회하지 말고 worktree 를 만들고 그 안에서
수정한다.

## Agent lifecycle

orchestrator 는 spawn 할 때 agent registry 를 머릿속/작업 노트에 유지:

| state | 의미 |
|---|---|
| planned | 목적 / PR / worktree / owner / 종료 조건 확정 |
| running | agent 작업 중. 같은 책임 중복 spawn 금지 |
| waiting | CI / review / 사용자 결정 대기 |
| done | 결과가 PR 또는 branch 에 반영됨 |
| closed | `close_agent` + worktree cleanup 또는 보존 사유 기록 완료 |
| abandoned | 실패/오염. push 금지, close 후 상태 기록 |

한 PR 의 write 책임자는 **delivery owner 1명**. reviewer 는 read-only.
review finding 은 새 worker 를 계속 만들지 말고 같은 delivery owner 에게
reflect/fix 로 되돌린다. 실패 worker 는 즉시 close 하고 dirty worktree 는
보존 사유를 기록하거나 사용자 승인 후 정리.

## 주의

- worktree 안에서 또 worktree spawn 하지 마. 동일 base repo 의 `.git/worktrees/`
  메타데이터가 중첩 시 추적 어려움.
- `git push --force` 같은 destructive 명령은 worktree 환경 무관하게
  `scripts/hooks/check-dangerous-bash.sh` 가 차단.

## 첫 turn 검증 (sprint-400)

다중 worktree 병렬 작업 시 *cross-worktree contamination* (다른 worktree 의
디렉토리에서 작업) 위험이 있음. sprint-381 / 380 / 385 에서 3 회 관측됨.
agent 가 첫 turn 에 반드시 worktree path 검증:

```bash
# expected_path = orchestrator 가 spawn 시 출력한 worktree path
test "$(git rev-parse --show-toplevel)" = "<expected_path>" \
  || { echo "ABORT: wrong worktree" >&2; exit 1; }
```

`scripts/worktree-spawn.sh` 가 spawn 직후 본 스니펫을 stderr 로 자동 출력 —
orchestrator 가 그대로 agent prompt 의 "MANDATORY first command" 슬롯에
삽입. 불일치 시 agent 는 **즉시 abort + 사용자 보고**. main 디렉토리에서 작업
재개 X.

### Agent hard rule — fetch/reset/pull 금지 (sprint-402)

`git fetch && git reset --hard FETCH_HEAD`, `git reset --hard
FETCH_HEAD/ORIG_HEAD/origin/*/@{u}/refs/remotes/*`, `git pull` (모든 변종)
**절대 금지**. hook (sprint-402) 이 단독 명령도 모두 block — 2 단계 분리
우회 불가능.

Push reject 시 회복 정답:

```bash
git ls-remote origin <branch>                           # 1) remote SHA 진단
git reflog                                              # 2) 직전 본인 SHA
git update-ref refs/heads/<branch> <local-sha>          # 3) ref 만 fix
SHA="$(git rev-parse HEAD)"
git push origin "$SHA":refs/heads/<branch>              # 4) SHA refspec push
```

자세히: [git-policy](../../workflow/git-policy/memory.md) — 외부 race 가짜
신호 + Push reject 응급 처치 절.

## 관련

- `scripts/worktree-spawn.sh` — 생성
- `scripts/worktree-cleanup.sh` — 정리
- [delivery](../../workflow/delivery/memory.md) — branch 머지 정책
- [git-policy](../../workflow/git-policy/memory.md) — hook 회피 금지
