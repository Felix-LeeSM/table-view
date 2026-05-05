// Sprint 216 — `refresh` axis split from `SchemaTree.test.tsx`. Covers
// the `Refresh schemas` button (AC-07), the `refresh-schema` window
// event listener + cleanup (AC-10), per-schema right-click Refresh
// (AC-CM-17, AC-CM-18), and the loadSchemas-rejection cleanup path.
// Cases are byte-equivalent to the originals.
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import SchemaTree from "./SchemaTree";
import {
  mockLoadSchemas,
  mockLoadTables,
  setSchemaStoreState,
  resetStores,
} from "./__tests__/schemaTreeTestHelpers";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SchemaTree — refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadSchemas.mockResolvedValue(undefined);
    mockLoadTables.mockResolvedValue(undefined);
    resetStores();
  });

  // -----------------------------------------------------------------------
  // AC-07: Refresh button -> reload schemas
  // -----------------------------------------------------------------------
  it("calls loadSchemas again when Refresh button is clicked", async () => {
    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });
    // One call from mount
    expect(mockLoadSchemas).toHaveBeenCalledTimes(1);

    // Wait for the initial load to finish (loadingSchemas -> false, button re-enabled)
    await waitFor(() => {
      expect(screen.getByLabelText("Refresh schemas")).not.toBeDisabled();
    });

    const refreshBtn = screen.getByLabelText("Refresh schemas");
    await act(async () => {
      fireEvent.click(refreshBtn);
    });

    expect(mockLoadSchemas).toHaveBeenCalledTimes(2);
    expect(mockLoadSchemas).toHaveBeenLastCalledWith("conn1");
  });

  // -----------------------------------------------------------------------
  // AC-10: refresh-schema custom event
  // -----------------------------------------------------------------------
  it("reloads schemas when refresh-schema window event is dispatched", async () => {
    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });
    expect(mockLoadSchemas).toHaveBeenCalledTimes(1);

    await act(async () => {
      window.dispatchEvent(new CustomEvent("refresh-schema"));
    });

    expect(mockLoadSchemas).toHaveBeenCalledTimes(2);
  });

  it("removes refresh-schema listener on unmount", async () => {
    let unmountFn: () => void;
    await act(async () => {
      const { unmount } = render(<SchemaTree connectionId="conn1" />);
      unmountFn = unmount;
    });
    expect(mockLoadSchemas).toHaveBeenCalledTimes(1);

    await act(async () => {
      unmountFn!();
    });

    // Dispatching after unmount should NOT trigger another load
    act(() => {
      window.dispatchEvent(new CustomEvent("refresh-schema"));
    });

    expect(mockLoadSchemas).toHaveBeenCalledTimes(1);
  });

  it("clears loading spinner when loadSchemas rejects via refresh", async () => {
    mockLoadSchemas.mockResolvedValueOnce(undefined); // mount call succeeds
    mockLoadSchemas.mockRejectedValueOnce(new Error("network error")); // refresh fails

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    await waitFor(() => {
      expect(screen.getByLabelText("Refresh schemas")).not.toBeDisabled();
    });

    const refreshBtn = screen.getByLabelText("Refresh schemas");
    await act(async () => {
      fireEvent.click(refreshBtn);
    });

    // After rejection, loading should be cleared
    await waitFor(() => {
      expect(screen.getByLabelText("Refresh schemas")).not.toBeDisabled();
    });
  });

  // =========================================================================
  // NEW: Context menu — schema node
  // =========================================================================

  // AC-CM-17: Right-clicking a schema node shows Refresh context menu
  it("shows context menu with Refresh on schema right-click", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: {},
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const schemaButton = screen.getByLabelText("public schema");
    await act(async () => {
      fireEvent.contextMenu(schemaButton, {
        clientX: 100,
        clientY: 200,
      });
    });

    expect(screen.getByText("Refresh")).toBeInTheDocument();
    // Table context menu items should NOT be present
    expect(screen.queryByText("Structure")).not.toBeInTheDocument();
    expect(screen.queryByText("Drop")).not.toBeInTheDocument();
  });

  // AC-CM-18: Schema Refresh reloads tables for that schema
  it("calls loadTables when schema Refresh is clicked", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: {
        "conn1:public": [{ name: "users", schema: "public", row_count: null }],
      },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const schemaButton = screen.getByLabelText("public schema");
    await act(async () => {
      fireEvent.contextMenu(schemaButton, {
        clientX: 100,
        clientY: 200,
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Refresh"));
    });

    // loadTables should be called for this specific schema
    expect(mockLoadTables).toHaveBeenCalledWith("conn1", "public");
  });
});
