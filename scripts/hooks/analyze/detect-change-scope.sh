#!/usr/bin/env bash
# Classify a push/PR change set into two INDEPENDENT signals, emitted to stdout
# and to $GITHUB_OUTPUT for downstream `if:` gates:
#
#   code_changed=true|false  — a path outside docs/, memory/, *.md changed.
#   docs_changed=true|false  — a path under docs/, memory/, or *.md changed.
#
# Both can be true (a mixed change set); both are false only for an empty diff.
#
# Why two signals and not one: a docs-only change set is NOT "no change". The
# repo has checks that READ docs/ — the vitest doc contracts, and `pnpm lint`
# via scripts/check-eslint-static-policy.ts, which reads the 20
# COMPLETION_FEATURE_REFERENCE_DOC_PATHS and the frontend-compat inventory. A
# single `code_changed` flag forced those to be described as "no change", and
# three separate holes were then patched on top of that one false statement
# (#1841 merged with its doc contracts unevaluated, and #1844/#1847 merged
# reading `Frontend Checks: skipping`). Since #1991 the doc readers sit in their
# own `doc-contracts` job gated on `docs_changed`, while the shard matrix gates
# on `code_changed`; the two `if:` conditions are complementary, so every
# non-empty change set runs the doc readers exactly once. `doc-contracts` is not
# a required context, so the `Frontend Checks` aggregation carries the
# `docs_changed` clause too and grades that job's result — its own heavy steps
# are gated off on that lane. The classification is true and the gates follow
# from it.
#
# Fail-safe: any ambiguity — missing base ref, git error, unhandled event
# (e.g. workflow_dispatch) — sets BOTH to true so the full pipeline runs. Never
# skip on doubt; a false "nothing changed" would merge unverified work.
#
# Local testing: set CHANGED_FILES_OVERRIDE to a newline-separated file list to
# exercise the classifier without git.
set -uo pipefail

emit() {
	printf 'code_changed=%s\ndocs_changed=%s\n' "$1" "$2"
	if [ -n "${GITHUB_OUTPUT:-}" ]; then
		printf 'code_changed=%s\ndocs_changed=%s\n' "$1" "$2" >>"$GITHUB_OUTPUT"
	fi
	return 0
}

full_ci() {
	[ -n "${1:-}" ] && printf 'detect-change-scope: %s -> running full CI\n' "$1" >&2
	emit true true
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
	# Empty diff: nothing to build, test, or re-read. Safe to skip everything.
	emit false false
	exit 0
fi

code_changed=false
docs_changed=false
while IFS= read -r file; do
	[ -n "$file" ] || continue
	# case-glob '*' matches '/', so docs/* covers docs/a/b.md and *.md covers any depth.
	case "$file" in
	docs/* | memory/* | *.md)
		docs_changed=true
		;;
	*)
		code_changed=true
		;;
	esac
	# Both set: no later path can change the answer.
	[ "$code_changed" = true ] && [ "$docs_changed" = true ] && break
done <<EOF
$changed_files
EOF

emit "$code_changed" "$docs_changed"
