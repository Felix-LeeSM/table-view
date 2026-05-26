#!/usr/bin/env bash
# check-memory-index-fresh.sh
# Fail when memory index files are not the result of scripts/regenerate-indexes.sh.

set -euo pipefail

if [ ! -d "memory" ]; then
	exit 0
fi

bash scripts/regenerate-indexes.sh >/dev/null

if ! git diff --quiet -- memory/index/by-task.md memory/index/by-surface.md; then
	echo "ERROR: memory indexes are stale." >&2
	echo "Run: bash scripts/regenerate-indexes.sh" >&2
	echo "Then stage memory/index/by-task.md and memory/index/by-surface.md." >&2
	exit 1
fi

exit 0
