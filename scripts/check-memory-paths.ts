#!/usr/bin/env node

// Reverse code->memory consistency gate (issue #1032).
//
// Memory rooms cite concrete repo paths in inline code and fenced blocks
// (e.g. `src/lib/foo.ts`). When code is deleted, moved, or renamed, those
// citations silently rot: an active rule keeps pointing at a path that no
// longer exists. `check-doc-links.ts` only validates Markdown *link* syntax in
// docs/, not backtick path citations in memory/. This gate walks memory/**.md,
// extracts path-like tokens from code spans, and fails on any that no longer
// resolve on disk.
//
// Heuristic (kept conservative so a false positive never blocks a push):
//   - the token must contain a slash and end in a known repo extension,
//   - its first path segment must be a real top-level repo directory (this is
//     what tells a repo-path citation apart from a prose shorthand such as
//     `paradigms/memory.md`, whose full path lives elsewhere),
//   - glob/placeholder/URL tokens are skipped,
//   - a small ALLOWLIST exempts paths cited precisely *because* they were
//     removed (history notes) or are placeholder templates.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, posix, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeRepoPath } from "./check-doc-links";

const KNOWN_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".rs",
  ".sh",
  ".json",
  ".toml",
  ".yml",
  ".yaml",
  ".css",
  ".html",
  ".md",
  ".sql",
  ".py",
  ".lock",
]);

// Non-literal citations kept in memory prose on purpose. Each is cited to
// document that it no longer exists (history) or is a template, so the gate
// must not treat it as a broken reference. Keep this list tiny and explain each
// entry — a growing list means the heuristic needs tightening instead.
const DEFAULT_ALLOWLIST = new Set([
  // "구 `docs/paradigm-ui-map.md` (2026-04-24) 압축본" — historical source note.
  "docs/paradigm-ui-map.md",
  // "과거 `.codex/hooks/pre-tool-use.sh` 흡수" — absorbed into scripts/hooks.
  ".codex/hooks/pre-tool-use.sh",
  // sprint-N is a placeholder segment, not a concrete sprint directory.
  "docs/sprints/sprint-N/contract.md",
]);

export interface StalePathIssue {
  source: string;
  line: number;
  target: string;
}

export interface MemoryPathResult {
  sources: string[];
  pathsChecked: number;
  issues: StalePathIssue[];
}

interface PathToken {
  token: string;
  line: number;
}

function listMemoryFiles(cwd: string): string[] {
  const root = resolve(cwd, "memory");
  if (!existsSync(root)) return [];

  const files: string[] = [];
  const walk = (absoluteDir: string) => {
    for (const entry of readdirSync(absoluteDir, { withFileTypes: true })) {
      const absolutePath = resolve(absoluteDir, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath);
      } else if (entry.name.endsWith(".md")) {
        files.push(normalizeRepoPath(posix.relative(cwd, absolutePath)));
      }
    }
  };

  walk(root);
  return files.sort();
}

function topLevelDirectories(cwd: string): Set<string> {
  const dirs = new Set<string>();
  for (const entry of readdirSync(cwd, { withFileTypes: true })) {
    if (entry.isDirectory()) dirs.add(entry.name);
  }
  return dirs;
}

function stripWrappers(token: string): string {
  return token.replace(/^[([<"'`]+/, "").replace(/[)\]>.,;:"'`]+$/, "");
}

// Line-aware token extraction: fenced blocks contribute every token on the
// line, inline `code` spans contribute only their fenced-off contents.
export function extractPathTokens(source: string): PathToken[] {
  const tokens: PathToken[] = [];
  let inFence = false;

  source.split(/\r?\n/).forEach((line, index) => {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      return;
    }

    const chunks: string[] = [];
    if (inFence) {
      chunks.push(line);
    } else {
      for (const match of line.matchAll(/`([^`\n]+)`/g))
        chunks.push(match[1] ?? "");
    }

    for (const chunk of chunks) {
      for (const rawToken of chunk.split(/\s+/)) {
        const token = stripWrappers(rawToken);
        if (token) tokens.push({ token, line: index + 1 });
      }
    }
  });

  return tokens;
}

function isRepoPathCandidate(token: string): boolean {
  if (!token.includes("/")) return false;
  if (token.startsWith("/")) return false;
  if (token.includes("://")) return false;
  if (/[*?{}<>$~|]/.test(token)) return false;
  return KNOWN_EXTENSIONS.has(extname(token).toLowerCase());
}

export function checkMemoryPaths(
  cwd = process.cwd(),
  allowlist: Set<string> = DEFAULT_ALLOWLIST,
): MemoryPathResult {
  const topDirs = topLevelDirectories(cwd);
  const sources = listMemoryFiles(cwd);
  const issues: StalePathIssue[] = [];
  let pathsChecked = 0;

  for (const source of sources) {
    const markdown = readFileSync(resolve(cwd, source), "utf8");
    for (const { token, line } of extractPathTokens(markdown)) {
      if (!isRepoPathCandidate(token)) continue;
      const firstSegment = token.split("/")[0] ?? "";
      // Not anchored to a real top-level dir -> prose shorthand, not a repo path.
      if (!topDirs.has(firstSegment)) continue;
      const repoPath = normalizeRepoPath(token);
      if (allowlist.has(repoPath)) continue;
      pathsChecked += 1;
      if (!existsSync(resolve(cwd, repoPath))) {
        issues.push({ source, line, target: token });
      }
    }
  }

  return { sources, pathsChecked, issues };
}

function main() {
  const result = checkMemoryPaths();
  if (result.issues.length > 0) {
    console.error(
      `memory:paths failed (${result.issues.length} stale citations, ${result.pathsChecked} paths, ${result.sources.length} sources)`,
    );
    for (const issue of result.issues) {
      console.error(
        `${issue.source}:${issue.line} -> ${issue.target} :: missing repo path`,
      );
    }
    process.exit(1);
  }

  console.log(
    `memory:paths ok (${result.pathsChecked} paths, ${result.sources.length} sources)`,
  );
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (import.meta.url === pathToFileURL(invokedPath).href) main();
