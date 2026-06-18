#!/usr/bin/env bash
# Print the dependency-security gate summary used by CI logs and step summary.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DENY_TOML="${CARGO_DENY_CONFIG:-$ROOT/src-tauri/deny.toml}"

if [ ! -f "$DENY_TOML" ]; then
	echo "ERROR: cargo deny config not found: $DENY_TOML" >&2
	exit 1
fi

repo_path="$DENY_TOML"
case "$repo_path" in
"$ROOT"/*) repo_path="${repo_path#"$ROOT"/}" ;;
esac

extract_ignore_ids() {
	awk '
		/^\[advisories\]/ { in_advisories = 1; next }
		/^\[/ && in_advisories { exit }
		in_advisories && /^[[:space:]]*ignore[[:space:]]*=/ { in_ignore = 1; next }
		in_advisories && in_ignore && /^[[:space:]]*\]/ { exit }
		in_advisories && in_ignore {
			line = $0
			while (match(line, /"RUSTSEC-[0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9]"/)) {
				id = substr(line, RSTART + 1, RLENGTH - 2)
				print id
				line = substr(line, RSTART + RLENGTH)
			}
		}
	' "$DENY_TOML"
}

tmp_summary="$(mktemp "${TMPDIR:-/tmp}/cargo-deny-summary.XXXXXX")"
trap 'rm -f "$tmp_summary"' EXIT

{
	echo "## Dependency security"
	echo
	echo "- Advisory config: \`$repo_path\` (\`[advisories].ignore\`)"
	echo "- Node audit: deferred"
	echo "- Runtime dependency upgrades: separate PRs"
	echo
	echo "Ignored advisory IDs:"
	ignore_ids="$(extract_ignore_ids)"
	if [ -n "$ignore_ids" ]; then
		while IFS= read -r id; do
			[ -n "$id" ] || continue
			printf -- '- `%s`\n' "$id"
		done <<<"$ignore_ids"
	else
		echo "- none"
	fi
} >"$tmp_summary"

cat "$tmp_summary"

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
	cat "$tmp_summary" >>"$GITHUB_STEP_SUMMARY"
fi
