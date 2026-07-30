#!/usr/bin/env bash
# Smoke check for the CI workflow cache and coverage contract.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
WORKFLOW="${CI_WORKFLOW_PATH:-$ROOT/.github/workflows/ci.yml}"
workflow_text="$(cat "$WORKFLOW")"

assert_contains() {
	local text="$1"
	local needle="$2"
	local label="$3"

	if ! grep -Fq -- "$needle" <<<"$text"; then
		echo "FAIL: $label: missing '$needle'" >&2
		exit 1
	fi
}

assert_not_contains() {
	local text="$1"
	local needle="$2"
	local label="$3"

	if grep -Fq -- "$needle" <<<"$text"; then
		echo "FAIL: $label: unexpected '$needle'" >&2
		exit 1
	fi
}

# Whole-line match with the YAML indent stripped. `assert_contains` is a
# SUBSTRING test, so a pinned `run: pnpm lint` also accepted
# `run: pnpm lint || true`, and a pinned selector accepted the same selector
# with `--dir src/types` appended — the pinned text survives as a prefix while
# the step stops checking what it was pinned for. Use this for any needle that
# is a complete `run:` or `if:` line; keep `assert_contains` for fragments of a
# multi-line `run: |` block.
assert_line() {
	local text="$1"
	local needle="$2"
	local label="$3"

	if ! sed 's/^[[:space:]]*//' <<<"$text" | grep -Fxq -- "$needle"; then
		echo "FAIL: $label: missing line '$needle'" >&2
		exit 1
	fi
}

assert_order() {
	local text="$1"
	local first="$2"
	local second="$3"
	local label="$4"
	local first_line
	local second_line

	first_line="$(grep -Fn -- "$first" <<<"$text" | head -n 1 | cut -d: -f1 || true)"
	second_line="$(grep -Fn -- "$second" <<<"$text" | head -n 1 | cut -d: -f1 || true)"

	if [ -z "$first_line" ] || [ -z "$second_line" ] || [ "$first_line" -ge "$second_line" ]; then
		echo "FAIL: $label: expected '$first' before '$second'" >&2
		exit 1
	fi
}

extract_step_block() {
	local text="$1"
	local step_name="$2"

	awk -v step_name="$step_name" '
		$0 == "      - name: " step_name { in_block = 1; print; next }
		in_block && $0 ~ /^      - name: / { exit }
		in_block { print }
	' <<<"$text"
}

extract_trigger_block() {
	local text="$1"
	local trigger_name="$2"

	awk -v trigger_name="$trigger_name" '
		$0 == "  " trigger_name ":" { in_block = 1; print; next }
		in_block && $0 ~ /^[^[:space:]]/ { exit }
		in_block && $0 ~ /^  [[:alnum:]_-]+:/ { exit }
		in_block { print }
	' <<<"$text"
}

# One job: its key line plus everything indented under it, ending at the next
# 2-space key or top-level comment. Blocks used to be `sed` ranges keyed to the
# name of whatever job came NEXT in the file, which made every assertion depend
# on job ORDER: #1991 inserted `doc-contracts` inside the `pr-body` range, that
# put a second `node-version: 22.14.0` in the range, and the PR body job's own
# pin became unguarded — deleting it still passed. Extract by job id instead so
# inserting or reordering jobs cannot widen anyone's block.
extract_job_block() {
	local text="$1"
	local job_id="$2"

	awk -v job_key="  $job_id:" '
		$0 == job_key { in_block = 1; print; next }
		in_block && $0 ~ /^  [^[:space:]]/ { exit }
		in_block { print }
	' <<<"$text"
}

