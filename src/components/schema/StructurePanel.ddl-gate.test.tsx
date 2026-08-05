// Issue #1460 — the Columns / Indexes editors keep their read-only listing for
// every RDB engine, but their mutation affordances read the per-action `ddl.*`
// capability (`supportsDdl(dbType, ...)`) so an engine whose adapter rejects the
// write hides the control instead of surfacing a click-then-error path (#1046).
// Asserts:
//   - SQLite (#1804 — natively-runnable DDL claimed) — Columns tab shows
//     `+ Column` + per-row Delete and Indexes tab shows `Create index` +
//     drop-index, because the adapter executes those. The per-row Edit stays
//     on screen but `disabled` on its own `modifyColumn` gate: an in-place
//     column change needs the 12-step table rebuild this app does not run, and
//     a Radix tooltip names that reason.
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
//
// Issue #1804 — adds the `modifyColumn` axis, the same shape one level up: the
// per-row Edit reads its OWN capability, so an engine that adds and drops
// columns but cannot rewrite one keeps Delete live and Edit disabled.

import { useConnectionStore } from "@stores/connectionStore";
import { act, fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
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
      } as any,
    ],
  });
}

describe("StructurePanel DDL capability gate (#1460)", () => {
  beforeEach(() => {
    resetStructurePanelMocks();
    useConnectionStore.setState({ connections: [] });
  });

  it("keeps Add/Delete Column but disables per-row Edit for SQLite (#1804 rebuild boundary)", async () => {
    setConnection("sqlite");
    await act(async () => {
      renderPanel();
    });
    expect(screen.getByText("id")).toBeInTheDocument();
    // ADD COLUMN and DROP COLUMN are native, so their affordances are live.
    expect(
      screen.getByRole("button", { name: "Add column" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Delete column id" }),
    ).toBeInTheDocument();
    // An in-place column change is not, so Edit stays but is off…
    const edit = screen.getByRole("button", { name: "Edit column id" });
    expect(edit).toBeDisabled();
    // …with the reason in a Radix tooltip, not a native `title`
    // (`memory/product/ui-parity/memory.md` §4 retires that pairing).
    expect(edit).not.toHaveAttribute("title");
    await act(async () => {
      fireEvent.pointerMove(edit.parentElement as HTMLElement);
    });
    expect(
      await screen.findByTestId("column-modify-rebuild-reason"),
    ).toHaveTextContent(/would need a full table rebuild/i);
  });

  it("keeps Add Column + Edit for PostgreSQL (regression guard)", async () => {
    setConnection("postgresql");
    await act(async () => {
      renderPanel();
    });
    expect(
      screen.getByRole("button", { name: "Add column" }),
    ).toBeInTheDocument();
    // #1804 — the disabled state is gated, not always-on: an engine that can
    // rewrite a column must not be told it cannot.
    expect(
      screen.getByRole("button", { name: "Edit column id" }),
    ).toBeEnabled();
    expect(
      screen.queryByTestId("column-modify-rebuild-reason"),
    ).not.toBeInTheDocument();
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
  // silent-data-loss shaped: `src-tauri/table-view-core/src/db/mysql/mutations.rs` matches
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

  it("keeps Create Index + drop-index for SQLite (#1804 — both are native)", async () => {
    setConnection("sqlite");
    await act(async () => {
      renderPanel({ initialSubTab: "indexes" });
    });
    expect(screen.getByText("users_name_idx")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create index" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Delete index users_name_idx" }),
    ).toBeInTheDocument();
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
