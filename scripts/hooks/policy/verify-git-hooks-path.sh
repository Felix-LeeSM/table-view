#!/bin/sh
# verify-git-hooks-path.sh — hook 경로 우회 방지 verification.
#
# 목적:
# - repository hook 실행 전 core.hooksPath 가 정확히 `.githooks` 인지 강제한다.
# - 값이 비어 있거나 다른 경로면 즉시 차단하고 setup 명령을 안내한다.
#
# read-only: 상태를 수정하지 않고 오직 실패/통과만 결정.
#

set -eu

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$repo_root" ]; then
  echo "ERROR: git repository root를 찾지 못했습니다." >&2
  echo "Run 'bash scripts/setup.sh' from repository root and retry." >&2
  exit 1
fi

current_hooks_path="$(git config --get core.hooksPath 2>/dev/null || true)"
if [ -z "$current_hooks_path" ]; then
  echo "BLOCKED: core.hooksPath is unset (default .git/hooks is active)." >&2
  echo "Run 'bash scripts/setup.sh' to force hooks via .githooks." >&2
  exit 1
fi

if [ "$current_hooks_path" = ".githooks" ]; then
  exit 0
fi

if [ "$current_hooks_path" = "$repo_root/.githooks" ]; then
  exit 0
fi

echo "BLOCKED: core.hooksPath is overridden ($current_hooks_path)." >&2
echo "Allowed values: .githooks (from repository root)." >&2
echo "Run 'bash scripts/setup.sh' to restore." >&2
exit 1