pull_request_trigger_block="$(extract_trigger_block "$workflow_text" "pull_request")"
changes_block="$(extract_job_block "$workflow_text" changes)"
# 2026-07-25 — `Frontend Checks` became an AGGREGATION job over the
# `frontend-shard` matrix: the vitest suite runs in the shards and this job
# merges their blob reports and owns the thresholds.
# `Integration Tests (Docker)` was measured under the same split and REVERTED
# (the `max-threads = 1` nextest groups made the slowest shard 1294s against
# 1028s undivided), so it stays a single job here.
doc_contracts_block="$(extract_job_block "$workflow_text" doc-contracts)"
frontend_shard_block="$(extract_job_block "$workflow_text" frontend-shard)"
frontend_block="$(extract_job_block "$workflow_text" frontend)"
# One block per job, including the blocking gate and its non-blocking advisory
# sibling: a two-job block let either job satisfy an assertion labelled for the
# other, which is the same duplicate-satisfaction hole the pr-body range had.
dependency_security_block="$(extract_job_block "$workflow_text" dependency-security)"
dependency_advisories_block="$(extract_job_block "$workflow_text" dependency-advisories)"
# rust job only, so the sql-parser-core cache assertions below target the
# Rust Unit And Storage Tests job, not the rust-static job.
rust_block="$(extract_job_block "$workflow_text" rust)"
integration_block="$(extract_job_block "$workflow_text" integration-tests)"
pr_body_block="$(extract_job_block "$workflow_text" pr-body)"
integration_disk_telemetry_step="$(extract_step_block "$integration_block" "Show disk usage before integration build")"
integration_disk_cleanup_step="$(extract_step_block "$integration_block" "Free disk headroom before integration build")"
integration_run_step="$(extract_step_block "$integration_block" "Run integration coverage")"

if [ -z "$pr_body_block" ]; then
	echo "FAIL: PR body job is missing from $WORKFLOW" >&2
	exit 1
fi
if [ -z "$pull_request_trigger_block" ]; then
	echo "FAIL: pull_request trigger is missing from $WORKFLOW" >&2
	exit 1
fi
if [ -z "$frontend_block" ]; then
	echo "FAIL: frontend job is missing from $WORKFLOW" >&2
	exit 1
fi
if [ -z "$dependency_security_block" ]; then
	echo "FAIL: dependency security job is missing from $WORKFLOW" >&2
	exit 1
fi

