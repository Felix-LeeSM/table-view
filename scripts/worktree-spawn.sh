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
  - .claude/worktrees/<sanitized>/ 에 worktree 추가 (sanitized = branch 의 / → __)
  - 해당 worktree 에서 lefthook install
  - stdout 에 worktree 경로 출력

.claude/worktrees/ 는 .gitignore 처리되어 있음.

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
# .claude/worktrees/ 는 .gitignore 처리. Tailwind v4 source-scanner 가 sibling
# 경로로 walking 하지 않도록 sprint-386 이전부터 ignored.
WORKTREE_PATH="$REPO_ROOT/.claude/worktrees/${SANITIZED}"

mkdir -p "$REPO_ROOT/.claude/worktrees"

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

echo "$WORKTREE_PATH"
