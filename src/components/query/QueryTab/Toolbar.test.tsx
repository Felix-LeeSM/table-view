// Sprint 381 (2026-05-17) — Mongo db-contract α: Run-button gate.
//
// 작성 이유: 사용자 보고 캡처 (#2) 의 root cause 는 Run-button 이
// `tab.database` 빈 문자열만으로 disabled 되는 점이었다. db-contract α
// 가 admin command (`db.runCommand({...})` / `db.adminCommand({...})`)
// 시 Run 을 enabled 해야 하므로 statement-kind 분기를 toolbar 가 어떻게
// 반영하는지 lock 한다. AST 는 sprint-382 — 본 sprint 는 정규식 기반.
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import QueryTabToolbar from "./Toolbar";
import type { QueryTab } from "@stores/workspaceStore";
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
    id: "tab-1",
    title: "Mongo Query",
    connectionId: "conn-mongo",
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
      />,
    );

    screen.getByRole("button", { name: /preview local file/i }).click();
    expect(onOpenFileAnalytics).toHaveBeenCalledTimes(1);
  });
});
