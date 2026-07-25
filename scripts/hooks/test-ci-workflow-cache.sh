#!/usr/bin/env bash
# Smoke check for the CI workflow cache and coverage contract.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
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

pull_request_trigger_block="$(extract_trigger_block "$workflow_text" "pull_request")"
changes_block="$(sed -n '/^  changes:/,/^  pr-body:/p' <<<"$workflow_text" | sed '$d')"
# 2026-07-25 — `Frontend Checks` became an AGGREGATION job over the
# `frontend-shard` matrix: the vitest suite runs in the shards and this job
# merges their blob reports and owns the thresholds. Note `/^  frontend:/` does
# not match `  frontend-shard:`, so the two blocks stay disjoint.
# `Integration Tests (Docker)` was measured under the same split and REVERTED
# (the `max-threads = 1` nextest groups made the slowest shard 1294s against
# 1028s undivided), so it stays a single job here.
frontend_shard_block="$(sed -n '/^  frontend-shard:/,/^  frontend:/p' <<<"$workflow_text" | sed '$d')"
frontend_block="$(sed -n '/^  frontend:/,/^  frontend-advisory:/p' <<<"$workflow_text" | sed '$d')"
dependency_security_block="$(sed -n '/^  dependency-security:/,/^  frontend-shard:/p' <<<"$workflow_text" | sed '$d')"
# rust job only (up to rust-static:), so the sql-parser-core cache assertions
# below target the Rust Unit And Storage Tests job, not the rust-static job.
rust_block="$(sed -n '/^  rust:/,/^  rust-static:/p' <<<"$workflow_text" | sed '$d')"
integration_block="$(sed -n '/^  integration-tests:/,/^  # Runtime E2E smoke/p' <<<"$workflow_text" | sed '$d')"
pr_body_block="$(sed -n '/^  pr-body:/,/^  frontend-shard:/p' <<<"$workflow_text" | sed '$d')"
pr_body_only_block="$(sed -n '/^  pr-body:/,/^  doc-size:/p' <<<"$workflow_text" | sed '$d')"
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
assert_contains "$pr_body_block" "run: bash scripts/hooks/test-check-pr-body.sh" "PR body job"
assert_contains "$pr_body_block" "run: node scripts/hooks/check-pr-body.mjs" "PR body job"
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
assert_contains "$frontend_block" "run: git fetch --no-tags --prune --depth=1 origin +refs/heads/main:refs/remotes/origin/main" "frontend coverage ratchet base fetch"
assert_contains "$frontend_block" "COVERAGE_RATCHET_REQUIRE_MAIN: \"1\"" "frontend coverage ratchet require main"
assert_contains "$frontend_block" "run: pnpm exec tsx scripts/check-coverage-ratchet.ts" "frontend coverage ratchet"
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
assert_contains "$dependency_security_block" "bash scripts/hooks/cargo-deny-summary.sh" "dependency security summary"
assert_contains "$dependency_security_block" "working-directory: src-tauri" "dependency security cargo deny cwd"
# Advisories are decoupled from the blocking gate (2026-07-02 incident): the
# blocking job only checks bans/licenses/sources, and the non-blocking
# `dependency-advisories` job owns `cargo deny check advisories`.
assert_contains "$dependency_security_block" "run: cargo deny check bans licenses sources --hide-inclusion-graph" "dependency security blocking cargo deny"
assert_contains "$dependency_security_block" "name: Dependency Advisories (non-blocking)" "dependency advisories job present"
assert_contains "$dependency_security_block" "run: cargo deny check advisories --hide-inclusion-graph" "dependency advisories cargo deny"
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
frontend_advisory_block="$(sed -n '/^  frontend-advisory:/,/^  rust:/p' <<<"$workflow_text" | sed '$d')"
if [ -z "$changes_block" ]; then
	echo "FAIL: change-detection 'changes' job is missing from $WORKFLOW" >&2
	exit 1
fi
assert_contains "$changes_block" "name: Detect Change Scope" "changes job"
assert_contains "$changes_block" "fetch-depth: 0" "changes job needs full history for diff base"
assert_contains "$changes_block" "code_changed: \${{ steps.detect.outputs.code_changed }}" "changes job output wiring"
assert_contains "$changes_block" "run: bash scripts/hooks/detect-change-scope.sh" "changes job detection script"
# Heavy jobs must gate on the change-detection output, fail-closed.
assert_contains "$frontend_block" "- changes" "frontend needs changes"
# Every job in a shard→aggregation pair carries the fail-closed gate. If only
# the aggregation had it, a docs-only run would skip the shards but still run
# the aggregation, which would then fail on missing artifacts; if only the
# shards had it, a broken detector could skip the shards while the aggregation
# graded an empty matrix as success.
assert_contains "$frontend_shard_block" "if: always() && (needs.changes.result != 'success' || needs.changes.outputs.code_changed == 'true')" "frontend-shard docs-only skip gate"
assert_contains "$frontend_block" "if: always() && (needs.changes.result != 'success' || needs.changes.outputs.code_changed == 'true')" "frontend docs-only skip gate"
assert_contains "$rust_block" "if: always() && (needs.changes.result != 'success' || needs.changes.outputs.code_changed == 'true')" "rust docs-only skip gate"
assert_contains "$integration_block" "if: always() && (needs.changes.result != 'success' || needs.changes.outputs.code_changed == 'true')" "integration docs-only skip gate"
assert_contains "$dependency_security_block" "if: always() && (needs.changes.result != 'success' || needs.changes.outputs.code_changed == 'true')" "dependency-security docs-only skip gate"
# pr-body, doc-size, and frontend-advisory stay unconditional — cheap, and
# docs:links (frontend-advisory) is most meaningful on docs-only PRs.
assert_not_contains "$pr_body_only_block" "needs.changes.outputs.code_changed" "pr-body always runs"
assert_not_contains "$frontend_advisory_block" "needs: changes" "frontend-advisory always runs (docs:links matters on docs PRs)"
# Guard against the forbidden shortcut: a workflow-level paths-ignore key (not a
# comment mentioning it) orphans the required checks (expected/missing forever).
if grep -Eq "^[[:space:]]+paths-ignore:" "$WORKFLOW"; then
	echo "FAIL: workflow-level paths-ignore orphans the required checks" >&2
	exit 1
fi

echo "PASS: CI workflow cache and coverage check"