assert_contains "$pr_body_block" "name: PR Body Contract" "PR body job"
assert_contains "$pr_body_block" "node-version: 22.14.0" "PR body job"
assert_line "$pr_body_block" "run: bash scripts/hooks/policy/test-check-pr-body.sh" "PR body job"
assert_line "$pr_body_block" "run: node scripts/hooks/policy/check-pr-body.mjs" "PR body job"
assert_order "$pr_body_block" "- name: Test PR body checker" "- name: Validate PR body" "PR body job order"
assert_contains "$pull_request_trigger_block" "types: [opened, edited, reopened, synchronize]" "pull_request trigger events"
assert_contains "$frontend_block" "cache: pnpm" "frontend pnpm cache"
assert_contains "$frontend_block" "cache-dependency-path: pnpm-lock.yaml" "frontend pnpm cache"
# The Vite transform cache step was removed (audit 2026-07-03): node_modules/.vite
# was a no-op cache — all stored entries were <1MB empty archives because there is
# no vite cacheDir and `vite build` keeps no persistent transform cache. Guard
# against reintroduction.
assert_not_contains "$frontend_block" "Cache Vite transform output" "vite cache step removed"
assert_not_contains "$frontend_block" "node_modules/.vite" "vite cache path removed"
assert_line "$frontend_block" "run: git fetch --no-tags --prune --depth=1 origin +refs/heads/main:refs/remotes/origin/main" "frontend coverage ratchet base fetch"
assert_contains "$frontend_block" "COVERAGE_RATCHET_REQUIRE_MAIN: \"1\"" "frontend coverage ratchet require main"
assert_line "$frontend_block" "run: pnpm exec tsx scripts/check-coverage-ratchet.ts" "frontend coverage ratchet"
assert_order "$frontend_block" "- name: Fetch coverage ratchet base" "- name: Coverage ratchet" "frontend coverage ratchet base fetch order"
# The vitest suite runs in the `frontend-shard` matrix and `Frontend Checks`
# merges the blobs. The gate is NOT weakened by the split, and these assertions
# are what keeps that true: shards must zero the thresholds (a 1/3 slice cannot
# clear an 85% global floor) and the merge must NOT — it re-applies the real
# vite.config.ts floors over the union.
assert_contains "$frontend_shard_block" "name: Frontend Tests (shard \${{ matrix.shard }}/3)" "frontend shard job"
assert_contains "$frontend_shard_block" "--shard=\${{ matrix.shard }}/3" "frontend shard partitioning"
assert_contains "$frontend_shard_block" "--reporter=blob" "frontend shard blob report"
assert_contains "$frontend_shard_block" "--coverage.thresholds.lines 0" "frontend shard defers thresholds to the merge"
assert_contains "$frontend_shard_block" "uses: actions/upload-artifact@v4" "frontend shard blob upload"
assert_contains "$frontend_shard_block" "if-no-files-found: error" "frontend shard blob upload fails loudly"
assert_contains "$frontend_block" "pnpm exec vitest --mergeReports=.vitest-reports" "frontend coverage gate"
assert_not_contains "$frontend_block" "--coverage.thresholds" "frontend merge must enforce the real thresholds"
# A merge of 2 of 3 blobs still succeeds — it just reports a number computed
# from two thirds of the suite, which can clear the floor. Lock the count check.
assert_contains "$frontend_block" "ls .vitest-reports/blob-*.json | wc -l)\" -eq 3" "frontend merge asserts all three blobs arrived"
assert_contains "$frontend_block" "- name: Require test matrix success" "frontend aggregation grades the matrix"
assert_contains "$frontend_block" "- frontend-shard" "frontend aggregation depends on the shards"
assert_order "$frontend_block" "- name: Require test matrix success" "- name: Checkout" "frontend grades the matrix before any setup"
assert_contains "$dependency_security_block" "name: Dependency Security" "dependency security job"
assert_contains "$dependency_security_block" "timeout-minutes: 20" "dependency security job"
assert_contains "$dependency_security_block" "CARGO_DENY_VERSION: \"0.19.9\"" "dependency security job"
assert_contains "$dependency_security_block" "toolchain: 1.91.0" "dependency security job"
assert_contains "$dependency_security_block" "path: |" "dependency security cache"
assert_contains "$dependency_security_block" "~/.cargo/bin/cargo-deny" "dependency security cache"
assert_contains "$dependency_security_block" "key: cargo-deny-\${{ runner.os }}-\${{ env.CARGO_DENY_VERSION }}" "dependency security cache"
assert_contains "$dependency_security_block" "cargo install cargo-deny --version \"\$CARGO_DENY_VERSION\" --locked --force" "dependency security install"
assert_line "$dependency_security_block" "run: bash scripts/hooks/apply/cargo-deny-summary.sh" "dependency security summary"
assert_contains "$dependency_security_block" "working-directory: src-tauri" "dependency security cargo deny cwd"
# Advisories are decoupled from the blocking gate (2026-07-02 incident): the
# blocking job only checks bans/licenses/sources, and the non-blocking
# `dependency-advisories` job owns `cargo deny check advisories`.
assert_line "$dependency_security_block" "run: cargo deny check bans licenses sources --hide-inclusion-graph" "dependency security blocking cargo deny"
assert_contains "$dependency_advisories_block" "name: Dependency Advisories (non-blocking)" "dependency advisories job present"
assert_line "$dependency_advisories_block" "run: cargo deny check advisories --hide-inclusion-graph" "dependency advisories cargo deny"
assert_order "$dependency_security_block" "- name: Dependency security summary" "- name: Run cargo deny" "dependency security summary before gate"
# rust job caches both src-tauri and the sql-parser-core path crate's own target
# (audit 2026-07-03): the standalone `--manifest-path src-tauri/sql-parser-core`
# test compiles into a separate target dir that `src-tauri -> target` never cached,
# so it recompiled every run.
assert_contains "$rust_block" "src-tauri -> target" "rust cache src-tauri workspace"
assert_contains "$rust_block" "src-tauri/sql-parser-core -> target" "rust cache sql-parser-core workspace"
assert_contains "$rust_block" "cache-bin: false" "rust cache"
assert_contains "$rust_block" "save-if: \${{ github.ref == 'refs/heads/main' }}" "rust cache"
assert_contains "$integration_block" "workspaces: src-tauri -> target" "integration rust cache"
assert_contains "$integration_block" "cache-bin: false" "integration rust cache"
assert_contains "$integration_block" "save-if: \${{ github.ref == 'refs/heads/main' }}" "integration rust cache"
assert_order "$integration_block" "- name: Show disk usage before integration build" "- name: Free disk headroom before integration build" "integration disk cleanup after telemetry"
assert_order "$integration_block" "- name: Free disk headroom before integration build" "- name: Cache Rust artifacts" "integration disk cleanup before cache restore"
assert_order "$integration_block" "- name: Cache Rust artifacts" "- name: Run integration coverage" "integration rust cache before coverage run"
assert_order "$integration_block" "- name: Free disk headroom before integration build" "- name: Run integration coverage" "integration disk cleanup before coverage run"
assert_contains "$integration_disk_telemetry_step" "df -h /" "integration disk telemetry step"
assert_contains "$integration_disk_telemetry_step" "du -sh src-tauri/target" "integration disk telemetry step"
assert_contains "$integration_disk_telemetry_step" "docker system df" "integration disk telemetry step"
assert_contains "$integration_disk_cleanup_step" "sudo apt-get clean" "integration disk cleanup step"
# 2026-07-25 — the SDK deletions and `docker system prune -af` were removed:
# the runner reports 86G free BEFORE any cleanup and the prune reclaimed
# 1.765GB, so the step was spending 130s (13% of the job) to go from 86G to
# 103G. The prune additionally evicted base images the testcontainers re-pull.
# Guard against reintroduction, same as the no-op Vite cache above.
assert_not_contains "$integration_disk_cleanup_step" "docker system prune -af" "integration disk prune removed (no-op, 1.765GB of 86G free)"
assert_not_contains "$integration_disk_cleanup_step" "/usr/local/lib/android" "integration SDK deletion removed (no-op)"
assert_not_contains "$integration_disk_cleanup_step" "/usr/share/dotnet" "integration SDK deletion removed (no-op)"
assert_not_contains "$integration_disk_cleanup_step" "/opt/ghc" "integration SDK deletion removed (no-op)"
# Rust integration coverage gate promoted from the pre-push rust route (audit
# 2026-07-03 #6). The integration-tests job owns the coverage floor: it
# installs pinned cargo-llvm-cov + cargo-nextest with the llvm-tools component
# and runs `cargo llvm-cov nextest --profile push` at the ratchet-locked
# thresholds (lines 80 / functions 75 / regions 80). The extraction in
# scripts/check-coverage-ratchet.ts reads these same flags from this workflow.
assert_contains "$integration_block" "components: llvm-tools-preview" "integration llvm-tools component"
assert_contains "$integration_block" "uses: taiki-e/install-action@v2" "integration coverage tool installer"
assert_contains "$integration_block" "tool: cargo-llvm-cov@0.8.7,cargo-nextest@0.9.137" "integration coverage tool pins"
assert_contains "$integration_run_step" "working-directory: src-tauri" "integration coverage cwd"
assert_contains "$integration_run_step" "cargo llvm-cov nextest --profile push --lib" "integration coverage command"
# 2026-07-25 — a 4-way `integration-shard` split was tried and reverted: the
# `max-threads = 1` nextest groups made the slowest shard 1294s against 1028s
# for the undivided job. Enumerate the binaries so a future split (or an edit)
# cannot silently drop one — a missing target lowers the coverage total rather
# than failing, which is exactly the rubber-stamp failure this gate exists to
# prevent.
for target in storage_integration query_integration schema_integration \
	value_search_integration fixture_loading mongo_integration mysql_integration \
	duckdb_file_analytics mariadb_ddl_preview mssql_connection_routing \
	mssql_integration oracle_integration redis_integration; do
	assert_contains "$integration_run_step" "--test $target" "integration coverage keeps $target"
