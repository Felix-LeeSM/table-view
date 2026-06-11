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
  PRE_PUSH_LOAD_TEST_TIMEOUT_MS,
  activateTab,
  getColumnsPanel,
  getKeysPanel,
  mockCreateIndex,
  mockCreateTable,
  mockDropIndex,
  renderDialog,
  setDevConnection,
  setProductionConnection,
  STALE_INDEX_PLACEHOLDER,
} from "./__tests__/createTableDialogTestHelpers";

// ── Sprint 228 — Indexes tab functional ─────────────────────────────────
//
// Date: 2026-05-07.
//
// Why this block exists:
//
// Sprint 227 left the Indexes tab as a stale Sprint 228
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

  it("Indexes tab no longer renders the stale Sprint 228 placeholder (AC-228-01)", () => {
    renderDialog();
    activateTab("Indexes");
    const panel = getIndexesPanel();
    expect(panel.textContent).not.toContain(STALE_INDEX_PLACEHOLDER);
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

  it(
    "mid-chain rejection leaves earlier index applied (no dropIndex rollback) (AC-228-07)",
    async () => {
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
    },
    PRE_PUSH_LOAD_TEST_TIMEOUT_MS,
  );

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
