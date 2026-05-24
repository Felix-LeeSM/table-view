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

function pickDmg(assets, patterns) {
  return (
    assets.find((asset) => {
      if (!asset.name.toLowerCase().endsWith(".dmg")) {
        return false;
      }

      const normalized = asset.name.toLowerCase();
      return patterns.some((pattern) => normalized.includes(pattern));
    }) || null
  );
}

function makeDmgUrl(tag, filename) {
  return `https://github.com/${GITHUB_REPOSITORY}/releases/download/${tag}/${encodeURIComponent(filename)}`;
}

function makeCask({ version, tag, arm, intel }) {
  const header = `cask "${HOMEBREW_CASK_NAME}" do\n  version "${version}"\n`;
  const meta = [
    `  name "${HOMEBREW_APP_TITLE}"`,
    `  desc "${HOMEBREW_DESCRIPTION}"`,
    `  homepage "${HOMEBREW_HOMEPAGE}"`,
    "",
  ];

  const body = [];
  if (arm && intel) {
    body.push("  if Hardware::CPU.arm?");
    body.push(`    sha256 "${arm.sha}"`);
    body.push(`    url "${makeDmgUrl(tag, arm.name)}"`);
    body.push("  else");
    body.push(`    sha256 "${intel.sha}"`);
    body.push(`    url "${makeDmgUrl(tag, intel.name)}"`);
    body.push("  end");
  } else if (arm) {
    body.push(`  sha256 "${arm.sha}"`);
    body.push(`  url "${makeDmgUrl(tag, arm.name)}"`);
    body.push("  depends_on arch: :arm64");
  } else if (intel) {
    body.push(`  sha256 "${intel.sha}"`);
    body.push(`  url "${makeDmgUrl(tag, intel.name)}"`);
    body.push("  depends_on arch: :x86_64");
  } else {
    throw new Error("No macOS dmg asset found for Homebrew update");
  }

  body.push("");
  body.push(`  app "${HOMEBREW_APP_NAME}"`);
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

const armDmg = pickDmg(assets, ["aarch64", "arm64"]);
const intelDmg = pickDmg(assets, ["x86_64", "x64", "amd64"]);

if (!armDmg && !intelDmg) {
  throw new Error(`No macOS .dmg assets found for ${releaseTag}`);
}

if (armDmg) {
  armDmg.sha = await resolveAssetSha(assets, armDmg);
}
if (intelDmg) {
  intelDmg.sha = await resolveAssetSha(assets, intelDmg);
}

const caskContent = makeCask({
  version,
  tag: releaseTag,
  arm: armDmg,
  intel: intelDmg,
});

await fs.mkdir(path.dirname(tapFilePath), { recursive: true });
const currentContent = await fs.readFile(tapFilePath, "utf8").catch(() => "");

if (currentContent === caskContent) {
  console.log(`No changes for ${tapFilePath} in tag ${releaseTag}`);
  process.exit(0);
}

await fs.writeFile(tapFilePath, `${caskContent}\n`, "utf8");
console.log(`Updated ${tapFilePath} for ${releaseTag}`);
