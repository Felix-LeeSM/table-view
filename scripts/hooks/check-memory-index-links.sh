#!/usr/bin/env bash
# check-memory-index-links.sh
# Fail when active memory contains broken internal markdown links.

set -euo pipefail

if [ ! -d "memory/index" ]; then
	exit 0
fi

pnpm exec tsx scripts/checks/memory-index-links.ts
