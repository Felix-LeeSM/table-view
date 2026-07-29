#!/usr/bin/env bash
# worktree-cleanup.sh — 완료된 worktree 제거. branch 는 보존 (PR 머지 후 자동 삭제).
#
# 사용:
#   bash scripts/worktree-cleanup.sh <branch-name>   # 특정 worktree 만
#   bash scripts/worktree-cleanup.sh --merged        # PR 이 머지된 clean worktree 전부
#   bash scripts/worktree-cleanup.sh --prune         # 사라진 worktree 메타데이터 정리

set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  cat <<EOF
worktree-cleanup.sh — multi-agent worktree 정리

사용:
  bash scripts/worktree-cleanup.sh <branch-name>   # 특정 branch worktree 제거
  bash scripts/worktree-cleanup.sh --merged        # PR 머지된 clean worktree 모두 제거
  bash scripts/worktree-cleanup.sh --prune         # stale 메타데이터만 정리

동작:
  - worktree 디렉토리 제거 (git worktree remove)
  - dirty worktree 는 제거하지 않고 실패로 보고
  - branch 는 보존 (PR 머지 시 'gh pr merge --delete-branch' 가 처리)
  - --merged 는 머지 여부를 PR 상태로 판정한다 (gh 필요). 이 저장소는 squash
    머지라 브랜치 커밋이 main 의 조상이 되지 않는다
  - --prune 은 디스크에서 사라진 worktree 의 git 메타데이터 정리
  - --merged / --prune 은 worktrees/ 아래의 고아 디렉토리를 보고만 한다 (삭제 X)

환경변수:
  WORKTREE_CLEANUP_PR_MERGED_CMD  PR 머지 조회 명령 교체 (인자: branch,
                                  stdout: 머지된 PR 개수). 테스트가 네트워크를
                                  타지 않게 하는 주입 지점

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

# 머지 판정 (#1932). 이 저장소는 squash 머지를 쓴다 — squash 는 브랜치 커밋을
# main 의 조상으로 만들지 않으므로 `git for-each-ref --merged origin/main` 은
# 문법이 맞아도 영원히 0건이다. 2026-07-29 실측: 머지 완료 PR 의 worktree 5개
# (126G) 를 한 건도 못 잡았다. 그래서 판정 근거를 PR 상태로 옮긴다.
#
# 조회 명령을 갈아끼울 수 있게 둔 이유는 하나다: 테스트가 네트워크나 gh 로그인을
# 요구하면 안 된다. scripts/test-worktree-cleanup.sh 가 이 훅으로 stub 을 넣는다.
pr_merged_count() {
  if [ -n "${WORKTREE_CLEANUP_PR_MERGED_CMD:-}" ]; then
    "$WORKTREE_CLEANUP_PR_MERGED_CMD" "$1"
  else
    gh pr list --head "$1" --state merged --json number --jq 'length'
  fi
}

# git-worktree(1): main worktree 가 항상 첫 항목, 그 뒤가 linked worktree.
# 경로에 공백이 있어도 깨지지 않게 $2 대신 substr 로 자른다.
list_linked_worktrees() {
  git worktree list --porcelain | awk '
    /^worktree / { path = substr($0, 10); n++ }
    /^branch refs\/heads\// { if (n > 1) print path "\t" substr($0, 19) }
  '
}

# worktrees/ 아래에 있는데 git 이 모르는 디렉토리를 보고만 한다. 자동 삭제 금지 —
# 2026-07-29 실측에서 worktrees/feat__redis-type-showcase/.git 이 저장소 이름이
# 바뀌기 전 경로를 가리키고 있었다. 그런 디렉토리는 git 명령이 아예 안 먹고
# `git worktree list` 에도 안 나오며, 다른 저장소를 가리키고 있을 수도 있다.
# --prune 은 반대 방향 (메타데이터는 있고 디렉토리가 없음) 만 처리한다.
report_orphan_dirs() {
  local base="$REPO_ROOT/worktrees" registered dir resolved
  [ -d "$base" ] || return 0
  registered="$(git worktree list --porcelain | sed -n 's/^worktree //p')"
  for dir in "$base"/*/; do
    [ -d "$dir" ] || continue
    resolved="$(cd "$dir" && pwd -P)"
    if ! printf '%s\n' "$registered" | grep -qxF -- "$resolved"; then
      echo "ORPHAN: $resolved is not a registered worktree (not removed)" >&2
    fi
  done
}

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

remove_worktree_for_branch() {
  local branch="$1"
  local sanitized="${branch//\//__}"
  local path="$REPO_ROOT/worktrees/${sanitized}"

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

if [ "$ARG" = "--prune" ]; then
  git worktree prune -v
  report_orphan_dirs
  exit 0
fi

if [ "$ARG" = "--merged" ]; then
  rc=0
  # 등록된 worktree 를 먼저 확정하고 순회한다 (순회 중 제거하므로).
  worktrees="$(list_linked_worktrees)"
  while IFS=$'\t' read -r path branch; do
    [ -n "$branch" ] || continue
    if ! count="$(pr_merged_count "$branch" 2>&1)"; then
      # 조회 실패를 삼키면 "정리할 게 없다" 와 구분이 안 된다 — 그게 #1932 다.
      echo "WARN: PR state lookup failed for $branch: $count" >&2
      rc=1
      continue
    fi
    [ "${count:-0}" -gt 0 ] 2>/dev/null || continue
    remove_worktree_path "$path" "$branch" || rc=1
  done < <(printf '%s\n' "$worktrees")
  report_orphan_dirs
  exit "$rc"
else
  remove_worktree_for_branch "$ARG"
fi
