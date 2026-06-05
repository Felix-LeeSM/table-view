---
title: Multi-agent worktree runbook
type: runbook
updated: 2026-06-01
task: worktree, multi-agent, parallel, spawn-verify, agent-hard-rule
---

# Multi-agent worktree

다중 brain (Claude Code / Codex / Cursor) 또는 다중 agent 가 동일 repo 에서
병렬 작업할 때 worktree 로 인스턴스 격리. 각 worktree 는 독립 디렉토리 +
독립 branch + 독립 git hook → 충돌 없이 동시 실행.

## 사용 시점

- 여러 sprint 를 병렬 진행 (각 sprint = 1 worktree)
- 같은 sprint 의 다른 phase (generator / evaluator / delivery) 가 동시에
  진행해야 할 때 — 단 evaluator 는 readonly 라 일반 main worktree 에서
  spawn 해도 충돌 없음
- 사용자가 같은 repo 에서 다른 brain (예: Codex review + Claude implement)
  을 동시에 돌리고 싶을 때

## 명령

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

기본 spawn 은 현재 worktree 의 `node_modules/` 와 pruned
`src-tauri/target/` 을 새 worktree 로 복사하고, 새 worktree 기준으로
`pnpm install --frozen-lockfile` 와 `cargo fetch --manifest-path
src-tauri/Cargo.toml` 를 실행한다. 복사는 빠른 시작용이고, install/fetch 가
branch 별 lockfile 차이를 보정한다. `--no-deps` 를 주면 의존성 복사/보정을
생략한다.

`src-tauri/target/` 기본 복사는 `llvm-cov-target/` 과 DuckDB native build
outputs 를 보존하고 `release/`, `tmp/`, `*/incremental/`, coverage raw/profile
만 제외한다. 목적은 pre-push 의 `cargo-llvm-cov` 와 DuckDB/Rust 의존성 산출물을
재사용하되 volatile coverage output 과 최종 산출물은 피하는 것. 전체 target 이
필요하면 `--full-target` 을 쓴다.

Rust hook cache 의 기준은 이 target warm-start 다. `sccache` 는 2026-06-01
로컬 실측에서 coverage gate Rust hit 0%, fresh target Rust hit 0% 로 나와
setup/hook 경로에서 제외한다.

수동 보충이 필요하면 primary 또는 이미 warm 된 checkout 에서
`bash scripts/target-cache.sh .` 또는
`bash scripts/target-cache.sh warm-all .` 로 routine Rust target cache 를 전부
데운 뒤 `bash scripts/target-cache.sh copy-to <worktree> .` 로 target cache 를
옮긴다. 기본 동작은 `cargo check` lane, debug nextest test binary lane,
`llvm-cov-target` coverage lane 을 함께 데운다. 세부 lane 만 필요하면
`--debug-only` 또는 `--coverage-only` 를 직접 실행한다. 이 helper 는 stale
판단 / lock / 자동 spawn 소비를 하지 않는다. 기존 target 을 overlay 하며 debug
target, `llvm-cov-target`, parser-core target cache 를 가져가되 tracked generated
WASM artifact 는 worktree 를 dirty 하게 만들 수 있어 제외한다.
target cache 의 주목적은 test warm-start 다. helper 변경 시 debug nextest test
binary lane 과 `llvm-cov-target` coverage test lane 이 빠지면 안 되며,
`scripts/hooks/test-target-cache.sh` 가 이 계약을 고정한다.

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
