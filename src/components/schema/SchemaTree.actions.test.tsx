// Sprint 216 — `actions` axis split from `SchemaTree.test.tsx`. Covers
// table click → addTab (AC-05), the table-row right-click context menu
// (AC-CM-01..16: Structure / Data / Rename / Drop), F2 keyboard rename
// (Sprint 107 #TREE-1), view-row click and view-context-menu Structure /
// Data routing, function-row click → query tab, the AC-191-03 toast
// fallback for dropTable / renameTable rejections, and the AC-192-04
// header Export popover (RDB-only). Cases are byte-equivalent to the
// originals.
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import SchemaTree from "./SchemaTree";
import { useSchemaStore } from "@stores/schemaStore";
import { useConnectionStore } from "@stores/connectionStore";
import { useTabStore } from "@stores/tabStore";
import {
  mockLoadSchemas,
  mockLoadTables,
  setSchemaStoreState,
  resetStores,
} from "./__tests__/schemaTreeTestHelpers";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SchemaTree — actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadSchemas.mockResolvedValue(undefined);
    mockLoadTables.mockResolvedValue(undefined);
    resetStores();
  });

  // -----------------------------------------------------------------------
  // AC-05: Table click -> addTab
  // -----------------------------------------------------------------------
  it("calls addTab with correct params when table is clicked", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: {
        "conn1:public": [{ name: "users", schema: "public", row_count: null }],
      },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    // Expand the schema first
    const tableButton = screen.getByLabelText("users table");
    await act(async () => {
      fireEvent.click(tableButton);
    });

    const state = useTabStore.getState();
    const tab = state.tabs.find((t) => t.type === "table");
    expect(tab).toBeDefined();
    if (tab && tab.type === "table") {
      expect(tab.title).toBe("public.users");
      expect(tab.connectionId).toBe("conn1");
      expect(tab.table).toBe("users");
      expect(tab.schema).toBe("public");
      expect(tab.subView).toBe("records");
      expect(tab.closable).toBe(true);
    }
  });

  // =========================================================================
  // NEW: Context menu — table node
  // =========================================================================

  // Helper: expand schema so table items are visible
  async function expandSchemaWithTables() {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: {
        "conn1:public": [{ name: "users", schema: "public", row_count: null }],
      },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });
  }

  // AC-CM-01: Right-clicking a table node shows context menu with correct items
  it("shows context menu with Structure/Data/Rename/Drop on table right-click", async () => {
    await expandSchemaWithTables();

    const tableItem = screen.getByLabelText("users table");
    await act(async () => {
      fireEvent.contextMenu(tableItem, {
        clientX: 100,
        clientY: 200,
      });
    });

    // ContextMenu should render with the expected items
    expect(screen.getByText("Structure")).toBeInTheDocument();
    expect(screen.getByText("Data")).toBeInTheDocument();
    expect(screen.getByText("Rename")).toBeInTheDocument();
    expect(screen.getByText("Drop")).toBeInTheDocument();
  });

  // AC-CM-02: Context menu closes when onClose is called (click outside)
  it("closes table context menu when close handler fires", async () => {
    await expandSchemaWithTables();

    const tableItem = screen.getByLabelText("users table");
    await act(async () => {
      fireEvent.contextMenu(tableItem, {
        clientX: 100,
        clientY: 200,
      });
    });

    expect(screen.getByText("Structure")).toBeInTheDocument();

    // The ContextMenu component handles its own close-on-click-outside.
    // Simulate by pressing Escape
    await act(async () => {
      fireEvent.keyDown(document, { key: "Escape" });
    });

    expect(screen.queryByText("Structure")).not.toBeInTheDocument();
  });

  // AC-CM-03: Structure opens tab with subView "structure"
  it("opens tab with subView 'structure' when Structure menu item is clicked", async () => {
    await expandSchemaWithTables();

    const tableItem = screen.getByLabelText("users table");
    await act(async () => {
      fireEvent.contextMenu(tableItem, {
        clientX: 100,
        clientY: 200,
      });
    });

    // Click the Structure menu item
    await act(async () => {
      fireEvent.click(screen.getByText("Structure"));
    });

    const state = useTabStore.getState();
    const tab = state.tabs.find((t) => t.type === "table");
    expect(tab).toBeDefined();
    if (tab && tab.type === "table") {
      expect(tab.subView).toBe("structure");
      expect(tab.table).toBe("users");
      expect(tab.schema).toBe("public");
    }
  });

  // AC-CM-04: Data opens tab with subView "records"
  it("opens tab with subView 'records' when Data menu item is clicked", async () => {
    await expandSchemaWithTables();

    const tableItem = screen.getByLabelText("users table");
    await act(async () => {
      fireEvent.contextMenu(tableItem, {
        clientX: 100,
        clientY: 200,
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Data"));
    });

    const state = useTabStore.getState();
    const tab = state.tabs.find((t) => t.type === "table");
    expect(tab).toBeDefined();
    if (tab && tab.type === "table") {
      expect(tab.subView).toBe("records");
      expect(tab.table).toBe("users");
    }
  });

  // AC-CM-05: Drop shows confirmation dialog
  it("shows confirmation dialog when Drop menu item is clicked", async () => {
    await expandSchemaWithTables();

    const tableItem = screen.getByLabelText("users table");
    await act(async () => {
      fireEvent.contextMenu(tableItem, {
        clientX: 100,
        clientY: 200,
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Drop"));
    });

    // Confirmation dialog should be visible
    expect(
      screen.getByRole("dialog", { name: "Drop Table" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Are you sure you want to drop/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/This action cannot be undone/),
    ).toBeInTheDocument();
  });

  // AC-CM-06: Drop confirmation cancel closes dialog
  it("closes drop confirmation dialog when Cancel is clicked", async () => {
    await expandSchemaWithTables();

    const tableItem = screen.getByLabelText("users table");
    await act(async () => {
      fireEvent.contextMenu(tableItem, {
        clientX: 100,
        clientY: 200,
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Drop"));
    });

    expect(
      screen.getByRole("dialog", { name: "Drop Table" }),
    ).toBeInTheDocument();

    // Click Cancel (find the one inside the dialog)
    const dialog = screen.getByRole("dialog", { name: "Drop Table" });
    const cancelBtn = dialog.querySelector("button:not([aria-label])");
    await act(async () => {
      fireEvent.click(cancelBtn!);
    });

    // Dialog should be gone
    expect(
      screen.queryByRole("dialog", { name: "Drop Table" }),
    ).not.toBeInTheDocument();
  });

  // AC-CM-07: Drop confirmation calls dropTable store action
  it("calls dropTable when confirming drop dialog", async () => {
    const mockDropTable = vi.fn().mockResolvedValue(undefined);
    // Override the dropTable action in the store
    useSchemaStore.setState({ dropTable: mockDropTable });

    await expandSchemaWithTables();

    const tableItem = screen.getByLabelText("users table");
    await act(async () => {
      fireEvent.contextMenu(tableItem, {
        clientX: 100,
        clientY: 200,
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Drop"));
    });

    // Click the confirm button inside the dialog
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Drop Table" }));
    });

    expect(mockDropTable).toHaveBeenCalledWith("conn1", "users", "public");
  });

  // AC-CM-08: Rename shows rename dialog
  it("shows rename dialog when Rename menu item is clicked", async () => {
    await expandSchemaWithTables();

    const tableItem = screen.getByLabelText("users table");
    await act(async () => {
      fireEvent.contextMenu(tableItem, {
        clientX: 100,
        clientY: 200,
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Rename"));
    });

    // Rename dialog should be visible
    expect(screen.getByText("Rename Table")).toBeInTheDocument();
    expect(screen.getByText("public.users")).toBeInTheDocument();
    expect(screen.getByLabelText("New table name")).toBeInTheDocument();
    expect(screen.getByLabelText("Rename")).toBeInTheDocument();
  });

  // AC-CM-09: Rename dialog pre-fills current name
  it("pre-fills rename input with current table name", async () => {
    await expandSchemaWithTables();

    const tableItem = screen.getByLabelText("users table");
    await act(async () => {
      fireEvent.contextMenu(tableItem, {
        clientX: 100,
        clientY: 200,
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Rename"));
    });

    const input = screen.getByLabelText("New table name") as HTMLInputElement;
    expect(input.value).toBe("users");
  });

  // AC-CM-10: Rename dialog cancel closes dialog
  it("closes rename dialog when Cancel is clicked", async () => {
    await expandSchemaWithTables();

    const tableItem = screen.getByLabelText("users table");
    await act(async () => {
      fireEvent.contextMenu(tableItem, {
        clientX: 100,
        clientY: 200,
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Rename"));
    });

    expect(screen.getByText("Rename Table")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByText("Cancel"));
    });

    expect(screen.queryByText("Rename Table")).not.toBeInTheDocument();
  });

  // AC-CM-11: Rename confirmation calls renameTable store action
  it("calls renameTable when confirming rename dialog", async () => {
    const mockRename = vi.fn().mockResolvedValue(undefined);
    useSchemaStore.setState({ renameTable: mockRename });

    await expandSchemaWithTables();

    const tableItem = screen.getByLabelText("users table");
    await act(async () => {
      fireEvent.contextMenu(tableItem, {
        clientX: 100,
        clientY: 200,
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Rename"));
    });

    // Change the name
    const input = screen.getByLabelText("New table name");
    await act(async () => {
      fireEvent.change(input, { target: { value: "people" } });
    });

    // Confirm
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Rename"));
    });

    expect(mockRename).toHaveBeenCalledWith(
      "conn1",
      "users",
      "public",
      "people",
    );
  });

  // AC-CM-12: Rename with Enter key
  it("submits rename on Enter key", async () => {
    const mockRename = vi.fn().mockResolvedValue(undefined);
    useSchemaStore.setState({ renameTable: mockRename });

    await expandSchemaWithTables();

    const tableItem = screen.getByLabelText("users table");
    await act(async () => {
      fireEvent.contextMenu(tableItem, {
        clientX: 100,
        clientY: 200,
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Rename"));
    });

    const input = screen.getByLabelText("New table name");
    await act(async () => {
      fireEvent.change(input, { target: { value: "people" } });
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    expect(mockRename).toHaveBeenCalledWith(
      "conn1",
      "users",
      "public",
      "people",
    );
  });

  // AC-CM-13: Rename dialog closes on Escape
  it("closes rename dialog on Escape key", async () => {
    await expandSchemaWithTables();

    const tableItem = screen.getByLabelText("users table");
    await act(async () => {
      fireEvent.contextMenu(tableItem, {
        clientX: 100,
        clientY: 200,
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Rename"));
    });

    const input = screen.getByLabelText("New table name");
    await act(async () => {
      fireEvent.keyDown(input, { key: "Escape" });
    });

    expect(screen.queryByText("Rename Table")).not.toBeInTheDocument();
  });

  // AC-CM-14: Rename validation - empty name
  it("shows error when renaming to empty string", async () => {
    await expandSchemaWithTables();

    const tableItem = screen.getByLabelText("users table");
    await act(async () => {
      fireEvent.contextMenu(tableItem, {
        clientX: 100,
        clientY: 200,
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Rename"));
    });

    const input = screen.getByLabelText("New table name");
    await act(async () => {
      fireEvent.change(input, { target: { value: "" } });
    });

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Rename"));
    });

    expect(
      screen.getByText("Table name must not be empty"),
    ).toBeInTheDocument();
  });

  // AC-CM-15: Rename validation - invalid characters
  it("shows error when renaming to name with invalid characters", async () => {
    await expandSchemaWithTables();

    const tableItem = screen.getByLabelText("users table");
    await act(async () => {
      fireEvent.contextMenu(tableItem, {
        clientX: 100,
        clientY: 200,
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Rename"));
    });

    const input = screen.getByLabelText("New table name");
    await act(async () => {
      fireEvent.change(input, { target: { value: "bad-name!" } });
    });

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Rename"));
    });

    expect(
      screen.getByText(/must start with a letter or underscore/),
    ).toBeInTheDocument();
  });

  // AC-CM-16: Rename same name just closes dialog (no-op)
  it("closes dialog without calling renameTable when name is unchanged", async () => {
    const mockRename = vi.fn().mockResolvedValue(undefined);
    useSchemaStore.setState({ renameTable: mockRename });

    await expandSchemaWithTables();

    const tableItem = screen.getByLabelText("users table");
    await act(async () => {
      fireEvent.contextMenu(tableItem, {
        clientX: 100,
        clientY: 200,
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Rename"));
    });

    // Don't change the name, just click rename
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Rename"));
    });

    expect(mockRename).not.toHaveBeenCalled();
    expect(screen.queryByText("Rename Table")).not.toBeInTheDocument();
  });

  // =========================================================================
  // View click and view context menu — routes to ViewStructurePanel
  // =========================================================================

  it("clicking a view item opens a table tab with view name", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: { "conn1:public": [] },
      views: {
        "conn1:public": [
          { name: "active_users", schema: "public", definition: "SELECT 1" },
        ],
      },
      functions: {},
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const viewsCat = screen.getByLabelText("Views in public");
    await act(async () => {
      fireEvent.click(viewsCat);
    });

    const viewItem = screen.getByLabelText("active_users view");
    await act(async () => {
      fireEvent.click(viewItem);
    });

    const tabState = useTabStore.getState();
    expect(tabState.tabs).toHaveLength(1);
    expect(tabState.tabs[0]!.type).toBe("table");
    if (tabState.tabs[0]!.type === "table") {
      expect(tabState.tabs[0]!.table).toBe("active_users");
      expect(tabState.tabs[0]!.schema).toBe("public");
    }
  });

  it("clicking a function item opens a query tab", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: { "conn1:public": [] },
      views: {},
      functions: {
        "conn1:public": [
          {
            name: "calculate_total",
            schema: "public",
            arguments: "x integer",
            returnType: "integer",
            language: "plpgsql",
            source: "BEGIN RETURN x; END",
            kind: "function",
          },
        ],
      },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const functionsCat = screen.getByLabelText("Functions in public");
    await act(async () => {
      fireEvent.click(functionsCat);
    });

    const funcItem = screen.getByLabelText("calculate_total function");
    await act(async () => {
      fireEvent.click(funcItem);
    });

    const tabState = useTabStore.getState();
    expect(tabState.tabs).toHaveLength(1);
    expect(tabState.tabs[0]!.type).toBe("query");
    if (tabState.tabs[0]!.type === "query") {
      expect(tabState.tabs[0]!.sql).toBe("BEGIN RETURN x; END");
    }
  });

  // =========================================================================
  // View context menu — Structure routes to ViewStructurePanel
  // =========================================================================

  async function expandSchemaWithView() {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: { "conn1:public": [] },
      views: {
        "conn1:public": [
          {
            name: "active_users",
            schema: "public",
            definition: "SELECT * FROM users WHERE active = true",
          },
        ],
      },
      functions: {},
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const viewsCat = screen.getByLabelText("Views in public");
    await act(async () => {
      fireEvent.click(viewsCat);
    });
  }

  it("opens view tab in records mode with objectKind 'view' on left click", async () => {
    await expandSchemaWithView();

    const viewItem = screen.getByLabelText("active_users view");
    await act(async () => {
      fireEvent.click(viewItem);
    });

    const tab = useTabStore.getState().tabs.find((t) => t.type === "table");
    expect(tab).toBeDefined();
    if (tab && tab.type === "table") {
      expect(tab.subView).toBe("records");
      expect(tab.objectKind).toBe("view");
      expect(tab.table).toBe("active_users");
    }
  });

  it("opens view tab in structure mode when context-menu Structure is clicked", async () => {
    await expandSchemaWithView();

    const viewItem = screen.getByLabelText("active_users view");
    await act(async () => {
      fireEvent.contextMenu(viewItem, { clientX: 100, clientY: 200 });
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Structure"));
    });

    const tab = useTabStore.getState().tabs.find((t) => t.type === "table");
    expect(tab).toBeDefined();
    if (tab && tab.type === "table") {
      expect(tab.subView).toBe("structure");
      expect(tab.objectKind).toBe("view");
      expect(tab.table).toBe("active_users");
    }
  });

  it("opens view tab in records mode when context-menu Data is clicked", async () => {
    await expandSchemaWithView();

    const viewItem = screen.getByLabelText("active_users view");
    await act(async () => {
      fireEvent.contextMenu(viewItem, { clientX: 100, clientY: 200 });
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Data"));
    });

    const tab = useTabStore.getState().tabs.find((t) => t.type === "table");
    expect(tab).toBeDefined();
    if (tab && tab.type === "table") {
      expect(tab.subView).toBe("records");
      expect(tab.objectKind).toBe("view");
    }
  });

  // =========================================================================
  // Sprint 107 (#TREE-1): F2 keyboard rename on focused table button
  // =========================================================================

  // AC-01: F2 on focused table button opens Rename Dialog
  it("opens rename dialog when F2 is pressed on a focused table button", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: {
        "conn1:public": [{ name: "users", schema: "public", row_count: null }],
      },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const tableButton = screen.getByLabelText("users table");
    await act(async () => {
      fireEvent.keyDown(tableButton, { key: "F2" });
    });

    expect(screen.getByText("Rename Table")).toBeInTheDocument();
    expect(screen.getByText("public.users")).toBeInTheDocument();
    expect(screen.getByLabelText("New table name")).toBeInTheDocument();
  });

  // AC-04: F2 on focused view button does NOT open Rename Dialog
  it("does not open rename dialog when F2 is pressed on a focused view button", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: { "conn1:public": [] },
      views: {
        "conn1:public": [
          {
            name: "active_users",
            schema: "public",
            definition: "SELECT * FROM users WHERE active = true",
          },
        ],
      },
      functions: {},
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const viewsCat = screen.getByLabelText("Views in public");
    await act(async () => {
      fireEvent.click(viewsCat);
    });

    const viewButton = screen.getByLabelText("active_users view");
    await act(async () => {
      fireEvent.keyDown(viewButton, { key: "F2" });
    });

    expect(screen.queryByText("Rename Table")).not.toBeInTheDocument();
  });

  // AC-04: F2 on focused function button does NOT open Rename Dialog
  it("does not open rename dialog when F2 is pressed on a focused function button", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: { "conn1:public": [] },
      views: {},
      functions: {
        "conn1:public": [
          {
            name: "calculate_total",
            schema: "public",
            arguments: "user_id integer",
            returnType: "numeric",
            language: "plpgsql",
            source: "BEGIN RETURN 0; END",
            kind: "function",
          },
        ],
      },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const functionsCat = screen.getByLabelText("Functions in public");
    await act(async () => {
      fireEvent.click(functionsCat);
    });

    const funcButton = screen.getByLabelText("calculate_total function");
    await act(async () => {
      fireEvent.keyDown(funcButton, { key: "F2" });
    });

    expect(screen.queryByText("Rename Table")).not.toBeInTheDocument();
  });

  // AC-02: After dialog opens (via F2), input is focused and selection covers full name
  it("focuses rename input and selects full existing name when opened via F2", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: {
        "conn1:public": [{ name: "users", schema: "public", row_count: null }],
      },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const tableButton = screen.getByLabelText("users table");
    await act(async () => {
      fireEvent.keyDown(tableButton, { key: "F2" });
    });

    const input = screen.getByLabelText("New table name") as HTMLInputElement;
    // autoFocus + onFocus={select()} should focus the input and select its full
    // contents so the user can type to overwrite the existing name immediately.
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("users");
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe("users".length);
  });

  // AC-03: Enter inside the F2-opened dialog input commits the rename
  it("commits rename on Enter when dialog was opened via F2", async () => {
    const mockRename = vi.fn().mockResolvedValue(undefined);

    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: {
        "conn1:public": [{ name: "users", schema: "public", row_count: null }],
      },
    });
    useSchemaStore.setState({ renameTable: mockRename });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const tableButton = screen.getByLabelText("users table");
    await act(async () => {
      fireEvent.keyDown(tableButton, { key: "F2" });
    });

    const input = screen.getByLabelText("New table name");
    await act(async () => {
      fireEvent.change(input, { target: { value: "people" } });
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    expect(mockRename).toHaveBeenCalledWith(
      "conn1",
      "users",
      "public",
      "people",
    );
  });

  // AC-191-03 — Sprint 191 silent failure → toast 정리. dropTable 과
  // renameTable 의 store 액션은 실제로 throw 하므로 SchemaTree 가 catch
  // 분기에서 toast.error 를 발사하는지를 직접 단언한다 (
  // useSchemaCache.test.ts 는 store-swallowing 분기만 단언). date 2026-05-02.
  it("[AC-191-03-1] dropTable rejection surfaces toast error instead of silent swallow", async () => {
    const toastMod = await import("@/lib/toast");
    const errorSpy = vi
      .spyOn(toastMod.toast, "error")
      .mockImplementation(() => "");
    const failingDropTable = vi
      .fn()
      .mockRejectedValue(new Error("permission denied"));
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: {
        "conn1:public": [{ name: "users", schema: "public", row_count: null }],
      },
    });
    useSchemaStore.setState({ dropTable: failingDropTable });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const tableItem = screen.getByLabelText("users table");
    await act(async () => {
      fireEvent.contextMenu(tableItem, { clientX: 100, clientY: 200 });
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Drop"));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Drop Table" }));
    });

    await waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringMatching(
          /Failed to drop public\.users:.*permission denied/,
        ),
      );
    });
    errorSpy.mockRestore();
  });

  // AC-192-04 — Sprint 192 통합 export. 진입점은 헤더 Popover (Download
  // 아이콘 → 클릭 시 schema 별 [Schema/Data/Full] 3 액션 노출). 우클릭
  // context menu 에서 헤더 Popover 으로 이전된 이유: schema 행이 hide
  // 되는 MySQL/SQLite tree shape 에서도 동작해야 하고, 사용자가 우클릭은
  // 발견성이 떨어진다고 피드백 (2026-05-02). RDB 연결에서만 노출되고
  // mongodb / redis 연결에서는 trigger button 자체가 hide.
  // date 2026-05-02
  it("[AC-192-04-1] header Export popover surfaces 3 actions per schema for RDB connections", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: {
        "conn1:public": [{ name: "users", schema: "public", row_count: null }],
      },
    });
    useConnectionStore.setState({
      connections: [
        {
          id: "conn1",
          name: "PG",
          db_type: "postgresql",
          host: "localhost",
          port: 5432,
          user: "u",
          database: "db",
          group_id: null,
          color: null,
          environment: "local",
          paradigm: "rdb",
          has_password: false,
        },
      ],
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const trigger = screen.getByLabelText("Export");
    expect(trigger).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(trigger);
    });

    // Popover 안에서 schema row 의 3 가지 액션이 모두 노출.
    expect(screen.getByLabelText("Export public DDL")).toBeInTheDocument();
    expect(screen.getByLabelText("Export public data")).toBeInTheDocument();
    expect(screen.getByLabelText("Export public full")).toBeInTheDocument();
  });

  it("[AC-192-04-2] header Export popover trigger is hidden for non-RDB connections", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: {},
    });
    useConnectionStore.setState({
      connections: [
        {
          id: "conn1",
          name: "Mongo",
          db_type: "mongodb",
          host: "localhost",
          port: 27017,
          user: "u",
          database: "db",
          group_id: null,
          color: null,
          environment: "local",
          paradigm: "document",
          has_password: false,
        },
      ],
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    // Mongo connection 에선 paradigm !== "rdb" 이므로 Popover trigger
    // 자체가 hide — refresh 버튼만 노출.
    expect(screen.queryByLabelText("Export")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Refresh schemas")).toBeInTheDocument();
  });

  // =========================================================================
  // Sprint 226 (AC-226-05) — schema-row "Create Table…" entry-point
  // =========================================================================
  //
  // Date: 2026-05-06.
  //
  // Why this case lives here:
  // - AC-226-05 mandates that right-clicking a schema row exposes a
  //   "Create Table…" item, that clicking it opens the modal pre-filled
  //   with the schema name, and that on commit-success `refreshSchema`
  //   is called exactly once. The modal body (form, preview, commit) is
  //   covered by `CreateTableDialog.test.tsx`; this case only locks the
  //   tree-side wiring + the post-commit refresh contract.
  // - Mock: `@lib/tauri.createTable` mock returns the SQL on both
  //   preview and commit. The hook's `runCommit` awaits `onRefresh`
  //   (which is plumbed to `refreshSchema(schemaName)` from
  //   `useSchemaCache`); we spy `refreshSchema` via the
  //   `useSchemaStore` action override so the assertion is direct.
  it("[AC-226-05] schema-row right-click surfaces 'Create Table…' menu item", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: { "conn1:public": [] },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const schemaRow = screen.getByLabelText("public schema");
    await act(async () => {
      fireEvent.contextMenu(schemaRow, { clientX: 100, clientY: 200 });
    });

    expect(screen.getByText(/Create Table/)).toBeInTheDocument();
  });

  it("[AC-226-05] clicking 'Create Table…' opens dialog pre-filled with schema name", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: { "conn1:public": [] },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const schemaRow = screen.getByLabelText("public schema");
    await act(async () => {
      fireEvent.contextMenu(schemaRow, { clientX: 100, clientY: 200 });
    });
    await act(async () => {
      fireEvent.click(screen.getByText(/Create Table/));
    });

    // Modal heading is rendered + the read-only Schema input shows the
    // right-clicked schema name.
    expect(screen.getByText("Create Table")).toBeInTheDocument();
    const schemaInput = screen.getByLabelText(
      "Schema name",
    ) as HTMLInputElement;
    expect(schemaInput.value).toBe("public");
    expect(schemaInput.readOnly).toBe(true);
  });

  it("[AC-226-05] commit-success calls refreshSchema('public') exactly once", async () => {
    // Sprint 226: prove the post-commit refresh contract.
    // - Mock `@lib/tauri.createTable` so preview + commit succeed.
    // - Spy on `useSchemaStore.loadTables` (the underlying call that
    //   `useSchemaCache.refreshSchema` invokes for the schema's tables).
    //   We set Safe Mode "off" so the gate passes through immediately.
    const tauri = await import("@lib/tauri");
    const createTableSpy = vi.spyOn(tauri, "createTable").mockResolvedValue({
      sql: 'CREATE TABLE "public"."new_t" ("id" integer)',
    });
    const loadTablesSpy = vi.fn().mockResolvedValue(undefined);
    const safeModeMod = await import("@stores/safeModeStore");
    safeModeMod.useSafeModeStore.setState({ mode: "off" });

    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: { "conn1:public": [] },
    });
    // The shared helper preserves a default `loadTables` mock — override
    // here so we can spy on the post-commit refresh path specifically.
    useSchemaStore.setState({ loadTables: loadTablesSpy });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const schemaRow = screen.getByLabelText("public schema");
    await act(async () => {
      fireEvent.contextMenu(schemaRow, { clientX: 100, clientY: 200 });
    });
    await act(async () => {
      fireEvent.click(screen.getByText(/Create Table/));
    });

    // Fill the form.
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Table name"), {
        target: { value: "new_t" },
      });
      fireEvent.change(screen.getByLabelText("Column name"), {
        target: { value: "id" },
      });
      fireEvent.change(screen.getByLabelText("Column data type"), {
        target: { value: "integer" },
      });
    });

    // Preview SQL — first call (preview_only: true).
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Preview SQL/i }));
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Execute/i }),
      ).toBeInTheDocument(),
    );

    // Reset loadTables spy *before* commit so we count only the
    // post-commit refresh call (auto-expand on schema render also fires
    // loadTables — pre-commit calls are unrelated to AC-226-05).
    loadTablesSpy.mockClear();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Execute/i }));
    });

    // Post-commit `refreshSchema("public")` resolves into
    // `loadTables(connectionId, "public")`.
    await waitFor(() => {
      const callsForPublic = loadTablesSpy.mock.calls.filter(
        (c) => c[0] === "conn1" && c[1] === "public",
      );
      expect(callsForPublic).toHaveLength(1);
    });
    // Commit-side createTable call (preview_only:false) ran exactly once.
    const commitCalls = createTableSpy.mock.calls.filter(
      (c) => (c[0] as { preview_only: boolean }).preview_only === false,
    );
    expect(commitCalls).toHaveLength(1);

    createTableSpy.mockRestore();
  });

  it("[AC-191-03-2] renameTable rejection surfaces toast error", async () => {
    const toastMod = await import("@/lib/toast");
    const errorSpy = vi
      .spyOn(toastMod.toast, "error")
      .mockImplementation(() => "");
    const failingRename = vi
      .fn()
      .mockRejectedValue(new Error("name already exists"));
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: {
        "conn1:public": [{ name: "users", schema: "public", row_count: null }],
      },
    });
    useSchemaStore.setState({ renameTable: failingRename });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const tableButton = screen.getByLabelText("users table");
    await act(async () => {
      fireEvent.keyDown(tableButton, { key: "F2" });
    });
    const input = screen.getByLabelText("New table name");
    await act(async () => {
      fireEvent.change(input, { target: { value: "people" } });
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    await waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringMatching(
          /Failed to rename public\.users:.*name already exists/,
        ),
      );
    });
    errorSpy.mockRestore();
  });
});
