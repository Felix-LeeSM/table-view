// Mongo db-contract α: Run-button gate.
//
// Reason: the root cause behind the user's report screenshot (#2) was
// that the Run button went disabled on nothing more than an empty
// `tab.database` string. db-contract α has to keep Run enabled for admin
// commands (`db.runCommand({...})` / `db.adminCommand({...})`), so this
// locks how the toolbar reflects the statement-kind branch. The AST
// lands later — this gate is regex-based.

import type { QueryTab } from "@stores/workspaceStore";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ConnectionId, TabId } from "@/types/branded";
import QueryTabToolbar from "./Toolbar";
import type { QueryFavoritesState } from "./useQueryFavorites";

// Mock the workspaceStore-derived TabDbChip dependency surface so the
// chip renders without a real store. We only care about the Run button
// state in these tests.
vi.mock("@/lib/api/listDatabases", () => ({
  listDatabases: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/runtime/toast", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));
vi.mock("@stores/workspaceStore", async () => {
  const actual = await vi.importActual<typeof import("@stores/workspaceStore")>(
    "@stores/workspaceStore",
  );
  return {
    ...actual,
    useCurrentWorkspaceKey: () => null,
    useWorkspaceStore: () => vi.fn(),
  };
});

function makeMongoTab(overrides: Partial<QueryTab> = {}): QueryTab {
  return {
    type: "query",
    id: "tab-1" as TabId,
    title: "Mongo Query",
    connectionId: "conn-mongo" as ConnectionId,
    closable: true,
    sql: "",
    queryState: { status: "idle" },
    paradigm: "document",
    database: undefined,
    collection: undefined,
    ...overrides,
  };
}

function makeFavorites(): QueryFavoritesState {
  return {
    showSaveForm: false,
    setShowSaveForm: vi.fn(),
    favoriteName: "",
    setFavoriteName: vi.fn(),
    showFavorites: false,
    setShowFavorites: vi.fn(),
    favorites: [],
    handleSaveFavorite: vi.fn(),
    handleLoadFavoriteSql: vi.fn(),
  };
}

describe("QueryTabToolbar — sprint-381 Mongo db-contract α", () => {
  it("enables Run when sql is `db.runCommand({ping: 1})` and no database is bound", () => {
    // AC-381-04: admin command bypasses the chip gate.
    const tab = makeMongoTab({
      sql: "db.runCommand({ping: 1})",
      database: undefined,
    });
    render(
      <QueryTabToolbar
        tab={tab}
        isDocument={true}
        onExecute={vi.fn()}
        onDryRun={vi.fn()}
        onFormat={vi.fn()}
        favorites={makeFavorites()}
        showSnippets={false}
        setShowSnippets={vi.fn()}
        onInsertSnippet={vi.fn()}
      />,
    );
    const runBtn = screen.getByRole("button", { name: /run query/i });
    expect(runBtn).not.toBeDisabled();
  });

  it("enables Run when sql is `db.adminCommand({serverStatus: 1})` regardless of chip", () => {
    const tab = makeMongoTab({
      sql: "db.adminCommand({serverStatus: 1})",
      database: undefined,
    });
    render(
      <QueryTabToolbar
        tab={tab}
        isDocument={true}
        onExecute={vi.fn()}
        onDryRun={vi.fn()}
        onFormat={vi.fn()}
        favorites={makeFavorites()}
        showSnippets={false}
        setShowSnippets={vi.fn()}
        onInsertSnippet={vi.fn()}
      />,
    );
    const runBtn = screen.getByRole("button", { name: /run query/i });
    expect(runBtn).not.toBeDisabled();
  });

  it("disables Run when sql is `db.users.find({})` and no database is bound", () => {
    // AC-381-05: collection commands still require a bound database.
    const tab = makeMongoTab({
      sql: "db.users.find({})",
      database: undefined,
    });
    render(
      <QueryTabToolbar
        tab={tab}
        isDocument={true}
        onExecute={vi.fn()}
        onDryRun={vi.fn()}
        onFormat={vi.fn()}
        favorites={makeFavorites()}
        showSnippets={false}
        setShowSnippets={vi.fn()}
        onInsertSnippet={vi.fn()}
      />,
    );
    const runBtn = screen.getByRole("button", { name: /run query/i });
    expect(runBtn).toBeDisabled();
  });

  it("enables Run for `db.users.find({})` when chip is bound to a database", () => {
    const tab = makeMongoTab({
      sql: "db.users.find({})",
      database: "myapp",
    });
    render(
      <QueryTabToolbar
        tab={tab}
        isDocument={true}
        onExecute={vi.fn()}
        onDryRun={vi.fn()}
        onFormat={vi.fn()}
        favorites={makeFavorites()}
        showSnippets={false}
        setShowSnippets={vi.fn()}
        onInsertSnippet={vi.fn()}
      />,
    );
    const runBtn = screen.getByRole("button", { name: /run query/i });
    expect(runBtn).not.toBeDisabled();
  });

  it("disables Run for empty sql even when admin pattern is partially typed", () => {
    const tab = makeMongoTab({ sql: "   ", database: undefined });
    render(
      <QueryTabToolbar
        tab={tab}
        isDocument={true}
        onExecute={vi.fn()}
        onDryRun={vi.fn()}
        onFormat={vi.fn()}
        favorites={makeFavorites()}
        showSnippets={false}
        setShowSnippets={vi.fn()}
        onInsertSnippet={vi.fn()}
      />,
    );
    const runBtn = screen.getByRole("button", { name: /run query/i });
    expect(runBtn).toBeDisabled();
  });

  it("renders an Open SQL File action for RDB tabs and forwards clicks", () => {
    // Stage 1 (#1077) import — the SQL-file loader is the inverse of the
    // existing SQL export and lives on the RDB query toolbar.
    const tab = makeMongoTab({
      paradigm: "rdb",
      sql: "",
      database: "main",
    });
    const onImportSqlFile = vi.fn();
    render(
      <QueryTabToolbar
        tab={tab}
        isDocument={false}
        onExecute={vi.fn()}
        onDryRun={vi.fn()}
        onFormat={vi.fn()}
        onImportSqlFile={onImportSqlFile}
        favorites={makeFavorites()}
        showSnippets={false}
        setShowSnippets={vi.fn()}
        onInsertSnippet={vi.fn()}
      />,
    );
    screen.getByRole("button", { name: /open sql file/i }).click();
    expect(onImportSqlFile).toHaveBeenCalledTimes(1);
  });

  it("hides the Open SQL File action for non-RDB (document) tabs", () => {
    const tab = makeMongoTab({ paradigm: "document", sql: "db.x.find({})" });
    render(
      <QueryTabToolbar
        tab={tab}
        isDocument={true}
        onExecute={vi.fn()}
        onDryRun={vi.fn()}
        onFormat={vi.fn()}
        onImportSqlFile={vi.fn()}
        favorites={makeFavorites()}
        showSnippets={false}
        setShowSnippets={vi.fn()}
        onInsertSnippet={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /open sql file/i })).toBeNull();
  });

  it("renders DuckDB local file preview action only when enabled", () => {
    const tab = makeMongoTab({
      paradigm: "rdb",
      sql: "SELECT 1",
      database: "main",
    });
    const onOpenFileAnalytics = vi.fn();
    render(
      <QueryTabToolbar
        tab={tab}
        isDocument={false}
        showFileAnalytics
        onOpenFileAnalytics={onOpenFileAnalytics}
        onExecute={vi.fn()}
        onDryRun={vi.fn()}
        onFormat={vi.fn()}
        favorites={makeFavorites()}
        showSnippets={false}
        setShowSnippets={vi.fn()}
        onInsertSnippet={vi.fn()}
      />,
    );

    screen.getByRole("button", { name: /preview local file/i }).click();
    expect(onOpenFileAnalytics).toHaveBeenCalledTimes(1);
  });
});
