// Issue #1460 — the Columns / Indexes editors keep their read-only listing for
// every RDB engine, but their mutation affordances read the per-action `ddl.*`
// capability (`supportsDdl(dbType, ...)`) so an engine whose adapter rejects the
// write hides the control instead of surfacing a click-then-error path (#1046).
// Asserts:
//   - SQLite (createTable only) — Columns tab hides `+ Column` + per-row
//     Edit/Delete; Indexes tab hides `Create index` + drop-index. The listings
//     still render (browse stays).
//   - PostgreSQL (all DDL true) — both editors keep their mutation controls
//     (regression guard).
//   - DuckDB (no DDL) — `+ Column` hidden.
//   - Unknown / still-loading connection — controls stay (affordance-preserving
//     fallback, same as `supportsRowEditing`).
import { describe, it, expect, beforeEach } from "vitest";
import { screen, act } from "@testing-library/react";
import { useConnectionStore } from "@stores/connectionStore";
import type { DatabaseType } from "@/types/connection";
import {
  renderPanel,
  resetStructurePanelMocks,
} from "./__tests__/structurePanelTestHelpers";

function setConnection(dbType: DatabaseType) {
  useConnectionStore.setState({
    connections: [
      {
        id: "conn-1",
        name: dbType,
        dbType,
        host: "localhost",
        port: 5432,
        database: "app",
        username: "u",
        password: null,
        environment: "development",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    ],
  });
}

describe("StructurePanel DDL capability gate (#1460)", () => {
  beforeEach(() => {
    resetStructurePanelMocks();
    useConnectionStore.setState({ connections: [] });
  });

  it("hides Add Column + per-row Edit/Delete for SQLite (alterTable false)", async () => {
    setConnection("sqlite");
    await act(async () => {
      renderPanel();
    });
    // Columns listing still renders (browse stays).
    expect(screen.getByText("id")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Add column" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Edit column id" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Delete column id" }),
    ).not.toBeInTheDocument();
  });

  it("keeps Add Column + Edit for PostgreSQL (regression guard)", async () => {
    setConnection("postgresql");
    await act(async () => {
      renderPanel();
    });
    expect(
      screen.getByRole("button", { name: "Add column" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Edit column id" }),
    ).toBeInTheDocument();
  });

  it("hides Add Column for DuckDB (no DDL)", async () => {
    setConnection("duckdb");
    await act(async () => {
      renderPanel();
    });
    expect(
      screen.queryByRole("button", { name: "Add column" }),
    ).not.toBeInTheDocument();
  });

  it("keeps Add Column while the connection is unknown / still loading", async () => {
    await act(async () => {
      renderPanel();
    });
    expect(
      screen.getByRole("button", { name: "Add column" }),
    ).toBeInTheDocument();
  });

  it("hides Create Index + drop-index for SQLite (createIndex / dropObject false)", async () => {
    setConnection("sqlite");
    await act(async () => {
      renderPanel({ initialSubTab: "indexes" });
    });
    // Indexes listing still renders (catalog.indexes true → browse stays).
    expect(screen.getByText("users_name_idx")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Create index" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Delete index users_name_idx" }),
    ).not.toBeInTheDocument();
  });

  it("keeps Create Index + drop-index for PostgreSQL (regression guard)", async () => {
    setConnection("postgresql");
    await act(async () => {
      renderPanel({ initialSubTab: "indexes" });
    });
    expect(
      screen.getByRole("button", { name: "Create index" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Delete index users_name_idx" }),
    ).toBeInTheDocument();
  });
});
