#!/usr/bin/env bash
# Detect whether a push/PR change set is docs/memory-only (heavy CI may skip)
# or touches code (heavy CI must run). Emits `code_changed=true|false` to stdout
# and to $GITHUB_OUTPUT for downstream `if:` gates.
#
# Docs-only = every changed path is under docs/, memory/, or ends in .md.
# Anything else (code, config, workflows, fixtures, lockfiles) => code_changed.
#
# Fail-safe: any ambiguity — missing base ref, git error, unhandled event
# (e.g. workflow_dispatch) — defaults to code_changed=true so the full pipeline
# runs. Never skip heavy CI on doubt; a false "docs-only" would merge unverified
# code.
#
# Local testing: set CHANGED_FILES_OVERRIDE to a newline-separated file list to
# exercise the classifier without git.
set -uo pipefail

emit() {
	printf 'code_changed=%s\n' "$1"
	[ -n "${GITHUB_OUTPUT:-}" ] && printf 'code_changed=%s\n' "$1" >>"$GITHUB_OUTPUT"
	return 0
}

full_ci() {
	[ -n "${1:-}" ] && printf 'detect-change-scope: %s -> running full CI\n' "$1" >&2
	emit true
	exit 0
}

if [ -n "${CHANGED_FILES_OVERRIDE:-}" ]; then
	changed_files="$CHANGED_FILES_OVERRIDE"
else
	event="${GITHUB_EVENT_NAME:-}"
	case "$event" in
	pull_request)
		# PR diff is merge-base(base, head)..head — the three-dot range.
		base="${PR_BASE_SHA:-}"
		[ -n "$base" ] || full_ci "missing PR base sha"
		git rev-parse --verify --quiet "${base}^{commit}" >/dev/null || full_ci "PR base sha ${base} not fetched"
		changed_files="$(git diff --name-only "${base}...HEAD")" || full_ci "git diff failed for ${base}...HEAD"
		;;
	push)
		# main push diff is the previous tip..new tip.
		before="${PUSH_BEFORE_SHA:-}"
		case "$before" in
		"" | 0000000000000000000000000000000000000000)
			full_ci "no valid before sha (first or force push)"
			;;
		esac
		git rev-parse --verify --quiet "${before}^{commit}" >/dev/null || full_ci "before sha ${before} not fetched"
		changed_files="$(git diff --name-only "${before}" HEAD)" || full_ci "git diff failed for ${before}..HEAD"
		;;
	*)
		full_ci "unhandled event '${event}' (workflow_dispatch et al. run full)"
		;;
	esac
fi

# Strip whitespace to detect a truly empty change set.
if [ -z "${changed_files//[$'\n\t ']/}" ]; then
	# Empty diff: nothing to build or test, heavy jobs add no value. Safe to skip.
	emit false
	exit 0
fi

code_changed=false
while IFS= read -r file; do
	[ -n "$file" ] || continue
	# case-glob '*' matches '/', so docs/* covers docs/a/b.md and *.md covers any depth.
	case "$file" in
	docs/* | memory/* | *.md) ;;
	*)
		code_changed=true
		break
		;;
	esac
done <<EOF
$changed_files
EOF

emit "$code_changed"
