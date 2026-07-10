#!/usr/bin/env node

/**
 * Release gate (#1431): verify the pushed release tag matches the version in
 * src-tauri/tauri.conf.json before anything builds.
 *
 * release.yml's header claims "tag = tauri.conf.json version", but the tag
 * consistency check lives only in auto-tag-release.yml — the workflow that
 * *creates* tags. A manually pushed tag (`git push origin v0.5.0`) bypasses it
 * entirely, and release.yml would publish the checked-out bundle (say 0.4.2)
 * under a v0.5.0 release: a version-mismatch release, and an updater manifest
 * whose version disagrees with every bundle in it.
 *
 * Comparison rule (fail-closed): the tag must be exactly `v<X.Y.Z>` — the only
 * shape auto-tag-release.yml ever pushes (`v$version` after a strict
 * `^[0-9]+\.[0-9]+\.[0-9]+$` check) — and `<X.Y.Z>` must string-equal the conf
 * version. Anything else (missing `v`, prerelease suffix the `v*.*.*` trigger
 * glob still matches, missing tag, unreadable conf) fails instead of passing
 * vacuously.
 *
 * Usage:
 *   node scripts/release/verify-tag-version.mjs [--conf <tauri.conf.json>] [<tag>]
 *
 * The tag defaults to $GITHUB_REF_NAME (the tag name on tag-push runs).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const DEFAULT_CONF = path.join(REPO_ROOT, "src-tauri", "tauri.conf.json");

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function main() {
  const argv = process.argv.slice(2);
  let confPath = DEFAULT_CONF;
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--conf") {
      confPath = argv[++i];
      if (!confPath) fail("--conf requires a path");
    } else {
      rest.push(argv[i]);
    }
  }
  if (rest.length > 1) {
    fail("usage: verify-tag-version.mjs [--conf <tauri.conf.json>] [<tag>]");
  }

  const tag = rest[0] ?? process.env.GITHUB_REF_NAME ?? "";
  if (tag === "") {
    fail(
      "no tag given (argument or GITHUB_REF_NAME) — refusing to pass without one",
    );
  }

  const match = /^v(\d+\.\d+\.\d+)$/.exec(tag);
  if (!match) {
    fail(
      `tag '${tag}' is not vX.Y.Z — auto-tag-release.yml only pushes v<X.Y.Z> ` +
        `tags, so this shape can only come from a manual push; refusing to release from it`,
    );
  }
  const tagVersion = match[1];

  let confVersion;
  try {
    confVersion = JSON.parse(fs.readFileSync(confPath, "utf8")).version;
  } catch (error) {
    fail(`cannot read ${path.basename(confPath)}: ${error.message}`);
  }
  if (typeof confVersion !== "string" || confVersion === "") {
    fail(`no version in ${confPath}`);
  }

  if (tagVersion !== confVersion) {
    fail(
      `tag ${tag} does not match tauri.conf.json version ${confVersion} — ` +
        `a manually pushed tag bypassed auto-tag-release.yml; delete the tag and ` +
        `retag the commit whose conf version matches`,
    );
  }
  console.log(
    `PASS: tag ${tag} matches tauri.conf.json version ${confVersion}`,
  );
}

main();
