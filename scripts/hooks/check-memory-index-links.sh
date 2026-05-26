#!/usr/bin/env bash
# check-memory-index-links.sh
# Fail when generated memory indexes contain broken internal markdown links.

set -euo pipefail

if [ ! -d "memory/index" ]; then
	exit 0
fi

pnpm exec tsx scripts/checks/memory-index-links.ts
