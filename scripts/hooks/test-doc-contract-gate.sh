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

# The drift probes must sit inside the repo, because the universe under test is
# whatever `vitest list` resolves from vite.config.ts — a $TMPDIR file is not in
# it. `/tmp/` is the repo's already-gitignored scratch root, so a probe cannot
# reach `git add -A` the way the previous `tests/__doc_contract_gate_probe__`
# could. The pre-run wipe matters as much as the trap: a SIGKILL leaves a
# probe behind, and a stale one makes every later local pre-push fail.
PROBE_DIR="$ROOT/tmp/doc-contract-gate-probe"
rm -rf "$PROBE_DIR"
mkdir -p "$PROBE_DIR"
trap 'rm -rf "$TMP_DIR" "$PROBE_DIR"' EXIT INT TERM

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

# The other entry in REQUIRED_RUNS. `pnpm lint` is a doc gate here, not only a
# code gate: check-eslint-static-policy.ts reads the frontend-compat inventory
# and scans docs/roadmap/*.md. Dropping it was a SURVIVED mutation.
awk 'NR == 202 && $0 == "        run: pnpm lint" { next } { print }' \
	"$WORKFLOW" >"$TMP_DIR/no-lint.yml"
expect_workflow_reject "dropped lint step" \
	"jobs.doc-contract must run \`pnpm lint\`" "$TMP_DIR/no-lint.yml"

# A step-level `continue-on-error` leaves the job green while the gate inside
# it fails — the same skipped-check hole, one level down.
awk '
	{ print }
	$0 == "      - name: Doc contract tests" { print "        continue-on-error: true" }
' "$WORKFLOW" >"$TMP_DIR/step-swallow.yml"
expect_workflow_reject "step-level continue-on-error" \
	'step "Doc contract tests" swallows its own failure' \
	"$TMP_DIR/step-swallow.yml"

# Deleting the job outright, rather than neutering it.
sed 's/^  doc-contract:$/  doc-contract-removed:/' "$WORKFLOW" \
	>"$TMP_DIR/no-job.yml"
expect_workflow_reject "removed job" "jobs.doc-contract is missing from" \
	"$TMP_DIR/no-job.yml"

# A workflow-level path filter keeps the job from reporting at all, which
# leaves a registered required context expected/missing forever.
awk '
	{ print }
	$0 == "  pull_request:" { print "    paths:\n      - \"src/**\"" }
' "$WORKFLOW" >"$TMP_DIR/paths.yml"
expect_workflow_reject "workflow-level paths filter" \
	"on.pull_request.paths filters the workflow" "$TMP_DIR/paths.yml"

# Drift: a NEW docs-reading test that never reaches `test:doc-contracts`. Run
# against the real tree (no seam) so each case also proves the collection
# universe comes from vitest and not from a hand-rolled glob.
#
# Every notation the two-signal detector claims to cover gets its own row.
# Before this loop only two of them were pinned (`*.spec.ts` carrying
# `path.join("docs", …)`), so the guard could have regressed on the other four
# while still reporting PASS on the pinned pair.
expect_drift_reject() {
	local filename="$1" body="$2"
	local probe="$PROBE_DIR/$filename" output status

	printf '%s\n' "$body" >"$probe"
	set +e
	output="$(node "$GATE" 2>&1)"
	status=$?
	set -e
	rm -f "$probe"

	if [ "$status" -eq 0 ]; then
		echo "FAIL: drift guard passed an uncovered docs-reading test ($filename)" >&2
		exit 1
	fi
	if ! grep -Fq "$filename reads docs/ at runtime" <<<"$output"; then
		echo "FAIL: drift guard failed for the wrong reason ($filename):" >&2
		echo "$output" >&2
		exit 1
	fi
}

expect_drift_reject "join.spec.ts" 'import { readFileSync } from "node:fs";
import path from "node:path";

it("path.join(\"docs\", …) — invisible to the old scan", () => {
  expect(readFileSync(path.join("docs", "PLAN.md"), "utf8")).toBeTruthy();
});'

expect_drift_reject "backtick.test.ts" 'import { readFileSync } from "node:fs";

const base = "PLAN.md";
it("a template literal path", () => {
  expect(readFileSync(`docs/${base}`, "utf8")).toBeTruthy();
});'

expect_drift_reject "relative.test.ts" 'import { readFileSync } from "node:fs";

it("a ./docs/… literal", () => {
  expect(readFileSync("./docs/PLAN.md", "utf8")).toBeTruthy();
});'

expect_drift_reject "rooted.test.ts" 'import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
it("join(ROOT, \"docs/…\")", () => {
  expect(readFileSync(join(ROOT, "docs/PLAN.md"), "utf8")).toBeTruthy();
});'

# `.test.mts` is inside vitest'"'"'s default include and outside the old
# `find src scripts tests -name '"'"'*.test.ts'"'"'` scan.
expect_drift_reject "modern.test.mts" 'import { readFileSync } from "node:fs";

it("an .mts test", () => {
  expect(readFileSync("docs/PLAN.md", "utf8")).toBeTruthy();
});'

# Vacuity: an empty collection makes every drift assertion above pass on
# nothing. Deleting the guard SURVIVED mutation until this row existed.
cat >"$PROBE_DIR/empty.config.ts" <<'CONFIG'
import { defineConfig } from "vite";

export default defineConfig({ test: { include: [] } });
CONFIG
set +e
empty_output="$(DOC_CONTRACT_VITEST_CONFIG="tmp/doc-contract-gate-probe/empty.config.ts" \
	node "$GATE" 2>&1)"
