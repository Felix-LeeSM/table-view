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
  - --merged 는 머지 여부를 PR 상태로 판정한다 (gh 필요). 브랜치 tip 이 머지된
    PR 의 head 에 포함될 때만 제거 — 이름만 같거나 머지 후 커밋이 더 붙은
    브랜치는 건드리지 않는다
  - 판정 불가 (조회 실패 / 알 수 없는 응답) 는 조용히 넘기지 않고 WARN + 비정상
    종료. 명령이 무엇을 했는지 마지막에 한 줄로 요약한다
  - 제거 대상의 gitignore 된 로컬 파일은 디렉토리와 함께 사라진다. 지우기 전에
    목록을 NOTE 로 출력한다 (백업하지 않는다 — issue #1948)
  - --prune 은 디스크에서 사라진 worktree 의 git 메타데이터 정리
  - --merged / --prune 은 worktree 루트 아래의 고아 디렉토리를 보고만 한다 (삭제 X)

환경변수:
  WORKTREE_CLEANUP_PR_MERGED_CMD  머지된 PR 의 head OID 조회 명령 교체
                                  (인자: branch, stdout: OID 0~n 줄).
                                  테스트가 네트워크를 안 타게 하는 주입 지점

관련: memory/runbook/worktree/memory.md
EOF
  exit 0
fi

ARG="${1:-}"

if [ -z "$ARG" ]; then
  echo "ERROR: branch name or --merged / --prune required. See --help." >&2
  exit 1
fi

# linked worktree 안에서 실행돼도 대상 경로는 main worktree 기준이어야 한다.
# `--show-toplevel` 은 "지금 서 있는" worktree 라, linked worktree 에서 돌리면
# 고아 스캔이 없는 디렉토리를 보고 스윕이 조용히 잘렸다.
MAIN_ROOT="$(cd "$(git rev-parse --path-format=absolute --git-common-dir)/.." && pwd -P)"
INVOKED_FROM="$(pwd -P)"
# 자기가 서 있는 디렉토리가 사라지면 이후 모든 git 호출이 getcwd 에러를 뱉고
# 그 에러가 조회 결과에 섞인다. main worktree 에 서서 일한다.
cd "$MAIN_ROOT"

LOOKUP_ERR="$(mktemp "${TMPDIR:-/tmp}/worktree-cleanup-lookup.XXXXXX")"
trap 'rm -f "$LOOKUP_ERR"' EXIT

# 머지된 PR 의 head OID 를 한 줄에 하나씩. 없으면 빈 출력.
#
# 조회 명령을 갈아끼울 수 있게 둔 이유는 하나다: 테스트가 네트워크나 gh 로그인을
# 요구하면 안 된다. scripts/test-worktree-cleanup.sh 가 이 훅으로 stub 을 넣는다.
pr_merged_head_oids() {
  if [ -n "${WORKTREE_CLEANUP_PR_MERGED_CMD:-}" ]; then
    "$WORKTREE_CLEANUP_PR_MERGED_CMD" "$1"
  else
    gh pr list --head "$1" --state merged --json headRefOid --jq '.[].headRefOid'
  fi
}

# 0 = 머지됨, 1 = 아님, 2 = 판정 불가 (사유는 이 함수가 직접 출력).
#
# 판정 근거 (#1932). 조상 관계는 머지 여부와 **무관하다** — 양쪽으로 틀린다.
#   - squash 머지된 브랜치는 main 의 조상이 아니다 → 머지된 걸 못 잡는다.
#   - 방금 spawn 한 브랜치는 origin/main 에 앉아 있어 자명하게 조상이다 →
#     머지된 PR 이 0건인 살아 있는 worktree 를 삭제 대상으로 집는다.
# 2026-07-29 실측: `git for-each-ref --merged origin/main` 이 32건을 나열했고
# 그중 둘이 머지된 PR 0건인 활성 worktree 였다. dirty 검사가 없었으면 지웠다.
#
# 이름이 아니라 커밋을 본다. `gh pr list --head` 는 브랜치 *이름* 으로 찾으므로
# 한 번 참이면 영원히 참인 단조 술어다 — 이름 재사용 2건, 머지 뒤 커밋이 더 붙은
# 브랜치 1건이 실측으로 있었다. tip 이 머지된 head 에 포함될 때만 머지로 본다.
branch_merge_state() {
  local branch="$1" oids tip oid
  if ! oids="$(pr_merged_head_oids "$branch" 2>"$LOOKUP_ERR")"; then
    echo "WARN: PR state lookup failed for $branch: $(tr '\n' ' ' <"$LOOKUP_ERR")" >&2
    return 2
  fi
  [ -n "$oids" ] || return 1

  tip="$(git rev-parse --verify -q "refs/heads/$branch" || true)"
  if [ -z "$tip" ]; then
    echo "WARN: $branch has no local ref to compare against its merged PR head" >&2
    return 2
  fi

  while IFS= read -r oid; do
    [ -n "$oid" ] || continue
    # 못 쓰는 값을 조용히 "미머지" 로 강등하지 않는다. 그 조용함이 #1932 다.
    case "$oid" in *[!0-9a-fA-F]*) oid="" ;; esac
    if [ -z "$oid" ] || { [ "${#oid}" -ne 40 ] && [ "${#oid}" -ne 64 ]; }; then
      echo "WARN: PR lookup for $branch answered something that is not a commit id" >&2
      return 2
    fi
    if ! git cat-file -e "$oid^{commit}" 2>/dev/null; then
      echo "WARN: merged PR head $oid for $branch is not in this repository (fork?)" >&2
      return 2
    fi
    git merge-base --is-ancestor "$tip" "$oid" && return 0
  done <<<"$oids"

  echo "SKIP: $branch has a merged PR but its tip ${tip:0:12} is not in it — name reused, or commits added after the merge" >&2
  return 1
}

