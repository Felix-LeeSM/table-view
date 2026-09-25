// #1219 — the eager N+1 load of every schema on connect becomes lazy.
// User-journey checks for the 4 ACs:
//   1. On connect only the schema list loads; tables load for expanded
//      schemas only (the seeded first schema included).
//   3. A small DB (schema count <= threshold) still loads everything at
//      once.
//   4. On reconnect the persisted expanded schemas load their content;
//      collapsed schemas are not fetched.
// Only the lib boundary (schema store actions) is mocked; the render uses
// the real SchemaTree.
// (AC-2, the autocomplete regression guard = the column prefetch in
//  expandSchema → locked by the `useSchemaCache` unit test [AC-1219-3].)

import { useWorkspaceStore } from "@stores/workspaceStore";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  mockLoadTables,
  resetStores,
  setSchemaStoreState,
} from "./__tests__/schemaTreeTestHelpers";
import SchemaTree from "./SchemaTree";

function manySchemas(n: number): Array<{ name: string }> {
  return Array.from({ length: n }, (_, i) => ({ name: `s${i}` }));
}

describe("SchemaTree — lazy schema load (#1219)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
  });

  // ── AC1 — large DB: only the seeded first schema's content loads on connect ─
  it("large DB: loads only the seeded first schema's tables at mount", async () => {
    setSchemaStoreState({ schemas: { conn1: manySchemas(6) }, tables: {} });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    // #1256 seed expands s0 → its content loads; s1..s5 collapsed → no fetch.
    expect(mockLoadTables).toHaveBeenCalledWith("conn1", "db1", "s0");
    expect(mockLoadTables).not.toHaveBeenCalledWith("conn1", "db1", "s1");

    // user-facing: seeded schema expanded, the rest collapsed.
    expect(screen.getByLabelText("s0 schema")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByLabelText("s1 schema")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  // ── AC3 — small DB: at or below the threshold, everything loads at once ───
  it("small DB: eager-loads every schema's tables at mount (<= threshold)", async () => {
    setSchemaStoreState({ schemas: { conn1: manySchemas(3) }, tables: {} });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    expect(mockLoadTables).toHaveBeenCalledWith("conn1", "db1", "s0");
    expect(mockLoadTables).toHaveBeenCalledWith("conn1", "db1", "s1");
    expect(mockLoadTables).toHaveBeenCalledWith("conn1", "db1", "s2");
  });

  // ── AC3 — system schemas inflate raw count; small DB stays eager (PR #1263) ─
  it("small DB with system schemas: user-schema count keeps it eager, all schemas visible", async () => {
    // DuckDB-shaped: `main`/`temp` (system) + 4 user schemas. Raw length 6
    // must not tip the DB lazy — the threshold counts only user schemas (4).
    setSchemaStoreState({
      schemas: {
        conn1: [
          { name: "main" },
          { name: "temp" },
          { name: "catalog" },
          { name: "core" },
          { name: "sales" },
          { name: "support" },
        ],
      },
      tables: {},
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    // eager: every schema's tables load at mount, incl. the user's `core`.
    expect(mockLoadTables).toHaveBeenCalledWith("conn1", "db1", "core");
    expect(mockLoadTables).toHaveBeenCalledWith("conn1", "db1", "support");
  });

  // ── AC4 — reconnect: persisted expanded schemas load, collapsed ones do not ─
  it("reconnect: persisted expanded schema loads its tables; collapsed ones stay unfetched", async () => {
    setSchemaStoreState({ schemas: { conn1: manySchemas(6) }, tables: {} });
    // The user left only s3 expanded in the previous session (rest collapsed).
    useWorkspaceStore.getState().setExpanded("conn1", "db1", ["s3"]);

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    expect(mockLoadTables).toHaveBeenCalledWith("conn1", "db1", "s3");
    expect(mockLoadTables).not.toHaveBeenCalledWith("conn1", "db1", "s0");

    expect(screen.getByLabelText("s3 schema")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByLabelText("s0 schema")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  // ── AC1 — large DB manual expand = 1 load (no reconcile ↔ click repeat) ───
  it("large DB: manually expanding a collapsed schema fetches its tables exactly once", async () => {
    setSchemaStoreState({ schemas: { conn1: manySchemas(6) }, tables: {} });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    await act(async () => {
      fireEvent.click(screen.getByLabelText("s1 schema"));
    });

    const s1Calls = mockLoadTables.mock.calls.filter(
      ([, , schema]) => schema === "s1",
    );
    expect(s1Calls).toHaveLength(1);
  });
});
