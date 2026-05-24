#!/usr/bin/env bash
# worktree-spawn.sh — 새 git worktree + branch 생성. 다중 agent 병렬 작업용.
#
# 사용:
#   bash scripts/worktree-spawn.sh [--no-deps] [--full-target] <branch-name> [base-branch]
#
# 동작:
#   - origin/<branch-name> 이 있으면 그 remote branch 를 source 로 새 local branch 생성
#   - 없으면 origin/<base-branch> (default main) 기준으로 새 local branch 생성
#   - worktrees/<sanitized-branch>/ 에 worktree 추가
#   - 기본으로 node_modules / pruned src-tauri/target 을 복사한 뒤
#     pnpm install --frozen-lockfile + cargo fetch 로 새 worktree 기준 보정
#   - 해당 worktree 에서 lefthook install 실행 (hook 활성화)
#   - 생성된 worktree 경로 출력 (agent 가 cd 할 path)
#   - stderr 에 worker prompt 계약 템플릿 출력

set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  cat <<EOF
worktree-spawn.sh — multi-agent worktree 생성

사용:
  bash scripts/worktree-spawn.sh [--no-deps] [--full-target] <branch-name> [base-branch]

예시:
  bash scripts/worktree-spawn.sh sprint-388/foo              # deps warm-start, base = main
  bash scripts/worktree-spawn.sh feature/bar develop         # deps warm-start, base = develop
  bash scripts/worktree-spawn.sh --no-deps sprint-388/foo    # cold spawn
  bash scripts/worktree-spawn.sh --full-target sprint-388/foo # target 전체 복사

결과:
  - origin/<branch-name> 있으면 해당 remote branch 기반 local branch 신설
  - 없으면 origin/<base-branch> 기반 local branch 신설
  - worktrees/<sanitized>/ 에 worktree 추가 (sanitized = branch 의 / → __)
  - 기본 deps warm-start:
    - 현재 worktree 의 node_modules 와 pruned src-tauri/target 을 새 worktree 로 복사
    - 새 worktree lockfile 기준으로 pnpm install --frozen-lockfile 실행
    - Cargo.lock 기준으로 cargo fetch --manifest-path src-tauri/Cargo.toml 실행
    - src-tauri/target 기본 복사는 release, tmp, incremental,
      coverage raw/profile 만 제외하고 llvm-cov-target 과 DuckDB build
      outputs 는 보존
  - 해당 worktree 에서 lefthook install
  - stdout 에 worktree 경로 출력
  - stderr 에 agent 첫 turn 검증 + worker prompt 계약 템플릿 출력

worktrees/ 는 .gitignore 처리. platform-neutral (Claude / Codex / Cursor 공통).

관련: memory/runbook/worktree/memory.md
EOF
  exit 0
fi

WITH_DEPS=1
PRUNE_TAURI_TARGET=1
while [ $# -gt 0 ]; do
  case "$1" in
    --with-deps | --bootstrap)
      WITH_DEPS=1
      shift
      ;;
    --no-deps | --no-bootstrap)
      WITH_DEPS=0
      shift
      ;;
    --full-target)
      PRUNE_TAURI_TARGET=0
      shift
      ;;
    --pruned-target)
      PRUNE_TAURI_TARGET=1
      shift
      ;;
    --)
      shift
      break
      ;;
    -*)
      echo "ERROR: unknown option: $1. See --help." >&2
      exit 1
      ;;
    *)
      break
      ;;
  esac
done

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

copy_bootstrap_dir() {
  local rel_path="$1"
  local src="$REPO_ROOT/$rel_path"
  local dst="$WORKTREE_PATH/$rel_path"

  if [ ! -d "$src" ]; then
    echo "deps: skip missing $rel_path" >&2
    return 0
  fi

  if [ -e "$dst" ]; then
    echo "deps: skip existing $rel_path" >&2
    return 0
  fi

  mkdir -p "$(dirname "$dst")"
  echo "deps: copy $rel_path" >&2
  if command -v rsync >/dev/null 2>&1; then
    rsync -a -- "$src/" "$dst/"
  else
    cp -R -p "$src" "$dst"
  fi
}

prune_tauri_target() {
  local dst="$WORKTREE_PATH/src-tauri/target"

  rm -rf -- "$dst/release" "$dst/tmp"

  if [ -d "$dst" ]; then
    find "$dst" -type d -name incremental -prune -exec rm -rf -- {} +
    find "$dst" \( -name '*.profraw' -o -name '*.profdata' \) -type f -exec rm -f -- {} +
  fi

  # Keep compiled deps and native build outputs. Pre-push runs cargo-llvm-cov
  # against llvm-cov-target, and removing DuckDB objects forces minute-scale
  # C++ rebuilds in every spawned worktree.
}

