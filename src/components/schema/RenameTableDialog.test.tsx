// Sprint 235 (AC-235-01..AC-235-04, AC-235-09) — RenameTableDialog test
// suite. Date: 2026-05-07.
//
// Why this file exists:
// - AC-235-01 / AC-235-03: assert IPC payload sent on Show DDL +
//   Apply matches the Rust `RenameTableRequest` shape (camelCase wire
//   form via serde rename) and that the call sequence is exactly
//   `[{ previewOnly: true }, { previewOnly: false }]`.
// - AC-235-04: form behaviour — pre-fill from `tableName`, Apply
//   disabled at name == current, identifier validation surfaces inline,
//   commit-success closes modal + onClose called.
// - AC-235-09: invalid identifier surfaces the inline error + keeps
//   Apply disabled (wire-up). The full reject matrix (space / quote /
//   leading-digit / >63 bytes / NULL / empty) was pushed down to the
//   `validateIdentifier` util unit test (./identifier.test.ts) in issue
//   #1626 (2026-07-22) — one representative case stays here.
//
// Mock pattern: `vi.hoisted` + factory mock for `@lib/tauri` so
// `tauri.renameTableRequest` is re-bindable inside test bodies.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
  cleanup,
} from "@testing-library/react";

const { mockRenameTableRequest, mockListTables, mockRenameTable } = vi.hoisted(
  () => ({
    mockRenameTableRequest: vi.fn(),
    mockListTables: vi.fn().mockResolvedValue([]),
    mockRenameTable: vi.fn().mockResolvedValue(undefined),
  }),
);
beforeEach(() => {
  setupTauriMock({
    renameTableRequest: mockRenameTableRequest,
    listTables: mockListTables,
    renameTable: mockRenameTable,
  });
});

import RenameTableDialog from "./RenameTableDialog";
import { useConnectionStore } from "@stores/connectionStore";
import { useSafeModeStore } from "@stores/safeModeStore";
import { useQueryHistoryStore } from "@stores/queryHistoryStore";
import { useSchemaStore } from "@stores/schemaStore";

