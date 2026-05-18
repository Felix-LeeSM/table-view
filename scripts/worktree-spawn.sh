#!/usr/bin/env bash
# worktree-spawn.sh — 새 git worktree + branch 생성. 다중 agent 병렬 작업용.
#
# 사용:
#   bash scripts/worktree-spawn.sh <branch-name> [base-branch]
#
# 동작:
#   - <branch-name> 이름의 새 branch 생성 (base 는 default main)
#   - ../<repo-name>--<sanitized-branch>/ 에 worktree 추가
#   - 해당 worktree 에서 lefthook install 실행 (hook 활성화)
#   - 생성된 worktree 경로 출력 (agent 가 cd 할 path)

set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  cat <<EOF
worktree-spawn.sh — multi-agent worktree 생성

사용:
  bash scripts/worktree-spawn.sh <branch-name> [base-branch]

예시:
  bash scripts/worktree-spawn.sh sprint-388/foo            # base = main
  bash scripts/worktree-spawn.sh feature/bar develop       # base = develop

결과:
  - branch <branch-name> 신설
  - worktrees/<sanitized>/ 에 worktree 추가 (sanitized = branch 의 / → __)
  - 해당 worktree 에서 lefthook install
  - stdout 에 worktree 경로 출력

worktrees/ 는 .gitignore 처리. platform-neutral (Claude / Codex / Cursor 공통).

관련: memory/runbook/worktree/memory.md
EOF
  exit 0
fi

BRANCH="${1:-}"
BASE="${2:-main}"

if [ -z "$BRANCH" ]; then
  echo "ERROR: branch name required. See --help." >&2
  exit 1
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"
SANITIZED="${BRANCH//\//__}"
# worktrees/ 는 platform-neutral. .gitignore 처리. Claude / Codex / Cursor 모두
# 본 경로 사용. (.claude/worktrees/ 는 별개 — Claude Code sub-agent 전용.)
WORKTREE_PATH="$REPO_ROOT/worktrees/${SANITIZED}"

mkdir -p "$REPO_ROOT/worktrees"

if [ -d "$WORKTREE_PATH" ]; then
  echo "ERROR: worktree path already exists: $WORKTREE_PATH" >&2
  exit 1
fi

# Fetch latest base (가능하면)
git fetch --quiet origin "$BASE" 2>/dev/null || true

# branch 가 이미 있나? 있으면 그 branch 로 worktree, 없으면 신설.
if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
  git worktree add "$WORKTREE_PATH" "$BRANCH"
else
  git worktree add -b "$BRANCH" "$WORKTREE_PATH" "$BASE"
fi

# hook 활성화 (lefthook install 은 .git/hooks 가 worktree 별로 분리됨)
(cd "$WORKTREE_PATH" && command -v lefthook >/dev/null 2>&1 && lefthook install >/dev/null 2>&1 || true)

# Sprint 400 — spawn 직후 *생성한 worktree 안* 에서 path 검증.
# 새 worktree 의 `git rev-parse --show-toplevel` 가 기대 path 와 일치하는지
# 확인. 일치하지 않으면 git worktree metadata 가 망가졌거나 base repo 의
# 잘못된 위치로 spawn 한 경우 — 즉시 ABORT 해서 agent 가 contamination 된
# 디렉토리에서 작업하지 못하도록 한다.
ACTUAL_TOPLEVEL="$(git -C "$WORKTREE_PATH" rev-parse --show-toplevel 2>/dev/null || echo '')"
if [ "$ACTUAL_TOPLEVEL" != "$WORKTREE_PATH" ]; then
  echo "ABORT: spawn 한 worktree path 가 git toplevel 과 불일치." >&2
  echo "       expected: $WORKTREE_PATH" >&2
  echo "       actual  : $ACTUAL_TOPLEVEL" >&2
  echo "       worktree metadata 오류 가능. 'git worktree list' + 'git" >&2
  echo "       worktree repair' 로 진단." >&2
  exit 1
fi

# Path 출력 (orchestrator / agent prompt template 용).
echo "$WORKTREE_PATH"

# Sprint 400 — agent 첫 turn 검증 스니펫. agent prompt template 의 첫 단계로
# 본 스니펫을 그대로 호출하면 cross-worktree contamination 을 turn 0 에 차단.
# stderr 로 출력해서 spawn script 의 stdout (worktree path) 와 분리.
cat >&2 <<EOF

# Agent 첫 turn 검증 스니펫 (sprint-400):
test "\$(git -C "$WORKTREE_PATH" rev-parse --show-toplevel)" = "$WORKTREE_PATH" \\
  || { echo "ABORT: not in expected worktree" >&2; exit 1; }
EOF
