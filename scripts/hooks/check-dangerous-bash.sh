#!/usr/bin/env bash
# check-dangerous-bash.sh — platform-neutral PreToolUse Bash hook
#
# 입력 (어떤 brain 든):
#   - env var `$COMMAND` (lefthook / CI 호환)
#   - argv `$1` (직접 호출)
#   - stdin JSON `.tool_input.command` (Claude Code 기본)
#
# 첫 번째 비어있지 않은 입력을 사용. jq 없으면 stdin JSON 입력은 무시.
#
# 동작:
#   - dangerous pattern 감지 시 exit 1 + stderr 메시지 (패턴별 tailored).
#   - warn 패턴 감지 시 exit 0 + stderr WARNING (block 아님).
#   - git commit / git push 시 lefthook 설치 + hook 파일 존재 확인.
#   - 통과 시 exit 0.
#
# Sprint 389: block / warn 메시지에 회복 sequence + memory pointer inline 출력
# → Bash tool 결과로 agent 가 직접 instruction 수신 (passive memory read 불요).
#
# 룰 source: `memory/workflow/git-policy/memory.md`.

set -euo pipefail

resolve_command() {
  if [ -n "${COMMAND:-}" ]; then
    echo "$COMMAND"
    return
  fi
  if [ -n "${1:-}" ]; then
    echo "$1"
    return
  fi
  if [ -t 0 ]; then
    echo ""
    return
  fi
  local stdin_buf
  stdin_buf="$(cat)"
  if [ -z "$stdin_buf" ]; then
    echo ""
    return
  fi
  if command -v jq >/dev/null 2>&1; then
    echo "$stdin_buf" | jq -r '.tool_input.command // .command // empty' 2>/dev/null || echo ""
  else
    # jq 없으면 raw stdin 을 그대로 (lefthook 같이 raw 명령 전달하는 caller 호환)
    echo "$stdin_buf"
  fi
}

CMD="$(resolve_command "$@")"

if [ -z "$CMD" ]; then
  exit 0
fi

# ERE 패턴. 토큰 경계 — `bash -c "git push --force"` 같이 quote / paren 으로
# 감싼 호출도 차단되도록 앞/뒤 anchor 를 [^a-zA-Z0-9_] 로 완화.
# (sprint-387 의 bash -c bypass 결함 fix — string concat / variable
# substitution / PATH override 같은 의도적 우회는 여전히 차단 불가, 본
# hook 은 부주의 방지 layer 한정.)
#
# Pattern IDs (block 메시지 dispatch key):
#   rm_destructive / sql_drop / sql_truncate / git_push_force / git_reset_hard
#   / no_verify / lefthook_env_zero / lefthook_skip / husky_zero / dd_if
#   / mkfs / dev_write
DANGEROUS_PATTERNS=(
  'rm_destructive::(^|[^a-zA-Z0-9_])rm[[:space:]]+-[rRfF]*[rR][rRfF]*[[:space:]]+(/|~|\*|\.|src|node_modules|target)([[:space:]/]|$)'
  'sql_drop::(^|[^a-zA-Z0-9_])DROP[[:space:]]+(DATABASE|TABLE)([^a-zA-Z0-9_]|$)'
  'sql_truncate::(^|[^a-zA-Z0-9_])TRUNCATE([^a-zA-Z0-9_]|$)'
  'git_push_force::(^|[^a-zA-Z0-9_])git[[:space:]]+push[[:space:]]+.*--force'
  'git_reset_hard::(^|[^a-zA-Z0-9_])git[[:space:]]+reset[[:space:]]+--hard'
  'no_verify::--no-verify([^a-zA-Z0-9_]|$)'
  'lefthook_env_zero::(^|[^a-zA-Z0-9_])LEFTHOOK=0([^a-zA-Z0-9_]|$)'
  'lefthook_skip::(^|[^a-zA-Z0-9_])LEFTHOOK_SKIP='
  'husky_zero::(^|[^a-zA-Z0-9_])HUSKY=0([^a-zA-Z0-9_]|$)'
  'dd_if::(^|[^a-zA-Z0-9_])dd[[:space:]]+if='
  'mkfs::(^|[^a-zA-Z0-9_])mkfs(\.|[[:space:]])'
  'dev_write::>[[:space:]]*/dev/(sd[a-z]|nvme[0-9]|disk[0-9])'
)

# Warn-only patterns. Exit 0 + stderr WARNING. block 아님.
# id::pattern 형식.
WARN_PATTERNS=(
  'gh_pr_close_no_delete::(^|[^a-zA-Z0-9_])gh[[:space:]]+pr[[:space:]]+close[[:space:]]'
)

MEMORY_POINTER="memory/workflow/git-policy/memory.md"

