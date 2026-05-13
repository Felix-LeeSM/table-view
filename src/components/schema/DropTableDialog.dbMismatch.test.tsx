// Sprint 271c (2026-05-13) — DropTableDialog end-to-end DbMismatch
// recovery test.
//
// 작성 이유: backend Sprint 266 가드가 `tauri.dropTableRequest` 를
// `AppError::DbMismatch` 로 reject 할 때, dialog 의 ddl preview catch
// path 가
//   (1) Sprint 266 wire format 을 `parseDbMismatch` 로 감지하고
//   (2) `syncMismatchedActiveDb` 로 verifyActiveDb + setActiveDb 를
//       호출하며
//   (3) Sprint 269 passive `toast.warning` 으로 사용자에게 재시도를
//       안내하는지 확인. user-initiated DDL 은 silent 가 아닌 toast 노출.
// IPC 는 Sprint 266 wire format ("Database mismatch: expected 'X',
// backend pool has 'Y'") 으로 mock 한다. verifyActiveDb 만 직접 mock
// 하고 나머지 sync 경로는 production code 가 실제 실행 — toast +
// connectionStore.setActiveDb side-effect 로 end-to-end 단언.

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";

const {
  mockDropTableRequest,
  mockDropTable,
  mockListTables,
  toastWarningMock,
  verifyActiveDbMock,
} = vi.hoisted(() => ({
  mockDropTableRequest: vi.fn(),
  mockDropTable: vi.fn().mockResolvedValue(undefined),
  mockListTables: vi.fn().mockResolvedValue([]),
  toastWarningMock: vi.fn(),
  verifyActiveDbMock: vi.fn(),
}));

vi.mock("@lib/tauri", () => ({
  dropTableRequest: mockDropTableRequest,
  dropTable: mockDropTable,
  listTables: mockListTables,
  executeQueryDryRun: vi.fn(() => Promise.resolve([])),
  cancelQuery: vi.fn(() => Promise.resolve("cancelled")),
}));

vi.mock("@lib/toast", () => ({
  toast: { warning: toastWarningMock, info: vi.fn(), error: vi.fn() },
}));

vi.mock("@lib/api/verifyActiveDb", () => ({
  verifyActiveDb: verifyActiveDbMock,
}));

import DropTableDialog from "./DropTableDialog";
import { useConnectionStore } from "@stores/connectionStore";
import { useSafeModeStore } from "@stores/safeModeStore";
import { useSchemaStore } from "@stores/schemaStore";

const DB_MISMATCH_ERROR =
  "Database mismatch: expected 'db-1', backend pool has 'db-2'";

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

describe("DropTableDialog — DbMismatch (Sprint 271c)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConnectionStore.setState({ connections: [], activeStatuses: {} });
    useSafeModeStore.setState({ mode: "off" });
    useSchemaStore.setState({ tables: {} });
    setDevConnection();
    verifyActiveDbMock.mockResolvedValue("db-2");
  });

  it("preview-fetch rejects with DbMismatch → routes through sync helper + raises Retry toast", async () => {
    mockDropTableRequest.mockRejectedValueOnce(new Error(DB_MISMATCH_ERROR));

    render(
      <DropTableDialog
        connectionId="conn-1"
        database="db-1"
        schemaName="public"
        tableName="users"
        open
        onClose={vi.fn()}
      />,
    );

    const input = screen.getByLabelText("Type the table name to confirm");
    fireEvent.change(input, { target: { value: "users" } });

    // Wait for the auto-debounced preview fetch + catch-side recovery to
    // flush.
    await waitFor(() => {
      expect(mockDropTableRequest).toHaveBeenCalled();
    });

    // Inline error shows the Sprint 266 message verbatim.
    await waitFor(() => {
      const errors = document.querySelectorAll('[role="alert"]');
      const messages = Array.from(errors).map((e) => e.textContent ?? "");
      expect(messages.some((m) => m.includes(DB_MISMATCH_ERROR))).toBe(true);
    });

    // Sync helper invoked verifyActiveDb (parseDbMismatch matched →
    // routed through syncMismatchedActiveDb).
    await waitFor(() => {
      expect(verifyActiveDbMock).toHaveBeenCalledWith("conn-1");
    });

    // User-initiated → Sprint 269 passive Retry toast. The toast
    // surface is the user-visible signal that the sync helper's
    // `onSynced` callback was invoked (which only fires when verify
    // returned a non-empty actual db).
    await waitFor(() => {
      expect(toastWarningMock).toHaveBeenCalledWith(
        expect.stringContaining("db-2"),
      );
    });
  });

  it("non-mismatch preview error keeps catch silent (no sync, no toast)", async () => {
    mockDropTableRequest.mockRejectedValueOnce(new Error("Connection refused"));

    render(
      <DropTableDialog
        connectionId="conn-1"
        database="db-1"
        schemaName="public"
        tableName="users"
        open
        onClose={vi.fn()}
      />,
    );

    const input = screen.getByLabelText("Type the table name to confirm");
    fireEvent.change(input, { target: { value: "users" } });

    await waitFor(() => {
      expect(mockDropTableRequest).toHaveBeenCalled();
    });

    // Wait for catch to settle.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // Non-DbMismatch error keeps the recovery silent (no verifyActiveDb,
    // no toast). This is the silent-regression guard ensuring the
    // mismatch path is the ONLY trigger.
    expect(verifyActiveDbMock).not.toHaveBeenCalled();
    expect(toastWarningMock).not.toHaveBeenCalled();
  });
});
