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

contains_local_env_file_reference() {
  local scrubbed="$CMD"
  # `.env.example` is a tracked template and may be inspected or edited.
  scrubbed="${scrubbed//.env.example/}"
  local pattern='(^|[[:space:]<>])["'\'']?(\./)?([^[:space:]"'\'';&|<>]+/)?\.env(\.[^[:space:]"'\'';&|<>]+)?(["'\'']?($|[[:space:];&|<>]))'
  echo "$scrubbed" | grep -qE "$pattern"
}

if contains_local_env_file_reference; then
  cat >&2 <<EOF
BLOCKED: Reading or editing local env files is not allowed.

Blocked patterns:
  - .env
  - .env.*

Allowed template:
  - .env.example

Use .env.example for documented defaults. Do not inspect local secret files.
EOF
  exit 1
fi

# ERE 패턴. 토큰 경계 — `bash -c "git push --force"` 같이 quote / paren 으로
# 감싼 호출도 차단되도록 앞/뒤 anchor 를 [^a-zA-Z0-9_] 로 완화.
# (sprint-387 의 bash -c bypass 결함 fix — string concat / variable
# substitution / PATH override 같은 의도적 우회는 여전히 차단 불가, 본
# hook 은 부주의 방지 layer 한정.)
#
# Pattern IDs (block 메시지 dispatch key):
#   rm_destructive / sql_drop / sql_truncate / git_push_force / git_reset_hard
#   / git_remote_ref_mutation / base64_shell_pipe / eval_cmd_subst / no_verify
#   / no_gpg_sign / gpgsign_false / gpgsign_env_key / githooks_path_override
#   / git_config_set_hooks_path / githooks_path_env_key / lefthook_env_zero
#   / lefthook_skip / husky_zero / dd_if / mkfs / dev_write / git_worktree_add
# Note: sql_drop / sql_truncate 는 이 배열이 아니라 check_sql_client_execution
# 이 세그먼트 단위로 처리한다 (issue #1029 + PR #1151 review). 배열의 다른 패턴은
# 명령 문자열 전체에 word-match 하지만, DROP/TRUNCATE 는 이 DB 클라이언트 repo 의
# 소스·커밋 메시지에 정상 등장하므로 그럴 수 없다.
DANGEROUS_PATTERNS=(
  'rm_destructive::(^|[^a-zA-Z0-9_])rm[[:space:]]+-[rRfF]*[rR][rRfF]*[[:space:]]+(/|~|\*|\.|src|node_modules|target)([[:space:]/]|$)'
  "base64_shell_pipe::(^|[^a-zA-Z0-9_])base64[[:space:]][^|;&]*(-d|--decode|-D)[^|;&]*[|][[:space:]]*[\"']?([^[:space:]|;&]*/)?[\"']?(bash|sh|zsh)[\"']?([^a-zA-Z0-9_]|$)"
  'eval_cmd_subst::(^|[^a-zA-Z0-9_])eval[[:space:]]+.*\$\('
  'git_push_force::(^|[^a-zA-Z0-9_])git[[:space:]]+push[[:space:]]+.*--force'
  'git_reset_hard::(^|[^a-zA-Z0-9_])git[[:space:]]+reset[[:space:]]+--hard'
  'git_pull::(^|[^a-zA-Z0-9_])git[[:space:]]+pull([^a-zA-Z0-9_]|$)'
  'git_remote_ref_mutation::(^|[^a-zA-Z0-9_])git[[:space:]]+(reset|checkout)[[:space:]]+(FETCH_HEAD|ORIG_HEAD|@\{u\}|origin/[^[:space:];&|]+|upstream/[^[:space:];&|]+|refs/remotes/[^[:space:];&|]+)([^a-zA-Z0-9_]|$)'
  'git_worktree_add::(^|[^a-zA-Z0-9_])git[[:space:]]+worktree[[:space:]]+add([^a-zA-Z0-9_]|$)'
  'githooks_path_override::(^|[^a-zA-Z0-9_])git[[:space:]].*-c[[:space:]]+core[.]hooksPath[[:space:]]*='
  'git_config_set_hooks_path::(^|[^a-zA-Z0-9_])git[[:space:]]+config[[:space:]]+(-[a-zA-Z0-9-]+([[:space:]]+|=)[[:space:]]*)*core[.]hooksPath[[:space:]]+[^-[:space:];&|][^[:space:];&|]*'
  'no_verify::--no-verify([^a-zA-Z0-9_]|$)'
  'no_gpg_sign::--no-gpg-sign([^a-zA-Z0-9_]|$)'
  'gpgsign_false::commit[.]gpgsign([[:space:]]*=[[:space:]]*|[[:space:]]+)false([^a-zA-Z0-9_]|$)'
  'gpgsign_env_key::GIT_CONFIG_KEY_[0-9]+=commit[.]gpgsign'
  'githooks_path_env_key::GIT_CONFIG_KEY_[0-9]+=core[.]hooksPath'
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
  'gh_pr_merge_cleanup::(^|[^a-zA-Z0-9_])gh[[:space:]]+pr[[:space:]]+merge[[:space:]]'
)

MEMORY_POINTER="memory/workflow/git-policy/memory.md"

# 회복 정답 4-step sequence — FETCH_HEAD reset / reset default / git_pull
# 3곳에서 byte-identical. reflog 기반 update-ref + SHA refspec push.
emit_reflog_recovery_steps() {
  cat >&2 <<EOF
회복 정답 ($MEMORY_POINTER 외부 race 가짜 신호 + Push reject 절):
  1) git ls-remote origin <branch>          # remote SHA 진단
  2) git reflog                              # 직전 본인 commit SHA 확인
  3) git update-ref refs/heads/<branch> <local-sha>
                                             # ref 만 본인 SHA 로 fix
  4) SHA="\$(git rev-parse HEAD)"            # SHA refspec push inline
     git push origin "\$SHA":refs/heads/<branch>