copy_tauri_target() {
  local src="$REPO_ROOT/src-tauri/target"
  local dst="$WORKTREE_PATH/src-tauri/target"

  if [ ! -d "$src" ]; then
    echo "deps: skip missing src-tauri/target" >&2
    return 0
  fi

  if [ -e "$dst" ]; then
    echo "deps: skip existing src-tauri/target" >&2
    return 0
  fi

  mkdir -p "$(dirname "$dst")"

  if [ "$PRUNE_TAURI_TARGET" -eq 0 ]; then
    echo "deps: copy src-tauri/target (full)" >&2
    copy_bootstrap_dir "src-tauri/target"
    return 0
  fi

  echo "deps: copy src-tauri/target (pruned)" >&2

  if [ "$(uname -s 2>/dev/null || echo '')" = "Darwin" ]; then
    if cp -cR "$src" "$dst"; then
      prune_tauri_target
      return 0
    fi
    rm -rf -- "$dst"
  fi

  if command -v rsync >/dev/null 2>&1; then
    mkdir -p "$dst"
    rsync -a \
      --exclude='/release/' \
      --exclude='/tmp/' \
      --exclude='*/incremental/' \
      --exclude='*.profraw' \
      --exclude='*.profdata' \
      -- "$src/" "$dst/"
    prune_tauri_target
  else
    cp -R -p "$src" "$dst"
    prune_tauri_target
  fi
}

bootstrap_deps() {
  copy_bootstrap_dir "node_modules"
  copy_tauri_target

  if [ -f "$WORKTREE_PATH/package.json" ]; then
    if command -v pnpm >/dev/null 2>&1; then
      echo "deps: pnpm install --frozen-lockfile" >&2
      (cd "$WORKTREE_PATH" && pnpm install --frozen-lockfile)
    else
      echo "WARN: pnpm not found; skipped pnpm install" >&2
    fi
  fi

  if [ -f "$WORKTREE_PATH/src-tauri/Cargo.toml" ]; then
    if command -v cargo >/dev/null 2>&1; then
      echo "deps: cargo fetch --manifest-path src-tauri/Cargo.toml" >&2
      (cd "$WORKTREE_PATH" && cargo fetch --manifest-path src-tauri/Cargo.toml)
    else
      echo "WARN: cargo not found; skipped cargo fetch" >&2
    fi
  fi
}

mkdir -p "$REPO_ROOT/worktrees"

if [ -d "$WORKTREE_PATH" ]; then
  echo "ERROR: worktree path already exists: $WORKTREE_PATH" >&2
  exit 1
fi

if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
  echo "ERROR: local branch already exists: $BRANCH" >&2
  echo "       기존 branch 재사용은 worktree contamination 위험이 있어 금지." >&2
  exit 1
fi

# remote refs 최신화. 생성 source 는 항상 origin/* 로 잡는다. 새 branch 생성
# 케이스에서는 origin/<branch> 가 없어도 정상이라 branch fetch 는 best-effort.
git fetch --quiet origin "$BASE"
git fetch --quiet origin "$BRANCH" 2>/dev/null || true

if git show-ref --verify --quiet "refs/remotes/origin/$BRANCH"; then
  git worktree add -b "$BRANCH" "$WORKTREE_PATH" "origin/$BRANCH"
else
  if ! git show-ref --verify --quiet "refs/remotes/origin/$BASE"; then
    echo "ERROR: remote base branch not found: origin/$BASE" >&2
    exit 1
  fi
  git worktree add -b "$BRANCH" "$WORKTREE_PATH" "origin/$BASE"
  # `git worktree add -b <branch> origin/main` configures the new local branch to
  # track origin/main. Keep new branches independent until their own remote ref
  # exists; otherwise hook fallbacks and status output can reason about the wrong
  # upstream.
  git -C "$WORKTREE_PATH" branch --unset-upstream "$BRANCH" >/dev/null 2>&1 || true
fi

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

if [ "$WITH_DEPS" -eq 1 ]; then
  bootstrap_deps
fi

# hook 활성화 (lefthook install 은 .git/hooks 가 worktree 별로 분리됨)
(cd "$WORKTREE_PATH" && command -v lefthook >/dev/null 2>&1 && lefthook install >/dev/null 2>&1 || true)

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

cat >&2 <<EOF

# Worker prompt contract template:
You are not alone in this codebase. Do not revert edits made by others.
Work only inside this worktree:
  $WORKTREE_PATH

Branch:
  $BRANCH

MANDATORY first command:
  test "\$(git -C "$WORKTREE_PATH" rev-parse --show-toplevel)" = "$WORKTREE_PATH" \\
    || { echo "ABORT: not in expected worktree" >&2; exit 1; }

Hard rules:
  - Do not create another worktree.
  - Do not pull from git.
  - Do not hard-reset to FETCH_HEAD, ORIG_HEAD, upstream, origin/*, or refs/remotes/*.
  - Do not bypass hooks with verification-skip flags or hook-disabling env vars.
  - Do not modify unrelated user changes.

Owned scope:
  - <files/modules>

Task:
  - <task summary>

Validation:
  - <test/check commands>

Return:
  - changed files
  - tests/checks run
  - blockers/risks
  - PR URL if created
EOF
