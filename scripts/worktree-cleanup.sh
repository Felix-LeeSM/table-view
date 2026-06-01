#!/usr/bin/env bash
# worktree-cleanup.sh — 완료된 worktree 제거. branch 는 보존 (PR 머지 후 자동 삭제).
#
# 사용:
#   bash scripts/worktree-cleanup.sh <branch-name>   # 특정 worktree 만
#   bash scripts/worktree-cleanup.sh --merged        # main 에 머지된 clean worktree 전부
#   bash scripts/worktree-cleanup.sh --prune         # 사라진 worktree 메타데이터 정리

set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  cat <<EOF
worktree-cleanup.sh — multi-agent worktree 정리

사용:
  bash scripts/worktree-cleanup.sh <branch-name>   # 특정 branch worktree 제거
  bash scripts/worktree-cleanup.sh --merged        # main 머지된 clean worktree 모두 제거
  bash scripts/worktree-cleanup.sh --prune         # stale 메타데이터만 정리

동작:
  - worktree 디렉토리 제거 (git worktree remove)
  - dirty worktree 는 제거하지 않고 실패로 보고
  - branch 는 보존 (PR 머지 시 'gh pr merge --delete-branch' 가 처리)
  - --prune 은 디스크에서 사라진 worktree 의 git 메타데이터 정리

관련: memory/runbook/worktree/memory.md
EOF
  exit 0
fi

ARG="${1:-}"

if [ -z "$ARG" ]; then
  echo "ERROR: branch name or --merged / --prune required. See --help." >&2
  exit 1
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"

if [ "$ARG" = "--prune" ]; then
  git worktree prune -v
  exit 0
fi

remove_worktree_for_branch() {
  local branch="$1"
  local sanitized="${branch//\//__}"
  local path="$REPO_ROOT/worktrees/${sanitized}"

  remove_worktree_path() {
    local target_path="$1"
    local target_branch="$2"
    local status

    status="$(git -C "$target_path" status --porcelain --untracked-files=normal)"
    if [ -n "$status" ]; then
      echo "SKIP: dirty worktree not removed: $target_path ($target_branch)" >&2
      echo "$status" | sed 's/^/  /' >&2
      return 2
    fi

    local output
    if ! output="$(git worktree remove "$target_path" 2>&1)"; then
      [ -n "$output" ] && echo "$output" >&2
      return 1
    fi
    [ -n "$output" ] && echo "$output"
    echo "removed: $target_path"
  }

  if [ -d "$path" ]; then
    remove_worktree_path "$path" "$branch"
  else
    # 경로 못 찾으면 worktree list 에서 그 branch 가리키는 path 찾기
    local found
    found="$(git worktree list --porcelain | awk -v b="$branch" '
      /^worktree / {p=$2}
      /^branch refs\/heads\// {if ($2 == "refs/heads/" b) print p}
    ')"
    if [ -n "$found" ]; then
      remove_worktree_path "$found" "$branch"
    else
      echo "WARN: no worktree found for branch $branch" >&2
    fi
  fi
}

if [ "$ARG" = "--merged" ]; then
  git fetch --quiet origin main 2>/dev/null || true
  rc=0
  # main 에 머지된 branch 들 (main 자체 제외). `git branch` 출력은 다른
  # worktree 에서 checkout 된 branch 앞에 `+` marker 를 붙이므로 ref API 를 쓴다.
  for branch in $(git for-each-ref --merged origin/main --format='%(refname:short)' refs/heads 2>/dev/null | grep -v '^main$' || true); do
    remove_worktree_for_branch "$branch" || rc=1
  done
  exit "$rc"
else
  remove_worktree_for_branch "$ARG"
fi