# Sprint 400 — git reset --hard <target> 의 target 별 메시지 dispatch.
#
# 4 분기:
#   1) FETCH_HEAD / origin/* — destructive remote-ref reset, 4-step recovery
#   2) HEAD~N / HEAD^N / @~N / @^N — destructive relative-ref reset,
#      `--soft` 옵션 안내 (commit 보존)
#   3) 40-hex SHA — reflog 검색 → 발견되면 *복구 case 추정* + 사용자 명시 승인
#      안내 / 미발견이면 *알 수 없는 SHA* + destructive 안내
#   4) 그 외 (branch name, tag 등) — destructive default 안내 (회귀 유지)
#
# 모든 case 에서 exit 1 (block) 은 호출자가 처리. 본 함수는 stderr 메시지만 출력.
emit_git_reset_hard_message() {
  local target="$1"
  case "$target" in
    FETCH_HEAD | origin/*)
      cat >&2 <<EOF
git reset --hard $target — destructive **remote-ref reset**.
push reject 후 즉시 reset 으로 가는 것은 거의 항상 잘못된 응급 처치 —
본인 local commit 을 wipe 하고 remote ref 로 강제 정렬합니다.

회복 sequence ($MEMORY_POINTER Push reject 절 참고):
  1) git ls-remote origin <branch>          # remote 상태부터 확인
  2) closed PR 의 stale head ref 면:
       gh api -X DELETE repos/<owner>/<repo>/git/refs/heads/<branch>
     (branch 가 PR close 시 --delete-branch 누락으로 남은 경우)
  3) legit non-fast-forward 면:
       git pull --rebase origin <branch>
  4) commit 보존하면서 ref 만 옮길 때:
       git reset --soft <sha>   또는   git stash

자세히: $MEMORY_POINTER (Push reject 절)
이 가이드를 따라도 안 풀리면 사용자 승인 요청.
EOF
      ;;
    HEAD~* | HEAD^* | @~* | @^*)
      cat >&2 <<EOF
git reset --hard $target — destructive **relative-ref reset**.
직전 N 개 commit 을 wipe 합니다. 본인이 방금 만든 commit 도 working tree
변경분과 함께 모두 사라집니다.

회복 옵션 (덜 destructive 한 순서):
  1) git reset --soft $target    # ref 만 이동, working tree + index 보존
  2) git reset $target            # ref + index 이동, working tree 보존
  3) git stash                    # working tree 변경분만 stash 로 대피
  4) git reflog                   # commit 이 정말 필요하면 reflog 로 복구 가능

destructive hard reset 이 진짜 필요하다고 판단되면 **사용자 명시 승인** 후
재시도. 자세히: $MEMORY_POINTER
EOF
      ;;
    [0-9a-fA-F]*)
      # 40-hex SHA 후보 — 길이 + hex 검증 후 reflog 조회.
      if [ "${#target}" -ge 7 ] && echo "$target" | grep -qE '^[0-9a-fA-F]+$'; then
        local sha_found="no"
        # reflog 검색 — git 명령 실패해도 (worktree 외부 호출 등) 안전하게 fallback.
        # `git reflog` 의 출력이 길면 `grep -q` 가 첫 매치에서 종료 → SIGPIPE 로
        # git 가 죽음 (exit 141). `set -o pipefail` 하에서는 그 141 가 pipeline
        # 의 exit 가 되어 false-negative. 회피: reflog output 을 한 번에 모은 뒤 grep.
        if command -v git >/dev/null 2>&1; then
          local reflog_dump
          reflog_dump="$(git reflog --all --format='%H' 2>/dev/null || true)"
          if echo "$reflog_dump" | grep -qF -- "$target"; then
            sha_found="yes"
          fi
        fi
        if [ "$sha_found" = "yes" ]; then
          cat >&2 <<EOF
git reset --hard $target — **복구 case 추정**.
target SHA 가 reflog 에 발견됨 — 본인이 과거에 만든 commit 으로 ref 를
되돌리려는 것 같습니다. 이 경우 destructive 가 아닐 수 있으나 hook 은
*모든* hard reset 을 block 으로 유지 (false-positive 가능성 인정).

진행하려면 **사용자 명시 승인** 후 재시도. 메시지에 다음을 포함해서 사용자
가 case 를 확정할 수 있게 합니다:
  - 왜 reset 이 필요한가 (예: 직전 broken merge 복구, 우발 commit 되돌리기)
  - target SHA 가 reflog 의 어떤 entry 인가
  - 더 부드러운 옵션 (\`git reset --soft $target\` / \`git checkout $target -- .\`)
    을 검토했는지

destructive 가능성도 인정:
  - reflog 가 *다른 작업* 의 부산물이고 본인 의도와 무관할 수 있음
  - --hard 는 working tree 변경분을 wipe 합니다 — 미커밋 작업이 있으면
    'git stash' 먼저

자세히: $MEMORY_POINTER (Push reject 절 + recovery)
EOF
        else
          cat >&2 <<EOF
git reset --hard $target — **알 수 없는 SHA**.
target SHA 가 reflog 에서 발견되지 않습니다. 이 SHA 가:
  - 다른 worktree / 다른 brain (Codex / Cursor) 의 reflog 라면 → 본 hook 은
    현재 worktree reflog 만 검색 → false-negative 가능
  - remote 의 SHA 라면 → 'git fetch' 후 다시 시도 / 'git ls-remote' 로 확인
  - 잘못된 SHA 라면 → 'git rev-parse --verify $target' 로 먼저 검증

destructive 위험: --hard 는 working tree + commit 을 wipe 합니다. 회복 시
sequence ($MEMORY_POINTER Push reject 절):
  1) git ls-remote origin <branch>
  2) gh api -X DELETE refs/heads/<branch>  # stale PR ref 면
  3) git pull --rebase origin <branch>     # legit non-fast-forward 면
  4) git reset --soft <sha>                # commit 보존

진행하려면 사용자 명시 승인 후 재시도. 자세히: $MEMORY_POINTER
EOF
        fi
      else
        emit_git_reset_hard_default
      fi
      ;;
    *)
      emit_git_reset_hard_default
      ;;
  esac
}

emit_git_reset_hard_default() {
  cat >&2 <<EOF
git reset --hard 는 destructive — 본인 commit 을 wipe 합니다.
push reject 후 즉시 reset 으로 가는 것은 거의 항상 잘못된 응급 처치.

회복 sequence ($MEMORY_POINTER Push reject 절 참고):
  1) git ls-remote origin <branch>          # remote 상태부터 확인
  2) closed PR 의 stale head ref 면:
       gh api -X DELETE repos/<owner>/<repo>/git/refs/heads/<branch>
     (branch 가 PR close 시 --delete-branch 누락으로 남은 경우)
  3) legit non-fast-forward 면:
       git pull --rebase origin <branch>
  4) commit 보존하면서 ref 만 옮길 때:
       git reset --soft <sha>   또는   git stash

자세히: $MEMORY_POINTER (Push reject 절)
이 가이드를 따라도 안 풀리면 사용자 승인 요청.
EOF
}

emit_block_message() {
  local id="$1"
  local pattern="$2"
  echo "BLOCKED: Dangerous command pattern detected ($id): $pattern" >&2
  case "$id" in
    git_reset_hard)
      # Sprint 400 — target argument 별 case dispatch.
      # 마지막 토큰 = `git reset --hard <target>` 의 <target>. 토큰 형식별로
      # destructive (확실 wipe) vs recovery 추정 (본인 commit 복구일 수 있음)
      # 분기. block 은 모든 case 에서 유지하되 *메시지* 가 case 를 인식.
      local target
      # shellcheck disable=SC2001
      target="$(echo "$CMD" | sed -E 's/.*git[[:space:]]+reset[[:space:]]+--hard[[:space:]]+([^[:space:]]+).*/\1/')"
      emit_git_reset_hard_message "$target"
      ;;
    no_verify | lefthook_env_zero | lefthook_skip | husky_zero)
      cat >&2 <<EOF
