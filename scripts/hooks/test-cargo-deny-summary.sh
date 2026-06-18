#!/usr/bin/env bash
# Contract test for the dependency-security CI summary.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SUMMARY_FILE="$(mktemp "${TMPDIR:-/tmp}/cargo-deny-step-summary.XXXXXX")"
trap 'rm -f "$SUMMARY_FILE"' EXIT

assert_contains() {
	local text="$1"
	local needle="$2"
	local label="$3"

	if ! grep -Fq -- "$needle" <<<"$text"; then
		echo "FAIL: $label: missing '$needle'" >&2
		exit 1
	fi
}

output="$(GITHUB_STEP_SUMMARY="$SUMMARY_FILE" bash "$ROOT/scripts/hooks/cargo-deny-summary.sh")"
summary_output="$(cat "$SUMMARY_FILE")"

assert_contains "$output" 'Advisory config: `src-tauri/deny.toml` (`[advisories].ignore`)' "stdout summary"
assert_contains "$output" "Node audit: deferred" "stdout summary"
assert_contains "$output" "Runtime dependency upgrades: separate PRs" "stdout summary"
assert_contains "$output" "RUSTSEC-2026-0118" "stdout ignore IDs"
assert_contains "$output" "RUSTSEC-2026-0119" "stdout ignore IDs"
assert_contains "$output" "RUSTSEC-2025-0134" "stdout ignore IDs"
assert_contains "$output" "RUSTSEC-2023-0071" "stdout ignore IDs"
assert_contains "$summary_output" 'Advisory config: `src-tauri/deny.toml` (`[advisories].ignore`)' "step summary"

ignore_count="$(grep -Eo 'RUSTSEC-[0-9]{4}-[0-9]{4}' <<<"$output" | sort -u | wc -l | tr -d '[:space:]')"
if [ "$ignore_count" -lt 20 ]; then
	echo "FAIL: expected at least 20 cargo deny ignore IDs, got $ignore_count" >&2
	exit 1
fi

echo "PASS: cargo deny summary contract"