done
assert_contains "$integration_run_step" "--fail-under-lines 80" "integration coverage lines threshold"
assert_contains "$integration_run_step" "--fail-under-functions 75" "integration coverage functions threshold"
assert_contains "$integration_run_step" "--fail-under-regions 80" "integration coverage regions threshold"

# docs/memory-only skip gate (audit 2026-07-03 #5). The `changes` job classifies
# the change set; heavy jobs gate on it with a FAIL-CLOSED `if:` — skip only when
# `changes` succeeded AND said docs-only, so a broken detector runs full instead
# of letting a skip satisfy a required check. Never regress into a workflow-level
# paths-ignore (would orphan the required checks).
frontend_advisory_block="$(extract_job_block "$workflow_text" frontend-advisory)"
if [ -z "$changes_block" ]; then
	echo "FAIL: change-detection 'changes' job is missing from $WORKFLOW" >&2
	exit 1
fi
assert_contains "$changes_block" "name: Detect Change Scope" "changes job"
assert_contains "$changes_block" "fetch-depth: 0" "changes job needs full history for diff base"
assert_contains "$changes_block" "code_changed: \${{ steps.detect.outputs.code_changed }}" "changes job output wiring"
assert_contains "$changes_block" "docs_changed: \${{ steps.detect.outputs.docs_changed }}" "changes job docs output wiring"
assert_line "$changes_block" "run: bash scripts/hooks/analyze/detect-change-scope.sh" "changes job detection script"
# Heavy jobs must gate on the change-detection output, fail-closed.
assert_contains "$frontend_block" "- changes" "frontend needs changes"
# Every job in a shard→aggregation pair carries the fail-closed gate. If only
# the aggregation had it, a docs-only run would skip the shards but still run
# the aggregation, which would then fail on missing artifacts; if only the
# shards had it, a broken detector could skip the shards while the aggregation
# graded an empty matrix as success.
# All four gate spellings come from ONE condition, so the notations cannot
# drift apart the way a second hand-written literal would:
#   CODE_COND       the code lane, fail-closed on a broken detector
#   CODE_GATE       job level, `always()` so a failed `needs` still evaluates it
#   CODE_STEP_GATE  step level, where the implicit success() is what we want
#   DOCS_GATE       CODE_GATE plus the docs clause — the required aggregation,
#                   which must also run on a docs-only set to report that lane
#   DOCS_ONLY_GATE  the COMPLEMENT of CODE_GATE: the reader runs on exactly the
#                   sets where the heavy lane skips and there is still
#                   something to re-read
# Every literal is matched as a WHOLE `if:` line and the truth table below is
# EVALUATED from these same strings, so this block is the only copy of the gate
# in this file.
CODE_COND="needs.changes.result != 'success' || needs.changes.outputs.code_changed == 'true'"
CODE_GATE="if: always() && ($CODE_COND)"
CODE_STEP_GATE="if: $CODE_COND"
DOCS_GATE="if: always() && ($CODE_COND || needs.changes.outputs.docs_changed == 'true')"
DOCS_ONLY_GATE="if: always() && needs.changes.result == 'success' && needs.changes.outputs.code_changed != 'true' && needs.changes.outputs.docs_changed == 'true'"
assert_line "$frontend_shard_block" "$CODE_GATE" "frontend-shard code gate"
assert_line "$frontend_block" "$DOCS_GATE" "frontend runs on the docs lane too, to report it"
assert_line "$doc_contracts_block" "$DOCS_ONLY_GATE" "doc-contracts docs-only gate"