# worktree 목록 (main worktree 포함). 제거 거부는 실제 제거 지점 한 곳에서만 한다
# — 호출자마다 가드를 두면 하나가 빠져도 안 보인다.
# 경로에 공백이 있어도 깨지지 않게 $2 대신 substr 로 자른다.
list_worktrees() {
  git worktree list --porcelain | awk '
    /^worktree / { path = substr($0, 10) }
    /^branch refs\/heads\// { print path "\t" substr($0, 19) }
  '
}

# worktree 루트 아래에 있는데 git 이 모르는 디렉토리를 보고만 한다. 자동 삭제
# 금지 — 2026-07-29 실측에서 어떤 worktree 의 `.git` 이 저장소 이름이 바뀌기 전
# 경로를 가리키고 있었다. 그런 디렉토리는 git 명령이 아예 안 먹고
# `git worktree list` 에도 안 나오며, 다른 저장소를 가리키고 있을 수도 있다.
# --prune 은 반대 방향 (메타데이터는 있고 디렉토리가 없음) 만 처리한다.
report_orphan_dirs() {
  local base="$MAIN_ROOT/worktrees" registered dir resolved
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

# 0 = 제거, 1 = 제거 실패, 2 = dirty, 3 = 제거 거부 (main worktree / 상태 불명).
remove_worktree_path() {
  local target_path="$1" target_branch="$2" status dirty ignored output

  if [ "$target_path" = "$MAIN_ROOT" ]; then
    echo "REFUSE: not removing the main worktree: $target_path" >&2
    return 3
  fi

  # 서 있는 자리를 지우면 이후 git 호출이 전부 getcwd 에러를 뱉고 스윕이 조용히
  # 잘린다. 두 진입점 (--merged / 단일 branch) 이 모두 여기를 지나므로 가드도
  # 여기 하나만 둔다.
  case "$INVOKED_FROM/" in
    "$target_path"/*)
      echo "REFUSE: not removing the worktree this command runs from: $target_path" >&2
      return 3
      ;;
  esac

  # status 가 실패하면 clean 인지 알 수 없다. 알 수 없으면 지우지 않는다.
  if ! status="$(git -C "$target_path" status --porcelain --untracked-files=normal --ignored=traditional 2>&1)"; then
    echo "REFUSE: cannot read worktree state, not removing: $target_path ($target_branch)" >&2
    printf '%s\n' "$status" | sed 's/^/  /' >&2
    return 3
  fi

  dirty="$(printf '%s' "$status" | awk 'NF && $0 !~ /^!! /')"
  if [ -n "$dirty" ]; then
    echo "SKIP: dirty worktree not removed: $target_path ($target_branch)" >&2
    printf '%s\n' "$dirty" | sed 's/^/  /' >&2
    return 2
  fi

  # 커밋된 작업은 branch 에 남지만 gitignore 된 로컬 상태 (환경변수 파일, 로컬
  # 설정) 는 디렉토리와 함께 사라진다. 백업하지 않고 목록만 알린다 — 정책 결정은
  # issue #1948.
  ignored="$(printf '%s' "$status" | awk '/^!! /')"
  if [ -n "$ignored" ]; then
    echo "NOTE: ignored local files are deleted with this worktree: $target_path" >&2
    printf '%s\n' "$ignored" | sed 's/^/  /' >&2
  fi

  # --force 를 붙이지 않는다. git 2.50.1 실측: plain remove 는 수정/untracked
  # 파일이 있는 worktree 를 거부하고 (rc=128) --force 는 지운다 (rc=0). 위 dirty
  # 검사가 언젠가 회귀해도 그 거부가 마지막 방어선이다.
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
  local path="$MAIN_ROOT/worktrees/${sanitized}"

  if [ -d "$path" ]; then
    remove_worktree_path "$path" "$branch"
  else
    # 경로 못 찾으면 worktree list 에서 그 branch 가리키는 path 찾기
    local found
    found="$(list_worktrees | awk -F'\t' -v b="$branch" '$2 == b {print $1}')"
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
  scanned=0
  removed=0
  # 순회 중 제거하므로 목록을 먼저 확정한다.
  worktrees="$(list_worktrees)"
  while IFS=$'\t' read -r path branch; do
    [ -n "$branch" ] || continue
    scanned=$((scanned + 1))
    state=0
    branch_merge_state "$branch" || state=$?
    if [ "$state" != 0 ]; then
      [ "$state" = 2 ] && rc=1
      continue
    fi
    if remove_worktree_path "$path" "$branch"; then
      removed=$((removed + 1))
    else
      rc=1
    fi
  done <<<"$worktrees"
  report_orphan_dirs
  # 아무것도 안 지웠을 때도 반드시 한 줄은 나온다. 조용한 0건이 이 버그였다.
  echo "scanned $scanned worktree(s): removed $removed, kept $((scanned - removed))" >&2
  exit "$rc"
else
  remove_worktree_for_branch "$ARG"
fi
