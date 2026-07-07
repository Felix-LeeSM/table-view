import { ESLint } from "eslint";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  COMPLETION_FEATURE_REFERENCE_DOC_PATHS,
  findCompletionFeatureBoundaryViolations as findCompletionFeatureBoundaryViolationsImpl,
} from "./static-policy/completion-feature";
import { findCatalogFeatureBoundaryViolations as findCatalogFeatureBoundaryViolationsImpl } from "./static-policy/catalog-feature";
import { findConnectionFeatureBoundaryViolations as findConnectionFeatureBoundaryViolationsImpl } from "./static-policy/connection-feature";
import { findFeatureImportBoundaryViolations as findFeatureImportBoundaryViolationsImpl } from "./static-policy/feature-import-boundary";

export {
  CATALOG_FEATURE_PUBLIC_API_EXPORTS,
  CATALOG_FEATURE_PUBLIC_API_PATH,
} from "./static-policy/catalog-feature";
export {
  COMPLETION_FEATURE_PUBLIC_API_EXPORTS,
  COMPLETION_FEATURE_PUBLIC_API_PATH,
} from "./static-policy/completion-feature";
export {
  CONNECTION_FEATURE_PUBLIC_API_EXPORTS,
  CONNECTION_FEATURE_PUBLIC_API_PATH,
} from "./static-policy/connection-feature";
export { FEATURE_IMPORT_BOUNDARY_SCOPE } from "./static-policy/feature-import-boundary";

export const MAX_LINES_ALLOWLIST = [
  "e2e/smoke/_helpers.ts",
  // Append-only seed-target registry: the smoke routing contract requires one
  // SEED_TARGETS_BY_SPEC_KEY entry per blocking E2E spec, so this file grows by
  // a line with every new smoke spec. The 700-line god-file cap does not fit a
  // required registry; allowlist it instead of shrink-hacking on each new spec.
  "e2e/fixtures/seed-smoke.ts",
  "src/features/connection/components/ConnectionDialog.test.tsx",
  "src/features/connection/components/ConnectionGroup.test.tsx",
  "src/features/connection/components/ConnectionItem.test.tsx",
  "src/components/datagrid/useDataGridEdit.mixed-batch.test.ts",
  "src/components/document/DocumentTreePanel.test.tsx",
  "src/components/document/DocumentTreePanel.tsx",
  "src/components/layout/MainArea.test.tsx",
  "src/components/layout/TabBar.test.tsx",
  "src/components/rdb/DataGrid.editing.test.tsx",
  "src/components/schema/SchemaTree.actions.test.tsx",
  "src/components/shared/QuickLookPanel.test.tsx",
  "src/hooks/useSqlAutocomplete.test.ts",
  "src/lib/mongo/mongoshParser.test.ts",
  "src/lib/sql/sqlAst.test.ts",
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

export const RAW_TAURI_INVOKE_INVENTORY =
  [] as const satisfies readonly RawTauriInvokeInventoryEntry[];

export type FrontendCompatClassification =
  | "permanent-wire-compatibility"
  | "migration-only"
  | "removable-debt";

type FrontendCompatInventoryEntry = {
  readonly path: string;
  readonly branch: string;
  readonly classification: FrontendCompatClassification;
  readonly owner: string;
  readonly horizon: string;
  readonly testEvidence: readonly string[];
  readonly followUp: string;
};

export const FRONTEND_COMPAT_INVENTORY_DOC =
  "docs/archives/audits/refactor-02-frontend-compat-inventory-2026-06-10.md";

const FRONTEND_COMPAT_SCOPE_ROOTS = [
  "src/components/",
  "src/features/",
  "src/lib/",
  "src/stores/",
  "src/types/",
] as const;

const FRONTEND_COMPAT_REFACTOR_02_FOLLOW_UP_ISSUES: ReadonlySet<string> =
  new Set([
    "#735",
    "#736",
    "#737",
    "#738",
    "#739",
    "#740",
    "#741",
    "#742",
    "#761",
    "#762",
    "#763",
    "#764",
  ]);

const FRONTEND_COMPAT_CLASSIFICATIONS: ReadonlySet<FrontendCompatClassification> =
  new Set(["permanent-wire-compatibility", "migration-only", "removable-debt"]);

const FRONTEND_COMPAT_MARKER_PATTERN =
  /legacy|deprecated|back-compat|backward compat|backward compatibility|backward-compat|backwards compatibility|backwards-compatible|compat wrapper|compat surface|compatibility[- ]mirror|compatibility projection/i;

function cleanMarkdownTableCell(cell: string): string {
  return cell.trim().replace(/^`|`$/g, "").trim();
}

export function parseFrontendCompatInventoryMarkdown(
  source: string,
): FrontendCompatInventoryEntry[] {
  const entries: FrontendCompatInventoryEntry[] = [];
  for (const line of source.split(/\r?\n/)) {
    if (!line.startsWith("| `src/")) continue;
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cleanMarkdownTableCell(cell));
    if (cells.length < 7) continue;
    const [path, branch, classification, owner, horizon, tests, followUp] =
      cells;
    entries.push({
      path,
      branch,
      classification: classification as FrontendCompatClassification,
      owner,
      horizon,
      testEvidence: tests
        .split(/<br>|,/)
        .map((test) => cleanMarkdownTableCell(test))
        .filter(Boolean),
      followUp,
    });
  }
  return entries;
}

