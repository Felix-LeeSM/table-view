// Issue #1459 — Indexes / Constraints sub-tabs are gated on the
// `catalog.indexes` / `catalog.constraints` capability flags
// (`getDataSourceProfile(dbType).capabilities.catalog.*`) instead of
// rendering unconditionally for every RDB engine. Asserts:
//   - DuckDB (#1070 — both flags now true after real duckdb_indexes() /
//     duckdb_constraints() introspection) keeps both tabs.
//   - SQLite (real PRAGMA index_list impl → indexes true; constraints
//     stub returns [] → false) keeps Indexes, hides Constraints.
//   - PostgreSQL (both true) keeps both tabs — regression guard.
//   - Unknown / still-loading connection keeps both tabs (same
//     affordance-preserving fallback as `supportsRowEditing`).
//   - `initialSubTab` pointing at a gated tab falls back to Columns and
//     never fires the gated fetch (SQLite constraints is still gated).
import { describe, it, expect, beforeEach } from "vitest";
import { screen, act } from "@testing-library/react";
import { useConnectionStore } from "@stores/connectionStore";
import type { DatabaseType } from "@/types/connection";
import {
  mockGetTableColumns,
  mockGetTableConstraints,
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

describe("StructurePanel catalog capability gate (#1459)", () => {
  beforeEach(() => {
    resetStructurePanelMocks();
    useConnectionStore.setState({ connections: [] });
  });

  it("keeps Indexes and Constraints for DuckDB (#1070 — both catalog flags now true)", async () => {
    setConnection("duckdb");
    await act(async () => {
      renderPanel();
    });
    expect(screen.getByRole("tab", { name: "Indexes" })).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "Constraints" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Columns" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Triggers" })).toBeInTheDocument();
  });

  it("keeps Indexes but hides Constraints for SQLite", async () => {
    setConnection("sqlite");
    await act(async () => {
      renderPanel();
    });
    expect(screen.getByRole("tab", { name: "Indexes" })).toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "Constraints" }),
    ).not.toBeInTheDocument();
  });

  it("keeps both tabs for PostgreSQL (regression guard)", async () => {
    setConnection("postgresql");
    await act(async () => {
      renderPanel();
    });
    expect(screen.getByRole("tab", { name: "Indexes" })).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "Constraints" }),
    ).toBeInTheDocument();
  });

  it("keeps both tabs while the connection is unknown / still loading", async () => {
    // connections store left empty — dbType unresolved.
    await act(async () => {
      renderPanel();
    });
    expect(screen.getByRole("tab", { name: "Indexes" })).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "Constraints" }),
    ).toBeInTheDocument();
  });

  it("falls back to Columns when initialSubTab targets a gated tab", async () => {
    // SQLite still gates Constraints (stub returns [] → capability false), so
    // it is the standing case for the clamp after DuckDB's #1070 flip.
    setConnection("sqlite");
    await act(async () => {
      renderPanel({ initialSubTab: "constraints" });
    });
    expect(mockGetTableConstraints).not.toHaveBeenCalled();
    expect(mockGetTableColumns).toHaveBeenCalled();
    expect(screen.getByRole("tab", { name: "Columns" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});
