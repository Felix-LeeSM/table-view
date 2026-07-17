// Sprint 216 — `highlight` axis split from `SchemaTree.test.tsx`. Covers
// row-count rendering (AC-09 tilde estimate, null `?`, zero `~0`),
// the loadTables-rejection spinner cleanup path, click selection
// (AC-SEL-01..03), active-tab highlight (AC-ACTIVE-01..03), the
// schema-collapsed Folder icon (AC-VIS-02), indentation classes
// (AC-VIS-03), schema separators (AC-SEP-01), category icons
// (AC-ICON-02..04), and the views/functions count badge mix. Cases are
// byte-equivalent to the originals.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ConnectionId, TabId } from "@/types/branded";
import {
  seedWorkspace,
  getTestWorkspace,
} from "@/stores/__tests__/workspaceStoreTestHelpers";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import SchemaTree from "./SchemaTree";
import { useWorkspaceStore } from "@stores/workspaceStore";
import {
  mockLoadSchemas,
  mockLoadTables,
  setSchemaStoreState,
  resetStores,
} from "./__tests__/schemaTreeTestHelpers";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SchemaTree — highlight", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadSchemas.mockResolvedValue(undefined);
    mockLoadTables.mockResolvedValue(undefined);
    resetStores();
  });

  // -----------------------------------------------------------------------
  // AC-09: row_count display
  // -----------------------------------------------------------------------
  it("displays row_count with the sprint-143 tilde estimate prefix", async () => {
    // Sprint 143 (AC-148-1) — visible cell now reads `~12,345` so the
    // user reads the number as an estimate rather than an exact count.
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: {
        "conn1:public": [
          { name: "big_table", schema: "public", row_count: 12345 },
        ],
      },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    expect(screen.getByText("~12,345")).toBeInTheDocument();
  });

  it("renders `?` for the row_count cell when the value is null (sprint 143)", async () => {
    // Sprint 143 (AC-148-2 edge case) — `null` row_count renders the
    // literal `?` instead of being suppressed, so the user reads
    // "value unknown" rather than mistaking a missing cell for `0`.
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: {
        "conn1:public": [{ name: "users", schema: "public", row_count: null }],
      },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const tableItem = screen.getByLabelText("users table");
    const countSpan = tableItem.querySelector('[data-row-count="true"]');
    expect(countSpan).not.toBeNull();
    expect(countSpan?.textContent).toBe("?");
  });

  // -----------------------------------------------------------------------
  // AC-04: row_count edge case — zero
  // -----------------------------------------------------------------------
  it("displays '~0' for row_count of 0 (sprint 143 — still an estimate)", async () => {
    // Sprint 143 (AC-148-1) — `0` is a valid estimate (empty table that
    // *was* analyzed) and gets the same `~` prefix as any non-null
    // estimate. Pre-S143 the cell read a bare "0".
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: {
        "conn1:public": [
          { name: "empty_table", schema: "public", row_count: 0 },
        ],
      },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    expect(screen.getByText("~0")).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // AC-05: loadTables failure still clears loading state
  // -----------------------------------------------------------------------
  it("clears loading spinner when loadTables rejects", async () => {
    mockLoadTables.mockRejectedValueOnce(new Error("network error"));

    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: {},
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    // Sprint 144: auto-expand on mount fires loadTables which rejects.
    // Wait for the rejected promise to settle and loading state to clear.
    const schemaButton = screen.getByLabelText("public schema");
    await waitFor(() => {
      const schemaRow = schemaButton.closest("div")!;
      const spinners = schemaRow.querySelectorAll(".animate-spin");
      expect(spinners.length).toBe(0);
    });
  });

  // =========================================================================
  // NEW: Selection highlighting
  // =========================================================================

  // AC-SEL-01: Clicking a schema selects it
  it("highlights schema node when clicked", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: { "conn1:public": [] },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    // Sprint 144: schema is auto-expanded on mount, but clicking still
    // selects it (and toggles the expand state — that's a separate axis).
    const schemaButton = screen.getByLabelText("public schema");
    await act(async () => {
      fireEvent.click(schemaButton);
    });

    expect(schemaButton).toHaveClass("bg-muted");
  });

  // AC-SEL-02: Clicking a category selects it
  it("highlights category header when clicked", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: { "conn1:public": [] },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const viewsCategory = screen.getByLabelText("Views in public");
    await act(async () => {
      fireEvent.click(viewsCategory);
    });

    // Sprint 226 polish (2026-05-06): selected highlight 가 button 자체가 아닌
    // wrapper div 로 이동 (Tables 옆 '+' 버튼 + itemCount badge 가 button 밖
    // sibling 으로 분리되면서 row 전체 hover/selected 색은 wrapper 가 담당).
    expect(viewsCategory.parentElement).toHaveClass("bg-muted");
  });

  // AC-SEL-03: Clicking a table selects it (and deselects previous)
  it("highlights table node when clicked and deselects schema", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: {
        "conn1:public": [{ name: "users", schema: "public", row_count: null }],
      },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    // Sprint 144: auto-expanded on mount. Click schema once to put it in
    // the selected state — but that also collapses the tree. Click again
    // to re-expand so the table row remains in the DOM. Schema is still
    // the selected node after the second click.
    const schemaButton = screen.getByLabelText("public schema");
    await act(async () => {
      fireEvent.click(schemaButton);
    });
    await act(async () => {
      fireEvent.click(schemaButton);
    });
    expect(schemaButton).toHaveClass("bg-muted");

    // Click table — table becomes selected
    const tableItem = screen.getByLabelText("users table");
    await act(async () => {
      fireEvent.click(tableItem);
    });

    expect(tableItem).toHaveClass("bg-primary/10");
    // Schema should no longer have selection highlight
    expect(schemaButton).not.toHaveClass("bg-muted");
  });

  // AC-VIS-02: Schema node has Folder icon when collapsed
  it("renders schema node with Folder icon when collapsed", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    // Sprint 144: schema is auto-expanded on mount, so click once to
    // collapse and exercise the collapsed Folder-icon rendering.
    const schemaButton = screen.getByLabelText("public schema");
    await act(async () => {
      fireEvent.click(schemaButton);
    });

    // The Folder SVG should be inside the schema row when collapsed
    const svgElements = schemaButton.querySelectorAll("svg.lucide-folder");
    expect(svgElements.length).toBe(1);
  });

  // AC-VIS-03: Different indentation levels
  it("applies different indentation to schema, category, and table levels", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: {
        "conn1:public": [{ name: "users", schema: "public", row_count: null }],
      },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    // Sprint 144: schema auto-expanded; category + table rows are visible.
    const schemaButton = screen.getByLabelText("public schema");
    // Schema has px-3
    expect(schemaButton).toHaveClass("px-3");

    // Category has pl-6
    const tablesCategory = screen.getByLabelText("Tables in public");
    expect(tablesCategory).toHaveClass("pl-6");

    // Table item has pl-10
    const tableItem = screen.getByLabelText("users table");
    expect(tableItem).toHaveClass("pl-10");
  });

  // =========================================================================
  // NEW: Section separators between schemas
  // =========================================================================

  // AC-SEP-01: Separator between schemas
  it("renders separator between multiple schemas", async () => {
    setSchemaStoreState({
      schemas: {
        conn1: [{ name: "public" }, { name: "analytics" }],
      },
      tables: {},
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    // There should be a border-t separator element between schemas
    const separators = document.querySelectorAll(".border-t.border-border");
    // Only separator between schemas (not the connection header border-b)
    const sectionSeparators = Array.from(separators).filter(
      (el) => el.classList.contains("mx-3") && el.classList.contains("my-0.5"),
    );
    expect(sectionSeparators.length).toBe(1);
  });

  it("does not render separator when there is only one schema", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: {},
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const sectionSeparators = Array.from(
      document.querySelectorAll(".border-t.border-border"),
    ).filter(
      (el) => el.classList.contains("mx-3") && el.classList.contains("my-0.5"),
    );
    expect(sectionSeparators.length).toBe(0);
  });

  // =========================================================================
  // NEW: Active tab highlight (Sprint 54)
  // =========================================================================

  // AC-ACTIVE-01: Table node matching active tab gets highlight class
  it("highlights table node when it matches the active tab", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: {
        "conn1:public": [
          { name: "users", schema: "public", row_count: null },
          { name: "orders", schema: "public", row_count: null },
        ],
      },
    });

    // Pre-set an active tab pointing to public.users
    useWorkspaceStore.setState(
      seedWorkspace(
        [
          {
            type: "table",
            id: "tab-1" as TabId,
            title: "public.users",
            connectionId: "conn1" as ConnectionId,
            closable: true,
            schema: "public",
            table: "users",
            subView: "records",
          },
        ],
        "tab-1",
      ),
    );

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    // Schema should auto-expand due to active tab
    const schemaButton = screen.getByLabelText("public schema");
    expect(schemaButton).toHaveAttribute("aria-expanded", "true");

    // The active table (users) should have highlight class
    const usersItem = screen.getByLabelText("users table");
    expect(usersItem).toHaveClass("bg-primary/10");
    expect(usersItem).toHaveClass("text-primary");
    expect(usersItem).toHaveClass("font-semibold");

    // The other table (orders) should NOT have highlight
    const ordersItem = screen.getByLabelText("orders table");
    expect(ordersItem).not.toHaveClass("bg-primary/10");
    expect(ordersItem).not.toHaveClass("text-primary");
  });

  // AC-ACTIVE-02: No highlight when active tab is a query tab
  it("does not highlight any table when active tab is a query tab", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: {
        "conn1:public": [{ name: "users", schema: "public", row_count: null }],
      },
    });

    // Set a query tab as active
    useWorkspaceStore.setState(
      seedWorkspace(
        [
          {
            type: "query",
            id: "query-1" as TabId,
            title: "Query 1",
            connectionId: "conn1" as ConnectionId,
            closable: true,
            sql: "SELECT 1",
            queryState: { status: "idle" },
            paradigm: "rdb",
            queryMode: "sql",
          },
        ],
        "query-1",
      ),
    );

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    // Expand schema manually
    // No table should have active highlight from tab state
    const usersItem = screen.getByLabelText("users table");
    // It won't have bg-primary/10 from active tab since it's a query tab
    expect(usersItem).not.toHaveClass("font-semibold");
  });

  // 2026-05-11 — Regression. Pre-fix `handleTableClick` /
  // `handleTableDoubleClick` set `selectedNodeId` to the clicked node,
  // and the item highlight OR-merged `selectedNodeId` with the active-
  // tab match. The last-opened table therefore stayed highlighted even
  // after the user switched to a different tab. The fix drops the
  // setter for table/view clicks (highlight now follows active-tab
  // identity only) so the previously-clicked row goes dark on switch.
  it(
    "clears the previously-opened table's highlight after switching to a " +
      "different tab via setActiveTab",
    async () => {
      setSchemaStoreState({
        schemas: { conn1: [{ name: "public" }] },
        tables: {
          "conn1:public": [
            { name: "users", schema: "public", row_count: null },
            { name: "orders", schema: "public", row_count: null },
          ],
        },
      });

      await act(async () => {
        render(<SchemaTree connectionId="conn1" />);
      });

      // Double-click users — opens a permanent tab and makes it active.
      const usersItem = screen.getByLabelText("users table");
      await act(async () => {
        fireEvent.doubleClick(usersItem);
      });
      expect(usersItem).toHaveClass("bg-primary/10");

      // Double-click orders — opens its own permanent tab and becomes
      // the new active tab. Users should lose the highlight here.
      const ordersItem = screen.getByLabelText("orders table");
      await act(async () => {
        fireEvent.doubleClick(ordersItem);
      });
      expect(ordersItem).toHaveClass("bg-primary/10");
      expect(usersItem).not.toHaveClass("bg-primary/10");

      // Switch back to the users tab via the store (simulates Cmd+1).
      const usersTab = getTestWorkspace().tabs.find(
        (t) => t.type === "table" && t.table === "users",
      );
      expect(usersTab).toBeTruthy();
      await act(async () => {
        useWorkspaceStore.getState().setActiveTab("conn1", "db1", usersTab!.id);
      });

      // Only users should be highlighted now — orders' highlight
      // tracked the previous active-tab state and must clear.
      expect(screen.getByLabelText("users table")).toHaveClass("bg-primary/10");
      expect(screen.getByLabelText("orders table")).not.toHaveClass(
        "bg-primary/10",
      );
    },
  );

  // AC-ACTIVE-03: Highlight updates when active tab changes
  it("updates highlight when active tab changes to a different table", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: {
        "conn1:public": [
          { name: "users", schema: "public", row_count: null },
          { name: "orders", schema: "public", row_count: null },
        ],
      },
    });

    // Start with users tab active
    useWorkspaceStore.setState(
      seedWorkspace(
        [
          {
            type: "table",
            id: "tab-1" as TabId,
            title: "public.users",
            connectionId: "conn1" as ConnectionId,
            closable: true,
            schema: "public",
            table: "users",
            subView: "records",
          },
        ],
        "tab-1",
      ),
    );

    const { rerender } = await act(async () => {
      return render(<SchemaTree connectionId="conn1" />);
    });

    // Users should be highlighted
    expect(screen.getByLabelText("users table")).toHaveClass("bg-primary/10");

    // Switch active tab to orders
    await act(async () => {
      useWorkspaceStore.setState(
        seedWorkspace(
          [
            {
              type: "table",
              id: "tab-1" as TabId,
              title: "public.users",
              connectionId: "conn1" as ConnectionId,
              closable: true,
              schema: "public",
              table: "users",
              subView: "records",
            },
            {
              type: "table",
              id: "tab-2" as TabId,
              title: "public.orders",
              connectionId: "conn1" as ConnectionId,
              closable: true,
              schema: "public",
              table: "orders",
              subView: "records",
            },
          ],
          "tab-2",
        ),
      );
    });

    await act(async () => {
      rerender(<SchemaTree connectionId="conn1" />);
    });

    // Now orders should be highlighted, users should not
    expect(screen.getByLabelText("orders table")).toHaveClass("bg-primary/10");
    expect(screen.getByLabelText("users table")).not.toHaveClass(
      "bg-primary/10",
    );
  });

  // =========================================================================
  // NEW: Icon rendering per hierarchy level (Sprint 54)
  // =========================================================================

  // AC-ICON-02: Schema node shows Folder icon when collapsed, FolderOpen when expanded
  it("renders Folder icon when schema is collapsed and FolderOpen when expanded", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: { "conn1:public": [] },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const schemaButton = screen.getByLabelText("public schema");

    // Sprint 144: schema is auto-expanded on mount, so the initial icon is
    // FolderOpen. Verify expanded state first, then click to collapse and
    // verify the Folder icon is rendered for the collapsed state.

    // Expanded (initial): should have FolderOpen icon
    const folderOpenInitial = schemaButton.querySelectorAll(
      "svg.lucide-folder-open",
    );
    const folderInitial = schemaButton.querySelectorAll("svg.lucide-folder");
    expect(folderOpenInitial.length).toBe(1);
    expect(folderInitial.length).toBe(0);

    // Collapse
    await act(async () => {
      fireEvent.click(schemaButton);
    });

    // Collapsed: should have Folder icon
    const folderAfterCollapse =
      schemaButton.querySelectorAll("svg.lucide-folder");
    const folderOpenAfterCollapse = schemaButton.querySelectorAll(
      "svg.lucide-folder-open",
    );
    expect(folderAfterCollapse.length).toBe(1);
    expect(folderOpenAfterCollapse.length).toBe(0);
  });

  // AC-ICON-03: Procedures category uses Terminal icon (distinct from Functions' Code2)
  it("renders Terminal icon for Procedures category", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: { "conn1:public": [] },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    // Procedures category should have a Terminal icon
    const proceduresCategory = screen.getByLabelText("Procedures in public");
    const terminalIcons = proceduresCategory.querySelectorAll(
      "svg.lucide-terminal",
    );
    expect(terminalIcons.length).toBe(1);
  });

  // AC-ICON-04: Category icons are distinct from each other
  it("renders distinct icons for each category type", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: { "conn1:public": [] },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const tablesCat = screen.getByLabelText("Tables in public");
    const viewsCat = screen.getByLabelText("Views in public");
    const functionsCat = screen.getByLabelText("Functions in public");
    const proceduresCat = screen.getByLabelText("Procedures in public");

    // Tables: LayoutGrid
    expect(tablesCat.querySelectorAll("svg.lucide-layout-grid").length).toBe(1);
    // Views: Eye
    expect(viewsCat.querySelectorAll("svg.lucide-eye").length).toBe(1);
    // Functions: Code2 (renders as lucide-code-xml)
    expect(functionsCat.querySelectorAll("svg.lucide-code-xml").length).toBe(1);
    // Procedures: Terminal
    expect(proceduresCat.querySelectorAll("svg.lucide-terminal").length).toBe(
      1,
    );
  });

  it("shows count badges for views and functions", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: {
        "conn1:public": [{ name: "users", schema: "public", row_count: 5 }],
      },
      views: {
        "conn1:public": [
          { name: "v1", schema: "public", definition: null },
          { name: "v2", schema: "public", definition: null },
        ],
      },
      functions: {
        "conn1:public": [
          {
            name: "f1",
            schema: "public",
            arguments: null,
            returnType: null,
            language: "sql",
            source: null,
            kind: "function",
          },
          {
            name: "p1",
            schema: "public",
            arguments: null,
            returnType: null,
            language: "plpgsql",
            source: null,
            kind: "procedure",
          },
        ],
      },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    // Sprint 226 polish (2026-05-06): itemCount badge 가 button 밖
    // sibling div 로 이동 — row 전체 (wrapper) textContent 검사.
    const tablesRow = screen.getByLabelText("Tables in public").parentElement!;
    const viewsRow = screen.getByLabelText("Views in public").parentElement!;
    const functionsRow = screen.getByLabelText(
      "Functions in public",
    ).parentElement!;
    const proceduresRow = screen.getByLabelText(
      "Procedures in public",
    ).parentElement!;

    expect(tablesRow.textContent).toContain("1");
    expect(viewsRow.textContent).toContain("2");
    expect(functionsRow.textContent).toContain("1");
    expect(proceduresRow.textContent).toContain("1");
  });
});
