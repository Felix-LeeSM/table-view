#!/usr/bin/env bash
# Regression tests for the latest.json platform completeness gate (#1429).
#
# release.yml builds with `fail-fast: false`, and tauri-action merges each
# leg's updater entry into the draft release's latest.json via read-merge-write.
# A failed leg (v0.3.1: Windows) or a lost concurrent merge drops that
# platform's key, and publishing the manifest makes that OS's clients silently
# report "up to date" forever. scripts/release/verify-latest-json.mjs must
#   1. derive the expected keys from the real release workflow's build matrix
#      (darwin-aarch64 / linux-x86_64 / windows-x86_64) and pass a complete
#      manifest,
#   2. fail on a missing platform key, naming the key,
#   3. fail on a platform entry with an empty signature,
#   4. fail when the manifest has no version,
#   5. fail on malformed JSON,
#   6. fail closed when the workflow yields no matrix target triples,
#   7. fail closed on an unrecognized target triple (mapping drift).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VERIFIER="$ROOT/scripts/release/verify-latest-json.mjs"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/latest-json-gate.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

fail() {
	echo "FAIL: $*" >&2
	exit 1
}

cat >"$TMP_DIR/complete.json" <<'JSON'
{
  "version": "0.4.0",
  "platforms": {
    "darwin-aarch64": { "url": "https://example.invalid/app-aarch64.app.tar.gz", "signature": "sig-darwin" },
    "linux-x86_64": { "url": "https://example.invalid/app-amd64.AppImage", "signature": "sig-linux" },
    "windows-x86_64": { "url": "https://example.invalid/app-x64.msi", "signature": "sig-windows" }
  }
}
JSON

# v0.3.1 shape: the Windows leg failed, darwin/linux merged their keys.
cat >"$TMP_DIR/missing-windows.json" <<'JSON'
{
  "version": "0.4.0",
  "platforms": {
    "darwin-aarch64": { "url": "https://example.invalid/app-aarch64.app.tar.gz", "signature": "sig-darwin" },
    "linux-x86_64": { "url": "https://example.invalid/app-amd64.AppImage", "signature": "sig-linux" }
  }
}
JSON

cat >"$TMP_DIR/empty-signature.json" <<'JSON'
{
  "version": "0.4.0",
  "platforms": {
    "darwin-aarch64": { "url": "https://example.invalid/app-aarch64.app.tar.gz", "signature": "sig-darwin" },
    "linux-x86_64": { "url": "https://example.invalid/app-amd64.AppImage", "signature": "sig-linux" },
    "windows-x86_64": { "url": "https://example.invalid/app-x64.msi", "signature": "" }
  }
}
JSON

cat >"$TMP_DIR/no-version.json" <<'JSON'
{
  "platforms": {
    "darwin-aarch64": { "url": "https://example.invalid/app-aarch64.app.tar.gz", "signature": "sig-darwin" },
    "linux-x86_64": { "url": "https://example.invalid/app-amd64.AppImage", "signature": "sig-linux" },
    "windows-x86_64": { "url": "https://example.invalid/app-x64.msi", "signature": "sig-windows" }
  }
}
JSON

printf '{ not json' >"$TMP_DIR/malformed.json"

cat >"$TMP_DIR/no-targets.yml" <<'YML'
jobs:
  build:
    runs-on: ubuntu-22.04
YML

cat >"$TMP_DIR/unknown-triple.yml" <<'YML'
jobs:
  build:
    strategy:
      matrix:
        include:
          - target: wasm32-unknown-unknown
YML

# 1. Complete manifest passes, with keys derived from the real release.yml
#    build matrix — locks the triple→updater-key mapping to the shipped list.
node "$VERIFIER" "$TMP_DIR/complete.json" >"$TMP_DIR/ok.out" 2>&1 \
	|| fail "complete manifest should pass: $(cat "$TMP_DIR/ok.out")"
grep -Fq "PASS: latest.json lists all 3 expected platform keys (darwin-aarch64, linux-x86_64, windows-x86_64)" "$TMP_DIR/ok.out" \
	|| fail "PASS summary should list the 3 matrix platforms: $(cat "$TMP_DIR/ok.out")"

# 2. Missing platform key (failed build leg / lost merge) must fail, naming it.
if node "$VERIFIER" "$TMP_DIR/missing-windows.json" >"$TMP_DIR/missing.out" 2>&1; then
	fail "manifest missing windows-x86_64 should fail"
fi
grep -Fq "missing platform key 'windows-x86_64'" "$TMP_DIR/missing.out" \
	|| fail "missing-key failure should name the key: $(cat "$TMP_DIR/missing.out")"

# 3. A present key with an empty signature is equally broken for that OS.
if node "$VERIFIER" "$TMP_DIR/empty-signature.json" >"$TMP_DIR/sig.out" 2>&1; then
	fail "manifest with empty signature should fail"
fi
grep -Fq "platform 'windows-x86_64' has no signature" "$TMP_DIR/sig.out" \
	|| fail "empty-signature failure should name the field: $(cat "$TMP_DIR/sig.out")"

# 4. No version — clients cannot compare, update check breaks silently.
if node "$VERIFIER" "$TMP_DIR/no-version.json" >"$TMP_DIR/version.out" 2>&1; then
	fail "manifest without version should fail"
fi
grep -Fq "manifest has no version" "$TMP_DIR/version.out" \
	|| fail "missing-version failure message missing: $(cat "$TMP_DIR/version.out")"

# 5. Malformed JSON must fail, not pass vacuously.
if node "$VERIFIER" "$TMP_DIR/malformed.json" >"$TMP_DIR/malformed.out" 2>&1; then
	fail "malformed manifest should fail"
fi
grep -Fq "cannot read manifest" "$TMP_DIR/malformed.out" \
	|| fail "malformed-manifest failure message missing: $(cat "$TMP_DIR/malformed.out")"

# 6. Fail-closed: a workflow with no matrix targets means the gate would
#    verify nothing — refuse to pass.
if node "$VERIFIER" --workflow "$TMP_DIR/no-targets.yml" "$TMP_DIR/complete.json" \
	>"$TMP_DIR/no-targets.out" 2>&1; then
	fail "workflow without matrix targets should fail closed"
fi
grep -Fq "no matrix target triples" "$TMP_DIR/no-targets.out" \
	|| fail "no-targets failure message missing: $(cat "$TMP_DIR/no-targets.out")"

# 7. Fail-closed: a matrix triple the mapping does not recognize must fail
#    instead of silently shrinking the expected key list.
if node "$VERIFIER" --workflow "$TMP_DIR/unknown-triple.yml" "$TMP_DIR/complete.json" \
	>"$TMP_DIR/unknown.out" 2>&1; then
	fail "unrecognized target triple should fail closed"
fi
grep -Fq "unrecognized target triple" "$TMP_DIR/unknown.out" \
	|| fail "unknown-triple failure message missing: $(cat "$TMP_DIR/unknown.out")"

echo "PASS: latest.json platform completeness gate checks"
