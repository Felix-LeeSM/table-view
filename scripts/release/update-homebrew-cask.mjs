#!/usr/bin/env node

/**
 * Generates/updates a Homebrew Cask file in a separate tap repo
 * from a released GitHub tag.
 */

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const requiredEnv = {
  GITHUB_TOKEN: process.env.GITHUB_TOKEN,
  GITHUB_REPOSITORY: process.env.GITHUB_REPOSITORY,
  RELEASE_TAG: process.env.RELEASE_TAG,
  HOMEBREW_TAP_REPO_PATH: process.env.HOMEBREW_TAP_REPO_PATH,
  HOMEBREW_TAP_PATH: process.env.HOMEBREW_TAP_PATH,
};

for (const [name, value] of Object.entries(requiredEnv)) {
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
}

const {
  GITHUB_TOKEN,
  GITHUB_REPOSITORY,
  RELEASE_TAG,
  HOMEBREW_TAP_REPO_PATH,
  HOMEBREW_TAP_PATH,
  HOMEBREW_CASK_NAME = "table-view",
  HOMEBREW_APP_NAME = "Table View.app",
  HOMEBREW_APP_TITLE = "Table View",
  HOMEBREW_DESCRIPTION = "Local database client for MongoDB, PostgreSQL, MySQL, and SQLite.",
} = process.env;

const HOMEBREW_HOMEPAGE =
  process.env.HOMEBREW_HOMEPAGE ?? `https://github.com/${GITHUB_REPOSITORY}`;
const tapFilePath = path.resolve(HOMEBREW_TAP_REPO_PATH, HOMEBREW_TAP_PATH);
const releaseTag = RELEASE_TAG;
const version = releaseTag.startsWith("v") ? releaseTag.slice(1) : releaseTag;

const headers = {
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${GITHUB_TOKEN}`,
  "User-Agent": "table-view-cask-sync",
};

async function getJson(url) {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`GitHub API request failed (${response.status}): ${url}`);
  }

  return response.json();
}

async function getText(url, accept = "application/octet-stream") {
  const response = await fetch(url, {
    headers: {
      ...headers,
      Accept: accept,
    },
  });
  if (!response.ok) {
    throw new Error(`Asset download failed (${response.status}): ${url}`);
  }

  return response.text();
}

async function getShaFromReleaseAsset(asset) {
  const text = await getText(asset.browser_download_url);
  const firstToken = text.trim().split(/\s+/, 1)[0];
  if (!/^[a-f0-9]{64}$/i.test(firstToken)) {
    throw new Error(`Cannot parse SHA from ${asset.name}`);
  }

  return firstToken;
}

function escapeRubyString(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r\n/g, "\\n")
    .replace(/\n/g, "\\n");
}

async function sha256Url(url) {
  const response = await fetch(url, {
    headers: { ...headers, Accept: "application/octet-stream" },
  });
  if (!response.ok) {
    throw new Error(`Failed to stream asset (${response.status}): ${url}`);
  }

  const reader = response.body;
  if (!reader) {
    throw new Error(`No response body for ${url}`);
  }

  const hash = createHash("sha256");
  for await (const chunk of reader) {
    hash.update(chunk);
  }

  return hash.digest("hex");
}

function isMacArm64DmgName(name) {
  const normalized = name.toLowerCase().replace(/\.dmg$/, "");
  return /(^|[_-])(aarch64|arm64|apple.?silicon)([_-]|$)/.test(normalized);
}

function pickArmDmgAsset(assets) {
  const dmgs = assets.filter((asset) =>
    asset.name.toLowerCase().endsWith(".dmg"),
  );
  const sortedDmgs = dmgs.toSorted((a, b) =>
    a.name.localeCompare(b.name, "en", { sensitivity: "base" }),
  );
  const armCandidates = sortedDmgs.filter((asset) =>
    isMacArm64DmgName(asset.name),
  );

  if (armCandidates.length === 1) {
    return armCandidates[0];
  }

  if (armCandidates.length > 1) {
    throw new Error(
      `Multiple macOS arm64 dmg assets found for ${GITHUB_REPOSITORY}: ${armCandidates
        .map((asset) => asset.name)
        .join(", ")}`,
    );
  }

  throw new Error(
    `No macOS arm64 .dmg asset found for ${GITHUB_REPOSITORY}. Expected a .dmg filename containing arm64, aarch64, or apple-silicon. Found: ${
      sortedDmgs.map((asset) => asset.name).join(", ") || "(none)"
    }`,
  );
}

function makeDmgUrl(tag, filename) {
  return `https://github.com/${GITHUB_REPOSITORY}/releases/download/${tag}/${encodeURIComponent(filename)}`;
}

function makeCask({ version, tag, arm }) {
  const header = `cask "${HOMEBREW_CASK_NAME}" do\n  version "${version}"\n`;
  const meta = [
    `  name "${escapeRubyString(HOMEBREW_APP_TITLE)}"`,
    `  desc "${escapeRubyString(HOMEBREW_DESCRIPTION)}"`,
    `  homepage "${escapeRubyString(HOMEBREW_HOMEPAGE)}"`,
    "",
  ];

  const body = [];
  body.push(`  sha256 "${arm.sha}"`);
  body.push(`  url "${makeDmgUrl(tag, arm.name)}"`);
  body.push("  depends_on arch: :arm64");

  body.push("");
  body.push(`  app "${escapeRubyString(HOMEBREW_APP_NAME)}"`);
  body.push("end");

  return [header, ...meta, ...body]
    .map((line, index, arr) => {
      if (index > 0 && arr[index - 1] === "" && line === "") {
        return null;
      }

      return line;
    })
    .filter(Boolean)
    .join("\n");
}

async function resolveAssetSha(assets, dmgAsset) {
  const shaAsset = assets.find(
    (asset) => asset.name === `${dmgAsset.name}.sha256`,
  );
  if (shaAsset) {
    try {
      return await getShaFromReleaseAsset(shaAsset);
    } catch (error) {
      console.warn(
        `[warn] cannot use provided sha256 file for ${dmgAsset.name}: ${error.message}`,
      );
    }
  }

  return sha256Url(dmgAsset.browser_download_url);
}

const release = await getJson(
  `https://api.github.com/repos/${GITHUB_REPOSITORY}/releases/tags/${encodeURIComponent(releaseTag)}`,
);
const assets = Array.isArray(release.assets) ? release.assets : [];

const armDmg = pickArmDmgAsset(assets);
armDmg.sha = await resolveAssetSha(assets, armDmg);

const caskContent = makeCask({
  version,
  tag: releaseTag,
  arm: armDmg,
});

await fs.mkdir(path.dirname(tapFilePath), { recursive: true });
const currentContent = await fs.readFile(tapFilePath, "utf8").catch(() => "");

if (currentContent === caskContent) {
  console.log(`No changes for ${tapFilePath} in tag ${releaseTag}`);
  process.exit(0);
}

await fs.writeFile(tapFilePath, `${caskContent}\n`, "utf8");
console.log(`Updated ${tapFilePath} for ${releaseTag}`);
