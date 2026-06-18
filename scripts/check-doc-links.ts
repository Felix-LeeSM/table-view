#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, posix, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT_DOCS = ["README.md", "AGENTS.md", "CLAUDE.md", "docs/ROADMAP.md"];
const ACTIVE_DOC_DIRS = ["docs/product", "docs/contributor-guide"];
const EXCLUDED_SOURCE_DIRS = ["docs/archives", "docs/sprints"];

export interface LinkCheckIssue {
  source: string;
  line: number;
  target: string;
  reason: string;
}

export interface LinkCheckResult {
  sources: string[];
  linksChecked: number;
  issues: LinkCheckIssue[];
}

interface LinkReference {
  rawTarget: string;
  line: number;
}

interface TargetParts {
  path: string;
  anchor: string;
}

export function normalizeRepoPath(path: string): string {
  return posix
    .normalize(path.replace(/\\/g, "/"))
    .replace(/^\.\//, "")
    .replace(/^\/+/, "");
}

function isExcludedSource(repoPath: string): boolean {
  const path = normalizeRepoPath(repoPath);
  return EXCLUDED_SOURCE_DIRS.some(
    (dir) => path === dir || path.startsWith(`${dir}/`),
  );
}

function walkMarkdownFiles(cwd: string, repoDir: string): string[] {
  const dir = resolve(cwd, repoDir);
  if (!existsSync(dir)) return [];

  const files: string[] = [];
  const walk = (absoluteDir: string) => {
    for (const entry of readdirSync(absoluteDir, { withFileTypes: true })) {
      const absolutePath = resolve(absoluteDir, entry.name);
      const repoPath = normalizeRepoPath(posix.relative(cwd, absolutePath));
      if (entry.isDirectory()) {
        if (!isExcludedSource(repoPath)) walk(absolutePath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".md")) files.push(repoPath);
    }
  };

  walk(dir);
  return files;
}

export function collectActiveDocSources(cwd = process.cwd()): string[] {
  const rootDocs = ROOT_DOCS.filter((path) => existsSync(resolve(cwd, path)));
  const activeDocs = ACTIVE_DOC_DIRS.flatMap((dir) =>
    walkMarkdownFiles(cwd, dir),
  );
  return [...new Set([...rootDocs, ...activeDocs])]
    .filter((path) => !isExcludedSource(path))
    .sort();
}

function lineForIndex(source: string, index: number): number {
  return source.slice(0, index).split(/\r?\n/).length;
}

function stripCodeFences(source: string): string {
  return source.replace(/^```[\s\S]*?^```/gm, (block) =>
    "\n".repeat(block.split(/\r?\n/).length - 1),
  );
}

function parseMarkdownLinks(source: string): LinkReference[] {
  const withoutFences = stripCodeFences(source);
  const links: LinkReference[] = [];

  const inlinePattern = /!?\[[^\]\n]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  for (const match of withoutFences.matchAll(inlinePattern)) {
    links.push({
      rawTarget: match[1] ?? "",
      line: lineForIndex(withoutFences, match.index ?? 0),
    });
  }

  const referencePattern = /^\s*\[[^\]]+\]:\s*(\S+)/gm;
  for (const match of withoutFences.matchAll(referencePattern)) {
    links.push({
      rawTarget: match[1] ?? "",
      line: lineForIndex(withoutFences, match.index ?? 0),
    });
  }

  const htmlPattern = /\b(?:href|src)=["']([^"']+)["']/g;
  for (const match of withoutFences.matchAll(htmlPattern)) {
    links.push({
      rawTarget: match[1] ?? "",
      line: lineForIndex(withoutFences, match.index ?? 0),
    });
  }

  return links;
}

function isExternalOrSpecialLink(target: string): boolean {
  return (
    target === "" ||
    /^(?:https?:|mailto:|tel:|ftp:|data:|javascript:)/i.test(target)
  );
}

function splitTarget(rawTarget: string): TargetParts {
  const withoutQuery = rawTarget.split(/[?;]/, 1)[0] ?? rawTarget;
  const hashIndex = withoutQuery.indexOf("#");
  if (hashIndex === -1) return { path: withoutQuery, anchor: "" };
  return {
    path: withoutQuery.slice(0, hashIndex),
    anchor: withoutQuery.slice(hashIndex + 1),
  };
}

