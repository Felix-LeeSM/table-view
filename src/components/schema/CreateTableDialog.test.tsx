// Sprint 226 — `CreateTableDialog` test suite (Phase 27 / sprint 1).
//
// Date: 2026-05-06.
//
// Why this file exists:
// - Locks AC-226-03 (form behaviour: opens with one row, "+ Column" /
//   "−" buttons, PK live multi-select, Preview disabled until valid).
// - Locks AC-226-04 (preview→commit IPC sequence, history `source =
//   "ddl-structure"` on success, Safe Mode warn-cancel canonical
//   message verbatim, Safe Mode strict-block prevents commit closure).
// - The Sprint 214 `useDdlPreviewExecution` hook + Sprint 189
//   `useSafeModeGate` are reused as-is; this suite is the regression
//   anchor for the *new* Create surface, not the hook bodies.
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
} from "@testing-library/react";

const { mockCreateTable } = vi.hoisted(() => ({
  mockCreateTable: vi.fn(),
}));

vi.mock("@lib/tauri", () => ({
  createTable: mockCreateTable,
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
  }> = {},
) {
  const onClose = overrides.onClose ?? vi.fn();
  const onRefresh = overrides.onRefresh ?? vi.fn().mockResolvedValue(undefined);
  const schemaName = overrides.schemaName ?? "public";
  const view = render(
    <CreateTableDialog
      connectionId="conn-1"
      schemaName={schemaName}
      open
      onClose={onClose}
      onRefresh={onRefresh}
    />,
  );
  return { ...view, onClose, onRefresh };
}

describe("CreateTableDialog (Sprint 226)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConnectionStore.setState({ connections: [] });
    useSafeModeStore.setState({ mode: "off" });
    useQueryHistoryStore.setState({ entries: [] });
  });

  // ── AC-226-03 form behaviour ────────────────────────────────────────

  it("opens with exactly one empty column row", () => {
    renderDialog();
    // One column row → exactly one "Column name" input mounted on init.
    const colNameInputs = screen.getAllByLabelText("Column name");
    expect(colNameInputs).toHaveLength(1);
    // Schema is read-only and pre-filled.
    const schemaInput = screen.getByLabelText(
      "Schema name",
    ) as HTMLInputElement;
    expect(schemaInput.value).toBe("public");
    expect(schemaInput.readOnly).toBe(true);
  });

  it("adds a row when '+ Column' is clicked", () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /Add column/i }));
    expect(screen.getAllByLabelText("Column name")).toHaveLength(2);
  });

  it("removes a row when '−' is clicked but blocks the last one", () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /Add column/i }));
    expect(screen.getAllByLabelText("Column name")).toHaveLength(2);

    const removeButtons = screen.getAllByRole("button", {
      name: /Remove column/i,
    });
    // Remove the second row → back to one.
    fireEvent.click(removeButtons[1]!);
    expect(screen.getAllByLabelText("Column name")).toHaveLength(1);

    // Last-row remove is disabled (button still rendered but disabled
    // attribute prevents an onClick from removing the row).
    const lastRemove = screen.getByRole("button", { name: /Remove column/i });
    expect(lastRemove).toBeDisabled();
  });

  it("PK multi-select reflects column names live", () => {
    renderDialog();

    // No valid column name yet → PK list shows the empty placeholder.
    expect(
      screen.getByText(
        /Add a column with a name to choose primary key columns/,
      ),
    ).toBeInTheDocument();

    // Type a column name; PK checkbox surfaces with that name.
    const colNameInput = screen.getByLabelText("Column name");
    fireEvent.change(colNameInput, { target: { value: "id" } });
    expect(screen.getByLabelText("Primary key: id")).toBeInTheDocument();

    // Add a second column → second PK option appears.
    fireEvent.click(screen.getByRole("button", { name: /Add column/i }));
    const inputs = screen.getAllByLabelText("Column name");
    fireEvent.change(inputs[1]!, { target: { value: "tenant_id" } });
    expect(screen.getByLabelText("Primary key: tenant_id")).toBeInTheDocument();
  });

  it("disables Preview SQL until table name + ≥1 valid column", () => {
    renderDialog();
    const previewButton = screen.getByRole("button", { name: /Preview SQL/i });
    expect(previewButton).toBeDisabled();

    // Table name only → still disabled.
    fireEvent.change(screen.getByLabelText("Table name"), {
      target: { value: "events" },
    });
    expect(previewButton).toBeDisabled();

    // Add column name → still disabled (no data type).
    fireEvent.change(screen.getByLabelText("Column name"), {
      target: { value: "id" },
    });
    expect(previewButton).toBeDisabled();

    // Add data type → now enabled.
    fireEvent.change(screen.getByLabelText("Column data type"), {
      target: { value: "integer" },
    });
    expect(previewButton).not.toBeDisabled();
  });

  // ── AC-226-04 preview→commit IPC pipeline + Safe Mode ───────────────

  async function fillSimpleForm() {
    fireEvent.change(screen.getByLabelText("Table name"), {
      target: { value: "events" },
    });
    fireEvent.change(screen.getByLabelText("Column name"), {
      target: { value: "id" },
    });
    fireEvent.change(screen.getByLabelText("Column data type"), {
      target: { value: "integer" },
    });
  }

  it("issues preview→commit calls in exactly the [{preview_only:true},{preview_only:false}] sequence", async () => {
    setDevConnection();
    useSafeModeStore.setState({ mode: "off" });
    mockCreateTable.mockImplementation(async () => {
      // Fixture-shaped SQL — body content doesn't matter for the
      // sequence assertion as long as preview returns a string the
      // hook can `;`-split.
      return {
        sql: 'CREATE TABLE "public"."events" ("id" integer)',
      };
    });

    renderDialog();
    await fillSimpleForm();

    fireEvent.click(screen.getByRole("button", { name: /Preview SQL/i }));
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Execute/i }),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Execute/i }));

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
    // Order is exactly [true, false].
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

    fireEvent.click(screen.getByRole("button", { name: /Preview SQL/i }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Execute/i }),
      ).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /Execute/i }));

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
    // The hook's analyzer treats CREATE TABLE as safe — to force the
    // warn dialog we feed a preview SQL that includes a DROP statement
    // (analyzer flags DROP as `confirm`-tier in production+warn).
    mockCreateTable.mockResolvedValue({
      sql: 'DROP TABLE "public"."events"',
    });

    renderDialog();
    await fillSimpleForm();

    fireEvent.click(screen.getByRole("button", { name: /Preview SQL/i }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Execute/i }),
      ).toBeInTheDocument(),
    );

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /Execute/i }));
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

    // Byte-equivalent canonical message — matches sibling editors per
    // Sprint 214's `useDdlPreviewExecution.cancelDangerous`.
    await screen.findByText(
      "Safe Mode (warn): confirmation cancelled — no changes committed",
    );
    // Commit closure must NOT have run.
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

    fireEvent.click(screen.getByRole("button", { name: /Preview SQL/i }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Execute/i }),
      ).toBeInTheDocument(),
    );

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /Execute/i }));
    });

    // Strict-block surfaces the analyzer reason via previewError.
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

    fireEvent.click(screen.getByRole("button", { name: /Preview SQL/i }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Execute/i }),
      ).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /Execute/i }));

    await waitFor(() => {
      expect(onRefresh).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it("forwards the table name + columns + primary_key to the Tauri payload", async () => {
    setDevConnection();
    useSafeModeStore.setState({ mode: "off" });
    mockCreateTable.mockResolvedValue({
      sql: 'CREATE TABLE "public"."events" ("id" integer NOT NULL, PRIMARY KEY ("id"))',
    });

    renderDialog();
    fireEvent.change(screen.getByLabelText("Table name"), {
      target: { value: "events" },
    });
    fireEvent.change(screen.getByLabelText("Column name"), {
      target: { value: "id" },
    });
    fireEvent.change(screen.getByLabelText("Column data type"), {
      target: { value: "integer" },
    });
    // Toggle nullable off (NOT NULL).
    fireEvent.click(screen.getByLabelText("Column nullable"));
    // Mark as PK.
    fireEvent.click(screen.getByLabelText("Primary key: id"));

    fireEvent.click(screen.getByRole("button", { name: /Preview SQL/i }));
    await waitFor(() => expect(mockCreateTable).toHaveBeenCalledTimes(1));

    const previewCall = mockCreateTable.mock.calls[0]![0] as {
      schema: string;
      name: string;
      columns: Array<{
        name: string;
        data_type: string;
        nullable: boolean;
        default_value: string | null;
      }>;
      primary_key: string[] | null;
      preview_only: boolean;
    };
    expect(previewCall.schema).toBe("public");
    expect(previewCall.name).toBe("events");
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

  it("Cancel inside the SQL preview discards the commit closure", async () => {
    setDevConnection();
    useSafeModeStore.setState({ mode: "off" });
    mockCreateTable.mockResolvedValue({
      sql: 'CREATE TABLE "public"."events" ("id" integer)',
    });

    renderDialog();
    await fillSimpleForm();

    fireEvent.click(screen.getByRole("button", { name: /Preview SQL/i }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Execute/i }),
      ).toBeInTheDocument(),
    );

    // Cancel the SQL preview dialog — `handlePreviewCancel` →
    // `ddl.cancelPreview()` discards the commit closure. Use the
    // dialog's Cancel button.
    const cancelBtns = screen
      .getAllByRole("button", { name: /Cancel/i })
      .filter((b) => !b.hasAttribute("aria-label"));
    fireEvent.click(cancelBtns[cancelBtns.length - 1]!);

    // Only the preview_only:true call should have been made; commit
    // closure was never invoked.
    expect(mockCreateTable).toHaveBeenCalledTimes(1);
    expect(
      (mockCreateTable.mock.calls[0]![0] as { preview_only: boolean })
        .preview_only,
    ).toBe(true);
  });
});
