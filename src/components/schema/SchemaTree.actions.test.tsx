// Sprint 235 (Phase 27 sprint 10) — `SchemaTree.actions.test.tsx`
// mechanical migration. Date: 2026-05-07.
//
// Why this file changed in Sprint 235:
// - Sprint 235 promotes the legacy minimal `DropTableConfirmDialog` +
//   `RenameTableDialog` slots to the Phase 27-shaped modals
//   (`RenameTableDialog` + `DropTableDialog` — typing-confirm + inline
//   DDL preview + Safe Mode dispatch via `useDdlPreviewExecution` +
//   `useSchemaTableMutations`).
// - The old `confirmDialog` / `renameDialog` / `renameInput` slots are
//   collapsed into 2 `{ schemaName, tableName } | null` slots
//   (`renameTableDialog` + `dropTableDialog`); the inline tauri /
//   history / toast paths now run INSIDE the modals.
// - All commit-side assertions move from `useSchemaStore.dropTable` /
//   `renameTable` overrides to `@lib/tauri.dropTable` /
//   `tauri.renameTable` mocks (the modals delegate to
//   `useSchemaTableMutations` → `schemaStore.dropTable` →
//   `tauri.dropTable` compat wrapper).
// - The toast-fallback assertions (AC-191-03) are removed from this file
//   because the modal owns the user-visible error surface (inline
//   `previewError` + `pendingConfirm` dialog) — the original silent-
//   swallow regression no longer applies.
//
// 4 NEW cases per AC-235-07 / AC-235-08:
// - "Rename menu opens RenameTableDialog with pre-fill" (AC-235-07)
// - "Drop menu opens DropTableDialog" (AC-235-08)
// - "Rename commit-success → tauri.renameTable invoked + dialog closes"
//   (AC-235-07)
// - "Drop commit-success → tauri.dropTable invoked + dialog closes"
//   (AC-235-08)
//
// The other context-menu / view / function / F2 / Export-popover / Create
// Table cases remain byte-equivalent in intent — only the post-action
// dialog assertions are mechanically updated.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getTestWorkspace } from "@/stores/__tests__/workspaceStoreTestHelpers";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";

// Sprint 235 — mock `@lib/tauri` so the new modals' DDL preview +
// commit paths short-circuit. `dropTableRequest` and
// `renameTableRequest` must resolve `{ sql }` for the preview path;
// `dropTable` and `renameTable` are the Sprint 223 compat wrappers
// the modal commit closure ultimately reaches.
const {
  mockDropTableRequest,
  mockRenameTableRequest,
  mockDropTable,
  mockRenameTable,
  mockListTables,
  mockCreateTable,
  mockCreateTablePlan,
} = vi.hoisted(() => ({
  mockDropTableRequest: vi.fn(),
  mockRenameTableRequest: vi.fn(),
  mockDropTable: vi.fn().mockResolvedValue(undefined),
  mockRenameTable: vi.fn().mockResolvedValue(undefined),
  mockListTables: vi.fn().mockResolvedValue([]),
  mockCreateTable: vi.fn(),
  // Sprint 240 — `CreateTableDialog` now calls a single
  // `tauri.createTablePlan` IPC instead of fanning out
  // create_table + create_index + add_constraint. The default impl
  // routes through `mockCreateTable` so existing assertions on
  // `mockCreateTable` call counts (preview vs commit) keep passing
  // verbatim — the no-index/no-constraint path collapses to a
  // single `mockCreateTable` invocation per IPC, identical to the
  // pre-Sprint-240 contract.
  mockCreateTablePlan: vi.fn(
    async (req: {
      connectionId: string;
      schema: string;
      name: string;
      columns: unknown[];
      primaryKey?: string[] | null;
      tableComment?: string | null;
      previewOnly?: boolean;
    }) => {
      const previewOnly = req.previewOnly ?? false;
      const r = (await mockCreateTable({
        connection_id: req.connectionId,
        schema: req.schema,
        name: req.name,
        columns: req.columns,
        primary_key: req.primaryKey ?? null,
        table_comment: req.tableComment ?? null,
        preview_only: previewOnly,
      })) as { sql?: string };
      return { sql: r.sql ?? "" };
    },
  ),
}));

vi.mock("@lib/tauri", () => ({
  dropTableRequest: mockDropTableRequest,
  renameTableRequest: mockRenameTableRequest,
  dropTable: mockDropTable,
  renameTable: mockRenameTable,
  listTables: mockListTables,
  createTable: mockCreateTable,
  createTablePlan: mockCreateTablePlan,
}));

