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
//   - DuckDB (#1070 ADR 0051 Stage 2 — native structural DDL) — `+ Column` +
//     `Create index` show, but `Add constraint` stays hidden (`alterConstraint`
//     false: DuckDB ALTER TABLE cannot add/drop constraints — Stage 2b).
//   - Unknown / still-loading connection — controls stay (affordance-preserving
//     fallback, same as `supportsRowEditing`).
//
// Issue #1735 — adds the `editColumnComment` axis: the comment cell reads its
// OWN capability, not `alterTable`, so an engine that runs structural ALTERs
// but does not emit `COMMENT ON COLUMN` keeps the cell read-only.
import { describe, it, expect, beforeEach } from "vitest";
import { screen, act, fireEvent } from "@testing-library/react";
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

  it("shows Add Column for DuckDB (#1070 Stage 2 native column ALTER)", async () => {
    setConnection("duckdb");
    await act(async () => {
      renderPanel();
    });
    expect(
      screen.getByRole("button", { name: "Add column" }),
    ).toBeInTheDocument();
  });

  it("shows Create Index for DuckDB (#1070 Stage 2 native index DDL)", async () => {
    setConnection("duckdb");
    await act(async () => {
      renderPanel({ initialSubTab: "indexes" });
    });
    expect(
      screen.getByRole("button", { name: "Create index" }),
    ).toBeInTheDocument();
  });

  it("hides Add Constraint for DuckDB (alterConstraint false, Stage 2b)", async () => {
    setConnection("duckdb");
    await act(async () => {
      renderPanel({ initialSubTab: "constraints" });
    });
    expect(
      screen.queryByRole("button", { name: "Add constraint" }),
    ).not.toBeInTheDocument();
  });

  it("keeps Add Constraint for PostgreSQL (regression guard)", async () => {
    setConnection("postgresql");
    await act(async () => {
      renderPanel({ initialSubTab: "constraints" });
    });
    expect(
      screen.getByRole("button", { name: "Add constraint" }),
    ).toBeInTheDocument();
  });

  it("keeps Add Column while the connection is unknown / still loading", async () => {
    await act(async () => {
      renderPanel();
    });
    expect(
      screen.getByRole("button", { name: "Add column" }),
    ).toBeInTheDocument();
  });

  // Issue #1735 — capability → prop seam for the comment cell. `ColumnsEditor`
  // owns the rendering rule and its own suite injects `canEditColumnComment`
  // directly, so only this layer can catch a mis-wire in
  // `StructurePanel.tsx` (e.g. reusing `canAlterTable`). A mis-wire is
  // silent-data-loss shaped: `src-tauri/src/db/mysql/mutations.rs` matches
  // `new_comment: _` and drops the value with no error, so the user would see
  // "saved" and no change. (2026-07-25)
  it("shows the comment input in edit mode for PostgreSQL (editColumnComment true)", async () => {
    setConnection("postgresql");
    await act(async () => {
      renderPanel();
    });
    fireEvent.click(screen.getByRole("button", { name: "Edit column id" }));
    expect(screen.getByLabelText("Comment for id")).toBeInTheDocument();
  });

  // Reason: MySQL has `ddl.alterTable: true` but `ddl.editColumnComment: false`
  // — the row must stay editable while the comment cell stays read-only. Pins
  // the two flags apart so a future `canAlterTable` reuse fails here. (2026-07-25)
  it("keeps the comment cell read-only in edit mode for MySQL (alterTable true, editColumnComment false)", async () => {
    setConnection("mysql");
    await act(async () => {
      renderPanel();
    });
    fireEvent.click(screen.getByRole("button", { name: "Edit column id" }));
    // Structural edit affordances survive …
    expect(screen.getByLabelText("Data type for id")).toBeInTheDocument();
    // … but the comment cell has no input.
    expect(screen.queryByLabelText("Comment for id")).not.toBeInTheDocument();
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
