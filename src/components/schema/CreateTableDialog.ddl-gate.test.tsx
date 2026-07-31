// Issue #1070 (ADR 0051 Stage 2) — CreateTableDialog per-engine DDL gate.
//
// The Stage 2 capability flip made `ddl.createTable` true for DuckDB, which
// opens this dialog for `.duckdb` connections for the first time. Two of its
// surfaces are NOT backed by the DuckDB adapter:
//   - the Constraints tab (FK / CHECK / UNIQUE) + the per-column inline FK
//     popover and inline CHECK input, which the backend fans out into
//     `add_constraint` → `Unsupported` (Stage 2b rebuild-swap),
//   - the per-column Identity checkbox, which no DuckDB emitter can honour
//     (auto-increment needs `CREATE SEQUENCE` + `DEFAULT nextval(...)`).
//
// #1046 says unsupported = hidden, never click-then-error, so both read the
// capability (`ddl.alterConstraint` / `ddl.identityColumn`) rather than
// rendering unconditionally. PostgreSQL keeps every control (regression guard)
// and an unknown / still-loading dbType keeps them too (affordance-preserving
// fallback, same as the rest of `supportsDdl`).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import { useConnectionStore } from "@stores/connectionStore";
import { useSafeModeStore } from "@stores/safeModeStore";
import { useQueryHistoryStore } from "@stores/queryHistoryStore";
import type { DatabaseType } from "@/types/connection";
import {
  getColumnsPanel,
  mockCreateTablePlan,
  renderDialog,
} from "./__tests__/createTableDialogTestHelpers";

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

describe("CreateTableDialog DDL capability gate (#1070)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConnectionStore.setState({ connections: [] });
    useSafeModeStore.setState({ mode: "off" });
    useQueryHistoryStore.setState({ recentVisible: [] });
    mockCreateTablePlan.mockResolvedValue({
      sql: 'CREATE TABLE "main"."t" ()',
    });
  });

  it("hides the Constraints tab and the inline FK / CHECK inputs for DuckDB", () => {
    setConnection("duckdb");
    renderDialog();

    expect(
      screen.queryByRole("tab", { name: "Constraints" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("create-table-foreign-keys-panel"),
    ).not.toBeInTheDocument();

    const columnsPanel = getColumnsPanel();
    expect(
      within(columnsPanel).queryByLabelText("Column check expression"),
    ).not.toBeInTheDocument();
    expect(
      within(columnsPanel).queryByLabelText(/^Foreign key for column/),
    ).not.toBeInTheDocument();
  });

  it("hides the per-column Identity checkbox for DuckDB", () => {
    setConnection("duckdb");
    renderDialog();

    expect(
      within(getColumnsPanel()).queryByLabelText("Column identity"),
    ).not.toBeInTheDocument();
  });

  it("keeps every constraint + identity control for PostgreSQL", () => {
    setConnection("postgresql");
    renderDialog();

    expect(
      screen.getByRole("tab", { name: "Constraints" }),
    ).toBeInTheDocument();
    const columnsPanel = getColumnsPanel();
    expect(
      within(columnsPanel).getByLabelText("Column check expression"),
    ).toBeInTheDocument();
    expect(
      within(columnsPanel).getByLabelText("Column identity"),
    ).toBeInTheDocument();
  });

  it("keeps the controls while the dbType is unknown / still loading", () => {
    renderDialog();

    expect(
      screen.getByRole("tab", { name: "Constraints" }),
    ).toBeInTheDocument();
    expect(
      within(getColumnsPanel()).getByLabelText("Column identity"),
    ).toBeInTheDocument();
  });
});
