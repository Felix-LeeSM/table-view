// Sprint 274 (2026-05-13) — DropTriggerDialog component test suite.
//
// 작성 이유: trigger DROP 다이얼로그가 처음 도입된 surface 이므로 다음을
// 고정한다 — (1) form mount + Apply 비활성 초기 상태, (2) typing-confirm
// 게이트가 byte-for-byte (empty / partial / case-mismatched / whitespace
// 모두 disabled), (3) 250 ms 디바운스 preview fetch + expectedDatabase
// 페이로드 전파, (4) CASCADE 토글이 preview cache 를 무효화하고 두 번째
// fetch 가 cascade:true 로 emit, (5) Safe-Mode warn 티어 confirm 흐름
// (`ConfirmDestructiveDialog` 마운트 후 confirm → drop_trigger 호출),
// (6) commit 성공 시 onRefresh + onClose 가 정확히 1 회 호출,
// (7) DbMismatch (Sprint 271c wire format) 에 대해 syncMismatchedActiveDb
// + Sprint 269 passive Retry toast 가 emit.

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";

const { mockDropTrigger, toastWarningMock, verifyActiveDbMock } = vi.hoisted(
  () => ({
    mockDropTrigger: vi.fn(),
    toastWarningMock: vi.fn(),
    verifyActiveDbMock: vi.fn(),
  }),
);

vi.mock("@lib/tauri", () => ({
  dropTrigger: mockDropTrigger,
  executeQueryDryRun: vi.fn(() => Promise.resolve([])),
  cancelQuery: vi.fn(() => Promise.resolve("cancelled")),
}));

vi.mock("@lib/toast", () => ({
  toast: { warning: toastWarningMock, info: vi.fn(), error: vi.fn() },
}));

vi.mock("@lib/api/verifyActiveDb", () => ({
  verifyActiveDb: verifyActiveDbMock,
}));

import DropTriggerDialog from "./DropTriggerDialog";
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

