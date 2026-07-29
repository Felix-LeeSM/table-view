#!/usr/bin/env bash
# Contract check for the review-gate round gate (delivery round reflect).
#
# The gate refuses the merge once a PR reaches `comments >= <cap>` without the
# escape label. Two values are load-bearing and duplicated across four files:
#
#   1. the escape label name. It must match a label that actually exists on the
#      repo — when the gate first shipped the label did not, and because branch
#      protection sets enforce_admins=true a tripped PR then had no merge path
#      at all. A rename in the workflow alone reproduces that dead end.
#   2. the round cap. Agents read the number from the prose SOTs, so changing
#      it in the workflow alone leaves them holding a stale line.
#
# Both values are read out of the workflow rather than hardcoded here, so
# raising the cap or renaming the label stays a one-file edit plus the prose.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
WORKFLOW="$ROOT/.github/workflows/review-gate.yml"

SOTS=(
	".agents/skills/delivery/SKILL.md"
	"memory/workflow/delivery/memory.md"
	"memory/runbook/pr-merge-gates/memory.md"
)

fail() {
	echo "FAIL: $1" >&2
	exit 1
}

[ -f "$WORKFLOW" ] || fail "review-gate workflow is missing"

workflow_text="$(cat "$WORKFLOW")"

grep -Fq -- "name: Stop at review round" <<<"$workflow_text" ||
	fail "round gate step is missing from the workflow"

# The count must come off the webhook payload. Switching to an API lookup would
# reintroduce the token/permission surface the declarative form avoids.
grep -Fq -- "github.event.pull_request.comments" <<<"$workflow_text" ||
	fail "round gate no longer reads the comment count from the payload"

label="$(grep -oE "'reflect:[a-z-]+'" <<<"$workflow_text" | head -1 | tr -d "'")"
[ -n "$label" ] || fail "could not read the escape label out of the workflow"

cap="$(grep -oE 'pull_request\.comments >= [0-9]+' <<<"$workflow_text" |
	grep -oE '[0-9]+' | head -1)"
[ -n "$cap" ] || fail "could not read the round cap out of the workflow"

# The gate must be evaluated before the approval check, so a PR that trips it
# reports the round problem rather than a missing-label error that sends the
# owner to re-fire the label (which cannot clear this gate).
round_line="$(grep -n "name: Stop at review round" <<<"$workflow_text" | head -1 | cut -d: -f1)"
approve_line="$(grep -n "name: Require review:approved label" <<<"$workflow_text" | head -1 | cut -d: -f1)"
[ -n "$approve_line" ] || fail "approval step is missing from the workflow"
[ "$round_line" -lt "$approve_line" ] ||
	fail "round gate must run before the approval check (round=$round_line approval=$approve_line)"

for sot in "${SOTS[@]}"; do
	path="$ROOT/$sot"
	[ -f "$path" ] || fail "$sot is missing"

	grep -Fq -- "$label" "$path" ||
		fail "$sot does not name the escape label '$label'"

	# The cap has to appear as a round threshold, not as an incidental digit.
	grep -qE "라운드 $cap|comments >= $cap" "$path" ||
		fail "$sot does not state the round cap $cap"
done

echo "PASS: review-gate round gate contract (label=$label cap=$cap)"
