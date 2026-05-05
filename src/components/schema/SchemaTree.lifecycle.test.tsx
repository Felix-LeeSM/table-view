// Sprint 216 — `lifecycle` axis split from `SchemaTree.test.tsx`. Covers
// mount auto-load, re-render skip, connectionId change, edge cases
// (undefined schemas, table-key format), connection-header verbatim/
// fallback, the static `Schemas` header, and the root `select-none`
// class. Cases are byte-equivalent to the originals — no behaviour
// change.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import React from "react";
import SchemaTree from "./SchemaTree";
import { useConnectionStore } from "@stores/connectionStore";
import {
  mockLoadSchemas,
  mockLoadTables,
  setSchemaStoreState,
  resetStores,
} from "./__tests__/schemaTreeTestHelpers";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SchemaTree — lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadSchemas.mockResolvedValue(undefined);
    mockLoadTables.mockResolvedValue(undefined);
    resetStores();
  });

  // -----------------------------------------------------------------------
  // AC-01: Auto-load on mount
  // -----------------------------------------------------------------------
  it("calls loadSchemas with connectionId on mount", async () => {
    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });
    expect(mockLoadSchemas).toHaveBeenCalledWith("conn1");
  });

  it("does not call loadSchemas again on re-render with same connectionId", async () => {
    let rerenderFn: (ui: React.ReactElement) => void;
    await act(async () => {
      const { rerender } = render(<SchemaTree connectionId="conn1" />);
      rerenderFn = rerender;
    });
    expect(mockLoadSchemas).toHaveBeenCalledTimes(1);

    await act(async () => {
      rerenderFn!(<SchemaTree connectionId="conn1" />);
    });
    expect(mockLoadSchemas).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------------
  // AC-02: Schema list rendering
  // -----------------------------------------------------------------------
  it("renders schema names from store", async () => {
    setSchemaStoreState({
      schemas: {
        conn1: [{ name: "public" }, { name: "analytics" }],
      },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });
    expect(screen.getByText("public")).toBeInTheDocument();
    expect(screen.getByText("analytics")).toBeInTheDocument();
  });

  it("renders nothing when schemas is empty", async () => {
    setSchemaStoreState({ schemas: { conn1: [] } });

    let container: HTMLElement;
    await act(async () => {
      const result = render(<SchemaTree connectionId="conn1" />);
      container = result.container;
    });
    // Header should still render but no schema items
    expect(screen.getByText("Schemas")).toBeInTheDocument();
    expect(container!.querySelectorAll("[aria-expanded]").length).toBe(0);
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------
  it("works when schemas for connectionId is undefined (uses empty array)", async () => {
    setSchemaStoreState({ schemas: {} });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });
    expect(screen.getByText("Schemas")).toBeInTheDocument();
  });

  it("uses correct table key format connectionId:schemaName", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "my_schema" }] },
      tables: {
        "conn1:my_schema": [
          { name: "t1", schema: "my_schema", row_count: null },
        ],
      },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    // Sprint 144: schema is auto-expanded on mount; tables visible immediately.
    // Tables should appear since they are pre-cached under the correct key
    expect(screen.getByText("t1")).toBeInTheDocument();
    // loadTables should NOT be called since tables are already cached
    expect(mockLoadTables).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // AC-03: connectionId change triggers new loadSchemas
  // -----------------------------------------------------------------------
  it("calls loadSchemas with new connectionId when connectionId changes", async () => {
    setSchemaStoreState({
      schemas: {
        conn1: [{ name: "public" }],
        conn2: [{ name: "dbo" }],
      },
    });

    let rerenderFn: (ui: React.ReactElement) => void;
    await act(async () => {
      const { rerender } = render(<SchemaTree connectionId="conn1" />);
      rerenderFn = rerender;
    });
    expect(mockLoadSchemas).toHaveBeenCalledWith("conn1");

    await act(async () => {
      rerenderFn!(<SchemaTree connectionId="conn2" />);
    });

    expect(mockLoadSchemas).toHaveBeenCalledWith("conn2");
  });

  // =========================================================================
  // NEW: Visual hierarchy and icons
  // =========================================================================

  // AC-VIS-01: Connection header shows connection name when available, falls back to connection ID
  it("renders connection header with connection name when connection exists in store", async () => {
    useConnectionStore.setState({
      connections: [
        {
          id: "conn1",
          name: "My PostgreSQL",
          db_type: "postgresql",
          host: "localhost",
          port: 5432,
          user: "postgres",
          has_password: false,
          database: "testdb",
          group_id: null,
          color: null,
          paradigm: "rdb",
        },
      ],
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    expect(screen.getByText("My PostgreSQL")).toBeInTheDocument();
    expect(screen.queryByText("conn1")).not.toBeInTheDocument();
  });

  it("falls back to connection ID when connection is not found in store", async () => {
    await act(async () => {
      render(<SchemaTree connectionId="my-connection" />);
    });

    expect(screen.getByText("my-connection")).toBeInTheDocument();
  });

  // =========================================================================
  // NEW: "Schemas" header label
  // =========================================================================

  it("renders 'Schemas' header label", async () => {
    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    expect(screen.getByText("Schemas")).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // select-none on root element
  // -----------------------------------------------------------------------
  it("has select-none class on root element to prevent text selection", async () => {
    const { container } = await act(async () => {
      return render(<SchemaTree connectionId="conn1" />);
    });

    const rootDiv = container.firstElementChild as HTMLElement;
    expect(rootDiv).toBeTruthy();
    expect(rootDiv.className).toContain("select-none");
  });
});