hook 우회 (--no-verify / LEFTHOOK=0 / LEFTHOOK_SKIP / HUSKY=0) 는 절대 금지.
pre-commit / pre-push 는 품질 + 회귀 게이트입니다.

회복: hook 실패 메시지를 읽고 *근본 원인* 을 fix.
  - 포맷 실패  → cargo fmt / npx prettier --write
  - 린트 실패  → 경고 수정 (eslint-disable 은 사유 코멘트와 함께만)
  - 테스트 실패 → 코드 수정 (테스트가 옳다면) / 테스트 수정 (옳지 않다면 +
                  ADR 또는 sprint 코멘트)
  - e2e timeout → e2e/_helpers.ts + wdio.conf.ts timeout, docker daemon 확인

자세히: $MEMORY_POINTER (Hook 실패 시 절)
예외 (사용자 명시 승인 시만): revert 백포팅, hook 자체 손상 복구.
EOF
      ;;
    git_push_force)
      cat >&2 <<EOF
git push --force 는 destructive — remote 의 commit 을 덮어씁니다.
다른 collaborator 의 작업 wipe + CI 검증 결과 무효화.

회복:
  - 일반적으로는 force 가 필요 없는 케이스. push reject 라면
    'git reset --hard' 가이드 (Push reject 절) 참고.
  - 정말 force 가 필요한 경우 (rebase 후 자기 PR branch update 등):
    --force-with-lease 사용 + 사용자 승인 후 진행.

