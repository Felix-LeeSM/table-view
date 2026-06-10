import { describe, expect, it } from "vitest";
import {
  CONNECTION_FEATURE_PUBLIC_API_EXPORTS,
  FRONTEND_COMPAT_INVENTORY,
  MAX_LINES_ALLOWLIST,
  RAW_TAURI_INVOKE_INVENTORY,
  findConnectionFeatureBoundaryViolations,
  findFrontendCompatInventoryViolations,
  findRawTauriInvokeBoundaryViolations,
  findUnexpectedIgnoredFiles,
  isAllowedGeneratedLintIgnore,
  parseFrontendCompatInventoryMarkdown,
  summarizeLintMessages,
} from "../check-eslint-static-policy";

describe("check-eslint-static-policy", () => {
  it("keeps the measured max-lines allowlist explicit", () => {
    expect(MAX_LINES_ALLOWLIST).toHaveLength(22);
    expect(MAX_LINES_ALLOWLIST).toContain(
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
    expect(RAW_TAURI_INVOKE_INVENTORY).toEqual([
      {
        path: "src/stores/favoritesStore.ts",
        commands: ["list_favorites", "persist_favorites"],
        owner: "favorites persistence store",
        wrapperTarget: "src/lib/tauri/favorites.ts",
        risk: "medium",
        action:
          "follow-up: move favorites persistence IPC behind a typed wrapper",
      },
      {
        path: "src/stores/mruStore.ts",
        commands: ["clear_mru", "persist_mru"],
        owner: "MRU persistence store",
        wrapperTarget: "src/lib/tauri/mru.ts",
        risk: "low",
        action: "follow-up: move MRU persistence IPC behind a typed wrapper",
      },
    ]);
  });

  it("locks the connection feature public API surface", () => {
    expect(CONNECTION_FEATURE_PUBLIC_API_EXPORTS).toEqual([
      "ConnectionDialog",
      "ConnectionList",
      "GroupDialog",
      "ImportExportDialog",
      "RecentConnections",
      "useConnectionStore",
      "ConnectionConfig",
      "ConnectionDraft",
      "ConnectionGroup",
      "ConnectionStatus",
      "DatabaseType",
      "DATABASE_TYPE_LABELS",
      "DATABASE_DEFAULTS",
      "DATABASE_DEFAULT_FIELDS",
      "createEmptyDraft",
      "draftFromConnection",
      "parseConnectionUrl",
      "listConnections",
      "saveConnection",
      "testConnection",
      "exportConnectionsEncrypted",
    ]);
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
    const publicApiSource = [
      "export { default as ConnectionDialog } from './components/ConnectionDialog';",
      "export { default as ConnectionList } from './components/ConnectionList';",
      "export { default as GroupDialog } from './components/GroupDialog';",
      "export { default as ImportExportDialog } from './components/ImportExportDialog';",
      "export { default as RecentConnections } from './components/RecentConnections';",
      "export { useConnectionStore } from './store';",
      "export type { ConnectionConfig, ConnectionDraft, ConnectionGroup, ConnectionStatus, DatabaseType } from './model';",
      "export { DATABASE_TYPE_LABELS, DATABASE_DEFAULTS, DATABASE_DEFAULT_FIELDS, createEmptyDraft, draftFromConnection, parseConnectionUrl } from './model';",
      "export { listConnections, saveConnection, testConnection, exportConnectionsEncrypted } from './api';",
    ].join("\n");

    const failures = findConnectionFeatureBoundaryViolations(
      new Map([
        ["src/features/connection/index.ts", publicApiSource],
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

    expect(failures).toEqual([]);
  });

  it("rejects new commands in inventoried raw store modules", () => {
    const failures = findRawTauriInvokeBoundaryViolations(
      new Map([
        [
          "src/stores/favoritesStore.ts",
          'import { invoke } from "@tauri-apps/api/core";\nvoid invoke("list_favorites");\nvoid invoke("persist_favorites");\nvoid invoke("delete_favorites");\n',
        ],
        [
          "src/stores/mruStore.ts",
          'import { invoke } from "@tauri-apps/api/core";\nvoid invoke("persist_mru");\nvoid invoke("clear_mru");\n',
        ],
      ]),
    );

    expect(failures).toContain(
      "src/stores/favoritesStore.ts: untriaged raw invoke command(s): delete_favorites.",
    );
  });
});
