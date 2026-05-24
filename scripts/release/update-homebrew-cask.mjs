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

function detectArchFromName(name) {
  const normalized = name.toLowerCase();
  if (/\b(universal)\b/.test(normalized)) {
    return "universal";
  }
  if (/(^|[_-])(aarch64|arm64|apple.?silicon)([_-]|$)/.test(normalized)) {
    return "arm";
  }
  if (/(^|[_-])(x86_64|x64|amd64|intel)([_-]|$)/.test(normalized)) {
    return "intel";
  }

  return "unknown";
}

function pickDmgAssets(assets) {
  const dmgs = assets.filter((asset) =>
    asset.name.toLowerCase().endsWith(".dmg"),
  );
  const sortedDmgs = dmgs.toSorted((a, b) =>
    a.name.localeCompare(b.name, "en", { sensitivity: "base" }),
  );
  const candidates = sortedDmgs
    .map((asset) => ({ ...asset, arch: detectArchFromName(asset.name) }))
    .filter((asset) => asset.arch !== "unknown");

  const unknownDmgs = sortedDmgs.filter(
    (asset) => detectArchFromName(asset.name) === "unknown",
  );

  if (candidates.length === 0 && unknownDmgs.length === 1) {
    return {
      fallback: unknownDmgs[0],
      arm: null,
      intel: null,
      universal: null,
    };
  }

  if (candidates.length === 0 && unknownDmgs.length > 1) {
    throw new Error(
      `Multiple macOS dmg assets found for ${GITHUB_REPOSITORY}, but no arm64/x86_64 pattern match in names: ${unknownDmgs
        .map((asset) => asset.name)
        .join(", ")}`,
    );
  }

  const arm = candidates.find((asset) => asset.arch === "arm") || null;
  const intel = candidates.find((asset) => asset.arch === "intel") || null;
  const universal =
    candidates.find((asset) => asset.arch === "universal") || null;

  if (universal && arm && arm.name !== universal.name) {
    console.warn(
      `[warn] both universal(${universal.name}) and arm(${arm.name}) dmg found; selecting universal first.`,
    );
    return { fallback: null, arm: null, intel, universal };
  }
  if (universal && intel && intel.name !== universal.name) {
    console.warn(
      `[warn] both universal(${universal.name}) and intel(${intel.name}) dmg found; selecting universal first.`,
    );
    return { fallback: null, arm, intel: null, universal };
  }

  if (arm && intel && arm.name === intel.name) {
    return { fallback: null, arm: null, intel: null, universal: arm };
  }

  return { fallback: null, arm, intel, universal };
}

function makeDmgUrl(tag, filename) {
  return `https://github.com/${GITHUB_REPOSITORY}/releases/download/${tag}/${encodeURIComponent(filename)}`;
}

function makeCask({ version, tag, arm, intel, universal }) {
  const header = `cask "${HOMEBREW_CASK_NAME}" do\n  version "${version}"\n`;
  const meta = [
    `  name "${escapeRubyString(HOMEBREW_APP_TITLE)}"`,
    `  desc "${escapeRubyString(HOMEBREW_DESCRIPTION)}"`,
    `  homepage "${escapeRubyString(HOMEBREW_HOMEPAGE)}"`,
    "",
  ];

  const body = [];
  if (universal) {
    body.push(`  sha256 "${universal.sha}"`);
    body.push(`  url "${makeDmgUrl(tag, universal.name)}"`);
  } else if (arm && intel) {
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

const {
  arm: armDmg,
  intel: intelDmg,
  universal: detectedUniversalDmg,
  fallback,
} = pickDmgAssets(assets);

const universalDmg = detectedUniversalDmg || fallback;

if (fallback) {
  console.warn(
    `[warn] Could not infer architecture from ${fallback.name}; falling back to single-package mode.`,
  );
}

if (!armDmg && !intelDmg && !universalDmg) {
  throw new Error(`No macOS .dmg assets found for ${releaseTag}`);
}

if (armDmg) {
  armDmg.sha = await resolveAssetSha(assets, armDmg);
}
if (intelDmg) {
  intelDmg.sha = await resolveAssetSha(assets, intelDmg);
}
if (universalDmg) {
  universalDmg.sha = await resolveAssetSha(assets, universalDmg);
}

const caskContent = makeCask({
  version,
  tag: releaseTag,
  arm: armDmg,
  intel: intelDmg,
  universal: universalDmg,
});

await fs.mkdir(path.dirname(tapFilePath), { recursive: true });
const currentContent = await fs.readFile(tapFilePath, "utf8").catch(() => "");

if (currentContent === caskContent) {
  console.log(`No changes for ${tapFilePath} in tag ${releaseTag}`);
  process.exit(0);
}

await fs.writeFile(tapFilePath, `${caskContent}\n`, "utf8");
console.log(`Updated ${tapFilePath} for ${releaseTag}`);
