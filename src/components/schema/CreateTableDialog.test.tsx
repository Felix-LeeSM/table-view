// Sprint 226 → Sprint 227 — `CreateTableDialog` test suite.
//
// Date: 2026-05-06.
//
// Why this file exists:
// - Sprint 226 carry-over (form behaviour + IPC sequence + history
//   source + Safe Mode warn-cancel) — assertion text strings preserved
//   verbatim per AC-227-08; only query selectors migrated to tab-aware
//   (`getByLabelText("Column name")` is now scoped to the Columns tab
//   panel via `within(columnsTabPanel)`).
// - Sprint 227 additions:
//   - AC-227-01: 4-tab layout (Columns / Keys / Indexes / Foreign Keys)
//     with placeholder strings for the Sprint 228 / 229 tabs.
//   - AC-227-02: Target schema dropdown — defaults to right-clicked
//     schema, lists ≥ 2 entries, change updates payload `schema` field
//     and invalidates the cached preview.
//   - AC-227-03: Type combobox — assertion that the per-row data-type
//     input renders as a `combobox` role with the canonical filter
//     behaviour (further filter / Enter / blur cases live in
//     `CreateTableTypeCombobox.test.tsx`).
//   - AC-227-04: Column comment input renders with aria-label
//     `"Column comment"`; preview text contains `COMMENT ON` substring
//     when a non-empty comment is provided.
//   - AC-227-05: Inline DDL Preview pane — Show DDL fires 1×
//     `tauri.createTable({preview_only:true})`; editing a field
//     invalidates the cached preview (next click triggers a 2nd
//     preview call). `SqlPreviewDialog` is NOT imported in
//     `CreateTableDialog.tsx`.
//   - AC-227-06: PK multi-select rendered inside the Keys tab; live
//     reflection of column-row name list across tab switches.
//   - AC-227-07: Footer renders only Cancel + Execute (no
//     "Preview SQL" button); IPC sequence + history source preserved.
//   - AC-227-08: Sprint 226 carry-over cases pass with mechanical
//     selector adaptation only (no assertion text changes).
//
// Mock pattern: `vi.hoisted` + factory mock for `@lib/tauri` so
// `tauri.createTable` is re-bindable inside test bodies. Pattern source:
// Sprint 219/223/224 (`useConnectionMutations.test.ts`).
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
  within,
} from "@testing-library/react";

const { mockCreateTable, mockCreateIndex, mockDropIndex } = vi.hoisted(() => ({
  mockCreateTable: vi.fn(),
  mockCreateIndex: vi.fn(),
  // Sprint 228 — declared so a vitest spy can assert that the chain
  // does NOT call dropIndex on mid-chain failure (AC-228-07). Not
  // exported in production, but the mock surface needs to expose it
  // so the test can `expect(mockDropIndex).not.toHaveBeenCalled()`.
  mockDropIndex: vi.fn(),
}));

vi.mock("@lib/tauri", () => ({
  createTable: mockCreateTable,
  createIndex: mockCreateIndex,
  dropIndex: mockDropIndex,
}));

import CreateTableDialog from "./CreateTableDialog";
import { useConnectionStore } from "@stores/connectionStore";
import { useSafeModeStore } from "@stores/safeModeStore";
import { useQueryHistoryStore } from "@stores/queryHistoryStore";

