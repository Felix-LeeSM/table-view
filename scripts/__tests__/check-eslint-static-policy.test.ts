import { describe, expect, it } from "vitest";
import {
  COMPLETION_FEATURE_PUBLIC_API_EXPORTS,
  COMPLETION_FEATURE_PUBLIC_API_PATH,
  CONNECTION_FEATURE_PUBLIC_API_PATH,
  CONNECTION_FEATURE_PUBLIC_API_EXPORTS,
  FRONTEND_COMPAT_INVENTORY,
  MAX_LINES_ALLOWLIST,
  RAW_TAURI_INVOKE_INVENTORY,
  findCompletionFeatureBoundaryViolations,
  findConnectionFeatureBoundaryViolations,
  findFeatureImportBoundaryViolations,
  findFrontendCompatInventoryViolations,
  findRawTauriInvokeBoundaryViolations,
  findUnexpectedIgnoredFiles,
  isAllowedGeneratedLintIgnore,
  parseFrontendCompatInventoryMarkdown,
  summarizeLintMessages,
} from "../check-eslint-static-policy";

function connectionPublicApiFixture(extraLines: readonly string[] = []) {
  return [
    "export { default as ConnectionDialog, sanitizeMessage } from './components/ConnectionDialog';",
    "export { default as ConnectionList } from './components/ConnectionList';",
    "export { default as ConnectionGroup } from './components/ConnectionGroup';",
    "export { default as ConnectionItem } from './components/ConnectionItem';",
    "export { default as GroupDialog } from './components/GroupDialog';",
    "export { default as ImportExportDialog } from './components/ImportExportDialog';",
    "export { default as RecentConnections, relativeTime } from './components/RecentConnections';",
    "export { DbLifecycleDialog } from './components/DbLifecycleDialog';",
    "export { KeyringFallbackToast } from './components/KeyringFallbackToast';",
    "export { ServerActivityPanel } from './components/ServerActivityPanel';",
    "export { ServerInfoPanel } from './components/ServerInfoPanel';",
    "export { DatabaseUsersPanel } from './components/DatabaseUsersPanel';",
    "export { useConnectionMutations } from '@lib/runtime/connection/useConnectionMutations';",
    "export { useConnectionStore, SYNCED_KEYS } from './store';",
    "export type { ConnectionState } from './store';",
    "export { connectToDatabase, createSqliteDatabaseFile, deleteConnection, deleteGroup, disconnectFromDatabase, exportConnections, exportConnectionsEncrypted, importConnections, importConnectionsEncrypted, listConnections, listGroups, moveConnectionToGroup, saveConnection, saveGroup, testConnection } from './api';",
    "export type { EncryptedExportResult, ImportRenamedEntry, ImportResult } from './api';",
    "export { CONNECTION_COLOR_PALETTE, getConnectionColor } from './color';",
    "export { DUCKDB_FILE_CONNECTION, SQLITE_FILE_CONNECTION } from './fileConnection';",
    "export type { FileConnectionContract, FileConnectionInputContract, FileConnectionInputKind, FileConnectionInputStatus, FileConnectionPermissionScope, FileConnectionPrivacyPolicyId } from './fileConnection';",
    "export { DATABASE_DEFAULTS, DATABASE_DEFAULT_FIELDS, DATABASE_TYPE_LABELS, ENVIRONMENT_META, ENVIRONMENT_OPTIONS, SUPPORTED_DATABASE_TYPES, createEmptyDraft, draftFromConnection, isKvFamily, isSearchFamily, isSupportedDatabaseType, paradigmOf, parseConnectionUrl, parseFileConnectionPath, parseSqliteFilePath } from './model';",
    "export type { ConnectionConfig, ConnectionDefaultFields, ConnectionDraft, ConnectionGroup as ConnectionGroupModel, ConnectionStatus, DatabaseType, EnvironmentTag, FileConnectionDatabaseType, Paradigm } from './model';",
    ...extraLines,
  ].join("\n");
}

