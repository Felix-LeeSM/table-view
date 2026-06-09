import { describe, expect, it } from "vitest";
import {
  MAX_LINES_ALLOWLIST,
  RAW_TAURI_INVOKE_INVENTORY,
  findRawTauriInvokeBoundaryViolations,
  findUnexpectedIgnoredFiles,
  isAllowedGeneratedLintIgnore,
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