# PROJECTION (#1991 round 2). `Doc Contracts` is not a context in the
# `pr_to_main` ruleset, and GitHub counts a skipped required check as satisfied,
# so a red docs-only lane would leave the PR mergeable. The already-required
# `Frontend Checks` aggregation reports it instead — the same mechanism it
# already uses for the shard matrix. Three things have to hold, and all three
# are pinned as whole lines: a substring pin is what let five weakening edits
# through (#2003).
assert_contains "$frontend_block" "- doc-contracts" "frontend needs doc-contracts to read its result"
grading_step="$(extract_step_block "$frontend_block" "Require test matrix success")"
assert_line "$grading_step" "if [ \"\${{ needs.changes.result }}\" != \"success\" ] || [ \"\${{ needs.changes.outputs.code_changed }}\" = \"true\" ]; then" "grading step branches on the code lane"
assert_line "$grading_step" "[ \"\${{ needs.frontend-shard.result }}\" = \"success\" ] || { echo \"Frontend test matrix result: \${{ needs.frontend-shard.result }}\"; exit 1; }" "grading step fails on a red shard matrix"
assert_line "$grading_step" "[ \"\${{ needs.doc-contracts.result }}\" = \"success\" ] || { echo \"Doc Contracts result: \${{ needs.doc-contracts.result }}\"; exit 1; }" "grading step fails on red doc contracts"