function completionPublicApiFixture(extraLines: readonly string[] = []) {
  return [
    "export { buildSqlCompletionContext } from './sql/sqlCompletionContext';",
    "export { buildSqlCompletionRequest } from './sql/sqlCompletionRequest';",
    "export { buildSqlCompletionRequestFromCodeMirror } from './sql/sqlCodeMirrorCompletionAdapter';",
    "export { createSqlHybridCompletionSource, SQL_COMPLETION_LEGACY_COMPATIBILITY_OWNER_ISSUE } from './sql/sqlHybridCompletionSource';",
    "export type { SqlCompletionCatalogStoreSnapshot, BuildSqlCompletionContextInput, SqlCompletionCatalogSchema, SqlCompletionCatalogDatabase, SqlCompletionCatalogObject, SqlCompletionCatalogColumn, SqlCompletionCatalogFunction, SqlCompletionCatalogExtension, SqlCompletionCatalogSnapshot, SqlCompletionCacheState, SqlCompletionContext } from './sql/sqlCompletionContext';",
    "export type { SqlCompletionRequest } from './sql/sqlCompletionRequest';",
    "export type { SqlHybridCompletionSourceOptions } from './sql/sqlHybridCompletionSource';",
    "export { useMongoAutocomplete } from './mongo/useMongoAutocomplete';",
    "export { createDbMethodCompletionSource, dbMethodCandidates } from './mongo/mongo';",
    "export { createMongoAdminCommandSource, createMongoCompletionSource, createMongoOperatorHighlight, createMongoshDbSource, classifyMongoCompletionPosition, getMongoAdminCommandCompletions, getMongoCompletionVocabulary, getMongoshCollectionMethodCompletions, getMongoshDbLevelMethodCompletions, MONGO_ACCUMULATORS, MONGO_ADMIN_COMMANDS, MONGO_AGGREGATE_STAGES, MONGO_ALL_OPERATORS, MONGO_EXPRESSION_OPERATORS, MONGO_PROJECTION_OPERATORS, MONGO_QUERY_OPERATORS, MONGO_TYPE_TAGS, MONGO_UPDATE_OPERATORS, MONGOSH_DB_LEVEL_METHODS, MONGOSH_DB_METHODS } from './mongo/mongoAutocomplete';",
    "export type { UseMongoAutocompleteOptions } from './mongo/useMongoAutocomplete';",
    "export type { MongoCompletionCursor, MongoCompletionResult, MongoDbMethodSource, MongoMethodCandidate } from './mongo/mongo';",
    "export type { MongoCompletionOptions, MongoCompletionPositionKind, MongoQueryMode, MongoshDbSourceOptions } from './mongo/mongoAutocomplete';",
    "export { createRedisCommandCompletionSource, REDIS_COMMAND_COMPLETIONS, REDIS_UNSUPPORTED_COMMAND_FAMILIES, VALKEY_COMMAND_COMPLETIONS } from './redis/redisCommandCompletion';",
    "export type { RedisCommandCompletionEffect, RedisCommandCompletionName, RedisCommandCompletionSourceOptions, RedisCommandCompletionSpec, RedisCommandCompletionTarget, RedisKeySuggestion, RedisUnsupportedCommandFamily } from './redis/redisCommandCompletion';",
    ...extraLines,
  ].join("\n");
}

