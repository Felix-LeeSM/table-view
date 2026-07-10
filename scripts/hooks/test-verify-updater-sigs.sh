#!/usr/bin/env bash
# Regression tests for the updater signature release gate (#1430).
#
# Generates a throwaway Ed25519 keypair at runtime and signs a fixture in the
# exact Tauri format (base64-wrapped minisign document, pre-hashed "ED" alg,
# global signature over sig||trusted-comment), then checks that
# scripts/release/verify-updater-sigs.mjs
#   1. passes a signature made with the committed pubkey's own key,
#   2. fails on pubkey/private-key drift (different keypair) mentioning drift,
#   3. fails on a tampered artifact,
#   4. fails on a tampered trusted comment (global signature),
#   5. fails closed when ARTIFACT_PATHS contains no .sig entries.
# No key material is committed: fixtures live and die in mktemp.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VERIFIER="$ROOT/scripts/release/verify-updater-sigs.mjs"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/updater-sig-gate.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

fail() {
	echo "FAIL: $*" >&2
	exit 1
}

# Writes: $TMP_DIR/app.tar.gz, app.tar.gz.sig (signed by key A),
# conf.json (pubkey A), conf-drifted.json (pubkey B — simulated rotation).
node - "$TMP_DIR" <<'FIXTURE'
const { createHash, generateKeyPairSync, sign } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const dir = process.argv[2];
const b64 = (buf) => Buffer.from(buf).toString("base64");
const rawPub = (pub) => pub.export({ format: "der", type: "spki" }).subarray(-32);

function minisignPubkey(keyId, pub) {
  const doc = `untrusted comment: test pubkey\n${b64(Buffer.concat([Buffer.from("Ed"), keyId, rawPub(pub)]))}\n`;
  return b64(doc); // Tauri wraps the whole minisign document in base64
}

function minisignSig(keyId, priv, message) {
  const digest = createHash("blake2b512").update(message).digest();
  const sig = sign(null, digest, priv); // pre-hashed "ED" mode
  const trusted = "timestamp:0\tfile:app.tar.gz";
  const globalSig = sign(null, Buffer.concat([sig, Buffer.from(trusted)]), priv);
  const doc =
    `untrusted comment: signature from test key\n${b64(Buffer.concat([Buffer.from("ED"), keyId, sig]))}\n` +
    `trusted comment: ${trusted}\n${b64(globalSig)}\n`;
  return b64(doc);
}

const keyA = generateKeyPairSync("ed25519");
const keyB = generateKeyPairSync("ed25519");
const keyIdA = Buffer.from("0102030405060708", "hex");
const keyIdB = Buffer.from("1112131415161718", "hex");

const artifact = Buffer.from("fixture updater bundle contents");
fs.writeFileSync(path.join(dir, "app.tar.gz"), artifact);
fs.writeFileSync(path.join(dir, "app.tar.gz.sig"), minisignSig(keyIdA, keyA.privateKey, artifact));

const conf = (pubkey) =>
  JSON.stringify({ plugins: { updater: { pubkey } } });
fs.writeFileSync(path.join(dir, "conf.json"), conf(minisignPubkey(keyIdA, keyA.publicKey)));
fs.writeFileSync(path.join(dir, "conf-drifted.json"), conf(minisignPubkey(keyIdB, keyB.publicKey)));
FIXTURE

# 1. Matching keypair verifies.
node "$VERIFIER" --conf "$TMP_DIR/conf.json" "$TMP_DIR/app.tar.gz.sig" \
	>"$TMP_DIR/ok.out" 2>&1 || fail "matching pubkey should verify: $(cat "$TMP_DIR/ok.out")"
grep -Fq "PASS: 1 updater signature(s)" "$TMP_DIR/ok.out" \
	|| fail "missing PASS summary: $(cat "$TMP_DIR/ok.out")"

# 2. Drifted pubkey (rotated key on one side only) must fail and say so.
if node "$VERIFIER" --conf "$TMP_DIR/conf-drifted.json" "$TMP_DIR/app.tar.gz.sig" \
	>"$TMP_DIR/drift.out" 2>&1; then
	fail "drifted pubkey should fail verification"
fi
grep -Fq "KEY DRIFT" "$TMP_DIR/drift.out" \
	|| fail "drift failure should name key drift: $(cat "$TMP_DIR/drift.out")"

# 3. Tampered artifact must fail.
cp "$TMP_DIR/app.tar.gz" "$TMP_DIR/app.tar.gz.orig"
printf 'X' >>"$TMP_DIR/app.tar.gz"
if node "$VERIFIER" --conf "$TMP_DIR/conf.json" "$TMP_DIR/app.tar.gz.sig" \
	>"$TMP_DIR/tamper.out" 2>&1; then
	fail "tampered artifact should fail verification"
fi
grep -Fq "Ed25519 verification failed" "$TMP_DIR/tamper.out" \
	|| fail "tamper failure should name signature mismatch: $(cat "$TMP_DIR/tamper.out")"
mv "$TMP_DIR/app.tar.gz.orig" "$TMP_DIR/app.tar.gz"

# 4. Tampered trusted comment must fail the global signature check.
node - "$TMP_DIR" <<'TAMPER'
const fs = require("node:fs");
const path = require("node:path");
const dir = process.argv[2];
const sigPath = path.join(dir, "app.tar.gz.sig");
const doc = Buffer.from(fs.readFileSync(sigPath, "utf8"), "base64").toString("utf8");
const lines = doc.split("\n");
lines[2] = "trusted comment: timestamp:9\tfile:evil.tar.gz";
fs.writeFileSync(path.join(dir, "app.tar.gz.tampered-comment.sig"), Buffer.from(lines.join("\n")).toString("base64"));
fs.copyFileSync(path.join(dir, "app.tar.gz"), path.join(dir, "app.tar.gz.tampered-comment"));
TAMPER
if node "$VERIFIER" --conf "$TMP_DIR/conf.json" "$TMP_DIR/app.tar.gz.tampered-comment.sig" \
	>"$TMP_DIR/comment.out" 2>&1; then
	fail "tampered trusted comment should fail verification"
fi
grep -Fq "global signature verification failed" "$TMP_DIR/comment.out" \
	|| fail "comment tamper should name global signature: $(cat "$TMP_DIR/comment.out")"

# 5. Fail-closed: an artifact list with zero .sig entries must not pass.
if ARTIFACT_PATHS='["/some/bundle.dmg","/some/bundle.msi"]' \
	node "$VERIFIER" --conf "$TMP_DIR/conf.json" >"$TMP_DIR/empty.out" 2>&1; then
	fail "zero .sig inputs should fail closed"
fi
grep -Fq "no updater .sig artifacts" "$TMP_DIR/empty.out" \
	|| fail "fail-closed message missing: $(cat "$TMP_DIR/empty.out")"

# ARTIFACT_PATHS mode also verifies (workflow entry point).
ARTIFACT_PATHS="[\"$TMP_DIR/app.tar.gz\",\"$TMP_DIR/app.tar.gz.sig\"]" \
	node "$VERIFIER" --conf "$TMP_DIR/conf.json" >"$TMP_DIR/env.out" 2>&1 \
	|| fail "ARTIFACT_PATHS mode should verify: $(cat "$TMP_DIR/env.out")"

echo "PASS: updater signature gate checks"