# The projection only pays for itself if the docs-only run of the required job
# is thin, and the download/merge steps would additionally FAIL there on
# artifacts the skipped shards never uploaded. So every step except the grading
# step and the checkout carries the code lane's gate. Derived by walking the
# job, not a hand-kept list: add a heavy step without the gate and this fails.
frontend_ungated_steps="Require test matrix success|Checkout"
while IFS= read -r step_name; do
	step_block="$(extract_step_block "$frontend_block" "$step_name")"
	case "|$frontend_ungated_steps|" in
	*"|$step_name|"*)
		# Not `needs.changes.outputs.code_changed` — the grading step reads that
		# output inside its `run:` body on purpose. What it must not have is the
		# step-level gate, which would skip it on the very lane it grades.
		assert_not_contains "$step_block" "$CODE_STEP_GATE" \
			"frontend step '$step_name' must run on the docs lane too"
		;;
	*)
		assert_line "$step_block" "$CODE_STEP_GATE" \
			"frontend step '$step_name' must be gated on the code lane"
		;;
	esac
done < <(sed -n 's/^      - name: //p' <<<"$frontend_block")
assert_contains "$doc_contracts_block" "name: Doc Contracts" "doc-contracts job name"
assert_contains "$doc_contracts_block" "needs: changes" "doc-contracts needs changes"
# A `continue-on-error` anywhere in this job turns both doc-reading checks into
# advisories that report green while failing — the docs-only lane's whole point
# is that it reports. Job level or step level, neither is allowed here.
assert_not_contains "$doc_contracts_block" "continue-on-error" "doc-contracts must report its failures"
# The doc contracts were enumerated by mutation (overwrite then delete every
# docs/, memory/, *.md file and diff the failing set against a clean run) and
# landed on five files across exactly these three roots. Directory-scoped, not a
# per-file allowlist: #1845 deleted one of those and re-adding it reopens the
# hole. Drop a root here and the docs-only lane silently stops covering it.
# Whole-line, not substring: appending `--dir src/types` or `--exclude 'tests/**'`
# narrows the selector back below the five files while leaving the pin intact.
assert_line "$doc_contracts_block" "run: pnpm exec vitest run scripts/ tests/ src/types/" "doc-contracts runs the doc contract roots"
# Same command the aggregation job runs, so the two lint paths cannot drift.
assert_line "$doc_contracts_block" "run: pnpm lint" "doc-contracts runs the doc-reading static policy"
assert_line "$frontend_block" "run: pnpm lint" "frontend still runs lint on code changes"

