import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

type Diagnostic = {
  file: string;
  line: number;
  message: string;
};

const repoRoot = process.cwd();
const indexDir = path.join(repoRoot, "memory", "index");

function repoPath(filePath: string): string {
  return path.relative(repoRoot, filePath).split(path.sep).join("/");
}

function isExternalLink(target: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//");
}

function stripTitle(rawTarget: string): string {
  const trimmed = rawTarget.trim();
  if (trimmed.startsWith("<")) {
    const closeIndex = trimmed.indexOf(">");
    return closeIndex === -1 ? trimmed : trimmed.slice(1, closeIndex);
  }
  return trimmed.split(/\s+/)[0] ?? "";
}

function stripAnchorAndQuery(target: string): string {
  const queryIndex = target.indexOf("?");
  const withoutQuery = queryIndex === -1 ? target : target.slice(0, queryIndex);
  const hashIndex = withoutQuery.indexOf("#");
  return hashIndex === -1 ? withoutQuery : withoutQuery.slice(0, hashIndex);
}

function decodeTarget(target: string): string {
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}

function resolveTarget(indexFile: string, target: string): string {
  const decoded = decodeTarget(stripAnchorAndQuery(target));
  if (decoded === "") {
    return "";
  }
  if (path.isAbsolute(decoded)) {
    return path.join(repoRoot, decoded.slice(1));
  }
  return path.resolve(path.dirname(indexFile), decoded);
}

function markdownLinks(
  markdown: string,
): Array<{ line: number; target: string }> {
  const links: Array<{ line: number; target: string }> = [];
  let inFence = false;

  markdown.split(/\r?\n/).forEach((line, index) => {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) {
      return;
    }

    const linkPattern = /(?<!!)\[[^\]\n]*\]\(([^)\n]+)\)/g;
    for (const match of line.matchAll(linkPattern)) {
      const rawTarget = match[1];
      if (rawTarget) {
        links.push({ line: index + 1, target: stripTitle(rawTarget) });
      }
    }
  });

  return links;
}

function indexFiles(): string[] {
  if (!existsSync(indexDir)) {
    return [];
  }
  return readdirSync(indexDir)
    .filter((entry) => entry.endsWith(".md"))
    .map((entry) => path.join(indexDir, entry))
    .filter((filePath) => statSync(filePath).isFile())
    .sort();
}

const errors: Diagnostic[] = [];
const warnings: Diagnostic[] = [];

for (const indexFile of indexFiles()) {
  const markdown = readFileSync(indexFile, "utf8");
  const relativeIndexFile = repoPath(indexFile);

  if (!/^generator:\s+/m.test(markdown)) {
    warnings.push({
      file: relativeIndexFile,
      line: 1,
      message: "generated index marker is missing",
    });
  }

  for (const link of markdownLinks(markdown)) {
    if (isExternalLink(link.target) || link.target.startsWith("#")) {
      continue;
    }

    const resolved = resolveTarget(indexFile, link.target);
    if (resolved === "") {
      continue;
    }

    const relativeTarget = repoPath(resolved);
    if (relativeTarget.startsWith("docs/archives/")) {
      warnings.push({
        file: relativeIndexFile,
        line: link.line,
        message: `default memory index points at archive: ${link.target}`,
      });
    }

    if (!existsSync(resolved)) {
      errors.push({
        file: relativeIndexFile,
        line: link.line,
        message: `broken memory index link: ${link.target}`,
      });
    }
  }
}

for (const warning of warnings) {
  console.error(`WARNING: ${warning.file}:${warning.line}: ${warning.message}`);
}

for (const error of errors) {
  console.error(`ERROR: ${error.file}:${error.line}: ${error.message}`);
}

if (errors.length > 0) {
  process.exit(1);
}