function readFrontendCompatInventory(cwd = process.cwd()) {
  return parseFrontendCompatInventoryMarkdown(
    readFileSync(resolve(cwd, FRONTEND_COMPAT_INVENTORY_DOC), "utf8"),
  );
}

export const FRONTEND_COMPAT_INVENTORY = readFrontendCompatInventory();

const SETTINGS_TAURI_WRAPPER_PATH = "src/lib/tauri/settings.ts";
const MOVED_SETTINGS_INVOKE_COMMANDS = [
  "get_setting",
  "persist_setting",
  "reset_setting",
] as const;
const MOVED_SETTINGS_INVOKE_COMMAND_SET: ReadonlySet<string> = new Set(
  MOVED_SETTINGS_INVOKE_COMMANDS,
);

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

export function findConnectionFeatureBoundaryViolations(
  fileSources: ReadonlyMap<string, string>,
): string[] {
  return findConnectionFeatureBoundaryViolationsImpl(
    fileSources,
    normalizeRepoPath,
  );
}

export function findCatalogFeatureBoundaryViolations(
  fileSources: ReadonlyMap<string, string>,
): string[] {
  return findCatalogFeatureBoundaryViolationsImpl(
    fileSources,
    normalizeRepoPath,
  );
}

export function findCompletionFeatureBoundaryViolations(
  fileSources: ReadonlyMap<string, string>,
): string[] {
  return findCompletionFeatureBoundaryViolationsImpl(
    fileSources,
    normalizeRepoPath,
  );
}

