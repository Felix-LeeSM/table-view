#!/usr/bin/env node

/**
 * Release gate (#1429): verify the merged updater manifest `latest.json`
 * lists an entry for every platform the release build matrix ships.
 *
 * release.yml builds with `fail-fast: false`, and tauri-action merges each
 * leg's platform entry into the draft release's latest.json via
 * read-merge-write. Two silent failure modes follow:
 *   - a failed leg never adds its key (v0.3.1: the Windows leg failed and the
 *     draft carried darwin/linux only), and
 *   - two legs merging concurrently can lose one leg's write (lost update).
 * Publishing such a manifest makes `check()` on the missing platform report
 * "up to date" forever — the client swallows it silently (updater errors are
 * DEV-log-only, no telemetry — ADR 0036). This gate runs after all build legs
 * and fails the workflow before the draft can be published.
 *
 * The expected platform keys are derived from the build matrix `target:`
 * triples in .github/workflows/release.yml — the SOT for what a release must
 * ship — so adding a matrix leg automatically extends this gate. Derivation
 * fails closed: zero triples or an unrecognized triple is an error, never a
 * shorter expected list.
 *
 * Usage:
 *   node scripts/release/verify-latest-json.mjs [--workflow <release.yml>] <latest.json>
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const DEFAULT_WORKFLOW = path.join(
  REPO_ROOT,
  ".github",
  "workflows",
  "release.yml",
);

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

// Map a Rust target triple from the build matrix to the updater platform key
// (`<os>-<arch>`) that tauri-action writes into latest.json. The arch is the
// triple's first component (aarch64, x86_64, …); anything not mapping to a
// Tauri updater OS is a hard error so regex/mapping drift cannot silently
// shrink the expected key list.
function updaterKeyFromTriple(triple) {
  const arch = triple.split("-")[0];
  const os = triple.includes("-apple-darwin")
    ? "darwin"
    : triple.includes("-windows-")
      ? "windows"
      : triple.includes("-linux-")
        ? "linux"
        : null;
  if (!os)
    throw new Error(`unrecognized target triple in build matrix: ${triple}`);
  return `${os}-${arch}`;
}

function expectedPlatformKeys(workflowPath) {
  const text = fs.readFileSync(workflowPath, "utf8");
  // Matrix legs declare literal `target: <rust-triple>` lines (possibly as the
  // entry's first key, `- target: …`); expression values like
  // `${{ matrix.target }}` do not match the triple shape.
  const triples = [
    ...text.matchAll(
      /^[ \t]+(?:-[ \t]+)?target:[ \t]*([A-Za-z0-9_]+(?:-[A-Za-z0-9_.]+)+)[ \t]*$/gm,
    ),
  ].map((m) => m[1]);
  if (triples.length === 0) {
    throw new Error(`no matrix target triples found in ${workflowPath}`);
  }
  return [...new Set(triples.map(updaterKeyFromTriple))].sort();
}

function main() {
  const argv = process.argv.slice(2);
  let workflowPath = DEFAULT_WORKFLOW;
  const files = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--workflow") {
      workflowPath = argv[++i];
      if (!workflowPath) fail("--workflow requires a path");
    } else {
      files.push(argv[i]);
    }
  }
  if (files.length !== 1) {
    fail(
      "usage: verify-latest-json.mjs [--workflow <release.yml>] <latest.json>",
    );
  }

  let expected;
  try {
    expected = expectedPlatformKeys(workflowPath);
  } catch (error) {
    fail(
      `cannot derive expected platforms from build matrix: ${error.message}`,
    );
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(files[0], "utf8"));
  } catch (error) {
    fail(`cannot read manifest ${path.basename(files[0])}: ${error.message}`);
  }

  const problems = [];
  if (typeof manifest?.version !== "string" || manifest.version === "") {
    problems.push(
      "manifest has no version — clients cannot compare against the installed build",
    );
  }
  const platforms = manifest?.platforms ?? {};
  for (const key of expected) {
    const entry = platforms[key];
    if (!entry) {
      problems.push(
        `missing platform key '${key}' — that OS's clients would silently report ` +
          `"up to date" forever (failed build leg or lost latest.json merge)`,
      );
      continue;
    }
    if (typeof entry.url !== "string" || entry.url === "") {
      problems.push(`platform '${key}' has no url`);
    }
    if (typeof entry.signature !== "string" || entry.signature === "") {
      problems.push(`platform '${key}' has no signature`);
    }
    if (entry.url && entry.signature) {
      console.log(`OK: ${key} -> ${entry.url}`);
    }
  }

  if (problems.length > 0) {
    for (const problem of problems) console.error(`FAIL: ${problem}`);
    fail(
      `latest.json failed platform completeness (${problems.length} problem(s); ` +
        `expected platforms: ${expected.join(", ")})`,
    );
  }
  console.log(
    `PASS: latest.json lists all ${expected.length} expected platform keys (${expected.join(", ")})`,
  );
}

main();
