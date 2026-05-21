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
import { setupTauriMock } from "@/test-utils/tauriMock";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
  within,
  configure,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Sprint 385 (2026-05-17) — `waitFor` default timeout 1000ms 가 pre-push 의
// `pnpm test --coverage` (instrumentation + 4000+ test 병렬 부하) 하에서 본
// 파일의 AC-229 긴 DDL-chain 시나리오에 부족. 본 파일만 5000ms 로 늘려 CI
// 부하 hidden margin 회복. 다른 test 파일 영향 0.
configure({ asyncUtilTimeout: 5000 });

// These AC-229 cases intentionally drive multi-step tab switching, debounced
// preview, and chained IPC mocks. Full-suite coverage instrumentation can push
// them past Vitest's global 10s test timeout even though the assertions pass in
// isolated runs.
const PRE_PUSH_LOAD_TEST_TIMEOUT_MS = 30000;

const {
  mockCreateTable,
  mockCreateIndex,
  mockDropIndex,
  mockAddConstraint,
  mockDropConstraint,
  mockCreateTablePlan,
  mockListPostgresTypes,
} = vi.hoisted(() => ({
  mockCreateTable: vi.fn(),
  mockCreateIndex: vi.fn(),
  // Sprint 228 — declared so a vitest spy can assert that the chain
  // does NOT call dropIndex on mid-chain failure (AC-228-07). Not
  // exported in production, but the mock surface needs to expose it
  // so the test can `expect(mockDropIndex).not.toHaveBeenCalled()`.
  mockDropIndex: vi.fn(),
  // Sprint 229 — addConstraint chain is the new ADD CONSTRAINT × K
  // step appended after the Sprint 228 createIndex × M chain. mock
  // dropConstraint is exposed so AC-229-08 can assert no rollback
  // on mid-chain failure.
  mockAddConstraint: vi.fn(),
  mockDropConstraint: vi.fn(),
  // Sprint 240 — `createTablePlan` is the new unified IPC the dialog
  // calls in place of the Sprint 228/229 N+1 fan-out. The default
  // impl below routes the plan through `mockCreateTable` /
  // `mockCreateIndex` / `mockAddConstraint` so the existing
  // fan-out-shaped assertions (call counts, ordering, rejection
  // halts the chain) keep validating the same contract. The
  // backend's trait default impl mirrors this exact fan-out, so
  // the simulation is faithful — not an arbitrary test seam.
  mockCreateTablePlan: vi.fn(),
  // Sprint 230 — usePostgresTypes consumes this. Default impl returns
  // an empty array so non-Sprint-230 cases see the canonical-only
  // merged list (= canonical exactly).
  mockListPostgresTypes: vi.fn().mockResolvedValue([]),
}));

// Sprint 240 — wire `createTablePlan` to the legacy fan-out mocks. The
// production code now issues exactly one IPC per debounce flush, but
// the test asserts the per-step shape (call counts on `createTable` /
// `createIndex` / `addConstraint`, order, propagated rejection). This
// impl keeps those asserts valid by replaying the same chain the
// backend's default `RdbAdapter::create_table_plan` would have run.
mockCreateTablePlan.mockImplementation(
  async (req: {
    connectionId: string;
    schema: string;
    name: string;
    columns: unknown[];
    primaryKey?: string[] | null;
    tableComment?: string | null;
    indexes?: Array<{
      indexName: string;
      columns: string[];
      indexType: string;
      isUnique?: boolean;
    }>;
    constraints?: Array<{
      constraintName: string;
      definition: unknown;
    }>;
    previewOnly?: boolean;
  }) => {
    const previewOnly = req.previewOnly ?? false;
    const sqlParts: string[] = [];
    const tableResult = await mockCreateTable({
      connection_id: req.connectionId,
      schema: req.schema,
      name: req.name,
      columns: req.columns,
      primary_key: req.primaryKey ?? null,
      table_comment: req.tableComment ?? null,
      preview_only: previewOnly,
    });
    sqlParts.push((tableResult as { sql?: string }).sql ?? "");
    for (const idx of req.indexes ?? []) {
      try {
        const r = await mockCreateIndex({
          connection_id: req.connectionId,
          schema: req.schema,
          table: req.name,
          index_name: idx.indexName,
          columns: idx.columns,
          index_type: idx.indexType,
          is_unique: idx.isUnique ?? false,
          preview_only: previewOnly,
        });
        sqlParts.push((r as { sql?: string }).sql ?? "");
      } catch (e) {
        // Sprint 240 — wrap rejection with the failing index name so
        // the dialog's preview pane surfaces "Index \"idx_x\" failed:
        // ...". Mirrors the backend `create_table_plan` default impl
        // (`db/traits.rs`).
        throw new Error(`Index "${idx.indexName}" failed: ${String(e)}`);
      }
    }
    for (const c of req.constraints ?? []) {
      try {
        const r = await mockAddConstraint({
          connection_id: req.connectionId,
          schema: req.schema,
          table: req.name,
          constraint_name: c.constraintName,
          definition: c.definition,
          preview_only: previewOnly,
        });
        sqlParts.push((r as { sql?: string }).sql ?? "");
      } catch (e) {
        throw new Error(
          `Constraint "${c.constraintName}" failed: ${String(e)}`,
        );
      }
    }
    return { sql: sqlParts.filter((s) => s.length > 0).join(";\n") };
  },
);
beforeEach(() => {
  setupTauriMock({
    createTable: mockCreateTable,
    createTablePlan: mockCreateTablePlan,
    createIndex: mockCreateIndex,
    dropIndex: mockDropIndex,
    addConstraint: mockAddConstraint,
    dropConstraint: mockDropConstraint,
    listPostgresTypes: mockListPostgresTypes,
    // Sprint 247 — `<DryRunPreview>` IPC stub for confirm dialog.
    executeQueryDryRun: vi.fn(() => Promise.resolve([])),
    cancelQuery: vi.fn(() => Promise.resolve("cancelled")),
  });
});

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
        dbType: "postgres",
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
        dbType: "postgres",
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
    database: string;
  }> = {},
) {
  const onClose = overrides.onClose ?? vi.fn();
  const onRefresh = overrides.onRefresh ?? vi.fn().mockResolvedValue(undefined);
  const schemaName = overrides.schemaName ?? "public";
  const availableSchemas = overrides.availableSchemas;
  // Sprint 263 — schemaStore caches are now `(connId, db)` keyed; the
  // dialog needs the active db to look up FK reference candidates.
  const database = overrides.database ?? "db-1";
  const view = render(
    <CreateTableDialog
      connectionId="conn-1"
      database={database}
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
  // The outer (main) Tabs in `CreateTableDialog` is controlled
  // (`value` + `onValueChange`), so a single `fireEvent.click` on the
  // trigger flips state via React. The first matching tab is the main
  // tablist's trigger — sub-tabs (FK / CHECK / UNIQUE inside the
  // Constraints panel) have non-overlapping labels.
  const tab = screen.getAllByRole("tab", { name: label })[0];
  if (!tab) throw new Error(`No tab with label ${label}`);
  fireEvent.click(tab);
}

// Sprint 241 — the Constraints panel splits FK / CHECK / UNIQUE into
// a nested uncontrolled `<Tabs defaultValue="fk">`. Radix Tabs in
// uncontrolled mode does NOT react to bare `fireEvent.click`; it
// requires the pointer-event sequence that `userEvent` synthesises.
async function activateConstraintSubTab(
  name: "Foreign Keys" | "CHECK" | "UNIQUE",
) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("tab", { name: new RegExp(`^${name}`) }));
}

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

  it("records a useQueryHistoryStore entry with source 'ddl-structure' on commit success", async () => {
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
  });

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

  it("Foreign Keys tab no longer renders the Sprint 228 placeholder (AC-227-01 superseded by AC-229-01)", async () => {
    // Sprint 229 — the AC-227-01 Foreign Keys placeholder body
    // (`"Available in Sprint 229"`) was removed in favour of the
    // interactive editor (AC-229-01). Sprint 241 — split into 3
    // sub-tabs (FK / CHECK / UNIQUE), so each family's `+ Add` button
    // is reachable only after activating its sub-tab.
    renderDialog();
    activateTab("Constraints");
    const panel = document.querySelector(
      '[data-testid="create-table-foreign-keys-panel"]',
    ) as HTMLElement;
    expect(panel.textContent).not.toContain("Available in Sprint 229");
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
    useQueryHistoryStore.setState({ recentVisible: [] });
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

    // Sprint 239 — preview pane defaults open; auto-debounced fetch settles via waitFor below.
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
      await Promise.resolve();
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

    // Sprint 239 — preview pane defaults open; auto-debounced fetch
    // settles after 250 ms idle. Wait for the Execute button to actually
    // become enabled (i.e. previewSql populated AND previewLoading=false)
    // before firing the click — the mock-count-only waitFor used to fire
    // mid-await and click a still-disabled button.
    await waitFor(
      () => {
        expect(mockCreateTable).toHaveBeenCalledTimes(1);
        expect(mockCreateIndex).toHaveBeenCalledTimes(2);
        const btn = screen.getByRole("button", {
          name: "Execute",
        }) as HTMLButtonElement;
        expect(btn.disabled).toBe(false);
      },
      { timeout: 3000 },
    );

    fireEvent.click(screen.getByRole("button", { name: "Execute" }));
    await waitFor(
      () => {
        expect(mockCreateTable).toHaveBeenCalledTimes(2);
        expect(mockCreateIndex).toHaveBeenCalledTimes(4);
      },
      { timeout: 3000 },
    );
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));

    // Sequential, not parallel — at most 1 createIndex in-flight.
    expect(maxConcurrent).toBeLessThanOrEqual(1);

    // 1 history entry, regardless of M.
    const entries = useQueryHistoryStore.getState().recentVisible;
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

    // Sprint 239 — preview pane defaults open; auto-debounced fetch settles via waitFor below.
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

    // Sprint 239 — preview pane defaults open; auto-debounced fetch settles via waitFor below.
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

    // Sprint 239 — preview pane defaults open; auto-debounced fetch settles via waitFor below.
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

    // Sprint 239 — preview pane defaults open; auto-debounced fetch settles via waitFor below.
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

    // Sprint 239 — preview pane defaults open; auto-debounced fetch settles via waitFor below.
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

    // Sprint 239 — preview pane defaults open; auto-debounced fetch settles via waitFor below.
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

    // Sprint 239 — preview pane defaults open; auto-debounced fetch settles via waitFor below.
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

    await screen.findByText(
      "Safe Mode (warn): confirmation cancelled — no changes committed",
    );
  });
});

