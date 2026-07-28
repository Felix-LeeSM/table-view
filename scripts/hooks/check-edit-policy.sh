#!/usr/bin/env bash
# Compatibility shim — forwards to apply/check-edit-policy.sh. See pre-tool-use.sh for why these
# exist: a running agent session caches its hook command string at start, so a
# moved hook is silently absent (non-blocking error, tool runs anyway) until the
# session restarts. Removable once no pre-reorg session can still be running.
exec bash "$(cd "$(dirname "$0")" && pwd)/apply/check-edit-policy.sh" "$@"
