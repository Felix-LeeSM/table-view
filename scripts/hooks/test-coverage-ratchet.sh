#!/usr/bin/env bash
# Smoke check for scripts/check-coverage-ratchet.ts.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHECKER="$ROOT/scripts/check-coverage-ratchet.ts"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/coverage-ratchet-check.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

while read -r git_env_var; do
	[ -n "$git_env_var" ] && unset "$git_env_var"
done < <(git -C "$ROOT" rev-parse --local-env-vars)

assert_contains() {
	local text="$1"
	local needle="$2"
	local label="$3"

	if ! grep -Fq "$needle" <<<"$text"; then
		echo "FAIL: $label: missing '$needle'" >&2
		echo "$text" >&2
		exit 1
	fi
}

write_threshold_sources() {
	local repo="$1"

	mkdir -p "$repo/scripts/hooks"
	cat >"$repo/vite.config.ts" <<'EOF'
export default {
  test: {
    coverage: {
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 70,
      },
    },
  },
};
EOF
	cat >"$repo/lefthook.yml" <<'EOF'
pre-commit:
  commands:
    rust-coverage:
      run: |
        cargo llvm-cov --lib --summary-only \
          --fail-under-lines 70 \
          --fail-under-functions 69 \
          --fail-under-regions 70
      glob: "*.rs"
EOF
	cat >"$repo/scripts/hooks/pre-push-path-router.sh" <<'EOF'
run_rust_coverage() {
  cargo llvm-cov nextest --profile push --lib \
    --fail-under-lines 79 \
    --fail-under-functions 74 \
    --fail-under-regions 80
}
EOF
}

write_full_targets() {
	local repo="$1"

	mkdir -p "$repo/scripts"
	cat >"$repo/scripts/coverage-ratchet-targets.json" <<'EOF'
{
  "version": 1,
  "entries": [
    {
      "id": "frontend.vitest.global",
      "source": "vite.config.ts",
      "metrics": {
        "lines": 70,
        "functions": 70,
        "branches": 70
      }
    },
    {
      "id": "rust.pre_commit.tier1",
      "source": "lefthook.yml",
      "metrics": {
        "lines": 70,
        "functions": 69,
        "regions": 70
      }
    },
    {
      "id": "rust.pre_push.integration",
      "source": "scripts/hooks/pre-push-path-router.sh",
      "metrics": {
        "lines": 79,
        "functions": 74,
        "regions": 80
      }
    }
  ]
}
EOF
}

write_deleted_target() {
	local repo="$1"

	cat >"$repo/scripts/coverage-ratchet-targets.json" <<'EOF'
{
  "version": 1,
  "entries": [
    {
      "id": "frontend.vitest.global",
      "source": "vite.config.ts",
      "metrics": {
        "lines": 70,
        "functions": 70,
        "branches": 70
      }
    },
    {
      "id": "rust.pre_commit.tier1",
      "source": "lefthook.yml",
      "metrics": {
        "lines": 70,
        "functions": 69,
        "regions": 70
      }
    }
  ]
}
EOF
}

init_repo() {
	local repo="$1"

	mkdir -p "$repo"
	git -C "$repo" init --quiet
	git -C "$repo" config user.name "Test User"
	git -C "$repo" config user.email "test@example.invalid"
	git -C "$repo" config commit.gpgsign false
	mkdir -p "$repo/.no-hooks"
	git -C "$repo" config core.hooksPath .no-hooks
	write_threshold_sources "$repo"
	write_full_targets "$repo"
	git -C "$repo" add .
	git -C "$repo" commit --quiet -m "test: base targets"
	git -C "$repo" update-ref refs/remotes/origin/main "$(git -C "$repo" rev-parse HEAD)"
}

run_checker() {
	local repo="$1"

	(
		cd "$ROOT"
		COVERAGE_RATCHET_REPO_ROOT="$repo" npx tsx "$CHECKER"
	)
}

repo="$TMP_DIR/repo"
init_repo "$repo"
write_deleted_target "$repo"

set +e
output="$(run_checker "$repo" 2>&1)"
status=$?
set -e

if [ "$status" -eq 0 ]; then
	echo "FAIL: deleted target unexpectedly passed" >&2
	echo "$output" >&2
	exit 1
fi

assert_contains "$output" "rust.pre_push.integration target is missing" "deleted target"

write_full_targets "$repo"
output="$(run_checker "$repo")"
assert_contains "$output" "Coverage ratchet passed" "full targets"

echo "PASS: coverage ratchet smoke check"
