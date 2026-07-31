// Issue #1070 (ADR 0051 Stage 2) — AddColumnDialog per-engine DDL gate.
//
// The Stage 2 capability flip made `ddl.alterTable` true for DuckDB, so this
// dialog now opens for `.duckdb` connections. Two of its inputs are not backed
// by the DuckDB adapter:
//   - CHECK, which `build_add_column_statements` rejects (`Unsupported`) —
//     DuckDB `ADD COLUMN` cannot carry a constraint (Stage 2b rebuild-swap),
//   - Identity, which no DuckDB emitter can honour (auto-increment needs
//     `CREATE SEQUENCE` + `DEFAULT nextval(...)`).
//
// #1046 says unsupported = hidden, never click-then-error, so both read the
// capability (`ddl.alterConstraint` / `ddl.identityColumn`). PostgreSQL keeps
// both (regression guard).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import { render, screen, cleanup } from "@testing-library/react";

const { mockAddColumnRequest, mockListPostgresTypes } = vi.hoisted(() => ({
  mockAddColumnRequest: vi.fn(),
  mockListPostgresTypes: vi.fn().mockResolvedValue([]),
}));
beforeEach(() => {
  setupTauriMock({
    addColumnRequest: mockAddColumnRequest,
    listPostgresTypes: mockListPostgresTypes,
    executeQueryDryRun: vi.fn(() => Promise.resolve([])),
    cancelQuery: vi.fn(() => Promise.resolve("cancelled")),
  });
});

import AddColumnDialog from "./AddColumnDialog";
import { useConnectionStore } from "@stores/connectionStore";
import { useSafeModeStore } from "@stores/safeModeStore";
import { invalidatePostgresTypesCache } from "@hooks/usePostgresTypes";
import type { DatabaseType } from "@/types/connection";

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
      } as any,
    ],
  });
}

function renderDialog() {
  return render(
    <AddColumnDialog
      connectionId="conn-1"
      schemaName="main"
      tableName="items"
      columns={[]}
      open
      onClose={vi.fn()}
      onColumnAdded={vi.fn().mockResolvedValue(undefined)}
    />,
  );
}

describe("AddColumnDialog DDL capability gate (#1070)", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    invalidatePostgresTypesCache("conn-1");
    useConnectionStore.setState({ connections: [] });
    useSafeModeStore.setState({ mode: "off" });
    mockListPostgresTypes.mockResolvedValue([]);
  });

  it("hides the CHECK input and the Identity toggle for DuckDB", () => {
    setConnection("duckdb");
    renderDialog();

    expect(screen.queryByLabelText("CHECK expression")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Identity")).not.toBeInTheDocument();
    // NOT NULL stays — DuckDB adds the column nullable then promotes it with
    // `ALTER COLUMN … SET NOT NULL`.
    expect(screen.getByLabelText("NOT NULL")).toBeInTheDocument();
  });

  it("keeps CHECK + Identity for PostgreSQL", () => {
    setConnection("postgresql");
    renderDialog();

    expect(screen.getByLabelText("CHECK expression")).toBeInTheDocument();
    expect(screen.getByLabelText("Identity")).toBeInTheDocument();
  });

  it("keeps both while the dbType is unknown / still loading", () => {
    renderDialog();

    expect(screen.getByLabelText("CHECK expression")).toBeInTheDocument();
    expect(screen.getByLabelText("Identity")).toBeInTheDocument();
  });
});