empty_status=$?
set -e
if [ "$empty_status" -eq 0 ]; then
	echo "FAIL: empty collection: gate reported PASS on an empty universe" >&2
	exit 1
fi
if ! grep -Fq "collected no test files" <<<"$empty_output"; then
	echo "FAIL: empty collection: failed for the wrong reason:" >&2
	echo "$empty_output" >&2
	exit 1
fi

# Fail-closed: a config that cannot load must not degrade into "nothing to
# check". `vitest list` exits non-zero and the gate has no try/catch, so the
# process dies instead of printing PASS.
printf 'throw new Error("broken config");\n' >"$PROBE_DIR/broken.config.ts"
set +e
broken_output="$(DOC_CONTRACT_VITEST_CONFIG="tmp/doc-contract-gate-probe/broken.config.ts" \
	node "$GATE" 2>&1)"
broken_status=$?
set -e
if [ "$broken_status" -eq 0 ]; then
	echo "FAIL: broken config: gate reported PASS instead of failing closed" >&2
	echo "$broken_output" >&2
	exit 1
fi
if grep -Fq "PASS: doc-contract gate" <<<"$broken_output"; then
	echo "FAIL: broken config: gate printed PASS:" >&2
	echo "$broken_output" >&2
	exit 1
fi

# --- invariant 3: the derived CI gate enumeration ---------------------------
#
# The failure this replaces: "which job is gated / ungated / blocking" was
# hand-copied into five documents, and #1845 round 2 found three of them stale
# — one on the line above a row this branch had just corrected. Deriving the
# sets is only half the fix; these rows are the half that keeps a new copy from
# being added back.
PROBE_MD="tmp/doc-contract-gate-probe/enumeration.md"
# The committed blocks come along so a probe is judged against the real tree,
# not against an empty one.
REAL_BLOCKS="docs/contributor-guide/smoke-matrix/h7-ops-security-reliability.md,memory/runbook/pr-merge-gates/memory.md"

expect_enumeration_reject() {
	local label="$1" needle="$2" body="$3" scope="${4:-$PROBE_MD,$REAL_BLOCKS}"
	local probe="$PROBE_DIR/enumeration.md" output status

	printf '%s\n' "$body" >"$probe"
	set +e
	output="$(DOC_CONTRACT_SCAN_ONLY="$scope" node "$GATE" 2>&1)"
	status=$?
	set -e
	rm -f "$probe"

	if [ "$status" -eq 0 ]; then
		echo "FAIL: $label: gate passed a document it must reject" >&2
		exit 1
	fi
	if ! grep -Fq -- "$needle" <<<"$output"; then
		echo "FAIL: $label: expected '$needle' in:" >&2
		echo "$output" >&2
		exit 1
	fi
}

expect_enumeration_reject "re-enumerated contexts" \
	"a paragraph enumerates 3 CI check contexts" \
	'The blocking checks are Frontend Checks, Rust Static Analysis, and
Integration Tests (Docker).'

# The two-item shape the count above is too coarse for. This exact sentence sat
# wrong in .agents/skills/delivery/SKILL.md for months.
expect_enumeration_reject "required-set composition claim" \
	"is a required-set composition claim" \
	'required is review-gate plus Runtime Happy Path, both of them.'

expect_enumeration_reject "duplicate ci-gates home" \
	"a derived enumeration may have exactly one home" \
	'<!-- ci-gates:ungated -->

- `changes`

<!-- /ci-gates -->'

expect_enumeration_reject "unknown ci-gates kind" \
	'unknown ci-gates kind "made-up"' \
	'<!-- ci-gates:made-up -->

- `changes`

<!-- /ci-gates -->'

# A derived enumeration with no home anywhere is the silent-vacuity case: with
# nothing to compare, every other enumeration assertion passes on nothing.
expect_enumeration_reject "no home for a derived enumeration" \
	"no ci-gates:ungated block exists" \
	'Nothing here declares a ci-gates block.' \
	"$PROBE_MD"

# A required context that no job produces. This is what a job rename looks like
# from the runbook side, and it is the half of the list that cannot be derived
# from the repo — so it is the half most worth asserting.
expect_enumeration_reject "required context no job produces" \
	"which no job in" \
	'<!-- ci-gates:required-contexts -->

- `Frontend Checks` and `Definitely Not A Job`

<!-- /ci-gates -->' \
	"$PROBE_MD"

# A real drift: flipping an ungated job to change-gated must make the committed
# `ci-gates:ungated` block wrong. This is what ties the prose to the workflow
# rather than to a reviewer noticing.
awk '
	{ print }
	$0 == "  doc-size:" {
		print "    if: always() && needs.changes.outputs.code_changed == '"'"'true'"'"'"
	}
' "$WORKFLOW" >"$TMP_DIR/regate.yml"
set +e
regate_output="$(CI_WORKFLOW_PATH="$TMP_DIR/regate.yml" node "$GATE" 2>&1)"
regate_status=$?
set -e
if [ "$regate_status" -eq 0 ]; then
	echo "FAIL: re-gated job: the ci-gates:ungated block did not go stale" >&2
	exit 1
fi
if ! grep -Fq "ci-gates:ungated lists" <<<"$regate_output"; then
	echo "FAIL: re-gated job: expected an ungated-block mismatch in:" >&2
	echo "$regate_output" >&2
	exit 1
fi

echo "PASS: doc-contract gate tests"
