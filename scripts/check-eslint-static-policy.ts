import { ESLint } from "eslint";
import { existsSync, readdirSync } from "node:fs";
import { extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const MAX_LINES_ALLOWLIST = [
  "e2e/smoke/_helpers.ts",
  "src/components/connection/ConnectionDialog.test.tsx",
  "src/components/connection/ConnectionGroup.test.tsx",
  "src/components/connection/ConnectionItem.test.tsx",
  "src/components/datagrid/sqlGenerator.test.ts",
  "src/components/datagrid/useDataGridEdit.mixed-batch.test.ts",
  "src/components/document/DocumentTreePanel.test.tsx",
  "src/components/document/DocumentTreePanel.tsx",
  "src/components/layout/MainArea.test.tsx",
  "src/components/layout/TabBar.test.tsx",
  "src/components/query/QueryTab/useQueryExecution.ts",
  "src/components/rdb/DataGrid.editing.test.tsx",
  "src/components/schema/CreateTableDialog.test.tsx",
  "src/components/schema/CreateTableDialog.tsx",
  "src/components/schema/SchemaTree.actions.test.tsx",
  "src/components/shared/QuickLookPanel.test.tsx",
  "src/hooks/useSqlAutocomplete.test.ts",
  "src/lib/mongo/mongoshParser.test.ts",
  "src/lib/sql/sqlAst.test.ts",
  "src/lib/sql/sqlSafety.test.ts",
  "src/stores/connectionStore.test.ts",
  "src/stores/schemaStore.test.ts",
] as const;

const SOURCE_ROOTS = ["src", "e2e", "scripts", "tests"] as const;
const GENERATED_LINT_IGNORE_PREFIXES = [
  "src/lib/sql/wasm/",
  "src/lib/mongo/wasm/",
] as const;

type LintMessageLike = {
  ruleId: string | null;
  severity: number;
};

type LintResultLike = {
  filePath: string;
  messages: LintMessageLike[];
};

export function normalizeRepoPath(path: string, cwd = process.cwd()): string {
  const normalized = path.replace(/\\/g, "/");
  const root = cwd.replace(/\\/g, "/");
  const repoPath = normalized.startsWith(`${root}/`)
    ? normalized.slice(root.length + 1)
    : normalized;
  return repoPath.replace(/^\.\//, "");
}

export function isAllowedGeneratedLintIgnore(repoPath: string): boolean {
  return GENERATED_LINT_IGNORE_PREFIXES.some((prefix) =>
    normalizeRepoPath(repoPath).startsWith(prefix),
  );
}

export function findUnexpectedIgnoredFiles(repoPaths: string[]): string[] {
  return repoPaths
    .map((path) => normalizeRepoPath(path))
    .filter((path) => !isAllowedGeneratedLintIgnore(path))
    .sort();
}

export function summarizeLintMessages(results: LintResultLike[]) {
  const maxLineWarningPaths: string[] = [];
  const unexpectedWarningRules = new Set<string>();
  let errorCount = 0;

  for (const result of results) {
    const repoPath = normalizeRepoPath(result.filePath);
    for (const message of result.messages) {
      if (message.severity === 2) {
        errorCount += 1;
        continue;
      }
      if (message.severity !== 1) continue;
      if (message.ruleId === "max-lines") {
        maxLineWarningPaths.push(repoPath);
      } else {
        unexpectedWarningRules.add(message.ruleId ?? "unknown");
      }
    }
  }

  return {
    errorCount,
    maxLineWarningPaths: [...new Set(maxLineWarningPaths)].sort(),
    unexpectedWarningRules: [...unexpectedWarningRules].sort(),
  };
}

function collectTypeScriptFiles(cwd: string): string[] {
  const files: string[] = [];

  function walk(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (![".ts", ".tsx"].includes(extname(entry.name))) continue;
      files.push(normalizeRepoPath(relative(cwd, fullPath), cwd));
    }
  }

  for (const root of SOURCE_ROOTS) {
    const dir = resolve(cwd, root);
    if (existsSync(dir)) walk(dir);
  }
  return files.sort();
}

async function findIgnoredCandidates(
  eslint: ESLint,
  repoPaths: string[],
): Promise<string[]> {
  const ignored: string[] = [];
  for (const path of repoPaths) {
    if (await eslint.isPathIgnored(path)) ignored.push(path);
  }
  return ignored.sort();
}

function compareMaxLinesAllowlist(actual: string[]): string[] {
  const allowed = new Set(MAX_LINES_ALLOWLIST);
  const actualSet = new Set(actual);
  const extra = actual.filter((path) => !allowed.has(path));
  const stale = MAX_LINES_ALLOWLIST.filter((path) => !actualSet.has(path));
  const failures: string[] = [];
  if (extra.length > 0) {
    failures.push(
      `new max-lines debt outside allowlist:\n${extra.map((p) => `  - ${p}`).join("\n")}`,
    );
  }
  if (stale.length > 0) {
    failures.push(
      `stale max-lines allowlist entries; remove them before merging:\n${stale
        .map((p) => `  - ${p}`)
        .join("\n")}`,
    );
  }
  return failures;
}

async function validateFeatureBoundaryRule(
  eslint: ESLint,
  cwd: string,
): Promise<string[]> {
  const filePath = resolve(cwd, "src/features/demo/Feature.tsx");
  const blocked = await eslint.lintText(
    "import { ConnectionDialog } from '@components/connection/ConnectionDialog';\nexport const Demo = ConnectionDialog;\n",
    { filePath },
  );
  const allowed = await eslint.lintText(
    "import { Button } from '@components/ui/button';\nexport const Demo = Button;\n",
    { filePath },
  );
  const hasBlockedMessage = blocked.some((result) =>
    result.messages.some(
      (message) => message.ruleId === "tv-local/no-feature-legacy-imports",
    ),
  );
  const hasAllowedMessage = allowed.some((result) =>
    result.messages.some(
      (message) => message.ruleId === "tv-local/no-feature-legacy-imports",
    ),
  );

  const failures: string[] = [];
  if (!hasBlockedMessage) {
    failures.push(
      "src/features import-boundary rule did not reject legacy component import.",
    );
  }
  if (hasAllowedMessage) {
    failures.push(
      "src/features import-boundary rule rejected @components/ui import.",
    );
  }
  return failures;
}

async function main() {
  const cwd = process.cwd();
  const eslint = new ESLint({
    cwd,
    overrideConfigFile: resolve(cwd, "eslint.config.js"),
  });
  const results = await eslint.lintFiles(["."]);
  const formatter = await eslint.loadFormatter("stylish");
  const output = await formatter.format(results);
  if (output.trim().length > 0) {
    console.log(output.trimEnd());
  }

  const summary = summarizeLintMessages(results);
  const sourceFiles = collectTypeScriptFiles(cwd);
  const ignored = await findIgnoredCandidates(eslint, sourceFiles);
  const unexpectedIgnored = findUnexpectedIgnoredFiles(ignored);
  const failures = [
    ...compareMaxLinesAllowlist(summary.maxLineWarningPaths),
    ...(summary.unexpectedWarningRules.length > 0
      ? [
          `unexpected warning rules:\n${summary.unexpectedWarningRules
            .map((rule) => `  - ${rule}`)
            .join("\n")}`,
        ]
      : []),
    ...(summary.errorCount > 0 ? [`eslint errors: ${summary.errorCount}`] : []),
    ...(unexpectedIgnored.length > 0
      ? [
          `ignored TS/TSX source outside generated allowlist:\n${unexpectedIgnored
            .map((path) => `  - ${path}`)
            .join("\n")}`,
        ]
      : []),
    ...(await validateFeatureBoundaryRule(eslint, cwd)),
  ];

  if (failures.length > 0) {
    console.error(`\nStatic policy failed:\n${failures.join("\n\n")}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `Static policy passed: ${results.length} linted files, 0 errors, ${summary.maxLineWarningPaths.length} allowed max-lines warnings, ${ignored.length} generated TS/TSX ignores.`,
  );
}

const currentFile = normalizeRepoPath(fileURLToPath(import.meta.url), "/");
const invokedFile = process.argv[1]
  ? normalizeRepoPath(resolve(process.argv[1]), "/")
  : "";

if (currentFile === invokedFile) {
  void main();
}
