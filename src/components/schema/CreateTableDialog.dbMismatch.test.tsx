// Sprint 271c (2026-05-13) — CreateTableDialog end-to-end DbMismatch
// recovery test.
//
// 작성 이유: backend Sprint 266 가드가 `tauri.createTablePlan` 을
// `AppError::DbMismatch` 로 reject 할 때, dialog 의 ddl preview catch
// path 가 Sprint 266 wire format 을 인식하고 sync 헬퍼 + Retry toast
// 를 발사하는지 확인. CreateTableDialog 는 다른 DDL dialog 들과 달리
// `createTablePlan` 단일 IPC 로 N+1 fan-out 을 대체했기 때문에 그
// 단일 surface 의 mismatch 경로를 박제 — DDL 11 commands 중 가장
// 두꺼운 wrapper.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
  within,
} from "@testing-library/react";

const {
  mockCreateTablePlan,
  mockListPostgresTypes,
  toastWarningMock,
  verifyActiveDbMock,
} = vi.hoisted(() => ({
  mockCreateTablePlan: vi.fn(),
  mockListPostgresTypes: vi.fn().mockResolvedValue([]),
  toastWarningMock: vi.fn(),
  verifyActiveDbMock: vi.fn(),
}));
beforeEach(() => {
  setupTauriMock({
    createTable: vi.fn(),
    createTablePlan: mockCreateTablePlan,
    createIndex: vi.fn(),
    dropIndex: vi.fn(),
    addConstraint: vi.fn(),
    dropConstraint: vi.fn(),
    listPostgresTypes: mockListPostgresTypes,
    executeQueryDryRun: vi.fn(() => Promise.resolve([])),
    cancelQuery: vi.fn(() => Promise.resolve("cancelled")),
  });
});

afterEach(() => {
  vi.useRealTimers();
});

vi.mock("@lib/toast", () => ({
  toast: { warning: toastWarningMock, info: vi.fn(), error: vi.fn() },
}));

vi.mock("@lib/api/verifyActiveDb", () => ({
  verifyActiveDb: verifyActiveDbMock,
}));

import CreateTableDialog from "./CreateTableDialog";
import { useConnectionStore } from "@stores/connectionStore";
import { useSafeModeStore } from "@stores/safeModeStore";

const DB_MISMATCH_ERROR =
  "Database mismatch: expected 'db-1', backend pool has 'db-2'";

function setDevConnection() {
  useConnectionStore.setState({
    connections: [
      {
        id: "conn-1",
        name: "dev",
        dbType: "postgresql",
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

function getColumnsPanel(): HTMLElement {
  return document.querySelector(
    '[data-testid="create-table-columns-panel"]',
  ) as HTMLElement;
}

describe("CreateTableDialog — DbMismatch (Sprint 271c)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConnectionStore.setState({ connections: [], activeStatuses: {} });
    useSafeModeStore.setState({ mode: "off" });
    setDevConnection();
    verifyActiveDbMock.mockResolvedValue("db-2");
    mockListPostgresTypes.mockResolvedValue([]);
  });

  it("preview-fetch DbMismatch → verifyActiveDb + Sprint 269 Retry toast", async () => {
    mockCreateTablePlan.mockRejectedValueOnce(new Error(DB_MISMATCH_ERROR));

    render(
      <CreateTableDialog
        connectionId="conn-1"
        database="db-1"
        schemaName="public"
        open
        onClose={vi.fn()}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    // Fill the minimum form so canPreview becomes true and the
    // auto-debounced fetch fires.
    const columnsPanel = getColumnsPanel();
    const nameInput = screen.getByLabelText("Table name");
    fireEvent.change(nameInput, { target: { value: "new_table" } });
    const columnNameInput =
      within(columnsPanel).getAllByLabelText("Column name")[0]!;
    fireEvent.change(columnNameInput, { target: { value: "id" } });
    const typeInput = within(columnsPanel).getAllByRole("combobox")[0]!;
    fireEvent.change(typeInput, { target: { value: "integer" } });

    // Wait for the auto-debounced plan fetch to fire.
    await waitFor(() => {
      expect(mockCreateTablePlan).toHaveBeenCalled();
    });

    // Verify the request payload carried `expectedDatabase` (the
    // production wire-up — not a separate test, but a sanity check
    // alongside the recovery path).
    const firstCall = mockCreateTablePlan.mock.calls[0]?.[0] as
      | { expectedDatabase?: string }
      | undefined;
    expect(firstCall?.expectedDatabase).toBe("db-1");

    // parseDbMismatch matched → syncMismatchedActiveDb fired
    // verifyActiveDb.
    await waitFor(() => {
      expect(verifyActiveDbMock).toHaveBeenCalledWith("conn-1");
    });

    // User-initiated → Sprint 269 passive Retry toast.
    await waitFor(() => {
      expect(toastWarningMock).toHaveBeenCalledWith(
        expect.stringContaining("db-2"),
      );
    });
  });

  it("non-mismatch preview error keeps catch silent (no sync, no toast)", async () => {
    vi.useFakeTimers();
    mockCreateTablePlan.mockRejectedValueOnce(new Error("Connection refused"));

    render(
      <CreateTableDialog
        connectionId="conn-1"
        database="db-1"
        schemaName="public"
        open
        onClose={vi.fn()}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    const columnsPanel = getColumnsPanel();
    const nameInput = screen.getByLabelText("Table name");
    fireEvent.change(nameInput, { target: { value: "new_table" } });
    const columnNameInput =
      within(columnsPanel).getAllByLabelText("Column name")[0]!;
    fireEvent.change(columnNameInput, { target: { value: "id" } });
    const typeInput = within(columnsPanel).getAllByRole("combobox")[0]!;
    fireEvent.change(typeInput, { target: { value: "integer" } });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(mockCreateTablePlan).toHaveBeenCalled();

    expect(verifyActiveDbMock).not.toHaveBeenCalled();
    expect(toastWarningMock).not.toHaveBeenCalled();
  });
});
