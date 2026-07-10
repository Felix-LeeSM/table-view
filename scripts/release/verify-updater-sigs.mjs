#!/usr/bin/env node

/**
 * Release gate (#1430): verify Tauri updater signatures against the pubkey
 * COMMITTED in src-tauri/tauri.conf.json — the exact key every shipped client
 * uses. tauri-action signs updater bundles with TAURI_SIGNING_PRIVATE_KEY (a
 * CI secret); if that secret and the committed pubkey drift (e.g. a key
 * rotation updates only one side), every produced `.sig` fails client-side
 * verification and auto-update breaks silently for all users (updater errors
 * are only logged in DEV builds, no telemetry — ADR 0036).
 *
 * Pure Node verification — no minisign binary, no private key, no new secret:
 *   - Tauri `.sig` file  = base64( minisign signature document )
 *   - tauri.conf pubkey  = base64( minisign public key document )
 *   - signature alg "ED" = Ed25519 over BLAKE2b-512(artifact) (pre-hashed),
 *     plus a global Ed25519 signature over (sig || trusted comment).
 *   Both Ed25519 and blake2b512 ship in node:crypto.
 *
 * Usage:
 *   node scripts/release/verify-updater-sigs.mjs [--conf <tauri.conf.json>] <file.sig>...
 *   ARTIFACT_PATHS='["…"]' node scripts/release/verify-updater-sigs.mjs [--conf …]
 *
 * ARTIFACT_PATHS is the tauri-action `artifactPaths` JSON array; entries not
 * ending in `.sig` are ignored. Zero `.sig` inputs is a FAILURE (fail-closed):
 * a release leg that produced no updater signature must not pass this gate.
 * Each `<x>.sig` is verified against its sibling artifact `<x>`.
 */

import { createHash, createPublicKey, verify } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEFAULT_CONF = path.join(REPO_ROOT, "src-tauri", "tauri.conf.json");
// ASN.1 SPKI header for a raw 32-byte Ed25519 public key (RFC 8410).
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

// minisign documents are line-oriented text; Tauri wraps the whole document
// in one more base64 layer. Accept both so local fixtures stay simple.
function decodeMinisignDoc(raw) {
  const text = raw.toString("utf8");
  if (text.startsWith("untrusted comment:")) return text;
  const decoded = Buffer.from(text.trim(), "base64").toString("utf8");
  if (!decoded.startsWith("untrusted comment:")) {
    throw new Error("not a minisign document (missing 'untrusted comment:' line)");
  }
  return decoded;
}

function keyIdHex(keyId) {
  // minisign prints the key ID as big-endian hex of the little-endian bytes.
  return Buffer.from(keyId).reverse().toString("hex").toUpperCase();
}

function parsePubkey(confPath) {
  const conf = JSON.parse(fs.readFileSync(confPath, "utf8"));
  const pubkey = conf?.plugins?.updater?.pubkey;
  if (!pubkey) throw new Error(`no plugins.updater.pubkey in ${confPath}`);
  const lines = decodeMinisignDoc(Buffer.from(pubkey)).split("\n");
  const blob = Buffer.from(lines[1], "base64");
  if (blob.length !== 42 || blob.toString("latin1", 0, 2) !== "Ed") {
    throw new Error("malformed minisign public key (want 'Ed' + 8-byte key ID + 32-byte key)");
  }
  return {
    keyId: blob.subarray(2, 10),
    key: createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, blob.subarray(10)]),
      format: "der",
      type: "spki",
    }),
  };
}

