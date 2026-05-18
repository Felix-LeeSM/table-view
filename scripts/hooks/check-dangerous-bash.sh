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

emit_block_message() {
  local id="$1"
  local pattern="$2"
  echo "BLOCKED: Dangerous command pattern detected ($id): $pattern" >&2
  case "$id" in
    git_reset_hard)
      cat >&2 <<EOF
git reset --hard 는 destructive — 본인 commit 을 wipe 합니다.
push reject 후 즉시 reset 으로 가는 것은 거의 항상 잘못된 응급 처치.

회복 sequence (memory/workflow/git-policy/memory.md Push reject 절 참고):
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
  local hooks_dir
  hooks_dir="$(git rev-parse --git-dir 2>/dev/null)/hooks"

  if echo "$CMD" | grep -qi -e "git commit"; then
    check_lefthook_binary
    for hook in pre-commit commit-msg; do
      if [ ! -f "$hooks_dir/$hook" ]; then
        block "git hook '$hook' is not installed. Run 'lefthook install' first."
      fi
    done
  elif echo "$CMD" | grep -qi -e "git push"; then
    check_lefthook_binary
    if [ ! -f "$hooks_dir/pre-push" ]; then
      block "git hook 'pre-push' is not installed. Run 'lefthook install' first."
    fi
  fi
}

check_dangerous_patterns
check_warn_patterns
check_git_hooks

exit 0
