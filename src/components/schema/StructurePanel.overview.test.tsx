// Sprint 220 — `overview` axis split from `StructurePanel.test.tsx` (P11
// step 3). Covers read-only display + tab switching + error / empty /
// spinner + refresh-structure event + table headers + em-dash null
// handling + clear-error-on-tab-switch (25 cases) plus the nested
// Sprint 179 paradigm-aware vocabulary describe (3 cases). Cases are
// byte-equivalent to the originals — no behaviour change.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import StructurePanel from "./StructurePanel";
import {
  MOCK_COLUMNS,
  mockGetTableColumns,
  mockGetTableIndexes,
  mockGetTableConstraints,
  renderPanel,
  resetStructurePanelMocks,
} from "./__tests__/structurePanelTestHelpers";

describe("StructurePanel", () => {
  beforeEach(() => {
    resetStructurePanelMocks();
  });

  // -----------------------------------------------------------------------
  // AC-09: Renders columns tab by default and fetches column data
  // -----------------------------------------------------------------------
  it("renders Columns tab as active by default", () => {
    // Keep promise pending so we see the initial tab state
    mockGetTableColumns.mockReturnValue(new Promise(() => {}));
    renderPanel();
    const columnsTab = screen.getByRole("tab", { name: "Columns" });
    expect(columnsTab).toHaveAttribute("aria-selected", "true");
  });

  it("calls getTableColumns on mount with correct arguments", async () => {
    await act(async () => {
      renderPanel();
    });

    expect(mockGetTableColumns).toHaveBeenCalledWith(
      "conn-1",
      "users",
      "public",
    );
  });

  it("renders column data in the table", async () => {
    await act(async () => {
      renderPanel();
    });

    // Column names
    expect(screen.getByText("id")).toBeInTheDocument();
    expect(screen.getByText("name")).toBeInTheDocument();
    expect(screen.getByText("org_id")).toBeInTheDocument();

    // Data types
    expect(screen.getByText("integer")).toBeInTheDocument();
    expect(screen.getByText("text")).toBeInTheDocument();

    // Nullable
    expect(screen.getByText("YES")).toBeInTheDocument();
    expect(screen.getAllByText("NO").length).toBeGreaterThanOrEqual(1);

    // Default value
    expect(screen.getByText("'unknown'")).toBeInTheDocument();

    // FK reference
    expect(screen.getByText("public.organizations(id)")).toBeInTheDocument();

    // Comment
    expect(screen.getByText("User display name")).toBeInTheDocument();
  });

  it("shows primary key icon for primary key columns", async () => {
    await act(async () => {
      renderPanel();
    });

    const pkIcons = screen.getAllByLabelText("Primary Key");
    expect(pkIcons.length).toBe(1);
  });

  // -----------------------------------------------------------------------
  // AC-10: Switches between columns/indexes/constraints tabs
  // -----------------------------------------------------------------------
  it("switches to Indexes tab and fetches indexes", async () => {
    await act(async () => {
      renderPanel();
    });

    // Initial fetch is columns
    expect(mockGetTableColumns).toHaveBeenCalledTimes(1);

    // Switch to indexes tab
    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Indexes" }));
    });

    const indexesTab = screen.getByRole("tab", { name: "Indexes" });
    expect(indexesTab).toHaveAttribute("aria-selected", "true");

    expect(mockGetTableIndexes).toHaveBeenCalledWith(
      "conn-1",
      "users",
      "public",
    );
  });

  it("renders index data in the table", async () => {
    await act(async () => {
      renderPanel();
    });

    // Switch to indexes tab
    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Indexes" }));
    });

    // Index names
    expect(screen.getByText("users_pkey")).toBeInTheDocument();
    expect(screen.getByText("users_name_idx")).toBeInTheDocument();

    // Index columns
    expect(screen.getByText("id")).toBeInTheDocument();

    // Index types
    expect(screen.getAllByText("btree").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("hash")).toBeInTheDocument();

    // Properties - PK and UNIQUE badges
    expect(screen.getByText("PK")).toBeInTheDocument();
    expect(screen.getByText("UNIQUE")).toBeInTheDocument();
  });

  it("switches to Constraints tab and fetches constraints", async () => {
    await act(async () => {
      renderPanel();
    });

    // Switch to constraints tab
    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Constraints" }));
    });

    const constraintsTab = screen.getByRole("tab", { name: "Constraints" });
    expect(constraintsTab).toHaveAttribute("aria-selected", "true");

    expect(mockGetTableConstraints).toHaveBeenCalledWith(
      "conn-1",
      "users",
      "public",
    );
  });

  it("renders constraint data in the table", async () => {
    await act(async () => {
      renderPanel();
    });

    // Switch to constraints tab
    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Constraints" }));
    });

    // Constraint names
    expect(screen.getByText("users_pkey")).toBeInTheDocument();
    expect(screen.getByText("users_org_id_fkey")).toBeInTheDocument();

    // Constraint types
    expect(screen.getByText("PRIMARY KEY")).toBeInTheDocument();
    expect(screen.getByText("FOREIGN KEY")).toBeInTheDocument();
    expect(screen.getByText("CHECK")).toBeInTheDocument();

    // Constraint columns
    expect(screen.getByText("org_id")).toBeInTheDocument();

    // References
    expect(screen.getByText("organizations(id)")).toBeInTheDocument();
  });

  it("shows em-dash for constraints without reference table", async () => {
    await act(async () => {
      renderPanel();
    });

    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Constraints" }));
    });

    // The em-dash character is used for null reference_table
    const cells = screen.getAllByRole("cell");
    const cellTexts = cells.map((c) => c.textContent);
    expect(cellTexts).toContain("—");
  });

  // -----------------------------------------------------------------------
  // AC-11: Shows error state when fetch fails
  // -----------------------------------------------------------------------
  it("shows error alert when columns fetch fails", async () => {
    mockGetTableColumns.mockRejectedValue(new Error("Connection lost"));

    await act(async () => {
      renderPanel();
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Connection lost");
  });

  it("shows error alert when indexes fetch fails", async () => {
    mockGetTableIndexes.mockRejectedValue(new Error("Permission denied"));

    await act(async () => {
      renderPanel();
    });

    // Switch to indexes tab
    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Indexes" }));
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Permission denied");
  });

  it("shows error alert when constraints fetch fails", async () => {
    mockGetTableConstraints.mockRejectedValue(new Error("Schema not found"));

    await act(async () => {
      renderPanel();
    });

    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Constraints" }));
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Schema not found");
  });

  // -----------------------------------------------------------------------
  // AC-12: Shows "No columns/indexes/constraints found" for empty data
  // -----------------------------------------------------------------------
  it("shows empty state for columns when no data returned", async () => {
    mockGetTableColumns.mockResolvedValue([]);

    await act(async () => {
      renderPanel();
    });

    expect(screen.getByText("No columns found")).toBeInTheDocument();
  });

  it("shows empty state for indexes when no data returned", async () => {
    mockGetTableIndexes.mockResolvedValue([]);

    await act(async () => {
      renderPanel();
    });

    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Indexes" }));
    });

    expect(screen.getByText("No indexes found")).toBeInTheDocument();
  });

  it("shows empty state for constraints when no data returned", async () => {
    mockGetTableConstraints.mockResolvedValue([]);

    await act(async () => {
      renderPanel();
    });

    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Constraints" }));
    });

    expect(screen.getByText("No constraints found")).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Loading state — Sprint 180 (AC-180-01) shifted the spinner to the
  // threshold-gated `AsyncProgressOverlay`. The fetch must remain
  // pending across the 1s threshold for the spinner to materialise; we
  // use fake timers to advance past the threshold deterministically.
  // -----------------------------------------------------------------------
  it("shows spinner while loading (after 1s threshold)", () => {
    vi.useFakeTimers();
    try {
      mockGetTableColumns.mockReturnValue(new Promise(() => {}));
      renderPanel();

      // Pre-threshold: spinner is absent (the overlay only paints after
      // `loading` has been continuously true for 1s — Sprint 180 AC-180-01).
      expect(document.querySelector(".animate-spin")).not.toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(1100);
      });

      // Post-threshold: spinner now visible, wrapped by AsyncProgressOverlay.
      expect(document.querySelector(".animate-spin")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("removes spinner after data loads", async () => {
    await act(async () => {
      renderPanel();
    });

    expect(document.querySelector(".animate-spin")).not.toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Refresh event
  // -----------------------------------------------------------------------
  it("refetches data on refresh-structure window event", async () => {
    await act(async () => {
      renderPanel();
    });

    const initialCallCount = mockGetTableColumns.mock.calls.length;

    await act(async () => {
      window.dispatchEvent(new Event("refresh-structure"));
    });

    expect(mockGetTableColumns.mock.calls.length).toBeGreaterThan(
      initialCallCount,
    );
  });

  // -----------------------------------------------------------------------
  // Tab headers
  // -----------------------------------------------------------------------
  it("renders all three tab buttons", () => {
    mockGetTableColumns.mockReturnValue(new Promise(() => {}));
    renderPanel();

    expect(screen.getByRole("tab", { name: "Columns" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Indexes" })).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "Constraints" }),
    ).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Non-primary, non-unique index shows em-dash in properties
  // -----------------------------------------------------------------------
  it("shows em-dash for non-primary non-unique indexes", async () => {
    await act(async () => {
      renderPanel();
    });

    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Indexes" }));
    });

    // The users_name_idx row should not have PK or UNIQUE badge
    expect(screen.getByText("users_name_idx")).toBeInTheDocument();
    const nameIdxRow = screen.getByText("users_name_idx").closest("tr");
    expect(nameIdxRow).toBeTruthy();
    // Properties is the 4th td (Name, Columns, Type, Properties, Actions)
    const propsCell = nameIdxRow!.querySelector("td:nth-child(4) span");
    // The em-dash may render as the literal escape sequence or the actual character
    expect(propsCell?.textContent).toBeTruthy();
    expect(propsCell?.textContent).not.toBe("PK");
    expect(propsCell?.textContent).not.toBe("UNIQUE");
  });

  // -----------------------------------------------------------------------
  // Table headers for columns tab
  // -----------------------------------------------------------------------
  it("renders correct table headers for columns tab", async () => {
    await act(async () => {
      renderPanel();
    });

    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Type")).toBeInTheDocument();
    expect(screen.getByText("Nullable")).toBeInTheDocument();
    expect(screen.getByText("Default")).toBeInTheDocument();
    expect(screen.getByText("Ref")).toBeInTheDocument();
    expect(screen.getByText("Comment")).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Null default value rendered as em-dash
  // -----------------------------------------------------------------------
  it("shows em-dash for null default_value", async () => {
    await act(async () => {
      renderPanel();
    });

    // The "id" column has default_value: null, should show em-dash
    const cells = screen.getAllByRole("cell");
    const cellTexts = cells.map((c) => c.textContent);
    expect(cellTexts).toContain("—");
  });

  // -----------------------------------------------------------------------
  // Null comment rendered as em-dash
  // -----------------------------------------------------------------------
  it("shows em-dash for null comment", async () => {
    await act(async () => {
      renderPanel();
    });

    // id and org_id columns have comment: null
    // There should be em-dash cells
    const cells = screen.getAllByRole("cell");
    const cellTexts = cells.map((c) => c.textContent);
    const emDashCount = cellTexts.filter((t) => t === "—").length;
    expect(emDashCount).toBeGreaterThanOrEqual(1);
  });

  // -----------------------------------------------------------------------
  // Column with no default shows em-dash
  // -----------------------------------------------------------------------
  it("renders null fk_reference as em-dash", async () => {
    await act(async () => {
      renderPanel();
    });

    // id and name columns have fk_reference: null
    const rows = screen.getAllByRole("row");
    expect(rows.length).toBe(MOCK_COLUMNS.length + 1); // +1 for header
  });

  // -----------------------------------------------------------------------
  // Switching tabs clears error from previous tab
  // -----------------------------------------------------------------------
  it("clears error when switching tabs", async () => {
    mockGetTableColumns.mockRejectedValue(new Error("Error on columns"));

    await act(async () => {
      renderPanel();
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Error on columns");

    // Switch to indexes tab (which succeeds)
    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Indexes" }));
    });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  // =========================================================================
  // SPRINT 179 — Paradigm-aware vocabulary (AC-179-02 / AC-179-03 / AC-179-04)
  // =========================================================================
  describe("paradigm-aware vocabulary (Sprint 179)", () => {
    // Reason: AC-179-02a — paradigm="document" renders the Mongo tab
    // label ("Fields") and the Mongo Add/Empty copy delegated to
    // ColumnsEditor; the legacy RDB tab label ("Columns") is absent.
    // Mongo collection's columns endpoint returning [] is a realistic
    // fixture (StructurePanel is RDB-only-mounted today; the test
    // simulates the future paradigm="document" mount path).
    // Date: 2026-04-30.
    it('[AC-179-02a] paradigm="document" renders Mongo tab label + empty-state copy', async () => {
      mockGetTableColumns.mockResolvedValue([]);

      await act(async () => {
        render(
          <StructurePanel
            connectionId="conn-1"
            table="users"
            schema="public"
            paradigm="document"
          />,
        );
      });

      // Tab label is "Fields" (dictionary's document.units).
      expect(screen.getByRole("tab", { name: "Fields" })).toBeInTheDocument();
      // RDB tab label "Columns" is absent.
      expect(
        screen.queryByRole("tab", { name: "Columns" }),
      ).not.toBeInTheDocument();
      // Editor empty-state delegates to ColumnsEditor with paradigm prop.
      expect(screen.getByText("No fields found")).toBeInTheDocument();
      expect(screen.queryByText("No columns found")).not.toBeInTheDocument();
    });

    // Reason: AC-179-03a — explicit paradigm="rdb" preserves the legacy
    // tab label "Columns". Anchors the dictionary's rdb entry equals the
    // existing literal. Date: 2026-04-30.
    it("[AC-179-03a] paradigm=\"rdb\" renders the legacy 'Columns' tab", async () => {
      mockGetTableColumns.mockReturnValue(new Promise(() => {}));

      render(
        <StructurePanel
          connectionId="conn-1"
          table="users"
          schema="public"
          paradigm="rdb"
        />,
      );

      expect(screen.getByRole("tab", { name: "Columns" })).toBeInTheDocument();
    });

    // Reason: AC-179-04a — paradigm prop missing/undefined falls back to
    // the RDB dictionary entry (tab label "Columns"). Component-level
    // fence; the dictionary-level fence is in paradigm-vocabulary.test.ts.
    // Date: 2026-04-30.
    it("[AC-179-04a] paradigm undefined falls back to 'Columns' tab", async () => {
      mockGetTableColumns.mockReturnValue(new Promise(() => {}));

      // Render without the prop entirely.
      render(
        <StructurePanel connectionId="conn-1" table="users" schema="public" />,
      );

      expect(screen.getByRole("tab", { name: "Columns" })).toBeInTheDocument();
    });
  });
});