# Truth table over the change-detection outputs: the doc-reading checks must run
# EXACTLY once on every classification, and never zero times when something
# changed. The rows are decided by EVALUATING the two pinned `if:` literals
# above, not by a shell rewrite of them. A hand-written mirror is what this
# looked like first, and it survived both of these:
#   - `code_changed != 'true'` -> `== 'true'` in the docs-only gate and in
#     ci.yml together: a docs-only set would then run neither lane.
#   - the `needs.changes.result != 'success'` clause deleted from CODE_GATE and
#     from ci.yml together: a dead `changes` job would skip every heavy
#     required job, and GitHub counts a skipped required check as satisfied.
# Editing the YAML and the pinned literal in one go is exactly what a human does
# when this file goes red, so the table has to move with them.
#
# Translation, not a parser: GitHub's `if:` grammar here is `&&`, `||`, `()`,
# `==`, `!=`, quoted literals and `always()` — all of which `[[ ]]` already
# means the same way once the context lookups are substituted.
gate_runs() { # $1=pinned `if:` literal, $2=changes result, $3=code, $4=docs
	local expr="${1#if: }"
	local res="$2" code="$3" docs="$4"

	expr="${expr//\'/\"}"
	case "$expr" in
	# No status function in an `if:` implies `success()`, so the job is skipped
	# outright when `changes` fails — the opposite of fail-closed. Model that
	# rather than treating a dropped `always()` as noise.
	*"always()"*) expr="${expr//always()/true}" ;;
	*) expr="\"$res\" == \"success\" && ( $expr )" ;;
	esac
	expr="${expr//needs.changes.result/\"$res\"}"
	expr="${expr//needs.changes.outputs.code_changed/\"$code\"}"
	expr="${expr//needs.changes.outputs.docs_changed/\"$docs\"}"
	# A renamed output would otherwise survive as a bare non-empty string and
	# quietly evaluate to true. Fail loudly instead.
	case "$expr" in
	*needs.*)
		echo "FAIL: gate truth table: unsubstituted context lookup in '$expr'" >&2
		exit 1
		;;
	esac
	eval "[[ $expr ]]"
}
# result|code|docs|expected number of lanes covering the doc readers
while IFS='|' read -r res code docs want; do
	got=0
	gate_runs "$CODE_GATE" "$res" "$code" "$docs" && got=$((got + 1))
	gate_runs "$DOCS_ONLY_GATE" "$res" "$code" "$docs" && got=$((got + 1))
	if [ "$got" -ne "$want" ]; then
		echo "FAIL: gate truth table: result=$res code=$code docs=$docs ran $got lane(s), expected $want" >&2
		exit 1
	fi
	# Second half of the projection: a lane that runs is worth nothing unless a
	# REQUIRED context runs with it to report the outcome. `Frontend Checks` has
	# to be reachable on exactly the rows where a lane is.
	required=0
	gate_runs "$DOCS_GATE" "$res" "$code" "$docs" && required=1
	if [ "$required" -ne "$want" ]; then
		echo "FAIL: gate truth table: result=$res code=$code docs=$docs ran $got lane(s) but the required aggregation ran $required time(s)" >&2
		exit 1
	fi