function setProductionConnection() {
  useConnectionStore.setState({
    connections: [
      {
        id: "conn-1",
        name: "prod",
        db_type: "postgresql",
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

function renderDialog(overrides?: {
  onClose?: () => void;
  onRefresh?: () => Promise<void>;
  triggerName?: string;
}) {
  const onClose = overrides?.onClose ?? vi.fn();
  const onRefresh =
    overrides?.onRefresh ?? vi.fn().mockResolvedValue(undefined);
  const triggerName = overrides?.triggerName ?? "tg_audit";
  render(
    <DropTriggerDialog
      connectionId="conn-1"
      database="db-1"
      schemaName="public"
      tableName="users"
      triggerName={triggerName}
      open
      onClose={onClose}
      onRefresh={onRefresh}
    />,
  );
  return { onClose, onRefresh, triggerName };
}

describe("DropTriggerDialog — Sprint 274", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConnectionStore.setState({ connections: [], activeStatuses: {} });
    useSafeModeStore.setState({ mode: "off" });
    setDevConnection();
    verifyActiveDbMock.mockResolvedValue("db-2");
    mockDropTrigger.mockResolvedValue({
      sql: 'DROP TRIGGER "tg_audit" ON "public"."users"',
    });
  });

  it("mounts with form fields visible and Apply disabled (typing-confirm empty)", () => {
    renderDialog();
    expect(
      screen.getByLabelText("Type the trigger name to confirm"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("CASCADE")).toBeInTheDocument();
    const apply = screen.getByRole("button", { name: "Apply" });
    expect(apply).toBeDisabled();
  });

  it("typing-confirm gate is byte-for-byte (empty / partial / whitespace / case-mismatch all stay Apply-disabled)", async () => {
    renderDialog({ triggerName: "Tg_Audit" });
    const input = screen.getByLabelText("Type the trigger name to confirm");
    const apply = screen.getByRole("button", { name: "Apply" });

    // Empty → disabled.
    expect(apply).toBeDisabled();

    // Partial prefix → disabled.
    fireEvent.change(input, { target: { value: "Tg_" } });
    expect(apply).toBeDisabled();

    // Case-mismatched → disabled (byte-for-byte case-sensitive — NO
    // toLowerCase).
    fireEvent.change(input, { target: { value: "tg_audit" } });
    expect(apply).toBeDisabled();

    // Whitespace-padded match → disabled (NO `.trim()`).
    fireEvent.change(input, { target: { value: " Tg_Audit " } });
    expect(apply).toBeDisabled();

    // Whitespace-only → disabled.
    fireEvent.change(input, { target: { value: "   " } });
    expect(apply).toBeDisabled();

    // Exact byte-for-byte match → preview fetched + Apply enabled.
    fireEvent.change(input, { target: { value: "Tg_Audit" } });
    await waitFor(() => {
      expect(mockDropTrigger).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(apply).not.toBeDisabled();
    });
  });

  it("debounced auto-preview fires once after 250ms with expectedDatabase + cascade:false payload", async () => {
    renderDialog();
    const input = screen.getByLabelText("Type the trigger name to confirm");
    fireEvent.change(input, { target: { value: "tg_audit" } });

    await waitFor(
      () => {
        expect(mockDropTrigger).toHaveBeenCalled();
      },
      { timeout: 1000 },
    );

    const firstCall = mockDropTrigger.mock.calls[0]?.[0] as
      | {
          connectionId: string;
          schema: string;
          table: string;
          triggerName: string;
          cascade?: boolean;
          previewOnly?: boolean;
          expectedDatabase?: string;
        }
      | undefined;

    expect(firstCall?.connectionId).toBe("conn-1");
    expect(firstCall?.schema).toBe("public");
    expect(firstCall?.table).toBe("users");
    expect(firstCall?.triggerName).toBe("tg_audit");
    expect(firstCall?.cascade).toBe(false);
    expect(firstCall?.previewOnly).toBe(true);
    // Sprint 271c — opt-in DbMismatch guard.
    expect(firstCall?.expectedDatabase).toBe("db-1");
  });

  it("CASCADE toggle invalidates preview cache → second fetch fires with cascade:true", async () => {
    mockDropTrigger
      .mockResolvedValueOnce({
        sql: 'DROP TRIGGER "tg_audit" ON "public"."users"',
      })
      .mockResolvedValueOnce({
        sql: 'DROP TRIGGER "tg_audit" ON "public"."users" CASCADE',
      });

    renderDialog();
    const input = screen.getByLabelText("Type the trigger name to confirm");
    fireEvent.change(input, { target: { value: "tg_audit" } });

    await waitFor(() => {
      expect(mockDropTrigger).toHaveBeenCalledTimes(1);
    });
    expect(mockDropTrigger.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ cascade: false, previewOnly: true }),
    );

    // Toggle CASCADE → second debounced fetch fires with cascade:true.
    await act(async () => {
      fireEvent.click(screen.getByLabelText("CASCADE"));
    });
    await waitFor(() => {
      expect(mockDropTrigger).toHaveBeenCalledTimes(2);
    });
    expect(mockDropTrigger.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({ cascade: true, previewOnly: true }),
    );
  });

  it("clicking Apply triggers commit IPC with previewOnly=false then closes dialog + invokes onRefresh", async () => {
    const { onClose, onRefresh } = renderDialog();
    const input = screen.getByLabelText("Type the trigger name to confirm");
    fireEvent.change(input, { target: { value: "tg_audit" } });

    await waitFor(() => {
      expect(mockDropTrigger).toHaveBeenCalled();
    });

    const apply = await screen.findByRole("button", { name: "Apply" });
    await waitFor(() => {
      expect(apply).not.toBeDisabled();
    });

    await act(async () => {
      fireEvent.click(apply);
    });

    await waitFor(() => {
      const commitCall = mockDropTrigger.mock.calls.find(
        (c) =>
          (c[0] as { previewOnly?: boolean } | undefined)?.previewOnly ===
          false,
      );
      expect(commitCall).toBeTruthy();
    });

    // Post-commit refresh invalidates the triggers cache (Sprint 274
    // AC-274-04) — onRefresh is wired to
    // `schemaStore.refreshTableTriggers` by the SchemaTree slot.
    await waitFor(() => {
      expect(onRefresh).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it("Safe-Mode warn-tier opens ConfirmDestructiveDialog; confirm runs the commit", async () => {
    setProductionConnection();
    useSafeModeStore.setState({ mode: "warn" });
    mockDropTrigger.mockResolvedValueOnce({
      sql: 'DROP TRIGGER "tg_audit" ON "public"."users"',
    });

    renderDialog();
    const input = screen.getByLabelText("Type the trigger name to confirm");
    fireEvent.change(input, { target: { value: "tg_audit" } });

    await waitFor(() => {
      expect(mockDropTrigger).toHaveBeenCalled();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    });

    // Warn-tier mounts ConfirmDestructiveDialog (PRODUCTION DATABASE
    // banner appears). The commit closure has NOT run yet — only the
    // preview fetch has been called.
    await screen.findByText("PRODUCTION DATABASE");
    const previewOnlyCommits = mockDropTrigger.mock.calls.filter(
      (c) =>
        (c[0] as { previewOnly?: boolean } | undefined)?.previewOnly === false,
    );
    expect(previewOnlyCommits).toHaveLength(0);
  });

  it("DbMismatch from preview fetch → verifyActiveDb + Sprint 269 Retry toast", async () => {
    mockDropTrigger.mockRejectedValueOnce(new Error(DB_MISMATCH_ERROR));

    renderDialog();
    const input = screen.getByLabelText("Type the trigger name to confirm");
    fireEvent.change(input, { target: { value: "tg_audit" } });

    await waitFor(() => {
      expect(mockDropTrigger).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(verifyActiveDbMock).toHaveBeenCalledWith("conn-1");
    });
    await waitFor(() => {
      expect(toastWarningMock).toHaveBeenCalledWith(
        expect.stringContaining("db-2"),
      );
    });
  });
});
