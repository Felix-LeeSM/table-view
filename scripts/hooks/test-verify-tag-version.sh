#!/usr/bin/env bash
# Regression tests for the release tag ↔ tauri.conf.json version gate (#1431).
#
# release.yml's header claims "tag = tauri.conf.json version", but the tag-push
# path never enforced it: the consistency check lives only in
# auto-tag-release.yml, and a manually pushed tag (`git push origin v0.5.0`)
# bypasses it — release.yml would publish a 0.4.2 bundle as v0.5.0.
# scripts/release/verify-tag-version.mjs must
#   1. pass when the tag matches the conf version (explicit arg form),
#   2. read the tag from GITHUB_REF_NAME when no arg is given (CI form),
#   3. resolve src-tauri/tauri.conf.json by default (repo conf, matching tag),
#   4. fail on a mismatched tag, naming both versions,
#   5. fail closed when no tag is available at all,
#   6. fail closed on a non-vX.Y.Z tag (missing `v`, prerelease suffix) —
#      auto-tag-release.yml only ever pushes v<X.Y.Z>, so anything else
#      reaching release.yml is a manual push,
#   7. fail when the conf has no version,
#   8. fail on malformed conf JSON.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VERIFIER="$ROOT/scripts/release/verify-tag-version.mjs"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/tag-version-gate.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

fail() {
	echo "FAIL: $*" >&2
	exit 1
}

cat >"$TMP_DIR/conf.json" <<'JSON'
{ "productName": "Table View", "version": "0.4.2" }
JSON

cat >"$TMP_DIR/prerelease-conf.json" <<'JSON'
{ "productName": "Table View", "version": "0.4.2-rc1" }
JSON

cat >"$TMP_DIR/no-version.json" <<'JSON'
{ "productName": "Table View" }
JSON

printf '{ not json' >"$TMP_DIR/malformed.json"

# 1. Tag matching the conf version passes (explicit arg form).
node "$VERIFIER" --conf "$TMP_DIR/conf.json" v0.4.2 >"$TMP_DIR/ok.out" 2>&1 \
	|| fail "matching tag should pass: $(cat "$TMP_DIR/ok.out")"
grep -Fq "PASS: tag v0.4.2 matches tauri.conf.json version 0.4.2" "$TMP_DIR/ok.out" \
	|| fail "PASS summary should name tag and version: $(cat "$TMP_DIR/ok.out")"

# 2. CI form: release.yml passes no arg — the tag comes from GITHUB_REF_NAME.
GITHUB_REF_NAME=v0.4.2 node "$VERIFIER" --conf "$TMP_DIR/conf.json" \
	>"$TMP_DIR/env.out" 2>&1 \
	|| fail "GITHUB_REF_NAME form should pass: $(cat "$TMP_DIR/env.out")"

# 3. Default conf path resolves the repo's src-tauri/tauri.conf.json.
repo_version="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).version' "$ROOT/src-tauri/tauri.conf.json")"
node "$VERIFIER" "v$repo_version" >"$TMP_DIR/default.out" 2>&1 \
	|| fail "default conf path should resolve repo tauri.conf.json: $(cat "$TMP_DIR/default.out")"

# 4. Issue #1431 scenario: conf is 0.4.2, someone manually pushes v0.5.0.
if node "$VERIFIER" --conf "$TMP_DIR/conf.json" v0.5.0 >"$TMP_DIR/mismatch.out" 2>&1; then
	fail "mismatched tag should fail"
fi
grep -Fq "tag v0.5.0" "$TMP_DIR/mismatch.out" \
	|| fail "mismatch failure should name the tag: $(cat "$TMP_DIR/mismatch.out")"
grep -Fq "0.4.2" "$TMP_DIR/mismatch.out" \
	|| fail "mismatch failure should name the conf version: $(cat "$TMP_DIR/mismatch.out")"

# 5. No tag anywhere — refuse to pass vacuously.
if env -u GITHUB_REF_NAME node "$VERIFIER" --conf "$TMP_DIR/conf.json" \
	>"$TMP_DIR/no-tag.out" 2>&1; then
	fail "missing tag should fail closed"
fi
grep -Fq "no tag" "$TMP_DIR/no-tag.out" \
	|| fail "missing-tag failure message missing: $(cat "$TMP_DIR/no-tag.out")"

# 6. Non-vX.Y.Z tags fail closed even when string-stripping would match:
#    `0.4.2` (no leading v) and `v0.4.2-rc1` (prerelease suffix the `v*.*.*`
#    trigger glob still matches) are shapes the release pipeline never produces.
if node "$VERIFIER" --conf "$TMP_DIR/conf.json" 0.4.2 >"$TMP_DIR/no-v.out" 2>&1; then
	fail "tag without leading v should fail closed"
fi
grep -Fq "not vX.Y.Z" "$TMP_DIR/no-v.out" \
	|| fail "no-v failure message missing: $(cat "$TMP_DIR/no-v.out")"
if node "$VERIFIER" --conf "$TMP_DIR/prerelease-conf.json" v0.4.2-rc1 \
	>"$TMP_DIR/prerelease.out" 2>&1; then
	fail "prerelease tag should fail closed"
fi
grep -Fq "not vX.Y.Z" "$TMP_DIR/prerelease.out" \
	|| fail "prerelease failure message missing: $(cat "$TMP_DIR/prerelease.out")"

# 7. Conf without a version — nothing to compare, fail.
if node "$VERIFIER" --conf "$TMP_DIR/no-version.json" v0.4.2 \
	>"$TMP_DIR/no-version.out" 2>&1; then
	fail "conf without version should fail"
fi
grep -Fq "no version" "$TMP_DIR/no-version.out" \
	|| fail "no-version failure message missing: $(cat "$TMP_DIR/no-version.out")"

# 8. Malformed conf JSON must fail, not pass vacuously.
if node "$VERIFIER" --conf "$TMP_DIR/malformed.json" v0.4.2 \
	>"$TMP_DIR/malformed.out" 2>&1; then
	fail "malformed conf should fail"
fi
grep -Fq "cannot read" "$TMP_DIR/malformed.out" \
	|| fail "malformed-conf failure message missing: $(cat "$TMP_DIR/malformed.out")"

echo "PASS: tag ↔ tauri.conf.json version gate checks"