done <<'TABLE'
failure|||1
cancelled|||1
success|true|true|1
success|true|false|1
success|false|true|1
success|false|false|0
TABLE
assert_line "$rust_block" "$CODE_GATE" "rust docs-only skip gate"
assert_line "$integration_block" "$CODE_GATE" "integration docs-only skip gate"
assert_line "$dependency_security_block" "$CODE_GATE" "dependency-security docs-only skip gate"
# pr-body, doc-size, and frontend-advisory stay unconditional — cheap, and
# docs:links (frontend-advisory) is most meaningful on docs-only PRs.
assert_not_contains "$pr_body_block" "needs.changes.outputs.code_changed" "pr-body always runs"
assert_not_contains "$frontend_advisory_block" "needs: changes" "frontend-advisory always runs (docs:links matters on docs PRs)"
# Guard against the forbidden shortcut: a workflow-level paths-ignore key (not a
# comment mentioning it) orphans the required checks (expected/missing forever).
if grep -Eq "^[[:space:]]+paths-ignore:" "$WORKFLOW"; then
	echo "FAIL: workflow-level paths-ignore orphans the required checks" >&2
	exit 1
fi

# DOCS-READING JOBS (#1845). This is the list `docs_changed` exists for, and
# the one check kept from the deleted allowlist+drift-guard design.
#
# The hole: doc-reading checks were gated on `code_changed` alone, so a docs-only
# PR skipped exactly the checks guarding the documents it edited — and GitHub
# counts a skipped required check as satisfied. #1841 merged that way; #1844 and
# #1847 merged reading `Frontend Checks: skipping`.
#
# The fix is the classification: `changes` also emits `docs_changed`, and the
# doc readers gate on it. #1991 moved them off the shard matrix and its
# aggregation — running three shards of a 638-file suite to reach five doc
# contract files, counted with
# `git ls-files | grep -E '\.(test|spec)\.(ts|tsx)$' | grep -vE '^e2e/' | wc -l`
# — into the single `doc-contracts` job.
#
# What a human still has to get right is WHICH jobs carry the clause, so that is
# what this asserts — exactly the declared jobs, and no other. `frontend` is on
# the list without reading a single doc: it is the required context projecting
# `doc-contracts`'s result, asserted above, and it cannot report a lane it does
# not run on. Add a docs-reading check to another job and this fails until the
# clause and this list are both updated.
docs_reading_jobs="doc-contracts frontend"
for job_id in $(grep -Eo '^  [a-z][a-z0-9-]*:' "$WORKFLOW" | tr -d ' :'); do
	# Stop at the next job key OR a top-level comment: the DOCS-READING JOBS
	# note trails the last job and would otherwise be read as part of it.
	block="$(awk -v j="  $job_id:" '$0 == j {f=1; next} f && /^  [a-z#]/ {exit} f {print}' "$WORKFLOW")"
	case " $docs_reading_jobs " in
	*" $job_id "*)
		assert_contains "$block" "needs.changes.outputs.docs_changed == 'true'" \
			"$job_id is a declared docs-reading job and must gate on docs_changed"
		;;
	*)
		assert_not_contains "$block" "needs.changes.outputs.docs_changed" \
			"$job_id gates on docs_changed but is not in the docs-reading list"
		;;
	esac
done

# The note in the workflow must list exactly the declared jobs, so the comment a
# maintainer reads cannot drift from the assertions above. Compare SETS, both
# directions: a substring needle cannot do this, because `#   frontend` is a
# prefix of `#   frontend-shard` (the shard entry alone satisfied the `frontend`
# needle, and an invented `#   rust` entry was invisible). A note entry is a
# note-indented comment whose first word is the job id; the continuation lines
# are indented past that column and do not match, so an empty capture (e.g. the
# note reindented or deleted) also fails.
note_jobs="$(grep -Eo '^  #   [a-z][a-z0-9-]*' "$WORKFLOW" | awk '{print $2}' | sort -u)"
declared_jobs="$(tr ' ' '\n' <<<"$docs_reading_jobs" | sed '/^$/d' | sort -u)"
if [ "$note_jobs" != "$declared_jobs" ]; then
	echo "FAIL: DOCS-READING JOBS note lists [$(tr '\n' ' ' <<<"$note_jobs")] but the declared list is [$docs_reading_jobs]" >&2
	exit 1
fi

echo "PASS: CI workflow cache and coverage check"