// ── Sprint 229 — Foreign Keys + CHECK + UNIQUE tab functional ─────────
//
// Date: 2026-05-07.
//
// Why this block exists:
//
// Sprint 228 left the Foreign Keys tab as a `"Available in Sprint 229"`
// placeholder. Sprint 229 closes that loop: replace the placeholder with
// an interactive editor housing **three** constraint families on a
// single tab — Foreign Keys + CHECK + UNIQUE — sharing the same
// `tauri.addConstraint` chain target after the Sprint 228 createIndex
// chain. Atomic policy C — table+COMMENT in one transaction, indexes
// then constraints sequentially each in its own transaction; failures
// do NOT roll back earlier-applied work. The failing constraint name
// surfaces verbatim in the inline preview pane error slot.
//
// Path A backend extension landed: `ConstraintDefinition::ForeignKey`
// gains `on_delete` / `on_update` (`#[serde(default)]`), whitelist
// `{NO ACTION | RESTRICT | CASCADE | SET NULL | SET DEFAULT}`.
//
// Source: `docs/sprints/sprint-229/contract.md` AC-229-01..AC-229-12.

import { useSchemaStore } from "@stores/schemaStore";

describe("Sprint 229 — Foreign Keys + CHECK + UNIQUE tab functional", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConnectionStore.setState({ connections: [] });
    useSafeModeStore.setState({ mode: "off" });
    useQueryHistoryStore.setState({ recentVisible: [] });
    // Reset the schema store cache between tests — AC-229-09's reference
    // table picker reads `useSchemaStore.tables[<conn>:<refSchema>]`.
    useSchemaStore.setState({
      schemas: {},
      tables: {},
      views: {},
      functions: {},
      tableColumnsCache: {},
      loading: false,
      error: null,
    });
  });

  function getForeignKeysPanel(): HTMLElement {
    return document.querySelector(
      '[data-testid="create-table-foreign-keys-panel"]',
    ) as HTMLElement;
  }

  // 2-column form helper: id integer / email text on `users` table.
  async function fillTwoColumnFormAndOpenForeignKeysTab() {
    fireEvent.change(screen.getByLabelText("Table name"), {
      target: { value: "orders" },
    });
    const columnsPanel = getColumnsPanel();
    const colNameInputs = within(columnsPanel).getAllByLabelText("Column name");
    fireEvent.change(colNameInputs[0]!, { target: { value: "order_id" } });
    fireEvent.change(
      within(columnsPanel).getAllByLabelText("Column data type")[0]!,
      { target: { value: "integer" } },
    );
    fireEvent.click(screen.getByRole("button", { name: /Add column/i }));
    const inputs2 = within(getColumnsPanel()).getAllByLabelText("Column name");
    fireEvent.change(inputs2[1]!, { target: { value: "user_id" } });
    fireEvent.change(
      within(getColumnsPanel()).getAllByLabelText("Column data type")[1]!,
      { target: { value: "integer" } },
    );
    activateTab("Constraints");
  }

  // Sprint 241 — Constraints panel has nested sub-tabs; each `+ Add`
  // button is hidden behind its family's sub-tab. The helpers below
  // activate the sub-tab first (FK is the default so its helper is
  // synchronous; CHECK / UNIQUE need an async sub-tab activation).
  function addFkRow() {
    fireEvent.click(screen.getByRole("button", { name: /Add foreign key/i }));
  }
  async function addCheckRow() {
    await activateConstraintSubTab("CHECK");
    fireEvent.click(await screen.findByRole("button", { name: /Add check/i }));
  }
  async function addUniqueRow() {
    await activateConstraintSubTab("UNIQUE");
    fireEvent.click(await screen.findByRole("button", { name: /Add unique/i }));
  }

  // ── AC-229-01: FK tab placeholder removed; 3 add-buttons present ─

  it("Foreign Keys tab no longer renders the 'Available in Sprint 229' placeholder (AC-229-01)", async () => {
    renderDialog();
    activateTab("Constraints");
    const panel = getForeignKeysPanel();
    expect(panel.textContent).not.toContain("Available in Sprint 229");
    // Sprint 241 — FK is the default sub-tab; CHECK / UNIQUE add
    // buttons live behind their respective sub-tab triggers.
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

  // ── AC-229-02: FK row inputs + ON DELETE / ON UPDATE 5-option list

  it("FK row renders all 7 inputs (name + local cols + ref schema + ref table + ref cols + ON DELETE + ON UPDATE) (AC-229-02)", async () => {
    renderDialog({ availableSchemas: ["public", "analytics"] });
    await fillTwoColumnFormAndOpenForeignKeysTab();
    addFkRow();
    const panel = getForeignKeysPanel();

    expect(
      within(panel).getByLabelText("Foreign key name"),
    ).toBeInTheDocument();
    // Local columns multi-checkbox group — labelled by column name.
    expect(
      within(panel).getByLabelText("Foreign key local column: order_id"),
    ).toBeInTheDocument();
    expect(
      within(panel).getByLabelText("Foreign key local column: user_id"),
    ).toBeInTheDocument();
    // Reference schema dropdown (combobox role from Radix Select trigger).
    expect(
      within(panel).getByRole("combobox", {
        name: "Foreign key reference schema",
      }),
    ).toBeInTheDocument();
    // Reference table dropdown OR free-text input (cache miss fallback).
    expect(
      within(panel).getByLabelText("Foreign key reference table"),
    ).toBeInTheDocument();
    // ON DELETE / ON UPDATE selectors.
    expect(
      within(panel).getByRole("combobox", { name: "Foreign key on delete" }),
    ).toBeInTheDocument();
    expect(
      within(panel).getByRole("combobox", { name: "Foreign key on update" }),
    ).toBeInTheDocument();
    // Remove button.
    expect(
      within(panel).getByRole("button", { name: /Remove foreign key/i }),
    ).toBeInTheDocument();
  });

  it("ON DELETE / ON UPDATE dropdowns each list exactly 5 options (AC-229-02)", async () => {
    renderDialog();
    await fillTwoColumnFormAndOpenForeignKeysTab();
    addFkRow();
    const panel = getForeignKeysPanel();
    fireEvent.click(
      within(panel).getByRole("combobox", { name: "Foreign key on delete" }),
    );
    const expected = [
      "NO ACTION",
      "RESTRICT",
      "CASCADE",
      "SET NULL",
      "SET DEFAULT",
    ];
    for (const v of expected) {
      expect(
        await screen.findByRole("option", { name: v }),
      ).toBeInTheDocument();
    }
  });

  // ── AC-229-03 Composite FK preview substring ────────────────────

  it(
    "composite FK emits FOREIGN KEY ('order_id','user_id') REFERENCES 'orders' ('id','line_no') in preview (AC-229-03)",
    async () => {
      setDevConnection();
      useSafeModeStore.setState({ mode: "off" });
      mockCreateTable.mockResolvedValue({
        sql: 'CREATE TABLE "public"."orders" ("order_id" integer, "user_id" integer)',
      });
      // Use the verbatim shape contract requires; backend will return
      // the substring that the test inspects.
      mockAddConstraint.mockResolvedValue({
        sql: 'ALTER TABLE "public"."orders" ADD CONSTRAINT "fk_composite" FOREIGN KEY ("order_id", "user_id") REFERENCES "orders" ("id", "line_no")',
      });

      // Seed the schema store so the reference table picker can find
      // `orders` under public, with id+line_no as columns.
      useSchemaStore.setState({
        tables: {
          "conn-1": {
            "db-1": {
              public: [{ name: "orders", schema: "public", row_count: null }],
            },
          },
        },
        tableColumnsCache: {
          "conn-1": {
            "db-1": {
              public: {
                orders: [
                  {
                    name: "id",
                    data_type: "integer",
                    nullable: false,
                    default_value: null,
                    is_primary_key: true,
                    is_foreign_key: false,
                    fk_reference: null,
                    comment: null,
                  },
                  {
                    name: "line_no",
                    data_type: "integer",
                    nullable: false,
                    default_value: null,
                    is_primary_key: false,
                    is_foreign_key: false,
                    fk_reference: null,
                    comment: null,
                  },
                ],
              },
            },
          },
        },
      });

      renderDialog({ availableSchemas: ["public"] });
      await fillTwoColumnFormAndOpenForeignKeysTab();
      addFkRow();

      const panel = getForeignKeysPanel();
      fireEvent.change(within(panel).getByLabelText("Foreign key name"), {
        target: { value: "fk_composite" },
      });
      // Pick local columns order_id + user_id.
      fireEvent.click(
        within(panel).getByLabelText("Foreign key local column: order_id"),
      );
      fireEvent.click(
        within(panel).getByLabelText("Foreign key local column: user_id"),
      );

      // Reference schema = public (default), ref table = orders.
      fireEvent.click(
        within(panel).getByRole("combobox", {
          name: "Foreign key reference table",
        }),
      );
      fireEvent.click(await screen.findByRole("option", { name: "orders" }));

      // After ref table picked, ref columns checkbox group surfaces.
      await waitFor(() => {
        expect(
          within(getForeignKeysPanel()).getByLabelText(
            "Foreign key reference column: id",
          ),
        ).toBeInTheDocument();
      });
      fireEvent.click(
        within(getForeignKeysPanel()).getByLabelText(
          "Foreign key reference column: id",
        ),
      );
      fireEvent.click(
        within(getForeignKeysPanel()).getByLabelText(
          "Foreign key reference column: line_no",
        ),
      );

      // Sprint 239 — preview pane defaults open; auto-debounced fetch settles via waitFor below.
      await waitFor(() => expect(mockAddConstraint).toHaveBeenCalledTimes(1));
      const call = mockAddConstraint.mock.calls[0]![0] as {
        definition: {
          type: string;
          columns: string[];
          reference_table: string;
          reference_columns: string[];
        };
      };
      expect(call.definition.type).toBe("foreign_key");
      expect(call.definition.columns).toEqual(["order_id", "user_id"]);
      expect(call.definition.reference_table).toBe("orders");
      expect(call.definition.reference_columns).toEqual(["id", "line_no"]);

      const previewPane = document.querySelector(
        "#create-table-ddl-preview",
      ) as HTMLElement;
      expect(previewPane.textContent).toContain(
        'FOREIGN KEY ("order_id", "user_id") REFERENCES "orders" ("id", "line_no")',
      );
    },
    PRE_PUSH_LOAD_TEST_TIMEOUT_MS,
  );

  // ── AC-229-04 CHECK preview ───────────────────────────────────────

  it('CHECK row preview shows ADD CONSTRAINT "<name>" CHECK (<expression>) (AC-229-04)', async () => {
    setDevConnection();
    useSafeModeStore.setState({ mode: "off" });
    mockCreateTable.mockResolvedValue({
      sql: 'CREATE TABLE "public"."orders" ("order_id" integer, "user_id" integer)',
    });
    mockAddConstraint.mockResolvedValue({
      sql: 'ALTER TABLE "public"."orders" ADD CONSTRAINT "chk_age" CHECK (age >= 0)',
    });

    renderDialog();
    await fillTwoColumnFormAndOpenForeignKeysTab();
    await addCheckRow();
    const panel = getForeignKeysPanel();
    fireEvent.change(within(panel).getByLabelText("Check name"), {
      target: { value: "chk_age" },
    });
    fireEvent.change(within(panel).getByLabelText("Check expression"), {
      target: { value: "age >= 0" },
    });

    // Sprint 239 — preview pane defaults open; auto-debounced fetch settles via waitFor below.
    await waitFor(() => expect(mockAddConstraint).toHaveBeenCalledTimes(1));
    const call = mockAddConstraint.mock.calls[0]![0] as {
      definition: { type: string; expression: string };
      constraint_name: string;
    };
    expect(call.definition.type).toBe("check");
    expect(call.definition.expression).toBe("age >= 0");
    expect(call.constraint_name).toBe("chk_age");

    const previewPane = document.querySelector(
      "#create-table-ddl-preview",
    ) as HTMLElement;
    expect(previewPane.textContent).toContain(
      'ADD CONSTRAINT "chk_age" CHECK (age >= 0)',
    );
  });

  it("whitespace-only CHECK expression is filtered out of the chain (AC-229-04)", async () => {
    setDevConnection();
    useSafeModeStore.setState({ mode: "off" });
    mockCreateTable.mockResolvedValue({
      sql: 'CREATE TABLE "public"."orders" ("order_id" integer)',
    });

    renderDialog();
    await fillTwoColumnFormAndOpenForeignKeysTab();
    await addCheckRow();
    const panel = getForeignKeysPanel();
    fireEvent.change(within(panel).getByLabelText("Check name"), {
      target: { value: "chk_blank" },
    });
    fireEvent.change(within(panel).getByLabelText("Check expression"), {
      target: { value: "   " },
    });

    // Sprint 239 — preview pane defaults open; auto-debounced fetch settles via waitFor below.
    await waitFor(() => expect(mockCreateTable).toHaveBeenCalledTimes(1));
    expect(mockAddConstraint).not.toHaveBeenCalled();
  });

  // ── AC-229-05 table-level UNIQUE ─────────────────────────────────

  it('table-level UNIQUE row preview shows ADD CONSTRAINT "<name>" UNIQUE ("col") (AC-229-05)', async () => {
    setDevConnection();
    useSafeModeStore.setState({ mode: "off" });
    mockCreateTable.mockResolvedValue({
      sql: 'CREATE TABLE "public"."orders" ("order_id" integer, "user_id" integer)',
    });
    mockAddConstraint.mockResolvedValue({
      sql: 'ALTER TABLE "public"."orders" ADD CONSTRAINT "uq_orders_user" UNIQUE ("user_id")',
    });

    renderDialog();
    await fillTwoColumnFormAndOpenForeignKeysTab();
    await addUniqueRow();
    const panel = getForeignKeysPanel();
    fireEvent.change(within(panel).getByLabelText("Unique name"), {
      target: { value: "uq_orders_user" },
    });
    fireEvent.click(within(panel).getByLabelText("Unique column: user_id"));

    // Sprint 239 — preview pane defaults open; auto-debounced fetch settles via waitFor below.
    await waitFor(() => expect(mockAddConstraint).toHaveBeenCalledTimes(1));
    const call = mockAddConstraint.mock.calls[0]![0] as {
      definition: { type: string; columns: string[] };
    };
    expect(call.definition.type).toBe("unique");
    expect(call.definition.columns).toEqual(["user_id"]);

    const previewPane = document.querySelector(
      "#create-table-ddl-preview",
    ) as HTMLElement;
    expect(previewPane.textContent).toContain(
      'ADD CONSTRAINT "uq_orders_user" UNIQUE ("user_id")',
    );
  });

  // ── AC-229-06 multi-statement preview shows full bundle ─────────

  it(
    "Show DDL bundles CREATE TABLE + 3× ADD CONSTRAINT (1 FK + 1 CHECK + 1 UNIQUE) (AC-229-06)",
    async () => {
      setDevConnection();
      useSafeModeStore.setState({ mode: "off" });
      mockCreateTable.mockResolvedValue({
        sql: 'CREATE TABLE "public"."orders" ("order_id" integer, "user_id" integer)',
      });
      mockAddConstraint.mockImplementation(
        async (req: {
          definition: { type: string };
          constraint_name: string;
        }) => ({
          sql: `ALTER TABLE "public"."orders" ADD CONSTRAINT "${req.constraint_name}" ${req.definition.type.toUpperCase()}`,
        }),
      );

      useSchemaStore.setState({
        tables: {
          "conn-1": {
            "db-1": {
              public: [{ name: "users", schema: "public", row_count: null }],
            },
          },
        },
        tableColumnsCache: {
          "conn-1": {
            "db-1": {
              public: {
                users: [
                  {
                    name: "id",
                    data_type: "integer",
                    nullable: false,
                    default_value: null,
                    is_primary_key: true,
                    is_foreign_key: false,
                    fk_reference: null,
                    comment: null,
                  },
                ],
              },
            },
          },
        },
      });

      renderDialog({ availableSchemas: ["public"] });
      await fillTwoColumnFormAndOpenForeignKeysTab();

      addFkRow();
      await addCheckRow();
      await addUniqueRow();
      // Sprint 241 — sub-tabs hide inactive panels; each family's fields
      // are only reachable while its sub-tab is active. Re-activate
      // before manipulating each family's controls.
      await activateConstraintSubTab("Foreign Keys");
      const panel = getForeignKeysPanel();

      fireEvent.change(
        await within(panel).findByLabelText("Foreign key name"),
        {
          target: { value: "fk_orders_user" },
        },
      );
      fireEvent.click(
        within(panel).getByLabelText("Foreign key local column: user_id"),
      );
      fireEvent.click(
        within(panel).getByRole("combobox", {
          name: "Foreign key reference table",
        }),
      );
      fireEvent.click(await screen.findByRole("option", { name: "users" }));
      await waitFor(() => {
        expect(
          within(getForeignKeysPanel()).getByLabelText(
            "Foreign key reference column: id",
          ),
        ).toBeInTheDocument();
      });
      fireEvent.click(
        within(getForeignKeysPanel()).getByLabelText(
          "Foreign key reference column: id",
        ),
      );

      await activateConstraintSubTab("CHECK");
      fireEvent.change(
        await within(getForeignKeysPanel()).findByLabelText("Check name"),
        {
          target: { value: "chk_age" },
        },
      );
      fireEvent.change(
        within(getForeignKeysPanel()).getByLabelText("Check expression"),
        { target: { value: "age >= 0" } },
      );

      await activateConstraintSubTab("UNIQUE");
      fireEvent.change(
        await within(getForeignKeysPanel()).findByLabelText("Unique name"),
        {
          target: { value: "uq_orders_user" },
        },
      );
      fireEvent.click(
        within(getForeignKeysPanel()).getByLabelText("Unique column: user_id"),
      );

      // Sprint 239 — preview pane defaults open; auto-debounced fetch settles via waitFor below.
      // 2026-05-11 — intermediate debounce flushes (FK, FK+CHECK, FK+CHECK+UNIQUE)
      // fire during real-timer awaits, so exact call counts are non-deterministic
      // under heavy parallel pre-push load (rust-coverage 동시 실행 시 reproducible).
      // Assert on terminal state instead — every constraint name eventually shows
      // up in a preview call, matching the `018455a` fix applied at AC-229-08.
      await waitFor(() => {
        expect(mockCreateTable).toHaveBeenCalledWith(
          expect.objectContaining({ preview_only: true }),
        );
        for (const name of ["fk_orders_user", "chk_age", "uq_orders_user"]) {
          expect(mockAddConstraint).toHaveBeenCalledWith(
            expect.objectContaining({
              constraint_name: name,
              preview_only: true,
            }),
          );
        }
      });

      // 0 indexes declared → no createIndex calls.
      expect(mockCreateIndex).not.toHaveBeenCalled();

      // IPC sequence: createTable(true), then addConstraint(true) × 3.
      expect(
        (mockCreateTable.mock.calls[0]![0] as { preview_only: boolean })
          .preview_only,
      ).toBe(true);
      for (const c of mockAddConstraint.mock.calls) {
        expect((c[0] as { preview_only: boolean }).preview_only).toBe(true);
      }
    },
    PRE_PUSH_LOAD_TEST_TIMEOUT_MS,
  );

  // ── AC-229-07 chained Execute happy path ─────────────────────────

  it(
    "Execute chains createTable + addConstraint × 3 sequentially with one history entry (AC-229-07)",
    async () => {
      setDevConnection();
      useSafeModeStore.setState({ mode: "off" });
      mockCreateTable.mockResolvedValue({
        sql: 'CREATE TABLE "public"."orders" ("order_id" integer, "user_id" integer)',
      });
      let inflight = 0;
      let maxConcurrent = 0;
      mockAddConstraint.mockImplementation(
        async (req: {
          constraint_name: string;
          definition: { type: string };
        }) => {
          inflight += 1;
          if (inflight > maxConcurrent) maxConcurrent = inflight;
          await Promise.resolve();
          inflight -= 1;
          return {
            sql: `ALTER TABLE "public"."orders" ADD CONSTRAINT "${req.constraint_name}" ${req.definition.type.toUpperCase()}`,
          };
        },
      );

      useSchemaStore.setState({
        tables: {
          "conn-1": {
            "db-1": {
              public: [{ name: "users", schema: "public", row_count: null }],
            },
          },
        },
        tableColumnsCache: {
          "conn-1": {
            "db-1": {
              public: {
                users: [
                  {
                    name: "id",
                    data_type: "integer",
                    nullable: false,
                    default_value: null,
                    is_primary_key: true,
                    is_foreign_key: false,
                    fk_reference: null,
                    comment: null,
                  },
                ],
              },
            },
          },
        },
      });

      const onRefresh = vi.fn().mockResolvedValue(undefined);
      const onClose = vi.fn();
      renderDialog({ onRefresh, onClose, availableSchemas: ["public"] });
      await fillTwoColumnFormAndOpenForeignKeysTab();

      addFkRow();
      let panel = getForeignKeysPanel();
      fireEvent.change(within(panel).getByLabelText("Foreign key name"), {
        target: { value: "fk_orders_user" },
      });
      fireEvent.click(
        within(panel).getByLabelText("Foreign key local column: user_id"),
      );
      fireEvent.click(
        within(panel).getByRole("combobox", {
          name: "Foreign key reference table",
        }),
      );
      fireEvent.click(await screen.findByRole("option", { name: "users" }));
      await waitFor(() => {
        expect(
          within(getForeignKeysPanel()).getByLabelText(
            "Foreign key reference column: id",
          ),
        ).toBeInTheDocument();
      });
      fireEvent.click(
        within(getForeignKeysPanel()).getByLabelText(
          "Foreign key reference column: id",
        ),
      );

      await addCheckRow();
      panel = getForeignKeysPanel();
      fireEvent.change(within(panel).getByLabelText("Check name"), {
        target: { value: "chk_age" },
      });
      fireEvent.change(within(panel).getByLabelText("Check expression"), {
        target: { value: "age >= 0" },
      });

      await addUniqueRow();
      panel = getForeignKeysPanel();
      fireEvent.change(within(panel).getByLabelText("Unique name"), {
        target: { value: "uq_orders_user" },
      });
      fireEvent.click(within(panel).getByLabelText("Unique column: user_id"));

      // Sprint 239 — preview pane defaults open; auto-debounced fetch settles via waitFor below.
      // Intermediate debounce flushes are timing-sensitive under full-suite
      // coverage load, so assert the terminal preview state instead of exact
      // preview call counts.
      await waitFor(() => {
        expect(mockCreateTable).toHaveBeenCalledWith(
          expect.objectContaining({ preview_only: true }),
        );
        for (const name of ["fk_orders_user", "chk_age", "uq_orders_user"]) {
          expect(mockAddConstraint).toHaveBeenCalledWith(
            expect.objectContaining({
              constraint_name: name,
              preview_only: true,
            }),
          );
        }
      });

      fireEvent.click(screen.getByRole("button", { name: "Execute" }));
      await waitFor(() => {
        const createTableCommitCalls = mockCreateTable.mock.calls.filter(
          (c) => (c[0] as { preview_only: boolean }).preview_only === false,
        );
        const commitConstraints = mockAddConstraint.mock.calls.filter(
          (c) => (c[0] as { preview_only: boolean }).preview_only === false,
        );
        expect(createTableCommitCalls).toHaveLength(1);
        expect(commitConstraints).toHaveLength(3);
      });
      await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));

      // Sequential — at most 1 in flight.
      expect(maxConcurrent).toBeLessThanOrEqual(1);

      // 1 history entry.
      const entries = useQueryHistoryStore.getState().recentVisible;
      expect(entries.filter((e) => e.source === "ddl-structure")).toHaveLength(
        1,
      );

      // Commit-only addConstraint × 3 (preview_only:false).
      const commitConstraints = mockAddConstraint.mock.calls.filter(
        (c) => (c[0] as { preview_only: boolean }).preview_only === false,
      );
      expect(commitConstraints).toHaveLength(3);
      expect(
        commitConstraints.map(
          (c) => (c[0] as { constraint_name: string }).constraint_name,
        ),
      ).toEqual(["fk_orders_user", "chk_age", "uq_orders_user"]);
    },
    PRE_PUSH_LOAD_TEST_TIMEOUT_MS,
  );

  // ── AC-229-08 constraint failure mid-chain ───────────────────────

  it(
    "2nd addConstraint(commit) rejection halts chain, modal stays open, error names failing constraint (AC-229-08)",
    async () => {
      setDevConnection();
      useSafeModeStore.setState({ mode: "off" });
      mockCreateTable.mockResolvedValue({
        sql: 'CREATE TABLE "public"."orders" ("order_id" integer, "user_id" integer)',
      });
      let commitConstraintCount = 0;
      mockAddConstraint.mockImplementation(
        async (req: {
          preview_only: boolean;
          constraint_name: string;
          definition: { type: string };
        }) => {
          if (req.preview_only) {
            return {
              sql: `ALTER TABLE "public"."orders" ADD CONSTRAINT "${req.constraint_name}" ${req.definition.type.toUpperCase()}`,
            };
          }
          commitConstraintCount += 1;
          if (commitConstraintCount === 2) {
            throw new Error('check constraint "chk_age" violated by some row');
          }
          return {
            sql: `ALTER TABLE "public"."orders" ADD CONSTRAINT "${req.constraint_name}" ${req.definition.type.toUpperCase()}`,
          };
        },
      );

      useSchemaStore.setState({
        tables: {
          "conn-1": {
            "db-1": {
              public: [{ name: "users", schema: "public", row_count: null }],
            },
          },
        },
        tableColumnsCache: {
          "conn-1": {
            "db-1": {
              public: {
                users: [
                  {
                    name: "id",
                    data_type: "integer",
                    nullable: false,
                    default_value: null,
                    is_primary_key: true,
                    is_foreign_key: false,
                    fk_reference: null,
                    comment: null,
                  },
                ],
              },
            },
          },
        },
      });

      const onClose = vi.fn();
      renderDialog({ onClose, availableSchemas: ["public"] });
      await fillTwoColumnFormAndOpenForeignKeysTab();

      addFkRow();
      let panel = getForeignKeysPanel();
      fireEvent.change(within(panel).getByLabelText("Foreign key name"), {
        target: { value: "fk_orders_user" },
      });
      fireEvent.click(
        within(panel).getByLabelText("Foreign key local column: user_id"),
      );
      fireEvent.click(
        within(panel).getByRole("combobox", {
          name: "Foreign key reference table",
        }),
      );
      fireEvent.click(await screen.findByRole("option", { name: "users" }));
      await waitFor(() => {
        expect(
          within(getForeignKeysPanel()).getByLabelText(
            "Foreign key reference column: id",
          ),
        ).toBeInTheDocument();
      });
      fireEvent.click(
        within(getForeignKeysPanel()).getByLabelText(
          "Foreign key reference column: id",
        ),
      );

      await addCheckRow();
      panel = getForeignKeysPanel();
      fireEvent.change(within(panel).getByLabelText("Check name"), {
        target: { value: "chk_age" },
      });
      fireEvent.change(within(panel).getByLabelText("Check expression"), {
        target: { value: "age >= 0" },
      });

      await addUniqueRow();
      panel = getForeignKeysPanel();
      fireEvent.change(within(panel).getByLabelText("Unique name"), {
        target: { value: "uq_orders_user" },
      });
      fireEvent.click(within(panel).getByLabelText("Unique column: user_id"));

      // Sprint 239 — preview pane defaults open; auto-debounced fetch settles via waitFor below.
      // Intermediate debounce flushes (FK+CHECK, then FK+CHECK+UNIQUE) fire during real-timer
      // awaits, so exact call count is non-deterministic. Assert on content instead.
      await waitFor(() =>
        expect(mockAddConstraint).toHaveBeenCalledWith(
          expect.objectContaining({
            constraint_name: "uq_orders_user",
            preview_only: true,
          }),
        ),
      );

      fireEvent.click(screen.getByRole("button", { name: "Execute" }));

      await waitFor(() => {
        const previewPane = document.querySelector(
          "#create-table-ddl-preview",
        ) as HTMLElement;
        expect(previewPane.textContent).toContain("chk_age");
      });

      // Commit phase: only 2 addConstraint calls fired (1st succeeded,
      // 2nd rejected, 3rd never fires).
      const commitCalls = mockAddConstraint.mock.calls.filter(
        (c) => (c[0] as { preview_only: boolean }).preview_only === false,
      );
      expect(commitCalls).toHaveLength(2);
      expect(
        (commitCalls[0]![0] as { constraint_name: string }).constraint_name,
      ).toBe("fk_orders_user");
      expect(
        (commitCalls[1]![0] as { constraint_name: string }).constraint_name,
      ).toBe("chk_age");

      // CREATE TABLE was NOT rolled back. We assert the commit-side call
      // happened exactly once — preview-side call counts are debounce-
      // sensitive under heavy parallel load (same flake class fixed at
      // AC-229-08 in 018455a).
      const createTableCommitCalls = mockCreateTable.mock.calls.filter(
        (c) => (c[0] as { preview_only: boolean }).preview_only === false,
      );
      expect(createTableCommitCalls).toHaveLength(1);

      // Modal stays open + no rollback.
      expect(onClose).not.toHaveBeenCalled();
      expect(mockDropConstraint).not.toHaveBeenCalled();
    },
    PRE_PUSH_LOAD_TEST_TIMEOUT_MS,
  );

  // ── AC-229-09 reference table picker — schemaStore-cached + lazy load

  it("reference table picker populates from useSchemaStore.tables cache (AC-229-09)", async () => {
    useSchemaStore.setState({
      tables: {
        "conn-1": {
          "db-1": {
            public: [
              { name: "users", schema: "public", row_count: null },
              { name: "products", schema: "public", row_count: null },
            ],
          },
        },
      },
    });

    renderDialog({ availableSchemas: ["public"] });
    await fillTwoColumnFormAndOpenForeignKeysTab();
    addFkRow();

    const panel = getForeignKeysPanel();
    fireEvent.click(
      within(panel).getByRole("combobox", {
        name: "Foreign key reference table",
      }),
    );

    expect(
      await screen.findByRole("option", { name: "users" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "products" }),
    ).toBeInTheDocument();
  });

  it("reference schema selection triggers loadTables on cache miss (AC-229-09)", async () => {
    const loadTables = vi
      .fn<(connectionId: string, db: string, schema: string) => Promise<void>>()
      .mockResolvedValue(undefined);
    useSchemaStore.setState({
      tables: {},
      loadTables,
    });

    renderDialog({ availableSchemas: ["public", "analytics"] });
    await fillTwoColumnFormAndOpenForeignKeysTab();
    addFkRow();
    const panel = getForeignKeysPanel();

    // Switching ref schema (e.g. to analytics) must trigger the lazy
    // loadTables call when the cache is empty.
    fireEvent.click(
      within(panel).getByRole("combobox", {
        name: "Foreign key reference schema",
      }),
    );
    fireEvent.click(await screen.findByRole("option", { name: "analytics" }));

    await waitFor(() => {
      expect(loadTables).toHaveBeenCalledWith("conn-1", "db-1", "analytics");
    });
  });

  // ── AC-229-10 0-constraint byte-equivalent regression ─────────────

  it("0-constraint IPC sequence is byte-equivalent to Sprint 228 (AC-229-10)", async () => {
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

    // Sprint 239 — preview pane defaults open; auto-debounced fetch settles via waitFor below.
    await waitFor(() => expect(mockCreateTable).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Execute" }));
    await waitFor(() => expect(mockCreateTable).toHaveBeenCalledTimes(2));

    // No addConstraint and no createIndex calls when 0 constraints / 0
    // indexes declared.
    expect(mockAddConstraint).not.toHaveBeenCalled();
    expect(mockCreateIndex).not.toHaveBeenCalled();
  });

  // ── canonical Safe Mode warn-cancel verbatim survives bundle ────

  it("Safe Mode warn-cancel surfaces the canonical message even with constraints declared (AC-229-12 / Sprint 228 invariant carry-over)", async () => {
    setProductionConnection();
    useSafeModeStore.setState({ mode: "warn" });
    mockCreateTable.mockResolvedValue({
      sql: 'DROP TABLE "public"."orders"',
    });
    mockAddConstraint.mockResolvedValue({
      sql: 'ALTER TABLE "public"."orders" ADD CONSTRAINT "chk_x" CHECK (id > 0)',
    });

    renderDialog();
    await fillTwoColumnFormAndOpenForeignKeysTab();
    await addCheckRow();
    const panel = getForeignKeysPanel();
    fireEvent.change(within(panel).getByLabelText("Check name"), {
      target: { value: "chk_x" },
    });
    fireEvent.change(within(panel).getByLabelText("Check expression"), {
      target: { value: "id > 0" },
    });

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

    await screen.findByText(
      "Safe Mode (warn): confirmation cancelled — no changes committed",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────
// Sprint 230 — dynamic Postgres type list (Phase 27 sprint 5).
// AC-230-08 (dialog wires `usePostgresTypes` → `typesSource` prop) +
// AC-230-10 (loading-canonical-first + silent merge replacement).
// ─────────────────────────────────────────────────────────────────────

import { invalidatePostgresTypesCache } from "@hooks/usePostgresTypes";

describe("Sprint 230 — CreateTableDialog wires dynamic PG type list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConnectionStore.setState({ connections: [] });
    useSafeModeStore.setState({ mode: "off" });
    useQueryHistoryStore.setState({ recentVisible: [] });
    // Punch the module memo so each Sprint 230 case sees a fresh
    // fetch sequence — `usePostgresTypes` shares one Promise per
    // connectionId across cases otherwise.
    invalidatePostgresTypesCache("conn-1");
    // Reset the default mock impl in case a prior case overrode it.
    mockListPostgresTypes.mockReset();
    mockListPostgresTypes.mockResolvedValue([]);
  });

  it("dialog mount calls tauri.listPostgresTypes(connectionId) exactly once (AC-230-08)", async () => {
    setDevConnection();
    mockListPostgresTypes.mockResolvedValueOnce([
      { schema: "public", name: "my_enum", type_kind: "enum" },
    ]);
    renderDialog();

    await waitFor(() => expect(mockListPostgresTypes).toHaveBeenCalledTimes(1));
    // Sprint 271a — wrapper now takes optional expectedDatabase as 2nd arg.
    // setProdConnection seeds connections[0].database = "app" → resolveActiveDb
    // falls back to the persisted database when no activeStatuses entry exists.
    expect(mockListPostgresTypes).toHaveBeenCalledWith("conn-1", "app");
  });

  it("dialog merges live types into the column-type combobox suggestions (AC-230-08)", async () => {
    setDevConnection();
    mockListPostgresTypes.mockResolvedValueOnce([
      { schema: "public", name: "my_enum", type_kind: "enum" },
      { schema: "extensions", name: "geometry", type_kind: "base" },
    ]);
    renderDialog();
    await waitFor(() => expect(mockListPostgresTypes).toHaveBeenCalledTimes(1));

    // Open the column-type combobox in the first row of the Columns
    // tab (active by default).
    const panel = getColumnsPanel();
    const typeInput = within(panel).getByRole("combobox", {
      name: "Column data type",
    });
    fireEvent.focus(typeInput);
    fireEvent.change(typeInput, { target: { value: "geo" } });

    const listbox = await screen.findByRole("listbox", {
      name: /PostgreSQL types/i,
    });
    const labels = Array.from(listbox.querySelectorAll('[role="option"]')).map(
      (o) => o.textContent ?? "",
    );
    expect(labels).toContain("extensions.geometry");
  });

  it("loading-canonical-first — combobox shows canonical entries instantly with no spinner (AC-230-10)", async () => {
    setDevConnection();
    // Defer the fetch resolution so we can assert the loading-state
    // surface (canonical visible, no spinner inside the combobox).
    let resolveFetch:
      | ((v: { schema: string; name: string; type_kind: string }[]) => void)
      | null = null;
    mockListPostgresTypes.mockImplementationOnce(
      () =>
        new Promise<{ schema: string; name: string; type_kind: string }[]>(
          (resolve) => {
            resolveFetch = resolve;
          },
        ),
    );
    renderDialog();

    const panel = getColumnsPanel();
    const typeInput = within(panel).getByRole("combobox", {
      name: "Column data type",
    });
    fireEvent.focus(typeInput);
    // Canonical entries (e.g. `varchar`) MUST be visible in the
    // listbox immediately — no spinner / no skeleton inside the
    // combobox subtree.
    const listbox = await screen.findByRole("listbox", {
      name: /PostgreSQL types/i,
    });
    const labels = Array.from(listbox.querySelectorAll('[role="option"]')).map(
      (o) => o.textContent ?? "",
    );
    expect(labels).toContain("varchar");
    expect(labels).toContain("uuid");
    // No spinner element inside the combobox subtree.
    expect(
      within(typeInput.parentElement as HTMLElement).queryByRole("status"),
    ).toBeNull();

    // Clean up — resolve the deferred Promise so the hook unmounts
    // gracefully.
    await act(async () => {
      resolveFetch?.([]);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────
// Sprint 234 — UX consolidation polish (Phase 27 sprint 9).
// AC-234-01 cross-tab cue / AC-234-02 empty-state message / AC-234-03/04
// reorder / AC-234-05/06 table-level COMMENT / AC-234-07 schema picker
// position / AC-234-08/09 type-kind color coding.
// ─────────────────────────────────────────────────────────────────────

describe("Sprint 234 — CreateTableDialog UX polish", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConnectionStore.setState({ connections: [] });
    useSafeModeStore.setState({ mode: "off" });
    useQueryHistoryStore.setState({ recentVisible: [] });
    invalidatePostgresTypesCache("conn-1");
    mockListPostgresTypes.mockReset();
    mockListPostgresTypes.mockResolvedValue([]);
  });

  // Sprint 234 AC-234-07 — schema picker LIVES IN THE BODY, not in the
  // header. The contract drives the layout: schema picker → table name
  // → table comment → tabs.
  it("renders the target schema dropdown in the body, not in the header (AC-234-07)", () => {
    renderDialog({ availableSchemas: ["public", "analytics"] });
    const schemaCombobox = screen.getByRole("combobox", {
      name: "Target schema",
    });
    // Header is the closest [data-slot="dialog-header"] ancestor when
    // the picker still lives there. Sprint 234 strips the picker, so
    // the picker MUST NOT be inside the header.
    const header = document.querySelector('[data-slot="dialog-header"]');
    expect(header).not.toBeNull();
    expect(header).not.toContainElement(schemaCombobox);
    // The body (any ancestor div with the px-4 / py-3 class set used
    // for the body wrapper) DOES contain the picker.
    expect(document.body).toContainElement(schemaCombobox);
  });

  // Sprint 234 AC-234-05 — Table comment input rendered between Table
  // name and the Tabs block. Optional, default empty, controlled.
  it("renders a Table comment input above the tabs (AC-234-05)", () => {
    renderDialog();
    const commentInput = screen.getByLabelText("Table comment");
    expect(commentInput).toBeInTheDocument();
    expect(commentInput.getAttribute("placeholder")).toBe("comment (optional)");
    // Verify positional ordering — Table comment input sits AFTER Table
    // name input but BEFORE the tablist. Sprint 241 introduced nested
    // sub-tabs inside the Constraints panel, so the document now has
    // multiple `tablist`s; use the first (outer / main) one.
    const tableNameInput = screen.getByLabelText("Table name");
    const mainTablist = screen.getAllByRole("tablist")[0]!;
    expect(
      tableNameInput.compareDocumentPosition(commentInput) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      commentInput.compareDocumentPosition(mainTablist) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  // Sprint 234 AC-234-05/06 — non-empty comment plumbs into the Tauri
  // payload as `table_comment: <trimmed string>`; whitespace-only stays
  // as `null` so the Sprint 226-233 byte-equivalence holds.
  it("plumbs Table comment into buildRequest as table_comment (trimmed) (AC-234-05/06)", async () => {
    setDevConnection();
    useSafeModeStore.setState({ mode: "off" });
    mockCreateTable.mockResolvedValue({
      sql: 'CREATE TABLE "public"."events" ("id" integer); COMMENT ON TABLE "public"."events" IS \'event log\';',
    });
    renderDialog();
    fireEvent.change(screen.getByLabelText("Table name"), {
      target: { value: "events" },
    });
    const columnsPanel = document.querySelector(
      '[data-testid="create-table-columns-panel"]',
    ) as HTMLElement;
    fireEvent.change(within(columnsPanel).getByLabelText("Column name"), {
      target: { value: "id" },
    });
    fireEvent.change(within(columnsPanel).getByLabelText("Column data type"), {
      target: { value: "integer" },
    });
    fireEvent.change(screen.getByLabelText("Table comment"), {
      target: { value: "  event log  " },
    });

    // Sprint 239 — preview pane defaults open; auto-debounced fetch settles via waitFor below.
    await waitFor(() => expect(mockCreateTable).toHaveBeenCalledTimes(1));
    const call = mockCreateTable.mock.calls[0]![0] as {
      table_comment: string | null;
    };
    expect(call.table_comment).toBe("event log");
  });

  it("plumbs whitespace-only Table comment as table_comment: null (Sprint 226-233 invariant)", async () => {
    setDevConnection();
    useSafeModeStore.setState({ mode: "off" });
    mockCreateTable.mockResolvedValue({
      sql: 'CREATE TABLE "public"."events" ("id" integer)',
    });
    renderDialog();
    fireEvent.change(screen.getByLabelText("Table name"), {
      target: { value: "events" },
    });
    const columnsPanel = document.querySelector(
      '[data-testid="create-table-columns-panel"]',
    ) as HTMLElement;
    fireEvent.change(within(columnsPanel).getByLabelText("Column name"), {
      target: { value: "id" },
    });
    fireEvent.change(within(columnsPanel).getByLabelText("Column data type"), {
      target: { value: "integer" },
    });
    fireEvent.change(screen.getByLabelText("Table comment"), {
      target: { value: "   " },
    });

    // Sprint 239 — preview pane defaults open; auto-debounced fetch settles via waitFor below.
    await waitFor(() => expect(mockCreateTable).toHaveBeenCalledTimes(1));
    const call = mockCreateTable.mock.calls[0]![0] as {
      table_comment: string | null;
    };
    expect(call.table_comment).toBeNull();
  });

  // Sprint 234 AC-234-01 — `(N)` count badges next to Keys / Indexes /
  // Foreign Keys tab labels reflect the live declared lists.
  it("shows (N) count badge next to Keys / Indexes / Foreign Keys tab labels (AC-234-01)", async () => {
    setDevConnection();
    renderDialog();
    // Setup: type one column with name "id" and mark it PK so the Keys
    // tab badge becomes (1).
    const columnsPanel = document.querySelector(
      '[data-testid="create-table-columns-panel"]',
    ) as HTMLElement;
    fireEvent.change(within(columnsPanel).getByLabelText("Column name"), {
      target: { value: "id" },
    });
    fireEvent.change(within(columnsPanel).getByLabelText("Column data type"), {
      target: { value: "integer" },
    });
    fireEvent.click(screen.getByRole("tab", { name: /^Keys/ }));
    const keysPanel = document.querySelector(
      '[data-testid="create-table-keys-panel"]',
    ) as HTMLElement;
    fireEvent.click(within(keysPanel).getByLabelText("Primary key: id"));

    // Keys tab now reports `(1)` in its label text. The badge sits as
    // a child span with `ml-1` margin, so the accessible name's
    // computed string is "Keys(1)" without inter-word whitespace.
    await waitFor(() => {
      const keysTab = screen.getByRole("tab", { name: /^Keys.*\(1\)/ });
      expect(keysTab).toBeInTheDocument();
    });

    // The Indexes / Constraints badges remain hidden because their
    // declared lists are still empty (the tabs themselves still exist
    // — `Indexes` and `Constraints` — but neither carries a `(...)`
    // suffix in its accessible name).
    expect(screen.queryByRole("tab", { name: /^Indexes.*\(\d+\)/ })).toBeNull();
    expect(screen.queryByRole("tab", { name: /^Constraints.*\(/ })).toBeNull();
  });

  // Sprint 234 AC-234-02 — locked empty-state message surfaces when no
  // named column exists. Same string across all sub-tabs (Keys + the
  // sub-component bodies; the IndexesTabBody / ForeignKeysTabBody
  // strings are guarded by their own component tests).
  it("surfaces empty-state message when no named column exists (AC-234-02)", () => {
    renderDialog();
    // `^Keys` anchors so we don't activate "Foreign Keys" instead.
    fireEvent.click(screen.getByRole("tab", { name: /^Keys/ }));
    const keysPanel = document.querySelector(
      '[data-testid="create-table-keys-panel"]',
    ) as HTMLElement;
    expect(
      within(keysPanel).getByText(
        "Add named columns in the Columns tab to use this picker.",
      ),
    ).toBeInTheDocument();
  });

  // Sprint 234 AC-234-03 — Move column up/down buttons. Clicking them
  // swaps the column rows in place; ↑ disabled at row 0, ↓ disabled
  // at the last row.
  it("Move column up/down buttons reorder rows in place and disable at boundaries (AC-234-03)", () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /Add column/i }));
    fireEvent.click(screen.getByRole("button", { name: /Add column/i }));

    const columnsPanel = document.querySelector(
      '[data-testid="create-table-columns-panel"]',
    ) as HTMLElement;
    const nameInputs = within(columnsPanel).getAllByLabelText("Column name");
    fireEvent.change(nameInputs[0]!, { target: { value: "a" } });
    fireEvent.change(nameInputs[1]!, { target: { value: "b" } });
    fireEvent.change(nameInputs[2]!, { target: { value: "c" } });

    // Initial order: [a, b, c]. ↑ on row 0 disabled, ↓ on row 2 disabled.
    let upButtons = within(columnsPanel).getAllByRole("button", {
      name: /Move column up/i,
    });
    let downButtons = within(columnsPanel).getAllByRole("button", {
      name: /Move column down/i,
    });
    expect(upButtons).toHaveLength(3);
    expect(downButtons).toHaveLength(3);
    expect(upButtons[0]).toBeDisabled();
    expect(downButtons[2]).toBeDisabled();
    expect(upButtons[1]).not.toBeDisabled();
    expect(downButtons[1]).not.toBeDisabled();

    // Click ↓ on row 0 → swaps a and b. Order becomes [b, a, c].
    fireEvent.click(downButtons[0]!);
    const refreshedNames = within(columnsPanel)
      .getAllByLabelText("Column name")
      .map((el) => (el as HTMLInputElement).value);
    expect(refreshedNames).toEqual(["b", "a", "c"]);

    // Click ↑ on row 2 (now `c`) → swaps c and a. Order becomes [b, c, a].
    upButtons = within(columnsPanel).getAllByRole("button", {
      name: /Move column up/i,
    });
    fireEvent.click(upButtons[2]!);
    const refreshedNames2 = within(columnsPanel)
      .getAllByLabelText("Column name")
      .map((el) => (el as HTMLInputElement).value);
    expect(refreshedNames2).toEqual(["b", "c", "a"]);

    // ↑ on row 0 is still disabled (boundary defense).
    upButtons = within(columnsPanel).getAllByRole("button", {
      name: /Move column up/i,
    });
    downButtons = within(columnsPanel).getAllByRole("button", {
      name: /Move column down/i,
    });
    expect(upButtons[0]).toBeDisabled();
    expect(downButtons[2]).toBeDisabled();
  });

  // Sprint 234 AC-234-04 / Sprint 238 — reorder auto-refetches the
  // preview with the swapped column order. 더 이상 "Show DDL" 재클릭이
  // 필요하지 않다.
  it("reorder auto-refetches the preview with new column order (AC-234-04)", async () => {
    setDevConnection();
    useSafeModeStore.setState({ mode: "off" });
    mockCreateTable.mockResolvedValue({
      sql: 'CREATE TABLE "public"."events" ("id" integer, "name" text)',
    });
    renderDialog();
    fireEvent.change(screen.getByLabelText("Table name"), {
      target: { value: "events" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Add column/i }));
    const columnsPanel = document.querySelector(
      '[data-testid="create-table-columns-panel"]',
    ) as HTMLElement;
    const nameInputs = within(columnsPanel).getAllByLabelText("Column name");
    fireEvent.change(nameInputs[0]!, { target: { value: "id" } });
    fireEvent.change(nameInputs[1]!, { target: { value: "name" } });
    const typeInputs =
      within(columnsPanel).getAllByLabelText("Column data type");
    fireEvent.change(typeInputs[0]!, { target: { value: "integer" } });
    fireEvent.change(typeInputs[1]!, { target: { value: "text" } });

    await waitFor(() => expect(mockCreateTable).toHaveBeenCalledTimes(1));

    const downButtons = within(columnsPanel).getAllByRole("button", {
      name: /Move column down/i,
    });
    fireEvent.click(downButtons[0]!);

    await waitFor(() => expect(mockCreateTable).toHaveBeenCalledTimes(2));
    const second = mockCreateTable.mock.calls[1]![0] as {
      columns: Array<{ name: string }>;
    };
    expect(second.columns.map((c) => c.name)).toEqual(["name", "id"]);
  });
});

// ── Sprint 241 — inline FK + CHECK on column row ──────────────────────
//
// Date: 2026-05-08.
//
// Why these tests exist:
//
// Sprint 241 moves single-column FK + CHECK out of the Constraints tab
// and onto the column row itself (TablePlus parity). The column-row
// `+ FK` cell opens a popover for ref schema/table/column + ON
// DELETE/UPDATE; the inline `check expression (optional, …)` text
// input takes free-text expressions. Both feed the same constraint
// chain the Constraints tab does — auto-named `fk_<table>_<col>` /
// `chk_<table>_<col>` so multiple inline declarations don't collide.
// Multi-column variants stay in the Constraints tab; the tab now
// renders a one-line scope reminder.
//
// Per AC-241 contract Test Requirements: ≥ 4 cases — column-row UI
// presence, inline CHECK chain pickup, inline FK chain pickup, the
// Constraints-tab reminder copy.
describe("Sprint 241 — inline FK + CHECK on column row", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConnectionStore.setState({ connections: [] });
    useSafeModeStore.setState({ mode: "off" });
    useQueryHistoryStore.setState({ recentVisible: [] });
    mockCreateTable.mockResolvedValue({
      sql: 'CREATE TABLE "public"."t" ()',
    });
    mockAddConstraint.mockImplementation(
      async (req: {
        constraint_name: string;
        definition: { type: string };
      }) => ({
        sql: `-- ${req.definition.type} ${req.constraint_name}`,
      }),
    );
    setDevConnection();
  });

  it("renders the inline FK trigger + inline CHECK input on each column row", () => {
    renderDialog();
    const columnsPanel = getColumnsPanel();
    // Empty FK trigger label = `+ FK`.
    const fkTriggers = within(columnsPanel).getAllByLabelText(
      /Foreign key for column /i,
    );
    expect(fkTriggers).toHaveLength(1);
    expect(fkTriggers[0]!.textContent).toContain("+ FK");

    // Inline CHECK input.
    const chkInputs = within(columnsPanel).getAllByLabelText(
      "Column check expression",
    );
    expect(chkInputs).toHaveLength(1);
  });

  it("inline CHECK expression flows into the constraint chain with auto-name chk_<table>_<column>", async () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText("Table name"), {
      target: { value: "users" },
    });
    const columnsPanel = getColumnsPanel();
    const nameInput = within(columnsPanel).getByLabelText("Column name");
    fireEvent.change(nameInput, { target: { value: "age" } });
    const typeInput = within(columnsPanel).getByLabelText("Column data type");
    fireEvent.change(typeInput, { target: { value: "integer" } });
    const chkInput = within(columnsPanel).getByLabelText(
      "Column check expression",
    );
    fireEvent.change(chkInput, { target: { value: "age >= 0" } });

    await waitFor(() =>
      expect(mockAddConstraint).toHaveBeenCalledWith(
        expect.objectContaining({
          constraint_name: "chk_users_age",
          definition: { type: "check", expression: "age >= 0" },
        }),
      ),
    );
  });

  it("inline FK fields flow into the constraint chain with auto-name fk_<table>_<column>", async () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText("Table name"), {
      target: { value: "orders" },
    });
    const columnsPanel = getColumnsPanel();
    const nameInput = within(columnsPanel).getByLabelText("Column name");
    fireEvent.change(nameInput, { target: { value: "user_id" } });
    const typeInput = within(columnsPanel).getByLabelText("Column data type");
    fireEvent.change(typeInput, { target: { value: "integer" } });

    // Open the FK popover and fill ref_table + ref_column via the
    // free-text fallback inputs (cache is empty — no Select renders).
    const fkTrigger = within(columnsPanel).getByLabelText(
      /Foreign key for column /i,
    );
    fireEvent.click(fkTrigger);
    const refTableInput = await screen.findByLabelText(
      "Inline FK reference table",
    );
    fireEvent.change(refTableInput, { target: { value: "users" } });
    const refColumnInput = screen.getByLabelText("Inline FK reference column");
    fireEvent.change(refColumnInput, { target: { value: "id" } });

    await waitFor(() =>
      expect(mockAddConstraint).toHaveBeenCalledWith(
        expect.objectContaining({
          constraint_name: "fk_orders_user_id",
          definition: expect.objectContaining({
            type: "foreign_key",
            columns: ["user_id"],
            reference_table: "users",
            reference_columns: ["id"],
          }),
        }),
      ),
    );
  });

  it("Constraints tab surfaces the multi-column scope reminder", () => {
    // Sprint 241 — each sub-tab carries its own tailored scope
    // reminder (FK / CHECK / UNIQUE) rather than a single combined
    // message. The FK sub-tab is active by default; its reminder is
    // visible immediately after opening the parent Constraints tab.
    renderDialog();
    activateTab("Constraints");
    expect(
      screen.getByText(
        /Single-column foreign keys are edited inline on the column row/i,
      ),
    ).toBeInTheDocument();
  });
});

