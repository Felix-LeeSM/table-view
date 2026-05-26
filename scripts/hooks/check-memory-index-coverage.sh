#!/usr/bin/env bash
# check-memory-index-coverage.sh
# Warn when important memory rooms cannot be discovered through generated indexes.

set -euo pipefail

if [ ! -d "memory" ]; then
	exit 0
fi

warnings=0

while IFS= read -r -d '' file; do
	case "$file" in
		memory/index/*) continue ;;
	esac

	type="$(awk -F': *' '
		BEGIN { in_fm=0 }
		NR == 1 && $0 == "---" { in_fm=1; next }
		in_fm && $0 == "---" { exit }
		in_fm && $1 == "type" { print $2; exit }
	' "$file")"

	case "$type" in
		workflow-rule|convention|runbook) ;;
		*) continue ;;
	esac

	if ! awk '
		BEGIN { in_fm=0; found=0 }
		NR == 1 && $0 == "---" { in_fm=1; next }
		in_fm && $0 == "---" { exit }
		in_fm && ($0 ~ /^task:/ || $0 ~ /^surface:/) { found=1; exit }
		END { exit(found ? 0 : 1) }
	' "$file"; then
		echo "WARNING: memory index coverage: $file has type '$type' but no task/surface frontmatter." >&2
		warnings=$((warnings + 1))
	fi
done < <(find memory -name memory.md -type f -print0)

if [ "$warnings" -gt 0 ]; then
	echo "WARNING: $warnings memory room(s) may be invisible to generated indexes." >&2
fi

exit 0
