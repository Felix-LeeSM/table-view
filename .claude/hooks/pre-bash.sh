#!/bin/bash
# Claude Code PreToolUse Bash wrapper.
# Source-of-truth: scripts/hooks/check-dangerous-bash.sh (platform-neutral).
# 본 wrapper 는 stdin JSON 만 전달. 다른 brain (Codex / Cursor / lefthook) 도
# 같은 스크립트를 env / argv / stdin 으로 호출.
exec "$(dirname "$0")/../../scripts/hooks/check-dangerous-bash.sh"