function verifySig(sigPath, pub) {
  const artifactPath = sigPath.slice(0, -".sig".length);
  if (!fs.existsSync(artifactPath)) {
    throw new Error(`artifact not found next to signature: ${path.basename(artifactPath)}`);
  }

  const lines = decodeMinisignDoc(fs.readFileSync(sigPath)).split("\n");
  const sigBlob = Buffer.from(lines[1], "base64");
  if (sigBlob.length !== 74) {
    throw new Error(`malformed signature line (${sigBlob.length} bytes, want 74)`);
  }
  const alg = sigBlob.toString("latin1", 0, 2);
  const keyId = sigBlob.subarray(2, 10);
  const signature = sigBlob.subarray(10);

  // The drift this gate exists to catch: signed with a key other than the
  // committed pubkey. Every client would reject this exact signature.
  if (!keyId.equals(pub.keyId)) {
    throw new Error(
      `KEY DRIFT — signature key ID ${keyIdHex(keyId)} != committed pubkey key ID ` +
        `${keyIdHex(pub.keyId)}. The CI signing secret and src-tauri/tauri.conf.json ` +
        `pubkey no longer match; shipping this release would silently break ` +
        `auto-update for every client.`,
    );
  }

  if (alg !== "ED") {
    // Tauri's signer always produces pre-hashed ("ED") signatures; anything
    // else would not come from the release pipeline.
    throw new Error(`unsupported minisign algorithm '${alg}' (expected pre-hashed 'ED')`);
  }
  // ponytail: whole-file read; switch to streaming blake2b if bundles ever
  // outgrow runner memory.
  const digest = createHash("blake2b512").update(fs.readFileSync(artifactPath)).digest();
  if (!verify(null, digest, pub.key, signature)) {
    throw new Error("Ed25519 verification failed (signature does not match artifact + pubkey)");
  }

  // Global signature covers (raw signature || trusted comment) — same check
  // the client-side minisign verifier performs before trusting the comment.
  const trustedComment = (lines[2] ?? "").replace(/^trusted comment:[ ]?/, "");
  const globalSig = Buffer.from(lines[3] ?? "", "base64");
  if (
    globalSig.length !== 64 ||
    !verify(null, Buffer.concat([signature, Buffer.from(trustedComment)]), pub.key, globalSig)
  ) {
    throw new Error("global signature verification failed (trusted comment tampered?)");
  }
}

function main() {
  const argv = process.argv.slice(2);
  let confPath = DEFAULT_CONF;
  const sigPaths = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--conf") {
      confPath = argv[++i];
      if (!confPath) fail("--conf requires a path");
    } else {
      sigPaths.push(argv[i]);
    }
  }

  if (process.env.ARTIFACT_PATHS) {
    let artifacts;
    try {
      artifacts = JSON.parse(process.env.ARTIFACT_PATHS);
    } catch {
      fail("ARTIFACT_PATHS is not valid JSON");
    }
    if (!Array.isArray(artifacts)) fail("ARTIFACT_PATHS must be a JSON array");
    sigPaths.push(...artifacts.filter((p) => typeof p === "string" && p.endsWith(".sig")));
  }

  if (sigPaths.length === 0) {
    // Fail-closed: no updater signature means the gate verified nothing.
    fail(
      "no updater .sig artifacts to verify — refusing to pass. " +
        "Usage: verify-updater-sigs.mjs [--conf <tauri.conf.json>] <file.sig>... " +
        "(or ARTIFACT_PATHS JSON env)",
    );
  }

  let pub;
  try {
    pub = parsePubkey(confPath);
  } catch (error) {
    fail(`cannot load committed pubkey: ${error.message}`);
  }

  let failures = 0;
  for (const sigPath of sigPaths) {
    try {
      verifySig(sigPath, pub);
      console.log(`OK: ${path.basename(sigPath)} verifies against committed pubkey`);
    } catch (error) {
      failures += 1;
      console.error(`FAIL: ${path.basename(sigPath)} — ${error.message}`);
    }
  }

  if (failures > 0) {
    fail(`${failures}/${sigPaths.length} updater signature(s) failed verification`);
  }
  console.log(
    `PASS: ${sigPaths.length} updater signature(s) verify against the committed pubkey ` +
      `(key ID ${keyIdHex(pub.keyId)})`,
  );
}

main();
