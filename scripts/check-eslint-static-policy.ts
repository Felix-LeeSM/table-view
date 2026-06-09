import { ESLint } from "eslint";
import { existsSync, readFileSync, readdirSync } from "node:fs";
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

type RawTauriInvokeInventoryEntry = {
  readonly path: string;
  readonly commands: readonly string[];
  readonly owner: string;
  readonly wrapperTarget: string;
  readonly risk: "low" | "medium" | "high";
  readonly action: string;
};

export const RAW_TAURI_INVOKE_INVENTORY = [
  {
    path: "src/stores/favoritesStore.ts",
    commands: ["list_favorites", "persist_favorites"],
    owner: "favorites persistence store",
    wrapperTarget: "src/lib/tauri/favorites.ts",
    risk: "medium",
    action: "follow-up: move favorites persistence IPC behind a typed wrapper",
  },
  {
    path: "src/stores/mruStore.ts",
    commands: ["clear_mru", "persist_mru"],
    owner: "MRU persistence store",
    wrapperTarget: "src/lib/tauri/mru.ts",
    risk: "low",
    action: "follow-up: move MRU persistence IPC behind a typed wrapper",
  },
] as const satisfies readonly RawTauriInvokeInventoryEntry[];

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

function isStoreProductionModule(repoPath: string): boolean {
  const path = normalizeRepoPath(repoPath);
  return (
    path.startsWith("src/stores/") &&
    !path.includes("/__tests__/") &&
    !path.endsWith(".test.ts") &&
    !path.endsWith(".test.tsx")
  );
}

function importsRawTauriInvoke(source: string): boolean {
  return /from\s+["']@tauri-apps\/api\/core["']/.test(source);
}

function collectRawInvokeCommands(source: string): string[] {
  return [...source.matchAll(/\binvoke(?:<[^>]+>)?\(\s*["']([^"']+)["']/g)]
    .map((match) => match[1]!)
    .sort();
}

export function findRawTauriInvokeBoundaryViolations(
  fileSources: ReadonlyMap<string, string>,
): string[] {
  const inventoryByPath = new Map(
    RAW_TAURI_INVOKE_INVENTORY.map((entry) => [entry.path, entry]),
  );
  const filesWithRawInvoke = new Set<string>();
  const failures: string[] = [];

  for (const [repoPath, source] of [...fileSources.entries()].sort()) {
    if (!isStoreProductionModule(repoPath)) continue;
    if (!importsRawTauriInvoke(source)) continue;

    filesWithRawInvoke.add(repoPath);
    const inventory = inventoryByPath.get(repoPath);
    const commands = collectRawInvokeCommands(source);

    if (inventory === undefined) {
      failures.push(
        `${repoPath}: raw @tauri-apps/api/core import is outside src/lib/tauri/** and missing from RAW_TAURI_INVOKE_INVENTORY.`,
      );
      continue;
    }

    const allowedCommands = new Set(inventory.commands);
    const unexpectedCommands = commands.filter(
      (command) => !allowedCommands.has(command),
    );
    const missingCommands = inventory.commands.filter(
      (command) => !commands.includes(command),
    );
    if (unexpectedCommands.length > 0) {
      failures.push(
        `${repoPath}: untriaged raw invoke command(s): ${unexpectedCommands.join(", ")}.`,
      );
    }
    if (missingCommands.length > 0) {
      failures.push(
        `${repoPath}: stale RAW_TAURI_INVOKE_INVENTORY command(s): ${missingCommands.join(", ")}.`,
      );
    }
  }

  for (const entry of RAW_TAURI_INVOKE_INVENTORY) {
    if (!filesWithRawInvoke.has(entry.path)) {
      failures.push(
        `${entry.path}: stale RAW_TAURI_INVOKE_INVENTORY entry; remove it after migrating to ${entry.wrapperTarget}.`,
      );
    }
  }

  return failures;
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

function readFileSources(cwd: string, repoPaths: string[]) {
  return new Map(
    repoPaths.map((repoPath) => [
      repoPath,
      readFileSync(resolve(cwd, repoPath), "utf8"),
    ]),
  );
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
  const sourceFileContents = readFileSources(cwd, sourceFiles);
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
    ...findRawTauriInvokeBoundaryViolations(sourceFileContents),
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