// ── Sprint 242 — IDENTITY (auto-increment) toggle ─────────────────────
//
// Date: 2026-05-08.
//
// Why these tests exist:
//
// Sprint 242 adds an `is_identity` flag to `ColumnDraft` + a per-row
// "Identity" checkbox. When checked, the dialog disables the row's
// `Nullable` + `default value` inputs (the IDENTITY sequence is the
// default; PG forces NOT NULL) and the `buildRequest` payload sets
// `is_identity: true` on the column's wire shape so the backend's PG
// emitter writes `GENERATED BY DEFAULT AS IDENTITY`.
describe("Sprint 242 — IDENTITY toggle on column row", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConnectionStore.setState({ connections: [] });
    useSafeModeStore.setState({ mode: "off" });
    useQueryHistoryStore.setState({ recentVisible: [] });
    mockCreateTable.mockResolvedValue({
      sql: 'CREATE TABLE "public"."t" ()',
    });
    setDevConnection();
  });

  it("renders the per-row Identity toggle next to Nullable", () => {
    renderDialog();
    const columnsPanel = getColumnsPanel();
    const identity = within(columnsPanel).getByLabelText("Column identity");
    expect(identity).toBeInTheDocument();
    expect((identity as HTMLInputElement).checked).toBe(false);
  });

  it("checking Identity disables Nullable + default-value inputs", () => {
    renderDialog();
    const columnsPanel = getColumnsPanel();
    fireEvent.click(within(columnsPanel).getByLabelText("Column identity"));
    expect(
      (
        within(columnsPanel).getByLabelText(
          "Column nullable",
        ) as HTMLInputElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        within(columnsPanel).getByLabelText(
          "Column default value",
        ) as HTMLInputElement
      ).disabled,
    ).toBe(true);
  });

  it("identity column flows into createTable wire payload as is_identity: true", async () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText("Table name"), {
      target: { value: "events" },
    });
    const columnsPanel = getColumnsPanel();
    fireEvent.change(within(columnsPanel).getByLabelText("Column name"), {
      target: { value: "id" },
    });
    fireEvent.change(within(columnsPanel).getByLabelText("Column data type"), {
      target: { value: "bigint" },
    });
    fireEvent.click(within(columnsPanel).getByLabelText("Column identity"));

    await waitFor(() =>
      expect(mockCreateTable).toHaveBeenCalledWith(
        expect.objectContaining({
          columns: expect.arrayContaining([
            expect.objectContaining({
              name: "id",
              data_type: "bigint",
              is_identity: true,
            }),
          ]),
        }),
      ),
    );
  });
});
