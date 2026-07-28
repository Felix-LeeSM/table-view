#!/usr/bin/env bash
# Compatibility shim — forwards to apply/pre-tool-use.sh.
#
# A running agent session caches the hook command string from its manifest at
# START. Moving this file into `apply/` therefore does not move it for any
# session already open: the cached command still points here, `bash` reports
# "No such file or directory", and Claude Code records that as a
# `hook_non_blocking_error` and RUNS THE TOOL ANYWAY. Every PreToolUse guard —
# dangerous-bash, edit policy, the primary-worktree guard — is silently off
# until that session restarts. Observed live while landing the reorg: 104
# non-blocking hook errors in one session, no visible warning.
#
# Removable once no session predating the reorg can still be running. There is
# no automatic signal for that, so treat it as a manual cleanup with the next
# hook change rather than something to leave forever.
exec bash "$(cd "$(dirname "$0")" && pwd)/apply/pre-tool-use.sh" "$@"