export function findFeatureImportBoundaryViolations(
  fileSources: ReadonlyMap<string, string>,
): string[] {
  return findFeatureImportBoundaryViolationsImpl(
    fileSources,
    normalizeRepoPath,
  );
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

function isProductionSourceModule(repoPath: string): boolean {
  const path = normalizeRepoPath(repoPath);
  return (
    path.startsWith("src/") &&
    !path.includes("/__tests__/") &&
    !path.endsWith(".test.ts") &&
    !path.endsWith(".test.tsx") &&
    !path.endsWith(".spec.ts") &&
    !path.endsWith(".spec.tsx")
  );
}

function isStoreProductionModule(repoPath: string): boolean {
  const path = normalizeRepoPath(repoPath);
  return path.startsWith("src/stores/") && isProductionSourceModule(path);
}

const RAW_TAURI_CORE_IMPORT_PATTERN =
  /(?:from\s+["']@tauri-apps\/api\/core["']|import\s*\(\s*(["'`])@tauri-apps\/api\/core\1\s*\))/;

function importsRawTauriInvoke(source: string): boolean {
  return RAW_TAURI_CORE_IMPORT_PATTERN.test(source);
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

  for (const [filePath, source] of [...fileSources.entries()].sort()) {
    const repoPath = normalizeRepoPath(filePath);
    if (!importsRawTauriInvoke(source)) continue;

    const commands = collectRawInvokeCommands(source);
    if (
      isProductionSourceModule(repoPath) &&
      repoPath !== SETTINGS_TAURI_WRAPPER_PATH
    ) {
      const movedSettingsCommands = [
        ...new Set(
          commands.filter((command) =>
            MOVED_SETTINGS_INVOKE_COMMAND_SET.has(command),
          ),
        ),
      ];
      if (movedSettingsCommands.length > 0) {
        failures.push(
          `${repoPath}: raw moved settings invoke command(s) must use ${SETTINGS_TAURI_WRAPPER_PATH}: ${movedSettingsCommands.join(", ")}.`,
        );
      }
    }

    if (!isStoreProductionModule(repoPath)) continue;

    filesWithRawInvoke.add(repoPath);
    const inventory = inventoryByPath.get(repoPath);

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

function isFrontendCompatScopeModule(repoPath: string): boolean {
  const path = normalizeRepoPath(repoPath);
  return (
    isProductionSourceModule(path) &&
    !isAllowedGeneratedLintIgnore(path) &&
    FRONTEND_COMPAT_SCOPE_ROOTS.some((root) => path.startsWith(root))
  );
}

function hasFrontendCompatMarker(source: string): boolean {
  return FRONTEND_COMPAT_MARKER_PATTERN.test(source);
}

function collectIssueRefs(text: string): string[] {
  return text.match(/#\d+/g) ?? [];
}

export function findFrontendCompatInventoryViolations(
  fileSources: ReadonlyMap<string, string>,
  inventory: readonly FrontendCompatInventoryEntry[] = FRONTEND_COMPAT_INVENTORY,
): string[] {
  const failures: string[] = [];
  const seenInventoryPaths = new Set<string>();
  const markerPaths = new Set<string>();

  for (const entry of inventory) {
    const path = normalizeRepoPath(entry.path);
    if (seenInventoryPaths.has(path)) {
      failures.push(
        `${path}: duplicate frontend compatibility inventory entry.`,
      );
    }
    seenInventoryPaths.add(path);

    if (!FRONTEND_COMPAT_CLASSIFICATIONS.has(entry.classification)) {
      failures.push(`${path}: invalid compatibility classification.`);
    }
    if (
      entry.branch.length === 0 ||
      entry.owner.length === 0 ||
      entry.horizon.length === 0 ||
      entry.followUp.length === 0 ||
      entry.testEvidence.length === 0
    ) {
      failures.push(
        `${path}: incomplete frontend compatibility inventory row.`,
      );
    }
    const followUpIssues = collectIssueRefs(entry.followUp);
    if (followUpIssues.length === 0) {
      failures.push(
        `${path}: frontend compatibility row lacks follow-up issue evidence.`,
      );
    }
    if (
      entry.classification === "migration-only" &&
      !followUpIssues.some((issue) =>
        FRONTEND_COMPAT_REFACTOR_02_FOLLOW_UP_ISSUES.has(issue),
      )
    ) {
      failures.push(
        `${path}: migration-only compatibility row lacks same-milestone Refactor 02 follow-up issue evidence.`,
      );
    }
    if (!isFrontendCompatScopeModule(path)) {
      failures.push(
        `${path}: frontend compatibility inventory path is outside frontend compatibility scope.`,
      );
    }
  }

  for (const [filePath, source] of [...fileSources.entries()].sort()) {
    const repoPath = normalizeRepoPath(filePath);
    if (!isFrontendCompatScopeModule(repoPath)) continue;
    if (!hasFrontendCompatMarker(source)) continue;
    markerPaths.add(repoPath);
    if (!seenInventoryPaths.has(repoPath)) {
      failures.push(
        `${repoPath}: frontend compatibility marker is missing from ${FRONTEND_COMPAT_INVENTORY_DOC}.`,
      );
    }
  }

  for (const path of seenInventoryPaths) {
    const source = fileSources.get(path);
    if (source === undefined || !hasFrontendCompatMarker(source)) {
      failures.push(
        `${path}: stale frontend compatibility inventory entry; remove it from ${FRONTEND_COMPAT_INVENTORY_DOC}.`,
      );
    }
  }

  if (markerPaths.size === 0) {
    failures.push(
      "frontend compatibility marker scan returned no production paths.",
    );
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
  const completionReferenceDocContents = readFileSources(
    cwd,
    COMPLETION_FEATURE_REFERENCE_DOC_PATHS.filter((repoPath) =>
      existsSync(resolve(cwd, repoPath)),
    ),
  );
  const completionPolicyContents = new Map([
    ...sourceFileContents,
    ...completionReferenceDocContents,
  ]);
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
    ...findCatalogFeatureBoundaryViolations(sourceFileContents),
    ...findCompletionFeatureBoundaryViolations(completionPolicyContents),
    ...findConnectionFeatureBoundaryViolations(sourceFileContents),
    ...findFeatureImportBoundaryViolations(sourceFileContents),
    ...findFrontendCompatInventoryViolations(sourceFileContents),
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