function setDevConnection() {
  useConnectionStore.setState({
    connections: [
      {
        id: "conn-1",
        name: "dev",
        db_type: "postgresql",
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
    schemaName: string;
    tableName: string;
  }> = {},
) {
  const onClose = overrides.onClose ?? vi.fn();
  const schemaName = overrides.schemaName ?? "public";
  const tableName = overrides.tableName ?? "users";
  const view = render(
    <RenameTableDialog
      connectionId="conn-1"
      database="db-1"
      schemaName={schemaName}
      tableName={tableName}
      open
      onClose={onClose}
    />,
  );
  return { ...view, onClose, schemaName, tableName };
}

describe("RenameTableDialog (Sprint 235)", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    useConnectionStore.setState({ connections: [] });
    useSafeModeStore.setState({ mode: "off" });
    useQueryHistoryStore.setState({ recentVisible: [] });
    // Reset the schemaStore so renameTable mutation doesn't carry
    // state across tests.
    useSchemaStore.setState({ tables: {} });
    setDevConnection();
    mockRenameTableRequest.mockResolvedValue({
      sql: 'ALTER TABLE "public"."users" RENAME TO "people"',
    });
    mockListTables.mockResolvedValue([]);
  });

  // AC-235-04 — opens with the current table name pre-filled.
  it("[AC-235-04] opens with current table name pre-filled in input", () => {
    renderDialog({ tableName: "users" });
    const input = screen.getByLabelText("New table name") as HTMLInputElement;
    expect(input.value).toBe("users");
  });

  // AC-235-04 — Apply disabled when input == current name.
  it("[AC-235-04] Apply disabled when input matches current name (rename-to-self pre-check)", () => {
    renderDialog({ tableName: "users" });
    const apply = screen.getByRole("button", { name: "Apply" });
    expect(apply).toBeDisabled();
  });

  // AC-235-04 / AC-235-09 — wire-up: an invalid identifier surfaces the
  // inline error AND keeps Apply disabled. The full reject matrix lives
  // in ./identifier.test.ts (issue #1626, 2026-07-22); embedded space is
  // the representative invalid input.
  it("[AC-235-04][AC-235-09] invalid identifier shows inline error + keeps Apply disabled", () => {
    renderDialog({ tableName: "users" });
    const input = screen.getByLabelText("New table name");
    fireEvent.change(input, { target: { value: "bad name" } });
    expect(
      screen.getByLabelText("Identifier validation error"),
    ).toHaveTextContent(/letter or underscore/);
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
  });

  // AC-235-01 / AC-235-03 — IPC sequence + payload shape.
  it("[AC-235-01][AC-235-03] Show DDL fires renameTableRequest with previewOnly:true + camelCase fields", async () => {
    renderDialog({ schemaName: "public", tableName: "users" });
    const input = screen.getByLabelText("New table name");
    await act(async () => {
      fireEvent.change(input, { target: { value: "people" } });
    });
    // Sprint 239 — preview pane defaults open; auto-debounced fetch settles via waitFor below.
    await waitFor(() => {
      expect(mockRenameTableRequest).toHaveBeenCalledTimes(1);
    });
    expect(mockRenameTableRequest).toHaveBeenCalledWith({
      connectionId: "conn-1",
      schema: "public",
      table: "users",
      newName: "people",
      previewOnly: true,
      // Sprint 271c — opt-in DbMismatch guard forwards workspace db.
      expectedDatabase: "db-1",
    });
  });

  it("[AC-235-04] commit-success closes modal + calls onClose once", async () => {
    const onClose = vi.fn();
    renderDialog({ tableName: "users", onClose });
    const input = screen.getByLabelText("New table name");
    await act(async () => {
      fireEvent.change(input, { target: { value: "people" } });
    });
    // Sprint 239 — preview pane defaults open; auto-debounced fetch settles via waitFor below.
    await waitFor(() => {
      expect(mockRenameTableRequest).toHaveBeenCalled();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    });
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    // Sprint 223 useSchemaTableMutations calls schemaStore.renameTable
    // which in turn calls tauri.renameTable (compat positional wrapper).
    // Sprint 271c — `expectedDatabase` last-positional propagated.
    expect(mockRenameTable).toHaveBeenCalledWith(
      "conn-1",
      "users",
      "public",
      "people",
      "db-1",
    );
  });

  // Purpose: audit-residual error-branch + keyboard coverage for the
  // Sprint 235 RenameTableDialog — preview/commit reject must surface an
  // inline alert while the modal stays open (P4 parity with the success
  // path), and the Enter-key submit path must commit. Mirrors the
  // DropColumnDialog reject pattern (DropColumnDialog.test.tsx:385).
  // Issue #1630 (2026-07-24) — 2026-07-17 test audit residual.
  describe("error branches + Enter-key submit (issue #1630)", () => {
    // Reason: preview reject (previewOnly:true renameTableRequest throws)
    // → previewError surfaces as role="alert" + modal stays open
    // (onClose NOT called). Issue #1630 (2026-07-24).
    it("preview reject surfaces inline alert + keeps modal open", async () => {
      mockRenameTableRequest.mockRejectedValueOnce(
        new Error("permission denied for schema public"),
      );
      const onClose = vi.fn();
      renderDialog({ tableName: "users", onClose });
      const input = screen.getByLabelText("New table name");
      fireEvent.change(input, { target: { value: "people" } });
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(/permission denied/);
      expect(onClose).not.toHaveBeenCalled();
    });

    // Reason: commit reject (previewOnly:false renameTable mutation
    // throws) → previewError surfaces as role="alert" + modal stays open
    // (onClose NOT called). Equal weight to commit-success (P4).
    // Issue #1630 (2026-07-24).
    it("commit reject surfaces inline alert + keeps modal open", async () => {
      mockRenameTable.mockRejectedValueOnce(
        new Error('relation "people" already exists'),
      );
      const onClose = vi.fn();
      renderDialog({ tableName: "users", onClose });
      const input = screen.getByLabelText("New table name");
      await act(async () => {
        fireEvent.change(input, { target: { value: "people" } });
      });
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Apply" })).toBeEnabled();
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Apply" }));
      });
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(/already exists/);
      expect(onClose).not.toHaveBeenCalled();
    });

    // Reason: Enter key in the name input runs the commit path
    // (onKeyDown → handleApply) — keyboard parity with the Apply button.
    // Previously unverified keyboard branch. Issue #1630 (2026-07-24).
    it("Enter key in name input submits the rename (keyboard path)", async () => {
      const onClose = vi.fn();
      renderDialog({ tableName: "users", onClose });
      const input = screen.getByLabelText("New table name");
      await act(async () => {
        fireEvent.change(input, { target: { value: "people" } });
      });
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Apply" })).toBeEnabled();
      });
      await act(async () => {
        fireEvent.keyDown(input, { key: "Enter" });
      });
      await waitFor(() => {
        expect(onClose).toHaveBeenCalledTimes(1);
      });
      expect(mockRenameTable).toHaveBeenCalledWith(
        "conn-1",
        "users",
        "public",
        "people",
        "db-1",
      );
    });
  });
});
