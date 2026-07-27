#!/usr/bin/env bash
# Smoke tests for scripts/hooks/check-doc-contract-gate.mjs.
#
# Every case below is a bypass that the previous `grep -F` shape lock and the
# `find src scripts tests -name '*.test.ts'` drift scan let through silently
# (verified on the pre-fix script during the #1845 review). They are pinned
# here because a guard that does not fire is worse than no guard: it reports
# PASS on exactly the change it exists to stop.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GATE="$ROOT/scripts/hooks/check-doc-contract-gate.mjs"
WORKFLOW="$ROOT/.github/workflows/ci.yml"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/doc-contract-gate-test.XXXXXX")"
PROBE_DIR="$ROOT/tests/__doc_contract_gate_probe__"
trap 'rm -rf "$TMP_DIR" "$PROBE_DIR"' EXIT

# Run the gate against a mutated copy of the workflow and require exit 1 with a
# specific reason, so a case cannot pass on an unrelated failure.
expect_workflow_reject() {
	local label="$1" needle="$2" mutated="$3"
	local output status

	set +e
	output="$(CI_WORKFLOW_PATH="$mutated" node "$GATE" 2>&1)"
	status=$?
	set -e

	if [ "$status" -eq 0 ]; then
		echo "FAIL: $label: gate passed a workflow it must reject" >&2
		exit 1
	fi
	if ! grep -Fq -- "$needle" <<<"$output"; then
		echo "FAIL: $label: expected '$needle' in:" >&2
		echo "$output" >&2
		exit 1
	fi
}

# Copy the workflow with the YAML on stdin spliced under the `doc-contract:`
# job key.
mutate_job() {
	local out="$1" insert_file="$TMP_DIR/.insert"
	cat >"$insert_file"
	awk -v insert_file="$insert_file" '
		{ print }
		$0 == "  doc-contract:" {
			while ((getline line < insert_file) > 0) print line
			close(insert_file)
		}
	' "$WORKFLOW" >"$out"
}

# Baseline: the committed workflow and test tree must pass, or every rejection
# below is meaningless.
node "$GATE" >/dev/null

mutate_job "$TMP_DIR/if-false.yml" <<<"    if: false"
expect_workflow_reject "job-level if" "jobs.doc-contract.if must be absent" \
	"$TMP_DIR/if-false.yml"

mutate_job "$TMP_DIR/needs-list.yml" <<'YAML'
    needs:
      - changes
YAML
expect_workflow_reject "needs as a block sequence" \
	"jobs.doc-contract.needs must be absent" "$TMP_DIR/needs-list.yml"

mutate_job "$TMP_DIR/needs-scalar.yml" <<<"    needs: changes"
expect_workflow_reject "needs as a scalar" \
	"jobs.doc-contract.needs must be absent" "$TMP_DIR/needs-scalar.yml"

mutate_job "$TMP_DIR/advisory.yml" <<<"    continue-on-error: true"
expect_workflow_reject "continue-on-error" \
	"jobs.doc-contract is a blocking gate" "$TMP_DIR/advisory.yml"

sed 's/^    name: Doc Contract Checks$/    name: Doc Contracts/' \
	"$WORKFLOW" >"$TMP_DIR/renamed.yml"
expect_workflow_reject "renamed job (ruleset context)" \
	'jobs.doc-contract.name must stay "Doc Contract Checks"' \
	"$TMP_DIR/renamed.yml"

# A step-level `if:` neuters the check without touching the job header, and the
# job still reports success.
awk '
	{ print }
	$0 == "      - name: Doc contract tests" { print "        if: false" }
' "$WORKFLOW" >"$TMP_DIR/step-if.yml"
expect_workflow_reject "step-level if" 'step "Doc contract tests" has an' \
	"$TMP_DIR/step-if.yml"

sed '/^        run: pnpm test:doc-contracts$/d' "$WORKFLOW" \
	>"$TMP_DIR/no-run.yml"
expect_workflow_reject "dropped run step" \
	"jobs.doc-contract must run \`pnpm test:doc-contracts\`" \
	"$TMP_DIR/no-run.yml"

# A workflow-level path filter keeps the job from reporting at all, which
# leaves a registered required context expected/missing forever.
awk '
	{ print }
	$0 == "  pull_request:" { print "    paths:\n      - \"src/**\"" }
' "$WORKFLOW" >"$TMP_DIR/paths.yml"
expect_workflow_reject "workflow-level paths filter" \
	"on.pull_request.paths filters the workflow" "$TMP_DIR/paths.yml"

# Drift: a NEW docs-reading test that never reaches `test:doc-contracts`. Run
# against the real tree (no seam) so the case also proves the collection
# universe comes from vitest and not from a hand-rolled glob — `*.spec.ts` and
# a `path.join("docs", …)` call were both invisible to the previous scan.
mkdir -p "$PROBE_DIR"
cat >"$PROBE_DIR/drift.spec.ts" <<'PROBE'
import { readFileSync } from "node:fs";
import path from "node:path";

it("reads a doc through a notation the old scan could not see", () => {
  expect(readFileSync(path.join("docs", "PLAN.md"), "utf8")).toBeTruthy();
});
PROBE

set +e
drift_output="$(node "$GATE" 2>&1)"
drift_status=$?
set -e
rm -rf "$PROBE_DIR"

if [ "$drift_status" -eq 0 ]; then
	echo "FAIL: drift guard passed an uncovered docs-reading test" >&2
	exit 1
fi
if ! grep -Fq "drift.spec.ts reads docs/ at runtime" <<<"$drift_output"; then
	echo "FAIL: drift guard failed for the wrong reason:" >&2
	echo "$drift_output" >&2
	exit 1
fi

echo "PASS: doc-contract gate tests"