function decodePath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function resolveTargetPath(
  cwd: string,
  sourcePath: string,
  targetPath: string,
): string {
  const decodedPath = decodePath(targetPath);
  if (decodedPath === "") return sourcePath;
  const base = decodedPath.startsWith("/")
    ? decodedPath.slice(1)
    : posix.join(posix.dirname(sourcePath), decodedPath);
  return normalizeRepoPath(base);
}

function githubSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/<[^>]*>/g, "")
    .replace(/[`*_~[\]]/g, "")
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function collectMarkdownAnchors(markdown: string): Set<string> {
  const anchors = new Set<string>();
  const slugCounts = new Map<string, number>();

  for (const line of markdown.split(/\r?\n/)) {
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      const baseSlug = githubSlug(heading[2] ?? "");
      if (baseSlug) {
        const count = slugCounts.get(baseSlug) ?? 0;
        slugCounts.set(baseSlug, count + 1);
        anchors.add(count === 0 ? baseSlug : `${baseSlug}-${count}`);
      }
    }

    for (const match of line.matchAll(/\b(?:id|name)=["']([^"']+)["']/g)) {
      anchors.add(match[1] ?? "");
    }
  }

  return anchors;
}

function targetIsMarkdown(repoPath: string): boolean {
  return extname(repoPath).toLowerCase() === ".md";
}

function targetExists(cwd: string, repoPath: string): boolean {
  const absolutePath = resolve(cwd, repoPath);
  return existsSync(absolutePath);
}

function validateLink(
  cwd: string,
  sourcePath: string,
  sourceLine: number,
  rawTarget: string,
): LinkCheckIssue | null {
  if (isExternalOrSpecialLink(rawTarget)) return null;

  const { path, anchor } = splitTarget(rawTarget);
  const targetPath = resolveTargetPath(cwd, sourcePath, path);
  const absoluteTarget = resolve(cwd, targetPath);

  if (!targetExists(cwd, targetPath)) {
    return {
      source: sourcePath,
      line: sourceLine,
      target: rawTarget,
      reason: `missing target ${targetPath}`,
    };
  }

  const stats = statSync(absoluteTarget);
  if (anchor && !stats.isFile()) {
    return {
      source: sourcePath,
      line: sourceLine,
      target: rawTarget,
      reason: `anchor on non-file target ${targetPath}`,
    };
  }

  if (anchor && targetIsMarkdown(targetPath)) {
    const markdown = readFileSync(absoluteTarget, "utf8");
    const anchors = collectMarkdownAnchors(markdown);
    const decodedAnchor = decodePath(anchor).toLowerCase();
    if (!anchors.has(decodedAnchor)) {
      return {
        source: sourcePath,
        line: sourceLine,
        target: rawTarget,
        reason: `missing anchor #${anchor} in ${targetPath}`,
      };
    }
  }

  return null;
}

export function checkDocLinks(cwd = process.cwd()): LinkCheckResult {
  const sources = collectActiveDocSources(cwd);
  const issues: LinkCheckIssue[] = [];
  let linksChecked = 0;

  for (const sourcePath of sources) {
    const markdown = readFileSync(resolve(cwd, sourcePath), "utf8");
    for (const link of parseMarkdownLinks(markdown)) {
      if (isExternalOrSpecialLink(link.rawTarget)) continue;
      linksChecked += 1;
      const issue = validateLink(cwd, sourcePath, link.line, link.rawTarget);
      if (issue) issues.push(issue);
    }
  }

  return { sources, linksChecked, issues };
}

function formatIssue(issue: LinkCheckIssue): string {
  return `${issue.source}:${issue.line} -> ${issue.target} :: ${issue.reason}`;
}

function main() {
  const result = checkDocLinks();
  if (result.issues.length > 0) {
    console.error(
      `docs:links failed (${result.issues.length} issues, ${result.linksChecked} links, ${result.sources.length} sources)`,
    );
    for (const issue of result.issues) console.error(formatIssue(issue));
    process.exit(1);
  }

  console.log(
    `docs:links ok (${result.linksChecked} links, ${result.sources.length} sources)`,
  );
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (import.meta.url === pathToFileURL(invokedPath).href) main();
