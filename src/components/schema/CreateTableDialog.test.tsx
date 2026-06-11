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
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useConnectionStore } from "@stores/connectionStore";
import { useSafeModeStore } from "@stores/safeModeStore";
import { useQueryHistoryStore } from "@stores/queryHistoryStore";
import {
  activateConstraintSubTab,
  activateTab,
  getColumnsPanel,
  getKeysPanel,
  mockCreateTable,
  PRE_PUSH_LOAD_TEST_TIMEOUT_MS,
  renderDialog,
  setDevConnection,
  setProductionConnection,
  STALE_CONSTRAINTS_PLACEHOLDER,
  STALE_INDEX_PLACEHOLDER,
} from "./__tests__/createTableDialogTestHelpers";

describe("CreateTableDialog (Sprint 226 carry-over → Sprint 227 tab migration)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConnectionStore.setState({ connections: [] });
    useSafeModeStore.setState({ mode: "off" });
    useQueryHistoryStore.setState({ recentVisible: [] });
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
    // Sprint 239 — preview pane defaults open; auto-debounced fetch settles via waitFor below.
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

  it(
    "records a useQueryHistoryStore entry with source 'ddl-structure' on commit success",
    async () => {
      setDevConnection();
      useSafeModeStore.setState({ mode: "off" });
      mockCreateTable.mockResolvedValue({
        sql: 'CREATE TABLE "public"."events" ("id" integer)',
      });

      renderDialog();
      await fillSimpleForm();

      // Sprint 239 — preview pane defaults open; auto-debounced fetch settles via waitFor below.
      await waitFor(() => expect(mockCreateTable).toHaveBeenCalledTimes(1));

      fireEvent.click(screen.getByRole("button", { name: "Execute" }));

      await waitFor(() => {
        const entries = useQueryHistoryStore.getState().recentVisible;
        expect(
          entries.some(
            (e) => e.source === "ddl-structure" && e.status === "success",
          ),
        ).toBe(true);
      });
    },
    PRE_PUSH_LOAD_TEST_TIMEOUT_MS,
  );

  it(
    "surfaces the canonical Safe Mode warn-cancel message verbatim in previewError",
    async () => {
      setProductionConnection();
      useSafeModeStore.setState({ mode: "warn" });
      // Force the warn dialog by feeding a DROP statement preview.
      mockCreateTable.mockResolvedValue({
        sql: 'DROP TABLE "public"."events"',
      });

      renderDialog();
      await fillSimpleForm();

      // Sprint 239 — preview pane defaults open; auto-debounced fetch settles via waitFor below.
      await waitFor(() => expect(mockCreateTable).toHaveBeenCalledTimes(1));

      act(() => {
        fireEvent.click(screen.getByRole("button", { name: "Execute" }));
      });

      await screen.findByText("PRODUCTION DATABASE");
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
    },
    PRE_PUSH_LOAD_TEST_TIMEOUT_MS,
  );

  it("opens confirm dialog (does not commit) when Safe Mode is strict and statement is dangerous", async () => {
    // Sprint 245 (ADR 0022 Phase 1) — was "blocks commit closure
    // entirely". The destructive-only policy raises the confirm dialog
    // instead of blocking; commit closure (preview_only=false) still
    // must NOT run until the user confirms.
    setProductionConnection();
    useSafeModeStore.setState({ mode: "strict" });
    mockCreateTable.mockResolvedValue({
      sql: 'DROP TABLE "public"."events"',
    });

    renderDialog();
    await fillSimpleForm();

    // Sprint 239 — preview pane defaults open; auto-debounced fetch settles via waitFor below.
    await waitFor(() => expect(mockCreateTable).toHaveBeenCalledTimes(1));

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Execute" }));
    });

    await screen.findByText("PRODUCTION DATABASE");
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

    // Sprint 239 — preview pane defaults open; auto-debounced fetch settles via waitFor below.
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

    // Sprint 239 — preview pane defaults open; auto-debounced fetch settles via waitFor below.
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

  it("renders exactly four tabs labelled Columns / Keys / Indexes / Constraints (AC-227-01)", () => {
    renderDialog();
    // Sprint 241 split FK / CHECK / UNIQUE into a nested tablist inside
    // the Constraints panel, so the document now has multiple
    // `tablist`s. Scope the count check to the OUTER (first) tablist —
    // the four main tabs — so the sub-tabs don't inflate the count.
    const mainTablist = screen.getAllByRole("tablist")[0]!;
    const tabs = within(mainTablist).getAllByRole("tab");
    expect(tabs).toHaveLength(4);
    const labels = tabs.map((t) => t.textContent?.trim());
    // The fourth tab was renamed `Foreign Keys` → `Constraints` because
    // it actually houses three constraint families (FK + CHECK + UNIQUE).
    expect(labels).toEqual(["Columns", "Keys", "Indexes", "Constraints"]);
  });

  it("Indexes tab no longer renders the Sprint 227 placeholder (AC-227-01 superseded by AC-228-01)", () => {
    // Sprint 228 — the AC-227-01 placeholder body
    // stale Sprint 228 placeholder was removed in favour of the
    // interactive editor (AC-228-01). Assertion intentionally flipped:
    // the editor's `+ Index` button must surface, and the placeholder
    // string must be gone from the panel. The Foreign Keys tab keeps
    // its own stale Sprint 229 placeholder — guarded by
    // its sibling test below.
    renderDialog();
    activateTab("Indexes");
    const panel = document.querySelector(
      '[data-testid="create-table-indexes-panel"]',
    ) as HTMLElement;
    expect(panel.textContent).not.toContain(STALE_INDEX_PLACEHOLDER);
    expect(
      within(panel).getByRole("button", { name: /Add index/i }),
    ).toBeInTheDocument();
  });

  it("Foreign Keys tab no longer renders the Sprint 228 placeholder (AC-227-01 superseded by AC-229-01)", async () => {
    // Sprint 229 — the AC-227-01 Foreign Keys placeholder body
    // stale Sprint 229 placeholder was removed in favour of the
    // interactive editor (AC-229-01). Sprint 241 — split into 3
    // sub-tabs (FK / CHECK / UNIQUE), so each family's `+ Add` button
    // is reachable only after activating its sub-tab.
    renderDialog();
    activateTab("Constraints");
    const panel = document.querySelector(
      '[data-testid="create-table-foreign-keys-panel"]',
    ) as HTMLElement;
    expect(panel.textContent).not.toContain(STALE_CONSTRAINTS_PLACEHOLDER);
    // FK sub-tab is the default — its add button is visible immediately.
    expect(
      within(panel).getByRole("button", { name: /Add foreign key/i }),
    ).toBeInTheDocument();
    await activateConstraintSubTab("CHECK");
    expect(
      await within(panel).findByRole("button", { name: /Add check/i }),
    ).toBeInTheDocument();
    await activateConstraintSubTab("UNIQUE");
    expect(
      await within(panel).findByRole("button", { name: /Add unique/i }),
    ).toBeInTheDocument();
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

    // The preview pane is live and may flush once with the initial schema
    // before the user changes the dropdown. Isolate the post-change preview
    // so this assertion does not race that legitimate first request.
    await waitFor(() =>
      expect(mockCreateTable).toHaveBeenCalledWith(
        expect.objectContaining({ preview_only: true, schema: "public" }),
      ),
    );
    mockCreateTable.mockClear();

    // Open the schema dropdown and pick "analytics".
    fireEvent.click(screen.getByRole("combobox", { name: "Target schema" }));
    // Radix Select renders the listbox as a portal — the option
    // appears as a `option` role.
    const analyticsOption = await screen.findByRole("option", {
      name: "analytics",
    });
    fireEvent.click(analyticsOption);

    // Sprint 239 — preview pane defaults open; auto-debounced fetch settles via waitFor below.
    await waitFor(() =>
      expect(mockCreateTable).toHaveBeenCalledWith(
        expect.objectContaining({ preview_only: true, schema: "analytics" }),
      ),
    );
    expect(
      mockCreateTable.mock.calls.every(
        ([call]) => (call as { schema: string }).schema === "analytics",
      ),
    ).toBe(true);
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

    // Sprint 239 — preview pane defaults open; auto-debounced fetch settles via waitFor below.
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

    // Sprint 239 — preview pane defaults open; auto-debounced fetch settles via waitFor below.
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

    // Sprint 239 — preview pane defaults open; auto-debounced fetch settles via waitFor below.
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

  it("editing a field after preview auto-refetches preview (AC-227-05 / Sprint 238)", async () => {
    // Sprint 238: 자동 refresh — table name 수정만으로 preview 가
    // debounce 후 재발행되며, "Show DDL" 재클릭이 필요 없다.
    setDevConnection();
    useSafeModeStore.setState({ mode: "off" });
    mockCreateTable.mockResolvedValue({
      sql: 'CREATE TABLE "public"."events" ("id" integer)',
    });
    renderDialog();
    await fillSimpleForm();

    await waitFor(() => expect(mockCreateTable).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText("Table name"), {
      target: { value: "events_v2" },
    });
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