자세히: $MEMORY_POINTER (Hook 강제 메커니즘 / 예외 절)
EOF
      ;;
    *)
      echo "If you really need this command, ask the user to approve it." >&2
      ;;
  esac
  exit 1
}

emit_warn_message() {
  local id="$1"
  case "$id" in
    gh_pr_close_no_delete)
      cat >&2 <<EOF
WARNING: gh pr close 가 --delete-branch 없이 호출됨.
Closed-PR 의 head ref 가 remote 에 stale 로 남으면, 같은 sprint 가 재 spawn
될 때 새 branch 의 SHA 가 stale ref 와 non-fast-forward 충돌 → push reject.

Prefer:
  gh pr close <N> --delete-branch --comment "<reason>"

Override (의도적으로 ref 를 남기고 싶을 때):
  명시적으로 --comment 만 추가하고 본 WARNING 을 무시 — 후속 sprint 가
  같은 branch 이름을 재사용하지 않도록 sprint 번호를 bump 한다.

자세히: $MEMORY_POINTER (PR close cleanup 절)
EOF
      ;;
    *)
      echo "WARNING: 알 수 없는 warn id ($id)" >&2
      ;;
  esac
}

block() {
  # Backward-compat fallback — 아직 id 미부여 호출자용.
  echo "BLOCKED: $1" >&2
  echo "If you really need this command, ask the user to approve it." >&2
  echo "자세히: $MEMORY_POINTER" >&2
  exit 1
}

check_dangerous_patterns() {
  for entry in "${DANGEROUS_PATTERNS[@]}"; do
    local id="${entry%%::*}"
    local pattern="${entry#*::}"
    if echo "$CMD" | grep -qiE -e "$pattern"; then
      emit_block_message "$id" "$pattern"
    fi
  done
}

check_warn_patterns() {
  for entry in "${WARN_PATTERNS[@]}"; do
    local id="${entry%%::*}"
    local pattern="${entry#*::}"
    if echo "$CMD" | grep -qiE -e "$pattern"; then
      # gh_pr_close_no_delete: --delete-branch 가 명령에 있으면 silent allow.
      if [ "$id" = "gh_pr_close_no_delete" ]; then
        if echo "$CMD" | grep -qE -- '--delete-branch([^a-zA-Z0-9_]|$)'; then
          continue
        fi
      fi
      emit_warn_message "$id"
    fi
  done
}

check_lefthook_binary() {
  if ! command -v lefthook >/dev/null 2>&1; then
    block "lefthook is not installed. Run 'pnpm install' first."
  fi
}

check_git_hooks() {
  # Sprint 400 — hooks 경로 resolve.
  # `core.hooksPath` 가 설정돼 있으면 (e.g. ".githooks" — sprint-387 setup.sh
  # 가 commit-tracked wrapper 를 활성화) 본 경로가 진짜 hook 디렉토리.
  # 그렇지 않으면 git-dir/hooks (lefthook install 의 기본 install 위치).
  # 사용자 setup.sh 가 .githooks 를 활성화하므로 worktree 마다 별도
  # `lefthook install` 이 불필요 — .githooks/ 는 working tree 의 tracked
  # 파일이라 모든 worktree 가 같은 wrapper 를 자동 공유.
  local hooks_dir
  hooks_dir="$(git config --get core.hooksPath 2>/dev/null || true)"
  if [ -z "$hooks_dir" ]; then
    hooks_dir="$(git rev-parse --git-dir 2>/dev/null)/hooks"
  elif [ "${hooks_dir#/}" = "$hooks_dir" ]; then
    # 상대 경로 — repo root 기준으로 resolve.
    local repo_root
    repo_root="$(git rev-parse --show-toplevel 2>/dev/null)"
    if [ -n "$repo_root" ]; then
      hooks_dir="$repo_root/$hooks_dir"
    fi
  fi

  if echo "$CMD" | grep -qi -e "git commit"; then
    check_lefthook_binary
    for hook in pre-commit commit-msg; do
      if [ ! -f "$hooks_dir/$hook" ]; then
        block "git hook '$hook' is not installed at $hooks_dir. Run 'bash scripts/setup.sh' first."
      fi
    done
  elif echo "$CMD" | grep -qi -e "git push"; then
    check_lefthook_binary
    if [ ! -f "$hooks_dir/pre-push" ]; then
      block "git hook 'pre-push' is not installed at $hooks_dir. Run 'bash scripts/setup.sh' first."
    fi
  fi
}

check_dangerous_patterns
check_warn_patterns
check_git_hooks

exit 0