function setProductionConnection() {
  useConnectionStore.setState({
    connections: [
      {
        id: "conn-1",
        name: "prod",
        db_type: "postgres",
        host: "localhost",
        port: 5432,
        database: "app",
        username: "u",
        password: null,
        environment: "production",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    ],
  });
}

function setDevConnection() {
  useConnectionStore.setState({
    connections: [
      {
        id: "conn-1",
        name: "dev",
        db_type: "postgres",
        host: "localhost",
        port: 5432,
        database: "app",
        username: "u",
        password: null,
        environment: "development",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    ],
  });
}

function renderDialog(
  overrides: Partial<{
    onClose: () => void;
    onRefresh: () => Promise<void>;
    schemaName: string;
    availableSchemas: string[];
  }> = {},
) {
  const onClose = overrides.onClose ?? vi.fn();
  const onRefresh = overrides.onRefresh ?? vi.fn().mockResolvedValue(undefined);
  const schemaName = overrides.schemaName ?? "public";
  const availableSchemas = overrides.availableSchemas;
  const view = render(
    <CreateTableDialog
      connectionId="conn-1"
      schemaName={schemaName}
      availableSchemas={availableSchemas}
      open
      onClose={onClose}
      onRefresh={onRefresh}
    />,
  );
  return { ...view, onClose, onRefresh };
}

function getColumnsPanel(): HTMLElement {
  // Tabs primitive renders inactive panels with hidden=true; the
  // active panel has data-state="active". Scope queries to the active
  // Columns panel so we don't pick up the Keys-tab PK label list.
  return document.querySelector(
    '[data-testid="create-table-columns-panel"]',
  ) as HTMLElement;
}

function getKeysPanel(): HTMLElement {
  return document.querySelector(
    '[data-testid="create-table-keys-panel"]',
  ) as HTMLElement;
}

function activateTab(label: string) {
  fireEvent.click(screen.getByRole("tab", { name: label }));
}

describe("CreateTableDialog (Sprint 226 carry-over → Sprint 227 tab migration)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConnectionStore.setState({ connections: [] });
    useSafeModeStore.setState({ mode: "off" });
    useQueryHistoryStore.setState({ entries: [] });
  });

  // ── AC-226-03 form behaviour (Sprint 226 carry-over, tab-aware) ────

  it("opens with exactly one empty column row", () => {
    renderDialog();
    const columnsPanel = getColumnsPanel();
    const colNameInputs = within(columnsPanel).getAllByLabelText("Column name");
    expect(colNameInputs).toHaveLength(1);
  });

  it("adds a row when '+ Column' is clicked", () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /Add column/i }));
    const columnsPanel = getColumnsPanel();
    expect(within(columnsPanel).getAllByLabelText("Column name")).toHaveLength(
      2,
    );
  });

  it("removes a row when '−' is clicked but blocks the last one", () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /Add column/i }));
    const columnsPanel = getColumnsPanel();
    expect(within(columnsPanel).getAllByLabelText("Column name")).toHaveLength(
      2,
    );

    const removeButtons = within(columnsPanel).getAllByRole("button", {
      name: /Remove column/i,
    });
    fireEvent.click(removeButtons[1]!);
    expect(within(columnsPanel).getAllByLabelText("Column name")).toHaveLength(
      1,
    );

    // Last-row remove is disabled.
    const lastRemove = within(columnsPanel).getByRole("button", {
      name: /Remove column/i,
    });
    expect(lastRemove).toBeDisabled();
  });

  it("PK multi-select reflects column names live (Keys tab)", () => {
    renderDialog();
    // Type a column name on the Columns tab.
    const columnsPanel = getColumnsPanel();
    const colNameInput = within(columnsPanel).getByLabelText("Column name");
    fireEvent.change(colNameInput, { target: { value: "id" } });

    // Switch to Keys tab to see the PK option.
    activateTab("Keys");
    const keysPanel = getKeysPanel();
    expect(
      within(keysPanel).getByLabelText("Primary key: id"),
    ).toBeInTheDocument();

    // Add a second column on the Columns tab and verify Keys tab
    // updates live.
    activateTab("Columns");
    fireEvent.click(screen.getByRole("button", { name: /Add column/i }));
    const inputs = within(getColumnsPanel()).getAllByLabelText("Column name");
    fireEvent.change(inputs[1]!, { target: { value: "tenant_id" } });

    activateTab("Keys");
    expect(
      within(getKeysPanel()).getByLabelText("Primary key: tenant_id"),
    ).toBeInTheDocument();
  });

  // ── AC-226-04 → AC-227-07 preview→commit IPC pipeline ─────────────

  async function fillSimpleForm() {
    fireEvent.change(screen.getByLabelText("Table name"), {
      target: { value: "events" },
    });
    const columnsPanel = getColumnsPanel();
    fireEvent.change(within(columnsPanel).getByLabelText("Column name"), {
      target: { value: "id" },
    });
    fireEvent.change(within(columnsPanel).getByLabelText("Column data type"), {
      target: { value: "integer" },
    });
  }

  it("issues preview→commit calls in exactly the [{preview_only:true},{preview_only:false}] sequence (AC-227-07 / AC-227-08)", async () => {
    setDevConnection();
    useSafeModeStore.setState({ mode: "off" });
    mockCreateTable.mockImplementation(async () => {
      return {
        sql: 'CREATE TABLE "public"."events" ("id" integer)',
      };
    });

    renderDialog();
    await fillSimpleForm();

    // Sprint 227 — Show DDL drives the preview fetch (no separate
    // "Preview SQL" button in the footer).
    fireEvent.click(screen.getByRole("button", { name: "Show DDL" }));
    await waitFor(() => {
      expect(mockCreateTable).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole("button", { name: "Execute" }));

    await waitFor(() => {
      expect(mockCreateTable).toHaveBeenCalledTimes(2);
    });

    const calls = mockCreateTable.mock.calls;
    expect(calls[0]![0]).toMatchObject({
      preview_only: true,
      schema: "public",
      name: "events",
    });
    expect(calls[1]![0]).toMatchObject({
      preview_only: false,
      schema: "public",
      name: "events",
    });
    expect((calls[0]![0] as { preview_only: boolean }).preview_only).toBe(true);
    expect((calls[1]![0] as { preview_only: boolean }).preview_only).toBe(
      false,
    );
  });

  it("records a useQueryHistoryStore entry with source 'ddl-structure' on commit success", async () => {
    setDevConnection();
    useSafeModeStore.setState({ mode: "off" });
    mockCreateTable.mockResolvedValue({
      sql: 'CREATE TABLE "public"."events" ("id" integer)',
    });

    renderDialog();
    await fillSimpleForm();

    fireEvent.click(screen.getByRole("button", { name: "Show DDL" }));
    await waitFor(() => expect(mockCreateTable).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Execute" }));

    await waitFor(() => {
      const entries = useQueryHistoryStore.getState().entries;
      expect(
        entries.some(
          (e) => e.source === "ddl-structure" && e.status === "success",
        ),
      ).toBe(true);
    });
  });

  it("surfaces the canonical Safe Mode warn-cancel message verbatim in previewError", async () => {
    setProductionConnection();
    useSafeModeStore.setState({ mode: "warn" });
    // Force the warn dialog by feeding a DROP statement preview.
    mockCreateTable.mockResolvedValue({
      sql: 'DROP TABLE "public"."events"',
    });

    renderDialog();
    await fillSimpleForm();

    fireEvent.click(screen.getByRole("button", { name: "Show DDL" }));
    await waitFor(() => expect(mockCreateTable).toHaveBeenCalledTimes(1));

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Execute" }));
    });

    await screen.findByText("Confirm dangerous statement");
    const alertDialog = document.querySelector(
      '[data-slot="alert-dialog-content"]',
    ) as HTMLElement;
    const cancelBtn = Array.from(alertDialog.querySelectorAll("button")).find(
      (b) => b.textContent === "Cancel",
    );
    act(() => {
      cancelBtn?.click();
    });

    // Byte-equivalent canonical message (Sprint 226 carry-over,
    // verbatim per AC-227-08).
    await screen.findByText(
      "Safe Mode (warn): confirmation cancelled — no changes committed",
    );
    const calls = mockCreateTable.mock.calls;
    expect(
      calls.some(
        (c) => (c[0] as { preview_only: boolean }).preview_only === false,
      ),
    ).toBe(false);
  });

  it("blocks commit closure entirely when Safe Mode is strict and statement is dangerous", async () => {
    setProductionConnection();
    useSafeModeStore.setState({ mode: "strict" });
    mockCreateTable.mockResolvedValue({
      sql: 'DROP TABLE "public"."events"',
    });

    renderDialog();
    await fillSimpleForm();

    fireEvent.click(screen.getByRole("button", { name: "Show DDL" }));
    await waitFor(() => expect(mockCreateTable).toHaveBeenCalledTimes(1));

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Execute" }));
    });

    await screen.findByText(/Safe Mode blocked/);
    const calls = mockCreateTable.mock.calls;
    expect(
      calls.some(
        (c) => (c[0] as { preview_only: boolean }).preview_only === false,
      ),
    ).toBe(false);
  });

  it("calls onRefresh + onClose after a successful commit", async () => {
    setDevConnection();
    useSafeModeStore.setState({ mode: "off" });
    mockCreateTable.mockResolvedValue({
      sql: 'CREATE TABLE "public"."events" ("id" integer)',
    });
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();

    renderDialog({ onRefresh, onClose });
    await fillSimpleForm();

    fireEvent.click(screen.getByRole("button", { name: "Show DDL" }));
    await waitFor(() => expect(mockCreateTable).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Execute" }));

    await waitFor(() => {
      expect(onRefresh).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it("forwards the table name + columns + primary_key to the Tauri payload (Sprint 226 carry-over)", async () => {
    setDevConnection();
    useSafeModeStore.setState({ mode: "off" });
    mockCreateTable.mockResolvedValue({
      sql: 'CREATE TABLE "public"."events" ("id" integer NOT NULL, PRIMARY KEY ("id"))',
    });

    renderDialog();
    fireEvent.change(screen.getByLabelText("Table name"), {
      target: { value: "events" },
    });
    const columnsPanel = getColumnsPanel();
    fireEvent.change(within(columnsPanel).getByLabelText("Column name"), {
      target: { value: "id" },
    });
    fireEvent.change(within(columnsPanel).getByLabelText("Column data type"), {
      target: { value: "integer" },
    });
    fireEvent.click(within(columnsPanel).getByLabelText("Column nullable"));
    // Switch to Keys to mark the PK.
    activateTab("Keys");
    fireEvent.click(within(getKeysPanel()).getByLabelText("Primary key: id"));

    fireEvent.click(screen.getByRole("button", { name: "Show DDL" }));
    await waitFor(() => expect(mockCreateTable).toHaveBeenCalledTimes(1));

    const previewCall = mockCreateTable.mock.calls[0]![0] as {
      schema: string;
      name: string;
      columns: Array<{
        name: string;
        data_type: string;
        nullable: boolean;
        default_value: string | null;
        comment?: string;
      }>;
      primary_key: string[] | null;
      preview_only: boolean;
    };
    expect(previewCall.schema).toBe("public");
    expect(previewCall.name).toBe("events");
    // Sprint 227 — `comment` field is omitted when blank (per the
    // dialog's `buildRequest`); the canonical Sprint 226 shape is
    // preserved byte-equivalent.
    expect(previewCall.columns).toEqual([
      {
        name: "id",
        data_type: "integer",
        nullable: false,
        default_value: null,
      },
    ]);
    expect(previewCall.primary_key).toEqual(["id"]);
    expect(previewCall.preview_only).toBe(true);
  });

  // ── AC-227-01 Tabs layout ─────────────────────────────────────────

  it("renders exactly four tabs labelled Columns / Keys / Indexes / Foreign Keys (AC-227-01)", () => {
    renderDialog();
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(4);
    const labels = tabs.map((t) => t.textContent?.trim());
    expect(labels).toEqual(["Columns", "Keys", "Indexes", "Foreign Keys"]);
  });

  it("Indexes tab no longer renders the Sprint 227 placeholder (AC-227-01 superseded by AC-228-01)", () => {
    // Sprint 228 — the AC-227-01 placeholder body
    // (`"Available in Sprint 228"`) was removed in favour of the
    // interactive editor (AC-228-01). Assertion intentionally flipped:
    // the editor's `+ Index` button must surface, and the placeholder
    // string must be gone from the panel. The Foreign Keys tab keeps
    // its own placeholder (`"Available in Sprint 229"`) — guarded by
    // its sibling test below.
    renderDialog();
    activateTab("Indexes");
    const panel = document.querySelector(
      '[data-testid="create-table-indexes-panel"]',
    ) as HTMLElement;
    expect(panel.textContent).not.toContain("Available in Sprint 228");
    expect(
      within(panel).getByRole("button", { name: /Add index/i }),
    ).toBeInTheDocument();
  });

  it("Foreign Keys tab renders 'Available in Sprint 229' placeholder and zero textboxes (AC-227-01)", () => {
    renderDialog();
    activateTab("Foreign Keys");
    const panel = document.querySelector(
      '[data-testid="create-table-foreign-keys-panel"]',
    ) as HTMLElement;
    expect(panel.textContent).toContain("Available in Sprint 229");
    expect(within(panel).queryAllByRole("textbox")).toHaveLength(0);
  });

  // ── AC-227-02 Target schema picker ────────────────────────────────

  it("renders a 'Target schema' dropdown with the pre-filled schema as default (AC-227-02)", () => {
    renderDialog({ availableSchemas: ["public", "analytics"] });
    const trigger = screen.getByRole("combobox", { name: "Target schema" });
    expect(trigger).toBeInTheDocument();
    expect(trigger.textContent).toContain("public");
  });

  it("changing the Target schema dropdown updates the Tauri payload schema field on next preview (AC-227-02)", async () => {
    setDevConnection();
    useSafeModeStore.setState({ mode: "off" });
    mockCreateTable.mockResolvedValue({
      sql: 'CREATE TABLE "analytics"."events" ("id" integer)',
    });
    renderDialog({ availableSchemas: ["public", "analytics"] });
    await fillSimpleForm();

    // Open the schema dropdown and pick "analytics".
    fireEvent.click(screen.getByRole("combobox", { name: "Target schema" }));
    // Radix Select renders the listbox as a portal — the option
    // appears as a `option` role.
    const analyticsOption = await screen.findByRole("option", {
      name: "analytics",
    });
    fireEvent.click(analyticsOption);

    fireEvent.click(screen.getByRole("button", { name: "Show DDL" }));
    await waitFor(() => expect(mockCreateTable).toHaveBeenCalledTimes(1));
    const call = mockCreateTable.mock.calls[0]![0] as { schema: string };
    expect(call.schema).toBe("analytics");
  });

  it("dropdown lists ≥ 2 schemas when availableSchemas has multiple entries (AC-227-02)", async () => {
    renderDialog({
      availableSchemas: ["public", "analytics", "audit"],
    });
    fireEvent.click(screen.getByRole("combobox", { name: "Target schema" }));
    // All schemas surface as options.
    expect(
      await screen.findByRole("option", { name: "public" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "analytics" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "audit" })).toBeInTheDocument();
  });

  // ── AC-227-03 Type combobox ───────────────────────────────────────

  it("per-column data-type input renders as a combobox role (AC-227-03)", () => {
    renderDialog();
    const columnsPanel = getColumnsPanel();
    const combobox = within(columnsPanel).getByRole("combobox", {
      name: "Column data type",
    });
    expect(combobox).toBeInTheDocument();
  });

  it("typing 'numeric(10,4)' in the type combobox commits the verbatim free-text on the column row (AC-227-03)", async () => {
    setDevConnection();
    useSafeModeStore.setState({ mode: "off" });
    mockCreateTable.mockResolvedValue({
      sql: 'CREATE TABLE "public"."events" ("id" numeric(10,4))',
    });
    renderDialog();
    fireEvent.change(screen.getByLabelText("Table name"), {
      target: { value: "events" },
    });
    const columnsPanel = getColumnsPanel();
    fireEvent.change(within(columnsPanel).getByLabelText("Column name"), {
      target: { value: "id" },
    });
    const typeInput = within(columnsPanel).getByRole("combobox", {
      name: "Column data type",
    });
    fireEvent.focus(typeInput);
    fireEvent.change(typeInput, { target: { value: "numeric(10,4)" } });
    fireEvent.blur(typeInput);

    fireEvent.click(screen.getByRole("button", { name: "Show DDL" }));
    await waitFor(() => expect(mockCreateTable).toHaveBeenCalledTimes(1));
    const call = mockCreateTable.mock.calls[0]![0] as {
      columns: Array<{ data_type: string }>;
    };
    expect(call.columns[0]?.data_type).toBe("numeric(10,4)");
  });

  // ── AC-227-04 Column comment input + COMMENT ON SQL emission ─────

  it("each column row renders a 'Column comment' input with the right placeholder (AC-227-04)", () => {
    renderDialog();
    const columnsPanel = getColumnsPanel();
    const commentInput = within(columnsPanel).getByLabelText("Column comment");
    expect(commentInput).toBeInTheDocument();
    expect(commentInput.getAttribute("placeholder")).toBe("comment (optional)");
  });

  it("sets the `comment` field on the Tauri payload when a non-empty comment is provided (AC-227-04)", async () => {
    setDevConnection();
    useSafeModeStore.setState({ mode: "off" });
    mockCreateTable.mockResolvedValue({
      sql: 'CREATE TABLE "public"."events" ("id" integer); COMMENT ON COLUMN "public"."events"."id" IS \'pk\';',
    });
    renderDialog();
    fireEvent.change(screen.getByLabelText("Table name"), {
      target: { value: "events" },
    });
    const columnsPanel = getColumnsPanel();
    fireEvent.change(within(columnsPanel).getByLabelText("Column name"), {
      target: { value: "id" },
    });
    fireEvent.change(within(columnsPanel).getByLabelText("Column data type"), {
      target: { value: "integer" },
    });
    fireEvent.change(within(columnsPanel).getByLabelText("Column comment"), {
      target: { value: "primary key" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Show DDL" }));
    await waitFor(() => expect(mockCreateTable).toHaveBeenCalledTimes(1));
    const call = mockCreateTable.mock.calls[0]![0] as {
      columns: Array<{ comment?: string }>;
    };
    expect(call.columns[0]?.comment).toBe("primary key");
  });

  // ── AC-227-05 Inline DDL Preview pane ─────────────────────────────

  it("clicking 'Show DDL' fires exactly one tauri.createTable({preview_only:true}) and surfaces the SQL inline (AC-227-05)", async () => {
    setDevConnection();
    useSafeModeStore.setState({ mode: "off" });
    mockCreateTable.mockResolvedValue({
      sql: 'CREATE TABLE "public"."events" ("id" integer); COMMENT ON COLUMN "public"."events"."id" IS \'pk\';',
    });
    renderDialog();
    await fillSimpleForm();
    const columnsPanel = getColumnsPanel();
    fireEvent.change(within(columnsPanel).getByLabelText("Column comment"), {
      target: { value: "pk" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Show DDL" }));
    await waitFor(() => expect(mockCreateTable).toHaveBeenCalledTimes(1));
    expect(
      (mockCreateTable.mock.calls[0]![0] as { preview_only: boolean })
        .preview_only,
    ).toBe(true);

    // Inline preview pane shows CREATE TABLE + COMMENT ON.
    const previewPane = document.querySelector(
      "#create-table-ddl-preview",
    ) as HTMLElement;
    expect(previewPane).toBeTruthy();
    expect(previewPane.textContent).toContain("CREATE TABLE");
    expect(previewPane.textContent).toContain("COMMENT ON");
  });

  it("editing a field after preview invalidates the cached preview — next 'Show DDL' triggers a 2nd preview call (AC-227-05)", async () => {
    setDevConnection();
    useSafeModeStore.setState({ mode: "off" });
    mockCreateTable.mockResolvedValue({
      sql: 'CREATE TABLE "public"."events" ("id" integer)',
    });
    renderDialog();
    await fillSimpleForm();

    fireEvent.click(screen.getByRole("button", { name: "Show DDL" }));
    await waitFor(() => expect(mockCreateTable).toHaveBeenCalledTimes(1));

    // Edit the table name → cache invalidated, pane collapses.
    fireEvent.change(screen.getByLabelText("Table name"), {
      target: { value: "events_v2" },
    });
    // Show DDL again triggers a 2nd preview fetch.
    fireEvent.click(screen.getByRole("button", { name: "Show DDL" }));
    await waitFor(() => expect(mockCreateTable).toHaveBeenCalledTimes(2));
  });

  // ── AC-227-07 Footer + Safe Mode parity ──────────────────────────

  it("footer renders only one Execute button and no 'Preview SQL' button (AC-227-07)", () => {
    renderDialog();
    expect(screen.queryByRole("button", { name: /Preview SQL/i })).toBeNull();
    expect(screen.getAllByRole("button", { name: /^Execute$/ })).toHaveLength(
      1,
    );
  });
});

// ── Sprint 228 — Indexes tab functional ─────────────────────────────────
//
// Date: 2026-05-07.
//
// Why this block exists:
//
// Sprint 227 left the Indexes tab as a `"Available in Sprint 228"`
// placeholder. Sprint 228 closes that loop:
//
// - Replace placeholder body with editor (`+ Index` / `−` row buttons,
//   per-row index name input + columns multi-checkbox + index type
//   `<Select>` [btree/hash/gin/gist] + unique checkbox).
// - On Show DDL, fan out N preview-only `tauri.createIndex` calls
//   alongside the canonical `tauri.createTable({preview_only:true})`
//   so the inline preview pane shows CREATE TABLE + COMMENT ON × N +
//   CREATE INDEX × M joined by `;\n`.
// - On Execute, after `tauri.createTable({preview_only:false})` returns,
//   sequentially `await tauri.createIndex({preview_only:false, …})` per
//   declared index (partial-atomic policy C — DataGrip pattern).
// - Index failure halts the chain but does NOT roll back the CREATE
//   TABLE; the failing index name surfaces verbatim in the inline
//   preview pane error slot (`Index "<name>" failed: <pg error>`).
// - PK auto-emission deduplication — when an Indexes-tab row's
//   `columns` array exactly matches the declared PK array, the chain
//   skips `tauri.createIndex` for that row (PG implicitly indexes PKs).
//
// Source: `docs/sprints/sprint-228/contract.md` AC-228-01..AC-228-11.

describe("Sprint 228 — Indexes tab functional", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConnectionStore.setState({ connections: [] });
    useSafeModeStore.setState({ mode: "off" });
    useQueryHistoryStore.setState({ entries: [] });
  });

  function getIndexesPanel(): HTMLElement {
    return document.querySelector(
      '[data-testid="create-table-indexes-panel"]',
    ) as HTMLElement;
  }

  // Wires up a 2-column form (id integer / email text) and switches to
  // the Indexes tab so the test body can exercise index-row inputs.
  async function fillTwoColumnFormAndOpenIndexesTab() {
    fireEvent.change(screen.getByLabelText("Table name"), {
      target: { value: "users" },
    });
    const columnsPanel = getColumnsPanel();
    const colNameInputs = within(columnsPanel).getAllByLabelText("Column name");
    fireEvent.change(colNameInputs[0]!, { target: { value: "id" } });
    fireEvent.change(
      within(columnsPanel).getAllByLabelText("Column data type")[0]!,
      { target: { value: "integer" } },
    );
    // Add a second row.
    fireEvent.click(screen.getByRole("button", { name: /Add column/i }));
    const inputs2 = within(getColumnsPanel()).getAllByLabelText("Column name");
    fireEvent.change(inputs2[1]!, { target: { value: "email" } });
    fireEvent.change(
      within(getColumnsPanel()).getAllByLabelText("Column data type")[1]!,
      { target: { value: "text" } },
    );
    activateTab("Indexes");
  }

  function addIndexRow() {
    fireEvent.click(screen.getByRole("button", { name: /Add index/i }));
  }

  // ── AC-228-01 placeholder removed ────────────────────────────────

  it("Indexes tab no longer renders the 'Available in Sprint 228' placeholder (AC-228-01)", () => {
    renderDialog();
    activateTab("Indexes");
    const panel = getIndexesPanel();
    expect(panel.textContent).not.toContain("Available in Sprint 228");
    // `+ Index` button surfaces — proves the editor body mounted.
    expect(
      within(panel).getByRole("button", { name: /Add index/i }),
    ).toBeInTheDocument();
  });

  // ── AC-228-02 add / remove rows + 0-row default ──────────────────

  it("Indexes tab default state has zero index rows (AC-228-02)", () => {
    renderDialog();
    activateTab("Indexes");
    const panel = getIndexesPanel();
    // No Index name inputs by default — index editor is opt-in.
    expect(within(panel).queryAllByLabelText("Index name")).toHaveLength(0);
  });

  it("'+ Index' adds an index row; '−' removes it (AC-228-02)", () => {
    renderDialog();
    activateTab("Indexes");
    addIndexRow();
    let panel = getIndexesPanel();
    expect(within(panel).getAllByLabelText("Index name")).toHaveLength(1);
    addIndexRow();
    panel = getIndexesPanel();
    expect(within(panel).getAllByLabelText("Index name")).toHaveLength(2);

    const removeBtns = within(panel).getAllByRole("button", {
      name: /Remove index/i,
    });
    fireEvent.click(removeBtns[1]!);
    panel = getIndexesPanel();
    expect(within(panel).getAllByLabelText("Index name")).toHaveLength(1);
  });

  // ── AC-228-03 per-row inputs + live column derivation ────────────

  it("index type `<Select>` exposes exactly btree | hash | gin | gist (AC-228-03)", async () => {
    renderDialog();
    activateTab("Indexes");
    addIndexRow();
    const panel = getIndexesPanel();
    fireEvent.click(
      within(panel).getByRole("combobox", { name: "Index type" }),
    );
    const labels = ["btree", "hash", "gin", "gist"];
    for (const label of labels) {
      expect(
        await screen.findByRole("option", { name: label }),
      ).toBeInTheDocument();
    }
    // No `brin` option — backend accepts but UI hides per contract.
    expect(screen.queryByRole("option", { name: "brin" })).toBeNull();
  });

  it("renaming a column on the Columns tab updates the index columns checkbox label live (AC-228-03)", () => {
    renderDialog();
    // First, type an initial column name on Columns.
    const columnsPanel = getColumnsPanel();
    const nameInput = within(columnsPanel).getByLabelText("Column name");
    fireEvent.change(nameInput, { target: { value: "email" } });

    activateTab("Indexes");
    addIndexRow();
    let panel = getIndexesPanel();
    expect(
      within(panel).getByLabelText("Index column: email"),
    ).toBeInTheDocument();

    // Rename the column on Columns tab.
    activateTab("Columns");
    const renamed = within(getColumnsPanel()).getByLabelText("Column name");
    fireEvent.change(renamed, { target: { value: "email_address" } });

    activateTab("Indexes");
    panel = getIndexesPanel();
    expect(
      within(panel).getByLabelText("Index column: email_address"),
    ).toBeInTheDocument();
    expect(within(panel).queryByLabelText("Index column: email")).toBeNull();
  });

  // ── AC-228-04 multi-statement preview (Show DDL) ─────────────────

  it("Show DDL fans out createTable(preview) + createIndex(preview) per declared row (AC-228-04)", async () => {
    setDevConnection();
    useSafeModeStore.setState({ mode: "off" });
    mockCreateTable.mockResolvedValue({
      sql: 'CREATE TABLE "public"."users" ("id" integer, "email" text)',
    });
    mockCreateIndex.mockResolvedValue({
      sql: 'CREATE INDEX "idx_users_email" ON "public"."users" USING btree ("email")',
    });

    renderDialog();
    await fillTwoColumnFormAndOpenIndexesTab();
    addIndexRow();

    const panel = getIndexesPanel();
    fireEvent.change(within(panel).getByLabelText("Index name"), {
      target: { value: "idx_users_email" },
    });
    fireEvent.click(within(panel).getByLabelText("Index column: email"));

    fireEvent.click(screen.getByRole("button", { name: "Show DDL" }));
    await waitFor(() => {
      expect(mockCreateTable).toHaveBeenCalledTimes(1);
      expect(mockCreateIndex).toHaveBeenCalledTimes(1);
    });
    expect(
      (mockCreateTable.mock.calls[0]![0] as { preview_only: boolean })
        .preview_only,
    ).toBe(true);
    const indexCall = mockCreateIndex.mock.calls[0]![0] as {
      preview_only: boolean;
      index_name: string;
      columns: string[];
      index_type: string;
      is_unique?: boolean;
    };
    expect(indexCall.preview_only).toBe(true);
    expect(indexCall.index_name).toBe("idx_users_email");
    expect(indexCall.columns).toEqual(["email"]);
    expect(indexCall.index_type).toBe("btree");

    const previewPane = document.querySelector(
      "#create-table-ddl-preview",
    ) as HTMLElement;
    expect(previewPane.textContent).toContain("CREATE TABLE");
    expect(previewPane.textContent).toContain("CREATE INDEX");
  });

  // ── AC-228-05 chained Execute happy path ─────────────────────────

  it("Execute chains createTable + createIndex × 2 sequentially with one history entry (AC-228-05)", async () => {
    setDevConnection();
    useSafeModeStore.setState({ mode: "off" });
    mockCreateTable.mockResolvedValue({
      sql: 'CREATE TABLE "public"."users" ("id" integer, "email" text)',
    });
    let inflight = 0;
    let maxConcurrent = 0;
    mockCreateIndex.mockImplementation(async (req: { index_name: string }) => {
      inflight += 1;
      if (inflight > maxConcurrent) maxConcurrent = inflight;
      // Yield once so a parallel call would be observable.
      await new Promise<void>((r) => setTimeout(r, 0));
      inflight -= 1;
      return {
        sql: `CREATE INDEX "${req.index_name}" ON "public"."users" USING btree ("email")`,
      };
    });

    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    renderDialog({ onRefresh, onClose });
    await fillTwoColumnFormAndOpenIndexesTab();

    addIndexRow();
    let panel = getIndexesPanel();
    const firstName = within(panel).getAllByLabelText("Index name")[0]!;
    fireEvent.change(firstName, { target: { value: "idx_email" } });
    fireEvent.click(within(panel).getByLabelText("Index column: email"));

    addIndexRow();
    panel = getIndexesPanel();
    const secondName = within(panel).getAllByLabelText("Index name")[1]!;
    fireEvent.change(secondName, { target: { value: "idx_id" } });
    const idCheckboxes = within(panel).getAllByLabelText("Index column: id");
    fireEvent.click(idCheckboxes[idCheckboxes.length - 1]!);

    fireEvent.click(screen.getByRole("button", { name: "Show DDL" }));
    await waitFor(() => {
      expect(mockCreateTable).toHaveBeenCalledTimes(1);
      expect(mockCreateIndex).toHaveBeenCalledTimes(2);
    });

    fireEvent.click(screen.getByRole("button", { name: "Execute" }));
    await waitFor(() => {
      expect(mockCreateTable).toHaveBeenCalledTimes(2);
      expect(mockCreateIndex).toHaveBeenCalledTimes(4);
    });
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));

    // Sequential, not parallel — at most 1 createIndex in-flight.
    expect(maxConcurrent).toBeLessThanOrEqual(1);

    // 1 history entry, regardless of M.
    const entries = useQueryHistoryStore.getState().entries;
    expect(entries.filter((e) => e.source === "ddl-structure")).toHaveLength(1);

    // Sequence: preview-only first, then commit.
    const commitTable = mockCreateTable.mock.calls[1]![0] as {
      preview_only: boolean;
    };
    expect(commitTable.preview_only).toBe(false);
    const commitIndexCalls = mockCreateIndex.mock.calls.slice(2);
    expect(commitIndexCalls).toHaveLength(2);
    for (const c of commitIndexCalls) {
      expect((c[0] as { preview_only: boolean }).preview_only).toBe(false);
    }
  });

  // ── AC-228-06 first index fails — table stays applied ───────────

  it("first createIndex(commit) rejection halts chain, modal stays open, error names failing index (AC-228-06)", async () => {
    setDevConnection();
    useSafeModeStore.setState({ mode: "off" });
    mockCreateTable.mockResolvedValue({
      sql: 'CREATE TABLE "public"."users" ("id" integer, "email" text)',
    });
    let createIndexCallCount = 0;
    mockCreateIndex.mockImplementation(
      async (req: { preview_only: boolean; index_name: string }) => {
        if (req.preview_only) {
          return {
            sql: `CREATE INDEX "${req.index_name}" ON "public"."users" USING btree ("email")`,
          };
        }
        createIndexCallCount += 1;
        // Reject the first commit-time call.
        if (createIndexCallCount === 1) {
          throw new Error('relation "idx_dup" already exists');
        }
        return {
          sql: `CREATE INDEX "${req.index_name}" ON "public"."users" USING btree ("email")`,
        };
      },
    );

    const onClose = vi.fn();
    renderDialog({ onClose });
    await fillTwoColumnFormAndOpenIndexesTab();

    addIndexRow();
    let panel = getIndexesPanel();
    fireEvent.change(within(panel).getAllByLabelText("Index name")[0]!, {
      target: { value: "idx_first" },
    });
    fireEvent.click(within(panel).getByLabelText("Index column: email"));

    addIndexRow();
    panel = getIndexesPanel();
    fireEvent.change(within(panel).getAllByLabelText("Index name")[1]!, {
      target: { value: "idx_second" },
    });
    const idCheckboxes = within(panel).getAllByLabelText("Index column: id");
    fireEvent.click(idCheckboxes[idCheckboxes.length - 1]!);

    fireEvent.click(screen.getByRole("button", { name: "Show DDL" }));
    await waitFor(() => expect(mockCreateIndex).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole("button", { name: "Execute" }));

    // Wait for the chain to reject.
    await waitFor(() => {
      const previewPane = document.querySelector(
        "#create-table-ddl-preview",
      ) as HTMLElement;
      expect(previewPane.textContent).toContain("idx_first");
    });

    // Only the first commit-time createIndex was called; the second
    // never fires because the chain aborts.
    const commitCalls = mockCreateIndex.mock.calls.filter(
      (c) => (c[0] as { preview_only: boolean }).preview_only === false,
    );
    expect(commitCalls).toHaveLength(1);
    expect((commitCalls[0]![0] as { index_name: string }).index_name).toBe(
      "idx_first",
    );

    // CREATE TABLE was NOT rolled back from the frontend — no extra
    // table-related calls beyond preview + commit.
    expect(mockCreateTable).toHaveBeenCalledTimes(2);

    // Modal stays open.
    expect(onClose).not.toHaveBeenCalled();

    // No dropIndex rollback.
    expect(mockDropIndex).not.toHaveBeenCalled();
  });

  // ── AC-228-07 second index fails — first stays applied ──────────

  it("mid-chain rejection leaves earlier index applied (no dropIndex rollback) (AC-228-07)", async () => {
    setDevConnection();
    useSafeModeStore.setState({ mode: "off" });
    mockCreateTable.mockResolvedValue({
      sql: 'CREATE TABLE "public"."users" ("id" integer, "email" text)',
    });
    let commitIndexCount = 0;
    mockCreateIndex.mockImplementation(
      async (req: { preview_only: boolean; index_name: string }) => {
        if (req.preview_only) {
          return {
            sql: `CREATE INDEX "${req.index_name}" ON "public"."users" USING btree ("email")`,
          };
        }
        commitIndexCount += 1;
        if (commitIndexCount === 2) {
          throw new Error("disk full");
        }
        return {
          sql: `CREATE INDEX "${req.index_name}" ON "public"."users" USING btree ("email")`,
        };
      },
    );

    renderDialog();
    await fillTwoColumnFormAndOpenIndexesTab();

    // Three rows.
    for (let i = 0; i < 3; i += 1) addIndexRow();
    let panel = getIndexesPanel();
    const nameInputs = within(panel).getAllByLabelText("Index name");
    ["idx_a", "idx_b", "idx_c"].forEach((n, i) => {
      fireEvent.change(nameInputs[i]!, { target: { value: n } });
    });
    // Each row picks the email column. The checkbox group is row-scoped
    // (one group per row) — pick the first email checkbox of every row
    // by walking the sequential aria-labelled nodes.
    const emailBoxes = within(panel).getAllByLabelText("Index column: email");
    expect(emailBoxes.length).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < 3; i += 1) fireEvent.click(emailBoxes[i]!);

    fireEvent.click(screen.getByRole("button", { name: "Show DDL" }));
    await waitFor(() => expect(mockCreateIndex).toHaveBeenCalledTimes(3));

    fireEvent.click(screen.getByRole("button", { name: "Execute" }));

    await waitFor(() => {
      const previewPane = document.querySelector(
        "#create-table-ddl-preview",
      ) as HTMLElement;
      expect(previewPane.textContent).toContain("idx_b");
    });

    const commitCalls = mockCreateIndex.mock.calls.filter(
      (c) => (c[0] as { preview_only: boolean }).preview_only === false,
    );
    expect(commitCalls).toHaveLength(2);
    expect((commitCalls[0]![0] as { index_name: string }).index_name).toBe(
      "idx_a",
    );
    expect((commitCalls[1]![0] as { index_name: string }).index_name).toBe(
      "idx_b",
    );
    // 3rd never fired.
    panel = getIndexesPanel();
    expect(mockDropIndex).not.toHaveBeenCalled();
  });

  // ── AC-228-08 PK auto-emission deduplication ─────────────────────

  it("PK exact match dedup — no createIndex emitted for the row (AC-228-08)", async () => {
    setDevConnection();
    useSafeModeStore.setState({ mode: "off" });
    mockCreateTable.mockResolvedValue({
      sql: 'CREATE TABLE "public"."users" ("id" integer NOT NULL, PRIMARY KEY ("id"))',
    });
    mockCreateIndex.mockResolvedValue({
      sql: 'CREATE INDEX "" ON "public"."users" USING btree ("id")',
    });

    renderDialog();
    // 1 column id integer.
    fireEvent.change(screen.getByLabelText("Table name"), {
      target: { value: "users" },
    });
    const columnsPanel = getColumnsPanel();
    fireEvent.change(within(columnsPanel).getByLabelText("Column name"), {
      target: { value: "id" },
    });
    fireEvent.change(within(columnsPanel).getByLabelText("Column data type"), {
      target: { value: "integer" },
    });

    // Mark id as PK on Keys tab.
    activateTab("Keys");
    fireEvent.click(within(getKeysPanel()).getByLabelText("Primary key: id"));

    // Indexes row matching the PK exactly.
    activateTab("Indexes");
    addIndexRow();
    const panel = getIndexesPanel();
    fireEvent.change(within(panel).getByLabelText("Index name"), {
      target: { value: "idx_pk_dup" },
    });
    fireEvent.click(within(panel).getByLabelText("Index column: id"));

    fireEvent.click(screen.getByRole("button", { name: "Show DDL" }));
    await waitFor(() => expect(mockCreateTable).toHaveBeenCalledTimes(1));

    // No createIndex call — row is PK-deduped.
    expect(mockCreateIndex).not.toHaveBeenCalled();

    // Inline note explains skip.
    expect(panel.textContent).toContain("primary key is already indexed");

    fireEvent.click(screen.getByRole("button", { name: "Execute" }));
    await waitFor(() => expect(mockCreateTable).toHaveBeenCalledTimes(2));
    // Still no createIndex call after Execute.
    expect(mockCreateIndex).not.toHaveBeenCalled();
  });

  it("PK partial overlap still emits a CREATE INDEX (AC-228-08)", async () => {
    setDevConnection();
    useSafeModeStore.setState({ mode: "off" });
    mockCreateTable.mockResolvedValue({
      sql: 'CREATE TABLE "public"."users" ("id" integer NOT NULL, "email" text, PRIMARY KEY ("id"))',
    });
    mockCreateIndex.mockResolvedValue({
      sql: 'CREATE INDEX "idx_id_email" ON "public"."users" USING btree ("id", "email")',
    });
    renderDialog();
    await fillTwoColumnFormAndOpenIndexesTab();

    // PK on id.
    activateTab("Keys");
    fireEvent.click(within(getKeysPanel()).getByLabelText("Primary key: id"));

    activateTab("Indexes");
    addIndexRow();
    const panel = getIndexesPanel();
    fireEvent.change(within(panel).getByLabelText("Index name"), {
      target: { value: "idx_id_email" },
    });
    // Pick id + email — superset of PK.
    fireEvent.click(within(panel).getByLabelText("Index column: id"));
    fireEvent.click(within(panel).getByLabelText("Index column: email"));

    fireEvent.click(screen.getByRole("button", { name: "Show DDL" }));
    await waitFor(() => {
      expect(mockCreateIndex).toHaveBeenCalledTimes(1);
    });
    const call = mockCreateIndex.mock.calls[0]![0] as { columns: string[] };
    expect(call.columns).toEqual(["id", "email"]);
  });

  // ── AC-228-09 0-index byte-equivalent regression ─────────────────

  it("0-index IPC sequence is byte-equivalent to Sprint 227 (AC-228-09)", async () => {
    setDevConnection();
    useSafeModeStore.setState({ mode: "off" });
    mockCreateTable.mockResolvedValue({
      sql: 'CREATE TABLE "public"."events" ("id" integer)',
    });

    renderDialog();
    fireEvent.change(screen.getByLabelText("Table name"), {
      target: { value: "events" },
    });
    const columnsPanel = getColumnsPanel();
    fireEvent.change(within(columnsPanel).getByLabelText("Column name"), {
      target: { value: "id" },
    });
    fireEvent.change(within(columnsPanel).getByLabelText("Column data type"), {
      target: { value: "integer" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Show DDL" }));
    await waitFor(() => expect(mockCreateTable).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Execute" }));
    await waitFor(() => expect(mockCreateTable).toHaveBeenCalledTimes(2));

    // No createIndex calls when no index rows declared.
    expect(mockCreateIndex).not.toHaveBeenCalled();
  });

  // ── multi-column + unique flag ──────────────────────────────────

  it("multi-column index forwards columns array in declared order (AC-228-04 / -05)", async () => {
    setDevConnection();
    useSafeModeStore.setState({ mode: "off" });
    mockCreateTable.mockResolvedValue({
      sql: 'CREATE TABLE "public"."users" ("id" integer, "email" text)',
    });
    mockCreateIndex.mockResolvedValue({
      sql: 'CREATE INDEX "idx_multi" ON "public"."users" USING btree ("id", "email")',
    });

    renderDialog();
    await fillTwoColumnFormAndOpenIndexesTab();

    addIndexRow();
    const panel = getIndexesPanel();
    fireEvent.change(within(panel).getByLabelText("Index name"), {
      target: { value: "idx_multi" },
    });
    fireEvent.click(within(panel).getByLabelText("Index column: id"));
    fireEvent.click(within(panel).getByLabelText("Index column: email"));

    fireEvent.click(screen.getByRole("button", { name: "Show DDL" }));
    await waitFor(() => expect(mockCreateIndex).toHaveBeenCalledTimes(1));
    const call = mockCreateIndex.mock.calls[0]![0] as { columns: string[] };
    expect(call.columns).toEqual(["id", "email"]);
  });

  it("unique checkbox flips is_unique on the createIndex payload (AC-228-03 / -05)", async () => {
    setDevConnection();
    useSafeModeStore.setState({ mode: "off" });
    mockCreateTable.mockResolvedValue({
      sql: 'CREATE TABLE "public"."users" ("id" integer, "email" text)',
    });
    mockCreateIndex.mockResolvedValue({
      sql: 'CREATE UNIQUE INDEX "idx_email_uq" ON "public"."users" USING btree ("email")',
    });

    renderDialog();
    await fillTwoColumnFormAndOpenIndexesTab();

    addIndexRow();
    const panel = getIndexesPanel();
    fireEvent.change(within(panel).getByLabelText("Index name"), {
      target: { value: "idx_email_uq" },
    });
    fireEvent.click(within(panel).getByLabelText("Index column: email"));
    fireEvent.click(within(panel).getByLabelText("Index unique"));

    fireEvent.click(screen.getByRole("button", { name: "Show DDL" }));
    await waitFor(() => expect(mockCreateIndex).toHaveBeenCalledTimes(1));
    const call = mockCreateIndex.mock.calls[0]![0] as { is_unique?: boolean };
    expect(call.is_unique).toBe(true);
  });

  // ── canonical Safe Mode warn-cancel survives multi-statement bundle

  it("Safe Mode warn-cancel surfaces the canonical message even with index rows declared (AC-228-11)", async () => {
    setProductionConnection();
    useSafeModeStore.setState({ mode: "warn" });
    mockCreateTable.mockResolvedValue({
      sql: 'DROP TABLE "public"."users"',
    });
    mockCreateIndex.mockResolvedValue({
      sql: 'CREATE INDEX "idx_x" ON "public"."users" USING btree ("email")',
    });

    renderDialog();
    await fillTwoColumnFormAndOpenIndexesTab();
    addIndexRow();
    const panel = getIndexesPanel();
    fireEvent.change(within(panel).getByLabelText("Index name"), {
      target: { value: "idx_x" },
    });
    fireEvent.click(within(panel).getByLabelText("Index column: email"));

    fireEvent.click(screen.getByRole("button", { name: "Show DDL" }));
    await waitFor(() => expect(mockCreateTable).toHaveBeenCalledTimes(1));

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Execute" }));
    });
    await screen.findByText("Confirm dangerous statement");
    const alertDialog = document.querySelector(
      '[data-slot="alert-dialog-content"]',
    ) as HTMLElement;
    const cancelBtn = Array.from(alertDialog.querySelectorAll("button")).find(
      (b) => b.textContent === "Cancel",
    );
    act(() => {
      cancelBtn?.click();
    });

    await screen.findByText(
      "Safe Mode (warn): confirmation cancelled — no changes committed",
    );
  });
});