EOF
}

# Sprint 400 — git reset --hard <target> 의 target 별 메시지 dispatch.
# Sprint 402 — 2-step bypass 차단: FETCH_HEAD / ORIG_HEAD / @{u} / refs/remotes/*
# 단독 명령도 sequence 차단과 같은 layer 로 끌어올림.
#
# 5 분기:
#   1) FETCH_HEAD / ORIG_HEAD / @{u} / origin/* / refs/remotes/* —
#      destructive **remote/upstream ref reset**. agent 2-step bypass 의 진범.
#      recovery = reflog 기반 update-ref + SHA refspec push (외부 race 가짜
#      신호 절 참고).
#   2) HEAD~N / HEAD^N / @~N / @^N — destructive relative-ref reset,
#      `--soft` 옵션 안내 (commit 보존)
#   3) 40-hex SHA — reflog 검색 → 발견되면 *복구 case 추정* 안내 /
#      미발견이면 *알 수 없는 SHA* + destructive 안내
#   4) 그 외 (branch name, tag 등) — destructive default 안내 (회귀 유지)
#
# 모든 case 에서 exit 1 (block) 은 호출자가 처리. 본 함수는 stderr 메시지만 출력.
emit_git_reset_hard_message() {
  local target="$1"
  case "$target" in
    FETCH_HEAD | ORIG_HEAD | '@{u}' | origin/* | refs/remotes/*)
      cat >&2 <<EOF
git reset --hard $target — destructive **remote/upstream ref reset**.
push reject 후 즉시 reset 으로 가는 것은 거의 항상 잘못된 응급 처치 —
본인 local commit 을 wipe 하고 remote/upstream ref 로 강제 정렬합니다.

본 hook 은 sprint-402 부터 다음 단독 명령도 모두 차단 (이전엔
\`git fetch && git reset --hard FETCH_HEAD\` sequence 만 차단 → agent 가
2 단계 분리로 우회):
  - git reset --hard FETCH_HEAD
  - git reset --hard ORIG_HEAD
  - git reset --hard origin/<branch>
  - git reset --hard @{u}
  - git reset --hard refs/remotes/<...>

EOF
      emit_reflog_recovery_steps
      cat >&2 <<EOF

자세히: $MEMORY_POINTER (외부 race 가짜 신호 + Push reject 절)
이 가이드를 따라도 안 풀리면 중단하고 별도 복구 절차를 설계.
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

hard reset 으로 재시도하지 말고 soft/reset/stash/reflog 복구 절차를 선택.
자세히: $MEMORY_POINTER
EOF
      ;;
    [0-9a-fA-F]*)
      # 40-hex SHA 후보 — 길이 + hex 검증 후 reflog 조회.
      if [ "${#target}" -ge 7 ] && echo "$target" | grep -qE '^[0-9a-fA-F]+$'; then
        local sha_found="no"
        # reflog 검색 — git 명령 실패해도 (worktree 외부 호출 등) 안전하게 fallback.
        # 주의: `echo "$dump" | grep -q` 는 grep 이 첫 매치 후 종료할 때 echo 의
        # write 가 SIGPIPE → exit 141. `set -o pipefail` 하에서 pipeline 전체가
        # 실패로 평가되어 false-negative. here-string 사용 시 pipe 가 없으므로
        # SIGPIPE 자체가 발생하지 않음.
        if command -v git >/dev/null 2>&1; then
          local reflog_dump
          reflog_dump="$(git reflog --all --format='%H' 2>/dev/null || true)"
          if grep -qF -- "$target" <<<"$reflog_dump"; then
            sha_found="yes"
          fi
        fi
        if [ "$sha_found" = "yes" ]; then
          cat >&2 <<EOF
git reset --hard $target — **복구 case 추정**.
target SHA 가 reflog 에 발견됨 — 본인이 과거에 만든 commit 으로 ref 를
되돌리려는 것 같습니다. 이 경우 destructive 가 아닐 수 있으나 hook 은
*모든* hard reset 을 block 으로 유지 (false-positive 가능성 인정).

hard reset 으로 재시도하지 말고 다음을 기록한 별도 복구 절차로 분리:
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

destructive 위험: --hard 는 working tree + commit 을 wipe 합니다. 회복 정답
($MEMORY_POINTER 외부 race 가짜 신호 + Push reject 절):
  1) git ls-remote origin <branch>          # remote SHA 진단
  2) git reflog                              # 직전 본인 commit SHA 확인
  3) git update-ref refs/heads/<branch> <local-sha>
  4) SHA="\$(git rev-parse HEAD)" && git push origin "\$SHA":refs/heads/<branch>

stale PR ref 가 의심되면 (closed PR 의 --delete-branch 누락):
  gh api -X DELETE repos/<owner>/<repo>/git/refs/heads/<branch>

hard reset 으로 재시도하지 말고 ref 진단과 update-ref 복구 절차로 분리.
자세히: $MEMORY_POINTER
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

EOF
  emit_reflog_recovery_steps
  cat >&2 <<EOF

부드러운 대안 (덜 destructive):
  - git reset --soft <sha>   # working tree + index 보존
  - git stash                 # 작업 보호

자세히: $MEMORY_POINTER (외부 race 가짜 신호 + Push reject 절)
이 가이드를 따라도 안 풀리면 사용자 승인 요청.
EOF
}

emit_block_message() {
  local id="$1"
  local pattern="$2"
  echo "BLOCKED: Dangerous command pattern detected ($id): $pattern" >&2
  case "$id" in
    base64_shell_pipe)
      cat >&2 <<EOF
base64 decode piped into a shell is blocked.
This shell pipe form is treated as script smuggling.
This pattern hides executable script text from the visible Bash command and
can bypass plain-text hook policy checks.

Blocked form:
  base64 -d ... | bash
  base64 --decode ... | sh

Allowed: decode to a file or stdout for inspection without piping to
bash/sh/zsh.

자세히: $MEMORY_POINTER (Hook 한계 + 회피 금지)
EOF
      ;;
    eval_cmd_subst)
      cat >&2 <<EOF
eval with command substitution is blocked.
This can assemble a dangerous command char-by-char at runtime, outside the
plain-text command patterns that the hook can inspect reliably.

Blocked form:
  eval \$(...)

Use an explicit command instead so the hook and reviewer can inspect it.

자세히: $MEMORY_POINTER (Hook 한계 + 회피 금지)
EOF
      ;;
    git_remote_ref_mutation)
      cat >&2 <<EOF
git reset/checkout against remote or upstream refs is blocked.
Target-only ref movement can detach or overwrite local work without the
more obvious \`--hard\` spelling.

Blocked command:
  $CMD

Allowed read-only inspection examples:
  git log FETCH_HEAD
  git show origin/main

자세히: $MEMORY_POINTER (Push reject 절 + hook 회피 금지)
EOF
      ;;
    git_worktree_add)
      cat >&2 <<EOF
git worktree add — agent worktree 자율 생성 금지 (issue #1706).
Rule: memory/runbook/worktree/memory.md — spawn 은 orchestrator 명시 호출:
  bash scripts/worktree-spawn.sh <branch>
본 스크립트가 lefthook install + deps warm-start + hook wiring 을 처리한다.
(guard 는 top-level 명령 문자열만 본다 — 스크립트 내부 git worktree add 는 미영향.)

자세히: memory/runbook/worktree/memory.md
EOF
      ;;
    githooks_path_override | git_config_set_hooks_path | githooks_path_env_key)
      cat >&2 <<EOF
Git hooks 경로를 임시/영속적으로 바꾸는 명령은 hook 우회 우려가 큽니다.
허용: git config core.hooksPath .githooks (setup.sh 완료 상태).

차단된 형태:
  - git -c core.hooksPath=...
  - git config --global/--local core.hooksPath ...
  - GIT_CONFIG_KEY_*=core.hooksPath ...

복구:
  - bash scripts/setup.sh

자세히: $MEMORY_POINTER
EOF
      ;;
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
예외 없음: hook 자체 손상 복구도 차단 명령 우회가 아니라 정책/script 변경으로 기록.
EOF
      ;;
    no_gpg_sign | gpgsign_false | gpgsign_env_key)
      cat >&2 <<EOF
GPG signing 우회 (--no-gpg-sign / commit.gpgsign=false) 는 금지.
서명 필수 repo 에서 pinentry timeout 이 나면 agent 는 즉시 중단하고
사용자에게 gpg-agent cache warm-up 을 요청해야 합니다.

회복:
  - 사용자가 로컬 TTY 에서 한 번 signed commit 또는 gpg sign 으로 cache warm-up
  - 그 뒤 동일 staged diff 로 git commit 재시도
  - unsigned commit 이 만들어졌다면 signed commit 으로 대체 후 push

자세히: $MEMORY_POINTER (Hook 실패 시 / GPG signing 절)
EOF
      ;;
    git_push_force)
      cat >&2 <<EOF
git push --force 는 destructive — remote 의 commit 을 덮어씁니다.
다른 collaborator 의 작업 wipe + CI 검증 결과 무효화.

회복:
  - 일반적으로는 force 가 필요 없는 케이스. push reject 라면
    'git reset --hard' 가이드 (Push reject 절) 참고.
  - 정말 force 가 필요한 경우도 agent hook path 에서는 수행하지 않음.
    별도 정책/script 변경 또는 사람이 수행하는 복구 절차로 분리.

자세히: $MEMORY_POINTER (Hard block 절)
EOF
      ;;
    git_pull)
      cat >&2 <<EOF
git pull 은 agent context 에서 **금지** (sprint-402).
push reject → 즉시 \`git pull --rebase\` 는 race-trace 결과 agent 의
*2-step bypass* 의 진범. pull 은 내부에서 fetch + merge/rebase 를 묶어
실행 → 본인 local commit 이 silently rebase 되거나 wipe 될 위험.

차단 대상:
  - git pull
  - git pull --rebase
  - git pull origin <branch>
  - git pull --rebase origin <branch>

EOF
      emit_reflog_recovery_steps
      cat >&2 <<EOF

예외: 사용자가 채팅에서 직접 \`! git pull\` (! prefix bypass) 로 명시 호출 시는
본 hook scope 밖.

자세히: $MEMORY_POINTER (외부 race 가짜 신호 + Push reject 절)
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
    gh_pr_merge_cleanup)
      cat >&2 <<EOF
WARNING: gh pr merge 는 linked worktree 디스크를 자동 정리하지 않음.
\`--delete-branch\` 는 remote branch/ref 만 지운다. merge 성공 후 T7 cleanup 을
반드시 실행:

  bash scripts/worktree-cleanup.sh <branch>
  # 또는 merged clean worktree 일괄 정리
  bash scripts/worktree-cleanup.sh --merged

Dirty worktree 는 cleanup script 가 제거하지 않고 SKIP 으로 보고한다.

자세히:
  - memory/runbook/worktree/memory.md (cleanup 책임)
  - memory/workflow/delivery/memory.md (T7 Cleanup)
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

# ─────────────────────────────────────────────────────────────────────────────
# Issue #1029 + PR #1151 review — SQL DROP/TRUNCATE 세그먼트 단위 검사.
# ─────────────────────────────────────────────────────────────────────────────
# 이 repo 는 DB 클라이언트라 DROP/TRUNCATE 가 소스·커밋 메시지에 정상 등장한다.
# 명령 문자열 전체 word-match (기존 배열 방식) 는 `rg "TRUNCATE" src/` /
# `git commit -m "fix: DROP TABLE guard"` 를 오탐 차단했다.
#
# 규칙: 명령을 shell 문장 구분자(; & && || 개행)로 "문장" 분할한다. 단일 파이프
# | 는 구분자가 아니다 — 파이프라인은 하나의 논리 명령이다. 각 문장에서
#   1) 문장을 pipe-stage 로 나눈다.
#   2) 각 stage 에서 앞쪽 env-assignment(VAR=val) 를 건너뛰고,
#      sudo/doas/env/command wrapper 뒤 옵션/값을 client 가 나올 때까지 건너뛴다.
#   3) 어느 pipe-stage 든 command position 첫 토큰이 DB client (psql/mysql/...) 이고,
#   4) 같은 문장 안에 파괴적 keyword (DROP DATABASE|TABLE / TRUNCATE) 가 있으면
#      block 한다.
# 문장 한정이라 `psql -l && git commit -m "...DROP TABLE..."` 는 통과 (commit 은
# 별개 문장). rg/grep/git 로 시작하는 문장은 client 가 command position 에 없어
# 통과한다. `echo "DROP TABLE t" | psql db` 는 한 문장(파이프라인)이라 block —
# PR #1151 이 | 까지 구분자로 삼아 생긴 pipe-fed 미탐 회귀 fix (Refs #1151).
#
# ponytail: 부주의 방지 heuristic — 정확한 보안 경계 아님 (스크립트 헤더 참고).
#   - string literal 안의 keyword (`mysql -e "SELECT 'TRUNCATE'"`) 도 여전히
#     block — 실제 client exec 에 대한 over-warning 이라 감수.
#   - wrapper 인식은 best-effort (sudo/doas/env/command 만). time/nice/xargs
#     등 다른 wrapper 는 놓칠 수 있음. 문장 분할은 quote 를 인식하나(quoted ; 는
#     문장을 안 쪼갬), pipe-stage 분할과 heredoc 본문 개행은 미parse — heredoc-fed
#     SQL 은 알려진 미탐. heuristic 은 어차피 우회 가능하므로 감수. `mongo`/`mongosh`
#     의 `db.x.drop()` 는 이 SQL keyword 로 매치 안 됨 (pre-existing dead cover).
SQL_CLIENT_BINARIES='psql mysql mariadb sqlite3 mongosh mongo duckdb'

# 세그먼트가 DB client 를 command position 에서 실행하면 exit 0.
_sql_segment_runs_client() {
  local -a words
  IFS=$' \t' read -r -a words <<<"$1"
  local seen_wrapper=0 w client
  # macOS ships Bash 3.2 where `"${words[@]}"` on an EMPTY array trips
  # `set -u` (words[@]: unbound variable) and crashes the whole hook, blocking
  # the legitimate command (issue #1242). A whitespace-only pipe-stage — e.g.
  # the trailing stage of `foo | ` — reads into an empty array, so guard the
  # expansion with the `${arr[@]+...}` idiom (expand only when set).
  for w in ${words[@]+"${words[@]}"}; do
    for client in $SQL_CLIENT_BINARIES; do
      [ "$w" = "$client" ] && return 0
    done
    [ "$seen_wrapper" -eq 1 ] && continue
    case "$w" in
      sudo | doas | env | command) seen_wrapper=1 ;; # wrapper — 뒤 옵션/값 skip
      *=*) : ;;                                       # leading env-assignment
      *) return 1 ;;                                  # 첫 실질 토큰이 client 아님
    esac
  done
  return 1
}

# CMD 를 shell "문장" 으로 분할한다. 문장 구분자 — ; & (&& 포함) / || / 개행 —
# 는 분할하지만 단일 파이프 | 는 분할하지 않는다: 파이프라인은 하나의 논리 명령.
# (PR #1151 이 | 까지 구분자로 삼아 `echo "DROP TABLE t" | psql db` 같은 pipe-fed
#  파괴 SQL 이 두 세그먼트로 쪼개져 미탐됨 — Refs #1151.) 따옴표 안의 구분자는
# literal 로 둔다 — `printf 'TRUNCATE t;' | mysql` 의 quoted ; 가 문장을 쪼개지
# 않도록. heredoc 본문의 개행은 여전히 read 루프가 문장 경계로 취급 → heredoc-fed
# SQL 은 알려진 미탐 (본 heuristic 은 quote/heredoc 을 완전히 parse 하지 않음).
_sql_split_statements() {
  local s="$1" n=${#1} i c q="" out=""
  for ((i = 0; i < n; i++)); do
    c=${s:i:1}
    if [ -n "$q" ]; then # 따옴표 안 — 닫힐 때까지 그대로 복사
      out+=$c
      [ "$c" = "$q" ] && q=""
      continue
    fi
    case $c in
      \' | \") q=$c; out+=$c ;;
      ';' | '&') out+=$'\n' ;; # ; & (&& 포함) → 문장 구분자
      '|')
        if [ "${s:i+1:1}" = "|" ]; then
          out+=$'\n'  # || (or) → 문장 구분자
          i=$((i + 1)) # 두 번째 | 소비 (set -e 안전: 산술 assignment)
        else
          out+='|' # 단일 | (pipe) → 유지 (파이프라인 = 한 문장)
        fi
        ;;
      *) out+=$c ;;
    esac
  done
  printf '%s\n' "$out"
}

check_sql_client_execution() {
  local statements stmt stage runs_client
  statements="$(_sql_split_statements "$CMD")"
  while IFS= read -r stmt; do
    [ -n "$stmt" ] || continue
    # 파이프라인은 한 문장이지만 여러 stage — client 는 어느 stage 든 될 수 있다
    # (`echo ... | psql`). 각 pipe-stage 의 command position 을 검사한다.
    runs_client=0
    while IFS= read -r stage; do
      [ -n "$stage" ] || continue
      if _sql_segment_runs_client "$stage"; then
        runs_client=1
        break
      fi
    done <<PIPES
$(printf '%s' "$stmt" | tr '|' '\n')
PIPES
    [ "$runs_client" -eq 1 ] || continue
    if printf '%s' "$stmt" | grep -qiE '(^|[^a-zA-Z0-9_])DROP[[:space:]]+(DATABASE|TABLE)([^a-zA-Z0-9_]|$)'; then
      emit_block_message "sql_drop" "DB client executes DROP DATABASE/TABLE in this command segment"
    fi
    if printf '%s' "$stmt" | grep -qiE '(^|[^a-zA-Z0-9_])TRUNCATE([^a-zA-Z0-9_]|$)'; then
      emit_block_message "sql_truncate" "DB client executes TRUNCATE in this command segment"
    fi
  done <<EOF
$statements
EOF
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
      # gh_pr_merge_cleanup: same shell command already includes cleanup.
      if [ "$id" = "gh_pr_merge_cleanup" ]; then
        if echo "$CMD" | grep -q -- 'worktree-cleanup.sh'; then
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
  local repo_root
  repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  if [ -z "$repo_root" ]; then
    block "Unable to resolve git repository root. Run command from a git repository."
  fi

  hooks_dir="$(git config --get core.hooksPath 2>/dev/null || true)"
  # issue #1706 — 복구로 해제: hooksPath drift 여도 sanctioned repair 명령은
  # 통과. block 메시지가 안내하는 자기 회복 수단 (setup.sh) 이 자기 자신에게
  # 차단되는 deadlock 방지 (2026-07-22 실측). 나머지 block layer (dangerous
  # pattern 등) 는 독립 실행이라 면제 범위는 hooksPath 상태 검사로 한정된다.
  if echo "$CMD" | grep -qE '(^|[[:space:];&|])bash[[:space:]]+(\./)?scripts/(setup|worktree-spawn)\.sh([[:space:]]|$)'; then
    return 0
  fi
  if [ -z "$hooks_dir" ]; then
    block "Blocked: core.hooksPath is unset (default .git/hooks). This repo requires core.hooksPath=.githooks. Run 'bash scripts/setup.sh'."
  fi
  if [ "${hooks_dir#/}" = "$hooks_dir" ]; then
    hooks_dir="$repo_root/$hooks_dir"
  fi

  if [ "$hooks_dir" != "$repo_root/.githooks" ]; then
    block "Blocked: core.hooksPath is '$hooks_dir'. Must be '$repo_root/.githooks'. Run 'bash scripts/setup.sh'."
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
check_sql_client_execution
check_warn_patterns
check_git_hooks

exit 0
