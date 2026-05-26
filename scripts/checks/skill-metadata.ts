import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

type Diagnostic = {
  file: string;
  message: string;
};

const repoRoot = process.cwd();
const roots = [".agents/skills", ".claude/skills", ".codex/skills"];

function repoPath(filePath: string): string {
  return path.relative(repoRoot, filePath).split(path.sep).join("/");
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }

  const entries = readdirSync(dir).sort();
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...walk(fullPath));
    } else if (entry === "SKILL.md") {
      files.push(fullPath);
    }
  }

  return files;
}

function frontmatter(markdown: string): Map<string, string> | null {
  if (!markdown.startsWith("---\n")) {
    return null;
  }

  const end = markdown.indexOf("\n---\n", 4);
  if (end === -1) {
    return null;
  }

  const fields = new Map<string, string>();
  for (const line of markdown.slice(4, end).split(/\r?\n/)) {
    const match = /^([A-Za-z0-9_-]+):(?:\s*(.*))?$/.exec(line);
    if (!match) {
      continue;
    }
    fields.set(match[1], match[2]?.trim() ?? "");
  }
  return fields;
}

function skillName(filePath: string): string {
  return path.basename(path.dirname(filePath));
}

function expectedWrapperTarget(filePath: string): string | null {
  const rel = repoPath(filePath);
  if (!rel.startsWith(".claude/skills/") && !rel.startsWith(".codex/skills/")) {
    return null;
  }
  return `../../../.agents/skills/${skillName(filePath)}/SKILL.md`;
}

const errors: Diagnostic[] = [];

for (const root of roots) {
  for (const filePath of walk(path.join(repoRoot, root))) {
    const rel = repoPath(filePath);
    const markdown = readFileSync(filePath, "utf8");
    const fields = frontmatter(markdown);

    if (!fields) {
      errors.push({ file: rel, message: "missing YAML frontmatter" });
      continue;
    }

    for (const required of ["name", "description"]) {
      if (!fields.has(required)) {
        errors.push({ file: rel, message: `missing field '${required}'` });
      } else if (fields.get(required) === "") {
        errors.push({ file: rel, message: `empty field '${required}'` });
      }
    }

    const expected = expectedWrapperTarget(filePath);
    if (expected) {
      const target = path.resolve(path.dirname(filePath), expected);
      if (!markdown.includes(`](${expected})`)) {
        errors.push({
          file: rel,
          message: `runtime wrapper must link to ${expected}`,
        });
      }
      if (!existsSync(target)) {
        errors.push({
          file: rel,
          message: `runtime wrapper source is missing: ${expected}`,
        });
      }
    }
  }
}

for (const error of errors) {
  console.error(`ERROR: ${error.file}: ${error.message}`);
}

if (errors.length > 0) {
  process.exit(1);
}
