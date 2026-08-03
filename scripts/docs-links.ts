/**
 * Internal markdown link checker for this repository (issue #2125).
 *
 * The rule system here runs on pointers: `AGENTS.md` sends an agent to a
 * `memory/**` room, that room links to an ADR, the ADR links back. A link whose
 * target does not exist is a rule that never arrives, and nothing has detected
 * that since PR #2033 removed the previous checker.
 *
 * Enumeration comes from `git ls-files` rather than a directory walk: "every
 * markdown in the repository" is exactly what git tracks, and that definition
 * needs no skip list for `node_modules`, build output, or sibling clones. If
 * git is unavailable the call throws and the gate fails — a scan that silently
 * found zero sources would be a green light nobody earned.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, posix, resolve } from "node:path";

export interface DocLinkIssue {
  source: string;
  line: number;
  target: string;
  reason: string;
}

export interface DocLinkReport {
  sources: string[];
  linksChecked: number;
  issues: DocLinkIssue[];
}

export interface KnownDeadLink {
  source: string;
  target: string;
  reason: string;
}

export interface ScanOptions {
  excludedDirs?: readonly string[];
  allowlist?: readonly KnownDeadLink[];
}

/** Markdown whose links are dead on purpose: this detector's own input. */
export const SEEDED_FIXTURE_DIR = "tests/fixtures/docs-links";

/**
 * Directory prefixes the gate does not read, repo-relative.
 *
 * `docs/archives` is frozen history — a record of what the repo used to say
 * must not be rewritten to satisfy a gate, and the deleted checker excluded it
 * for the same reason.
 *
 * `docs/explorations` is deliberately absent even though `.ignore` hides it
 * from `rg`: it currently suppresses nothing, and an exclusion that filters
 * nothing only makes the scan look narrower than it is.
 */
export const EXCLUDED_SOURCE_DIRS = [
  "docs/archives",
  SEEDED_FIXTURE_DIR,
] as const;

/**
 * Dead links the repo is not allowed to repair. ADR bodies freeze at their
 * first commit (`AGENTS.md` 「강제 룰」), so a pointer an ADR wrote before its
 * target was deleted can never be edited back into life — the only lawful
 * repair is a new ADR, which does not remove the old line.
 *
 * Anything not on this list blocks. Entries are asserted to be load-bearing in
 * `scripts/__tests__/docs-links.test.ts`, so a new one cannot be parked here
 * without showing up in that test's diff.
 */
export const KNOWN_DEAD_LINKS: readonly KnownDeadLink[] = [
  {
    source: "docs/decisions/0029-mongosh-parser-strategy/memory.md",
    target: "../../sprints/sprint-307/contract.md",
    reason:
      "frozen ADR body; `docs/sprints/` was deleted by 46ca4799 (PR #2034) long after ADR 0029 was written",
  },
];