import SchemaTree from "./SchemaTree";
import { useSchemaStore } from "@stores/schemaStore";
import { useConnectionStore } from "@stores/connectionStore";
import { useSafeModeStore } from "@stores/safeModeStore";
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
    mockListTables.mockResolvedValue([]);
    mockDropTable.mockResolvedValue(undefined);
    mockRenameTable.mockResolvedValue(undefined);
    mockDropTableRequest.mockResolvedValue({
      sql: 'DROP TABLE "public"."users"',
    });
    mockRenameTableRequest.mockResolvedValue({
      sql: 'ALTER TABLE "public"."users" RENAME TO "people"',
    });
    resetStores();
    useSafeModeStore.setState({ mode: "off" });
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

    const state = getTestWorkspace();
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

    const state = getTestWorkspace();
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

    const state = getTestWorkspace();
    const tab = state.tabs.find((t) => t.type === "table");
    expect(tab).toBeDefined();
    if (tab && tab.type === "table") {
      expect(tab.subView).toBe("records");
      expect(tab.table).toBe("users");
    }
  });

  // AC-CM-05 / AC-235-08 — Drop menu mounts the new DropTableDialog with
  // typing-confirm + CASCADE checkbox. The dialog title remains "Drop
  // Table" (verbatim from Sprint 226 minimal version) and the description
  // surfaces `{schema}.{table}`.
  it("[AC-235-08] Drop menu mounts DropTableDialog with typing-confirm", async () => {
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

    // Dialog title + description from new modal
    expect(screen.getByText("Drop Table")).toBeInTheDocument();
    expect(screen.getByText("public.users")).toBeInTheDocument();
    // Sprint 235 — typing-confirm input + CASCADE checkbox + Apply.
    expect(
      screen.getByLabelText("Type the table name to confirm"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("CASCADE")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
  });

  // AC-CM-06 — Cancel closes the new DropTableDialog.
  it("closes DropTableDialog when Cancel is clicked", async () => {
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

    expect(screen.getByText("Drop Table")).toBeInTheDocument();

    // The Cancel button is the ghost-variant button in the DialogFooter.
    const cancelBtn = screen.getByRole("button", { name: "Cancel" });
    await act(async () => {
      fireEvent.click(cancelBtn);
    });

    await waitFor(() => {
      expect(screen.queryByText("Drop Table")).not.toBeInTheDocument();
    });
  });

  // AC-235-08 — Drop commit-success path. The new modal's typing-confirm
  // + Show DDL + Apply lifecycle goes through `useDdlPreviewExecution` →
  // `useSchemaTableMutations.dropTable` → `tauri.dropTable` compat
  // wrapper.
  it("[AC-235-08] Drop commit-success calls tauri.dropTable + dialog closes", async () => {
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

    // Type table name to enable Show DDL + Apply.
    const typingConfirm = screen.getByLabelText(
      "Type the table name to confirm",
    );
    await act(async () => {
      fireEvent.change(typingConfirm, { target: { value: "users" } });
    });

    // Show DDL → fetches preview SQL.
    // Sprint 239 — preview pane defaults open; auto-debounced fetch settles via waitFor below.
    await waitFor(() => {
      expect(mockDropTableRequest).toHaveBeenCalled();
    });

    // Apply → commit closure runs. Connection environment defaults to
    // `local` (resetStores empties connections, beforeEach safe-mode off
    // permits commit), so the safe path runs and `tauri.dropTable` fires.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    });
    await waitFor(() => {
      expect(mockDropTable).toHaveBeenCalledWith("conn1", "users", "public");
    });
    await waitFor(() => {
      expect(screen.queryByText("Drop Table")).not.toBeInTheDocument();
    });
  });

  // AC-CM-08 / AC-235-07 — Rename menu mounts RenameTableDialog with
  // pre-filled current name and inline DDL preview button.
  it("[AC-235-07] Rename menu mounts RenameTableDialog pre-filled with current name", async () => {
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
    expect(screen.getByText("public.users")).toBeInTheDocument();
    const input = screen.getByLabelText("New table name") as HTMLInputElement;
    expect(input.value).toBe("users");
    // Apply disabled at name == current (rename-to-self pre-check).
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
  });

  // AC-CM-10 — Cancel closes the new RenameTableDialog.
  it("closes RenameTableDialog when Cancel is clicked", async () => {
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
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    });

    await waitFor(() => {
      expect(screen.queryByText("Rename Table")).not.toBeInTheDocument();
    });
  });

  // AC-235-07 — Rename commit-success path. Sprint 223 mutation hook
  // calls `tauri.renameTable` (compat positional wrapper) which the
  // modal commit closure forwards to.
  it("[AC-235-07] Rename commit-success calls tauri.renameTable + dialog closes", async () => {
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

    // Change the name to enable Apply.
    const input = screen.getByLabelText("New table name");
    await act(async () => {
      fireEvent.change(input, { target: { value: "people" } });
    });

    // Show DDL → fetches preview SQL.
    // Sprint 239 — preview pane defaults open; auto-debounced fetch settles via waitFor below.
    await waitFor(() => {
      expect(mockRenameTableRequest).toHaveBeenCalled();
    });

    // Apply → commit closure runs.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    });
    await waitFor(() => {
      expect(mockRenameTable).toHaveBeenCalledWith(
        "conn1",
        "users",
        "public",
        "people",
      );
    });
    await waitFor(() => {
      expect(screen.queryByText("Rename Table")).not.toBeInTheDocument();
    });
  });

  // AC-CM-14 — Identifier validation. Empty / whitespace-only input
  // surfaces inline error (Apply disabled).
  it("shows inline error when renaming to empty / whitespace-only", async () => {
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
      fireEvent.change(input, { target: { value: "   " } });
    });

    expect(
      screen.getByLabelText("Identifier validation error"),
    ).toHaveTextContent(/must not be empty/);
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
  });

  // AC-CM-15 — Invalid characters surface inline error.
  it("shows inline error when renaming to name with invalid characters", async () => {
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

    expect(
      screen.getByLabelText("Identifier validation error"),
    ).toHaveTextContent(/letter or underscore/);
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
  });

  // AC-CM-16 — Rename to same name keeps Apply disabled (no-op).
  it("[AC-235-07] Apply disabled when name unchanged (rename-to-self)", async () => {
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

    // Don't change the name — Apply stays disabled.
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    expect(mockRenameTable).not.toHaveBeenCalled();
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

    const tabState = getTestWorkspace();
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

    const tabState = getTestWorkspace();
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

    const tab = getTestWorkspace().tabs.find((t) => t.type === "table");
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

    const tab = getTestWorkspace().tabs.find((t) => t.type === "table");
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

    const tab = getTestWorkspace().tabs.find((t) => t.type === "table");
    expect(tab).toBeDefined();
    if (tab && tab.type === "table") {
      expect(tab.subView).toBe("records");
      expect(tab.objectKind).toBe("view");
    }
  });

  // =========================================================================
  // Sprint 107 (#TREE-1): F2 keyboard rename on focused table button
  // =========================================================================

  // AC-01: F2 on focused table button opens the new RenameTableDialog
  it("opens RenameTableDialog when F2 is pressed on a focused table button", async () => {
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

  // AC-02: After dialog opens (via F2), input is focused and selection
  // covers full name.
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

  // AC-192-04 — Sprint 192 통합 export. 진입점은 헤더 Popover (Download
  // 아이콘 → 클릭 시 schema 별 [Schema/Data/Full] 3 액션 노출). RDB
  // 연결에서만 노출되고 mongodb / redis 연결에서는 trigger button 자체가 hide.
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

    expect(screen.getByText("Create Table")).toBeInTheDocument();
    const schemaTrigger = screen.getByRole("combobox", {
      name: "Target schema",
    });
    expect(schemaTrigger.textContent).toContain("public");
  });

  it("[AC-226-05] commit-success calls refreshSchema('public') exactly once", async () => {
    // Sprint 226: prove the post-commit refresh contract.
    mockCreateTable.mockResolvedValue({
      sql: 'CREATE TABLE "public"."new_t" ("id" integer)',
    });
    const loadTablesSpy = vi.fn().mockResolvedValue(undefined);

    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: { "conn1:public": [] },
    });
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

    // Sprint 238 — auto-debounced (250ms) preview fetch. Wait for the
    // preview-only createTable call to settle before clicking Execute.
    await waitFor(
      () => {
        const previewCalls = mockCreateTable.mock.calls.filter(
          (c) => (c[0] as { preview_only: boolean }).preview_only === true,
        );
        expect(previewCalls.length).toBeGreaterThan(0);
      },
      { timeout: 1000 },
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Execute/i }),
      ).toBeInTheDocument(),
    );

    loadTablesSpy.mockClear();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Execute/i }));
    });

    // Post-commit `refreshSchema("public")` resolves into
    // `loadTables(connectionId, db, "public")` (Sprint 263 — db dimension).
    await waitFor(() => {
      const callsForPublic = loadTablesSpy.mock.calls.filter(
        (c) => c[0] === "conn1" && c[2] === "public",
      );
      expect(callsForPublic).toHaveLength(1);
    });
    // Commit-side createTable call (preview_only:false) ran exactly once.
    const commitCalls = mockCreateTable.mock.calls.filter(
      (c) => (c[0] as { preview_only: boolean }).preview_only === false,
    );
    expect(commitCalls).toHaveLength(1);
  });

  // =========================================================================
  // Sprint 226 polish — Tables 카테고리 헤더의 '+' 버튼 entry-point
  // =========================================================================
  it("Tables 카테고리 헤더의 '+' 버튼 click → CreateTableDialog 열림", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: { "conn1:public": [] },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const plusButton = screen.getByLabelText("Create table in public");
    await act(async () => {
      fireEvent.click(plusButton);
    });

    expect(screen.getByText("Create Table")).toBeInTheDocument();
    const schemaTrigger = screen.getByRole("combobox", {
      name: "Target schema",
    });
    expect(schemaTrigger.textContent).toContain("public");
  });

  it("Views/Functions 카테고리에는 '+' 버튼 없음 — Tables 한정", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: { "conn1:public": [] },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    expect(screen.getByLabelText("Tables in public")).toBeInTheDocument();
    expect(screen.getByLabelText("Views in public")).toBeInTheDocument();

    const plusButtons = screen.queryAllByLabelText(/^Create table in /);
    expect(plusButtons).toHaveLength(1);
  });
});
