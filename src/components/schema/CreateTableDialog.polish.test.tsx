import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { invalidatePostgresTypesCache } from "@hooks/usePostgresTypes";
import { useConnectionStore } from "@stores/connectionStore";
import { useSafeModeStore } from "@stores/safeModeStore";
import { useQueryHistoryStore } from "@stores/queryHistoryStore";
import {
  PRE_PUSH_LOAD_TEST_TIMEOUT_MS,
  mockCreateTable,
  mockListPostgresTypes,
  renderDialog,
  setDevConnection,
} from "./__tests__/createTableDialogTestHelpers";

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
  it(
    "Move column up/down buttons reorder rows in place and disable at boundaries (AC-234-03)",
    () => {
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
    },
    PRE_PUSH_LOAD_TEST_TIMEOUT_MS,
  );

  // Sprint 234 AC-234-04 / Sprint 238 — reorder auto-refetches the
  // preview with the swapped column order. 더 이상 "Show DDL" 재클릭이
  // 필요하지 않다.
  it(
    "reorder auto-refetches the preview with new column order (AC-234-04)",
    async () => {
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
    },
    PRE_PUSH_LOAD_TEST_TIMEOUT_MS,
  );
});