function normalizeRepoPath(path: string): string {
  return posix
    .normalize(path.replace(/\\/g, "/"))
    .replace(/^\.\//, "")
    .replace(/^\/+/, "");
}

function isUnder(repoPath: string, dir: string): boolean {
  return repoPath === dir || repoPath.startsWith(`${dir}/`);
}

/** Every markdown file git tracks, repo-relative, sorted, exclusions applied. */
export function collectSources(
  root: string,
  excludedDirs: readonly string[] = EXCLUDED_SOURCE_DIRS,
): string[] {
  const listing = execFileSync("git", ["ls-files", "-z", "--", "*.md"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return listing
    .split("\0")
    .filter((path) => path !== "")
    .map(normalizeRepoPath)
    .filter((path) => !excludedDirs.some((dir) => isUnder(path, dir)))
    .sort();
}

interface LinkReference {
  rawTarget: string;
  line: number;
}

/**
 * Blanks out fenced code blocks, keeping the line count so reported line
 * numbers still match the file. Fences are tracked line by line rather than
 * with one regex: ``` and ~~~ both open a block, only a closing run at least as
 * long ends it, and a fence indented inside a list item still counts. Docs here
 * routinely show markdown samples whose paths are illustrations, not links.
 */
function blankCodeFences(markdown: string): string[] {
  let openFence: string | null = null;
  return markdown.split(/\r?\n/).map((line) => {
    const fence = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    const marker = fence?.[1];
    const info = fence?.[2] ?? "";
    if (openFence === null) {
      // An info string may not contain a backtick, which is what keeps a line
      // such as ``` `a` and `b` ``` from being read as a fence opener.
      if (marker && !(marker.startsWith("`") && info.includes("`"))) {
        openFence = marker;
      }
      return openFence === null ? line : "";
    }
    if (
      marker &&
      marker[0] === openFence[0] &&
      marker.length >= openFence.length &&
      info.trim() === ""
    ) {
      openFence = null;
    }
    return "";
  });
}

/** Blanks inline code spans: `` `[a](b)` `` renders as text, not as a link. */
function blankInlineCode(line: string): string {
  return line.replace(/(`+)(?:(?!\1).)*\1/g, (span) => " ".repeat(span.length));
}

const INLINE_LINK = /!?\[[^\]\n]*\]\(\s*<?([^)<>\s]+)>?(?:\s+["'(][^)]*)?\)/g;
const REFERENCE_DEFINITION = /^\s{0,3}\[[^\]]+\]:\s*<?([^\s<>]+)>?/;
const HTML_ATTRIBUTE = /\b(?:href|src)\s*=\s*["']([^"']+)["']/g;

/** Inline links, images, reference definitions and HTML `href` / `src`. */
export function parseLinks(markdown: string): LinkReference[] {
  const links: LinkReference[] = [];
  blankCodeFences(markdown).forEach((rawLine, index) => {
    const line = blankInlineCode(rawLine);
    const lineNumber = index + 1;
    for (const match of line.matchAll(INLINE_LINK)) {
      links.push({ rawTarget: match[1] ?? "", line: lineNumber });
    }
    const definition = REFERENCE_DEFINITION.exec(line);
    if (definition) {
      links.push({ rawTarget: definition[1] ?? "", line: lineNumber });
    }
    for (const match of line.matchAll(HTML_ATTRIBUTE)) {
      links.push({ rawTarget: match[1] ?? "", line: lineNumber });
    }
  });
  return links;
}

/** Empty targets, protocol-relative URLs and anything carrying a scheme. */
export function isExternalTarget(target: string): boolean {
  return (
    target === "" ||
    target.startsWith("//") ||
    /^[a-z][a-z0-9+.-]*:/i.test(target)
  );
}

function splitTarget(rawTarget: string): { path: string; anchor: string } {
  const withoutQuery = rawTarget.split(/[?;]/, 1)[0] ?? rawTarget;
  const hash = withoutQuery.indexOf("#");
  if (hash === -1) return { path: withoutQuery, anchor: "" };
  return {
    path: withoutQuery.slice(0, hash),
    anchor: withoutQuery.slice(hash + 1),
  };
}

function decode(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function resolveTarget(sourcePath: string, targetPath: string): string {
  const decoded = decode(targetPath);
  if (decoded === "") return sourcePath;
  return normalizeRepoPath(
    decoded.startsWith("/")
      ? decoded.slice(1)
      : posix.join(posix.dirname(sourcePath), decoded),
  );
}

/**
 * Both sides of an anchor comparison pass through here, which is what lets the
 * two slugger conventions in circulation agree. GitHub turns `## A — B` into
 * `#a--b` (the em dash leaves its surrounding spaces behind); most other
 * renderers, and the checker PR #2033 deleted, collapse that to `#a-b`.
 * Collapsing hyphen runs and dropping `_` on both the heading and the link
 * fragment makes either spelling resolve. The ceiling is deliberate: a link
 * that only one of the two conventions resolves is not reported.
 */
function normalizeFragment(fragment: string): string {
  return fragment
    .toLowerCase()
    .replace(/_/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** GitHub's heading-to-fragment slug. */
function slugify(headingText: string): string {
  return headingText
    .trim()
    .toLowerCase()
    .replace(/<[^>]*>/g, "")
    .replace(/[`*_~[\]]/g, "")
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Fragments a markdown file offers: one per heading, with GitHub's `-1`, `-2`
 * suffixes for repeated text, plus explicit `id=` / `name=` attributes.
 */
export function collectAnchors(markdown: string): Set<string> {
  const anchors = new Set<string>();
  const seen = new Map<string, number>();
  for (const line of blankCodeFences(markdown)) {
    const heading = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      const slug = slugify(heading[2] ?? "");
      if (slug) {
        const count = seen.get(slug) ?? 0;
        seen.set(slug, count + 1);
        anchors.add(count === 0 ? slug : `${slug}-${count}`);
      }
    }
    for (const match of line.matchAll(
      /\b(?:id|name)\s*=\s*["']([^"']+)["']/g,
    )) {
      anchors.add(normalizeFragment(match[1] ?? ""));
    }
  }
  return anchors;
}

function validate(
  root: string,
  source: string,
  link: LinkReference,
  anchorCache: Map<string, Set<string>>,
): DocLinkIssue | null {
  const { path, anchor } = splitTarget(link.rawTarget);
  const target = resolveTarget(source, path);
  const absolute = resolve(root, target);
  const issue = (reason: string): DocLinkIssue => ({
    source,
    line: link.line,
    target: link.rawTarget,
    reason,
  });

  // Existence is read off the disk, not out of the git index. The two agree
  // today (measured: zero links resolve to an existing untracked path), and an
  // index lookup is the upgrade if a link to a build artifact ever starts
  // passing locally while a clean CI checkout has no such file.
  if (target.startsWith("../") || !existsSync(absolute)) {
    return issue(`missing target ${target}`);
  }
  if (anchor === "") return null;
  if (!statSync(absolute).isFile()) {
    return issue(`anchor on non-file target ${target}`);
  }
  // `foo.ts#L12` is a GitHub line range, not a document fragment.
  if (extname(target).toLowerCase() !== ".md") return null;

  let anchors = anchorCache.get(target);
  if (!anchors) {
    anchors = collectAnchors(readFileSync(absolute, "utf8"));
    anchorCache.set(target, anchors);
  }
  return anchors.has(normalizeFragment(decode(anchor)))
    ? null
    : issue(`missing anchor #${anchor} in ${target}`);
}

export function checkDocLinks(
  root: string,
  options: ScanOptions = {},
): DocLinkReport {
  const excludedDirs = options.excludedDirs ?? EXCLUDED_SOURCE_DIRS;
  const allowlist = options.allowlist ?? KNOWN_DEAD_LINKS;
  const sources = collectSources(root, excludedDirs);
  const anchorCache = new Map<string, Set<string>>();
  const issues: DocLinkIssue[] = [];
  let linksChecked = 0;

  for (const source of sources) {
    const markdown = readFileSync(resolve(root, source), "utf8");
    for (const link of parseLinks(markdown)) {
      if (isExternalTarget(link.rawTarget)) continue;
      linksChecked += 1;
      const issue = validate(root, source, link, anchorCache);
      if (!issue) continue;
      const allowed = allowlist.some(
        (known) =>
          known.source === issue.source && known.target === issue.target,
      );
      if (!allowed) issues.push(issue);
    }
  }

  return { sources, linksChecked, issues };
}

export function formatIssue(issue: DocLinkIssue): string {
  return `${issue.source}:${issue.line} -> ${issue.target} :: ${issue.reason}`;
}