describe("check-eslint-static-policy", () => {
  it("keeps the measured max-lines allowlist explicit", () => {
    expect(MAX_LINES_ALLOWLIST).toHaveLength(18);
    // #1407 — the redis-empty-state-window seed mapping pushed
    // e2e/fixtures/seed-smoke.ts past the 700-line cap.
    expect(MAX_LINES_ALLOWLIST).toContain("e2e/fixtures/seed-smoke.ts");
    expect(MAX_LINES_ALLOWLIST).not.toContain(
      "src/components/datagrid/sqlGenerator.test.ts",
    );
    // #1360 — CreateTableDialog.tsx dropped below 700 lines after the
    // hook + tab-body split, so its allowlist entry was removed.
    expect(MAX_LINES_ALLOWLIST).not.toContain(
      "src/components/schema/CreateTableDialog.tsx",
    );
    expect(MAX_LINES_ALLOWLIST).not.toContain(
      "src/components/schema/CreateTableDialog.test.tsx",
    );
    expect(MAX_LINES_ALLOWLIST).not.toContain(
      "src/components/query/QueryTab/useQueryExecution.ts",
    );
    expect(MAX_LINES_ALLOWLIST).toContain("e2e/smoke/_helpers.ts");
  });

  it("allows only generated wasm lint ignores", () => {
    expect(
      isAllowedGeneratedLintIgnore("src/lib/sql/wasm/sql_parser_core.d.ts"),
    ).toBe(true);
    expect(
      isAllowedGeneratedLintIgnore(
        "src/lib/mongo/wasm/mongosh_parser_core.d.ts",
      ),
    ).toBe(true);
    expect(isAllowedGeneratedLintIgnore("src/components/Foo.tsx")).toBe(false);
  });

  it("reports hidden lint candidates outside the generated allowlist", () => {
    expect(
      findUnexpectedIgnoredFiles([
        "src/lib/sql/wasm/sql_parser_core.d.ts",
        "src/components/Foo.tsx",
      ]),
    ).toEqual(["src/components/Foo.tsx"]);
  });

  it("summarizes max-lines warnings separately from other lint messages", () => {
    const summary = summarizeLintMessages([
      {
        filePath: "src/A.ts",
        messages: [
          { ruleId: "max-lines", severity: 1 },
          { ruleId: "no-console", severity: 2 },
          { ruleId: "no-warning-comments", severity: 1 },
        ],
      },
    ]);

    expect(summary.maxLineWarningPaths).toEqual(["src/A.ts"]);
    expect(summary.errorCount).toBe(1);
    expect(summary.unexpectedWarningRules).toEqual(["no-warning-comments"]);
  });

  it("keeps raw store invoke inventory explicit", () => {
    expect(RAW_TAURI_INVOKE_INVENTORY).toEqual([]);
  });

  it("locks the connection feature public API surface", () => {
    expect(CONNECTION_FEATURE_PUBLIC_API_EXPORTS).toEqual([
      "ConnectionDialog",
      "sanitizeMessage",
      "ConnectionList",
      "ConnectionGroup",
      "ConnectionItem",
      "GroupDialog",
      "ImportExportDialog",
      "RecentConnections",
      "relativeTime",
      "DbLifecycleDialog",
      "KeyringFallbackToast",
      "ServerActivityPanel",
      "ServerInfoPanel",
      "DatabaseUsersPanel",
      "useConnectionMutations",
      "useConnectionStore",
      "SYNCED_KEYS",
      "ConnectionState",
      "connectToDatabase",
      "createSqliteDatabaseFile",
      "deleteConnection",
      "deleteGroup",
      "disconnectFromDatabase",
      "exportConnections",
      "exportConnectionsEncrypted",
      "importConnections",
      "importConnectionsEncrypted",
      "listConnections",
      "listGroups",
      "moveConnectionToGroup",
      "saveConnection",
      "saveGroup",
      "testConnection",
      "EncryptedExportResult",
      "ImportRenamedEntry",
      "ImportResult",
      "getConnectionColor",
      "CONNECTION_COLOR_PALETTE",
      "FileConnectionPermissionScope",
      "FileConnectionPrivacyPolicyId",
      "FileConnectionInputKind",
      "FileConnectionInputStatus",
      "FileConnectionInputContract",
      "FileConnectionContract",
      "SQLITE_FILE_CONNECTION",
      "DUCKDB_FILE_CONNECTION",
      "DATABASE_DEFAULTS",
      "DATABASE_DEFAULT_FIELDS",
      "DATABASE_TYPE_LABELS",
      "ENVIRONMENT_META",
      "ENVIRONMENT_OPTIONS",
      "SUPPORTED_DATABASE_TYPES",
      "createEmptyDraft",
      "draftFromConnection",
      "isKvFamily",
      "isSearchFamily",
      "isSupportedDatabaseType",
      "paradigmOf",
      "parseConnectionUrl",
      "parseFileConnectionPath",
      "parseSqliteFilePath",
      "ConnectionConfig",
      "ConnectionDefaultFields",
      "ConnectionDraft",
      "ConnectionGroupModel",
      "ConnectionStatus",
      "DatabaseType",
      "EnvironmentTag",
      "FileConnectionDatabaseType",
      "Paradigm",
    ]);
  });

  it("locks the completion feature public API surface", () => {
    expect(COMPLETION_FEATURE_PUBLIC_API_EXPORTS).toEqual([
      "buildSqlCompletionContext",
      "buildSqlCompletionRequest",
      "buildSqlCompletionRequestFromCodeMirror",
      "createSqlHybridCompletionSource",
      "SQL_COMPLETION_LEGACY_COMPATIBILITY_OWNER_ISSUE",
      "SqlCompletionCatalogStoreSnapshot",
      "BuildSqlCompletionContextInput",
      "SqlCompletionCatalogSchema",
      "SqlCompletionCatalogDatabase",
      "SqlCompletionCatalogObject",
      "SqlCompletionCatalogColumn",
      "SqlCompletionCatalogFunction",
      "SqlCompletionCatalogExtension",
      "SqlCompletionCatalogSnapshot",
      "SqlCompletionCacheState",
      "SqlCompletionContext",
      "SqlCompletionRequest",
      "SqlHybridCompletionSourceOptions",
      "useMongoAutocomplete",
      "createDbMethodCompletionSource",
      "createMongoAdminCommandSource",
      "createMongoCompletionSource",
      "createMongoOperatorHighlight",
      "createMongoshDbSource",
      "classifyMongoCompletionPosition",
      "dbMethodCandidates",
      "getMongoAdminCommandCompletions",
      "getMongoCompletionVocabulary",
      "getMongoshCollectionMethodCompletions",
      "getMongoshDbLevelMethodCompletions",
      "MONGO_ACCUMULATORS",
      "MONGO_ADMIN_COMMANDS",
      "MONGO_AGGREGATE_STAGES",
      "MONGO_ALL_OPERATORS",
      "MONGO_EXPRESSION_OPERATORS",
      "MONGO_PROJECTION_OPERATORS",
      "MONGO_QUERY_OPERATORS",
      "MONGO_TYPE_TAGS",
      "MONGO_UPDATE_OPERATORS",
      "MONGOSH_DB_LEVEL_METHODS",
      "MONGOSH_DB_METHODS",
      "UseMongoAutocompleteOptions",
      "MongoCompletionCursor",
      "MongoCompletionOptions",
      "MongoCompletionPositionKind",
      "MongoCompletionResult",
      "MongoDbMethodSource",
      "MongoMethodCandidate",
      "MongoQueryMode",
      "MongoshDbSourceOptions",
      "createRedisCommandCompletionSource",
      "REDIS_COMMAND_COMPLETIONS",
      "REDIS_UNSUPPORTED_COMMAND_FAMILIES",
      "VALKEY_COMMAND_COMPLETIONS",
      "RedisCommandCompletionEffect",
      "RedisCommandCompletionName",
      "RedisCommandCompletionSourceOptions",
      "RedisCommandCompletionSpec",
      "RedisCommandCompletionTarget",
      "RedisKeySuggestion",
      "RedisUnsupportedCommandFamily",
    ]);
  });

  it("rejects completion adapter imports from migrated legacy paths", () => {
    const failures = findCompletionFeatureBoundaryViolations(
      new Map([
        [COMPLETION_FEATURE_PUBLIC_API_PATH, completionPublicApiFixture()],
        [
          "src/components/query/SqlQueryEditor.tsx",
          'import { createSqlHybridCompletionSource } from "@lib/sql/sqlHybridCompletionSource";\n',
        ],
        [
          "src/components/document/AddDocumentModal.tsx",
          'import { useMongoAutocomplete } from "@/hooks/useMongoAutocomplete";\n',
        ],
      ]),
    );

    expect(failures).toContain(
      "src/components/query/SqlQueryEditor.tsx: import completion request/context/UI adapters through src/features/completion/index.ts, not @lib/sql/sqlHybridCompletionSource.",
    );
    expect(failures).toContain(
      "src/components/document/AddDocumentModal.tsx: import completion request/context/UI adapters through src/features/completion/index.ts, not @/hooks/useMongoAutocomplete.",
    );
  });

  it("rejects moved completion compatibility paths", () => {
    const failures = findCompletionFeatureBoundaryViolations(
      new Map([
        [COMPLETION_FEATURE_PUBLIC_API_PATH, completionPublicApiFixture()],
        [
          "src/lib/redis/redisCommandCompletion.ts",
          "export function createRedisCommandCompletionSource() {}\n",
        ],
      ]),
    );

    expect(failures).toContain(
      "src/lib/redis/redisCommandCompletion.ts: moved completion module must not remain as a compatibility path; import src/features/completion/index.ts.",
    );
  });

  it("accepts migrated completion feature imports", () => {
    const failures = findCompletionFeatureBoundaryViolations(
      new Map([
        [COMPLETION_FEATURE_PUBLIC_API_PATH, completionPublicApiFixture()],
        [
          "src/components/query/SqlQueryEditor.tsx",
          'import { createSqlHybridCompletionSource } from "@features/completion";\n',
        ],
        [
          "src/components/query/QueryTab.tsx",
          'import { buildSqlCompletionContext, useMongoAutocomplete } from "@features/completion";\n',
        ],
        [
          "src/components/query/RedisCommandEditor.tsx",
          'import { createRedisCommandCompletionSource } from "@features/completion";\n',
        ],
        [
          "src/components/document/DocumentFilterBar.tsx",
          'import { useMongoAutocomplete } from "@features/completion";\n',
        ],
      ]),
    );

    expect(failures).toEqual([]);
  });

  it("rejects unexpected completion feature public API exports", () => {
    const failures = findCompletionFeatureBoundaryViolations(
      new Map([
        [
          COMPLETION_FEATURE_PUBLIC_API_PATH,
          completionPublicApiFixture([
            "export { internalCompletionFixture } from './testSupport';",
          ]),
        ],
      ]),
    );

    expect(failures).toContain(
      `${COMPLETION_FEATURE_PUBLIC_API_PATH}: unexpected public export internalCompletionFixture.`,
    );
  });

  it("rejects completion feature default public exports", () => {
    const failures = findCompletionFeatureBoundaryViolations(
      new Map([
        [
          COMPLETION_FEATURE_PUBLIC_API_PATH,
          completionPublicApiFixture([
            "export default function internalCompletionFixture() {}",
          ]),
        ],
      ]),
    );

    expect(failures).toContain(
      `${COMPLETION_FEATURE_PUBLIC_API_PATH}: default public export is not allowed; enumerate named exports.`,
    );
  });

  it("rejects stale moved completion references in docs", () => {
    const failures = findCompletionFeatureBoundaryViolations(
      new Map([
        [COMPLETION_FEATURE_PUBLIC_API_PATH, completionPublicApiFixture()],
        [
          "docs/ROADMAP.md",
          "Evidence: `src/lib/sql/sqlCompletionContext.test.ts`.",
        ],
      ]),
    );

    expect(failures).toContain(
      "docs/ROADMAP.md: stale moved completion reference src/lib/sql/sqlCompletionContext.test.ts; use src/features/completion/sql/sqlCompletionContext.test.ts.",
    );
  });

  it("rejects app-shell imports from legacy connection UI/model/api paths", () => {
    const failures = findConnectionFeatureBoundaryViolations(
      new Map([
        [
          "src/features/connection/index.ts",
          "export { default as ConnectionDialog } from './components/ConnectionDialog';\n",
        ],
        [
          "src/pages/HomePage.tsx",
          'import ConnectionDialog from "@components/connection/ConnectionDialog";\n',
        ],
      ]),
    );

    expect(failures).toContain(
      "src/pages/HomePage.tsx: import connection UI/model/api through src/features/connection/index.ts, not @components/connection/ConnectionDialog.",
    );
  });

  it("accepts migrated app-shell connection imports and compatibility wrappers", () => {
    const failures = findConnectionFeatureBoundaryViolations(
      new Map([
        [CONNECTION_FEATURE_PUBLIC_API_PATH, connectionPublicApiFixture()],
        [
          "src/pages/HomePage.tsx",
          'import { ConnectionDialog } from "@features/connection";\n',
        ],
        [
          "src/components/connection/ConnectionDialog.tsx",
          'export { default } from "@features/connection";\n',
        ],
      ]),
    );

    expect(failures).toEqual([]);
  });

  it("rejects unexpected connection feature public API exports", () => {
    const failures = findConnectionFeatureBoundaryViolations(
      new Map([
        [
          CONNECTION_FEATURE_PUBLIC_API_PATH,
          connectionPublicApiFixture([
            "export { internalConnectionFixture } from './testSupport';",
          ]),
        ],
      ]),
    );

    expect(failures).toContain(
      `${CONNECTION_FEATURE_PUBLIC_API_PATH}: unexpected public export internalConnectionFixture.`,
    );
  });

  it("requires the connection group model type to use the public ConnectionGroupModel alias", () => {
    const failures = findConnectionFeatureBoundaryViolations(
      new Map([
        [
          CONNECTION_FEATURE_PUBLIC_API_PATH,
          connectionPublicApiFixture().replace(
            "ConnectionGroup as ConnectionGroupModel",
            "ConnectionGroup",
          ),
        ],
      ]),
    );

    expect(failures).toContain(
      `${CONNECTION_FEATURE_PUBLIC_API_PATH}: missing public export ConnectionGroupModel.`,
    );
  });

  it("rejects untriaged raw Tauri invoke imports in store modules", () => {
    const failures = findRawTauriInvokeBoundaryViolations(
      new Map([
        [
          "src/stores/themeStore.ts",
          'import { invoke } from "@tauri-apps/api/core";\nvoid invoke("persist_setting");\n',
        ],
        [
          "src/stores/favoritesStore.ts",
          'import { invoke } from "@tauri-apps/api/core";\nvoid invoke("list_favorites");\nvoid invoke("persist_favorites");\n',
        ],
        [
          "src/stores/mruStore.ts",
          'import { invoke } from "@tauri-apps/api/core";\nvoid invoke("persist_mru");\nvoid invoke("clear_mru");\n',
        ],
      ]),
    );

    expect(failures).toContain(
      "src/stores/themeStore.ts: raw @tauri-apps/api/core import is outside src/lib/tauri/** and missing from RAW_TAURI_INVOKE_INVENTORY.",
    );
  });

  it.each([
    [
      "call expression",
      'const { invoke } = await import("@tauri-apps/api/core");\nvoid invoke("persist_setting");\n',
    ],
    [
      "call expression with whitespace",
      'const { invoke } = await import ("@tauri-apps/api/core");\nvoid invoke("persist_setting");\n',
    ],
    [
      "template literal specifier",
      'const { invoke } = await import(`@tauri-apps/api/core`);\nvoid invoke("persist_setting");\n',
    ],
  ])(
    "rejects untriaged dynamic raw Tauri invoke imports: %s",
    (_name, source) => {
      const failures = findRawTauriInvokeBoundaryViolations(
        new Map([["src/stores/themeStore.ts", source]]),
      );

      expect(failures).toContain(
        "src/stores/themeStore.ts: raw @tauri-apps/api/core import is outside src/lib/tauri/** and missing from RAW_TAURI_INVOKE_INVENTORY.",
      );
    },
  );

  it("rejects moved settings raw invokes in UI-adjacent modules", () => {
    const failures = findRawTauriInvokeBoundaryViolations(
      new Map([
        [
          "src/lib/themeBoot.ts",
          'import { invoke } from "@tauri-apps/api/core";\nawait invoke<string | null>("get_setting", { key: "theme" });\n',
        ],
        [
          "src/stores/favoritesStore.ts",
          'import { invoke } from "@tauri-apps/api/core";\nvoid invoke("list_favorites");\nvoid invoke("persist_favorites");\n',
        ],
        [
          "src/stores/mruStore.ts",
          'import { invoke } from "@tauri-apps/api/core";\nvoid invoke("persist_mru");\nvoid invoke("clear_mru");\n',
        ],
      ]),
    );

    expect(failures).toContain(
      "src/lib/themeBoot.ts: raw moved settings invoke command(s) must use src/lib/tauri/settings.ts: get_setting.",
    );
  });

  it("allows moved settings raw invokes in the typed settings wrapper", () => {
    const failures = findRawTauriInvokeBoundaryViolations(
      new Map([
        [
          "src/lib/tauri/settings.ts",
          'import { invoke } from "@tauri-apps/api/core";\nvoid invoke("get_setting");\nvoid invoke("persist_setting");\nvoid invoke("reset_setting");\n',
        ],
      ]),
    );

    expect(failures).toEqual([]);
  });

  it("loads the frontend compatibility inventory from the audit document", () => {
    expect(FRONTEND_COMPAT_INVENTORY.length).toBeGreaterThan(50);
    expect(FRONTEND_COMPAT_INVENTORY).toContainEqual(
      expect.objectContaining({
        path: "src/stores/workspaceStore/types.ts",
        classification: "migration-only",
        followUp: expect.stringContaining("#764"),
      }),
    );
    expect(FRONTEND_COMPAT_INVENTORY).toContainEqual(
      expect.objectContaining({
        path: "src/lib/runtime/migration/legacyColumnPrefsDrop.ts",
        classification: "removable-debt",
        followUp: expect.stringContaining("#758"),
      }),
    );
    expect(FRONTEND_COMPAT_INVENTORY).toContainEqual(
      expect.objectContaining({
        path: "src/lib/tauri/legacyImport.ts",
        classification: "permanent-wire-compatibility",
        followUp: expect.stringContaining("#758"),
      }),
    );
  });

  it("parses compact frontend compatibility table rows", () => {
    expect(
      parseFrontendCompatInventoryMarkdown(`
| Path | Branch | Classification | Owner | Horizon | Tests | Follow-up |
|---|---|---|---|---|---|---|
| \`src/types/connection.ts\` | legacy URL alias | permanent-wire-compatibility | connection | preserve | \`src/types/connection.test.ts\` | #735 |
`),
    ).toEqual([
      {
        path: "src/types/connection.ts",
        branch: "legacy URL alias",
        classification: "permanent-wire-compatibility",
        owner: "connection",
        horizon: "preserve",
        testEvidence: ["src/types/connection.test.ts"],
        followUp: "#735",
      },
    ]);
  });

  it("rejects untriaged frontend compatibility markers", () => {
    const failures = findFrontendCompatInventoryViolations(
      new Map([
        [
          "src/types/connection.ts",
          "// legacy URL scheme kept for compatibility\n",
        ],
        ["src/lib/newCompat.ts", "// legacy persisted value still supported\n"],
      ]),
      [
        {
          path: "src/types/connection.ts",
          branch: "legacy URL scheme",
          classification: "permanent-wire-compatibility",
          owner: "connection",
          horizon: "preserve",
          testEvidence: ["src/types/connection.test.ts"],
          followUp: "#735",
        },
      ],
    );

    expect(failures).toContain(
      "src/lib/newCompat.ts: frontend compatibility marker is missing from docs/archives/audits/refactor-02-frontend-compat-inventory-2026-06-10.md.",
    );
  });

  it("rejects stale frontend compatibility inventory rows", () => {
    const failures = findFrontendCompatInventoryViolations(
      new Map([
        ["src/types/connection.ts", "export const database = 'postgres';\n"],
      ]),
      [
        {
          path: "src/types/connection.ts",
          branch: "legacy URL scheme",
          classification: "permanent-wire-compatibility",
          owner: "connection",
          horizon: "preserve",
          testEvidence: ["src/types/connection.test.ts"],
          followUp: "#735",
        },
      ],
    );

    expect(failures).toContain(
      "src/types/connection.ts: stale frontend compatibility inventory entry; remove it from docs/archives/audits/refactor-02-frontend-compat-inventory-2026-06-10.md.",
    );
  });

  it("requires migration-only frontend compatibility rows to cite same-milestone Refactor 02 issues", () => {
    const failures = findFrontendCompatInventoryViolations(
      new Map([
        [
          "src/lib/tauri/legacyImport.ts",
          "// legacy local-storage import IPC wrapper\n",
        ],
      ]),
      [
        {
          path: "src/lib/tauri/legacyImport.ts",
          branch: "legacy local-storage import IPC wrapper",
          classification: "migration-only",
          owner: "storage import runtime",
          horizon: "Keep until compatibility ledger.",
          testEvidence: ["src/lib/tauri/legacyImport.test.ts"],
          followUp: "#758 decides preservation/removal",
        },
      ],
    );

    expect(failures).toContain(
      "src/lib/tauri/legacyImport.ts: migration-only compatibility row lacks same-milestone Refactor 02 follow-up issue evidence.",
    );
  });

  it("does not block unrelated raw invoke commands in UI-adjacent modules", () => {
    const failures = findRawTauriInvokeBoundaryViolations(
      new Map([
        [
          "src/lib/themeBoot.ts",
          'import { invoke } from "@tauri-apps/api/core";\nvoid invoke("show_window");\n',
        ],
      ]),
    );

    expect(failures).toEqual([]);
  });

  it("rejects raw invoke reintroduction in migrated store modules", () => {
    const failures = findRawTauriInvokeBoundaryViolations(
      new Map([
        [
          "src/stores/favoritesStore.ts",
          'import { invoke } from "@tauri-apps/api/core";\nvoid invoke("persist_favorites");\n',
        ],
        [
          "src/stores/mruStore.ts",
          'import { invoke } from "@tauri-apps/api/core";\nvoid invoke("clear_mru");\n',
        ],
      ]),
    );

    expect(failures).toContain(
      "src/stores/favoritesStore.ts: raw @tauri-apps/api/core import is outside src/lib/tauri/** and missing from RAW_TAURI_INVOKE_INVENTORY.",
    );
    expect(failures).toContain(
      "src/stores/mruStore.ts: raw @tauri-apps/api/core import is outside src/lib/tauri/** and missing from RAW_TAURI_INVOKE_INVENTORY.",
    );
  });

  it("rejects direct imports of other feature internals", () => {
    const failures = findFeatureImportBoundaryViolations(
      new Map([
        [
          "src/features/completion/sql/sqlCompletionRequest.ts",
          'import { parseMongoshExpression } from "@features/query/mongo/mongoshParser";\n',
        ],
        [
          "src/features/connection/store.ts",
          'import { WorkspacePage } from "@/features/workspace/index";\n',
        ],
      ]),
    );

    expect(failures).toContain(
      "src/features/completion/sql/sqlCompletionRequest.ts: import query feature internals through src/features/query/index.ts, not @features/query/mongo/mongoshParser.",
    );
    expect(failures).not.toContain(
      "src/features/connection/store.ts: import workspace feature internals through src/features/workspace/index.ts, not @/features/workspace/index.",
    );
  });

  it("allows public feature APIs and same-feature internals", () => {
    const failures = findFeatureImportBoundaryViolations(
      new Map([
        [
          "src/features/completion/sql/sqlCompletionRequest.ts",
          'import { MONGOSH_METHOD_WHITELIST } from "@features/query";\n',
        ],
        [
          "src/features/connection/components/ConnectionDialog.tsx",
          'import { useConnectionStore } from "../store";\n',
        ],
      ]),
    );

    expect(failures).toEqual([]);
  });
});
