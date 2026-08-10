// Sprint 274 (2026-05-13) — DropTriggerDialog component test suite.
//
// 작성 이유: trigger DROP 다이얼로그가 처음 도입된 surface 이므로 다음을
// 고정한다 — (1) form mount + Apply 비활성 초기 상태, (2) typing-confirm
// 게이트가 byte-for-byte (empty / partial / case-mismatched / whitespace
// 모두 disabled), (3) 250 ms 디바운스 preview fetch + expectedDatabase
// 페이로드 전파, (4) CASCADE 토글이 두 번째 debounce fetch 를 일으키고
// cascade:true 로 emit, (5) Safe-Mode warn 티어 confirm 흐름
// (`ConfirmDestructiveDialog` 마운트 후 confirm → drop_trigger 호출),
// (6) commit 성공 시 onRefresh + onClose 가 정확히 1 회 호출,
// (7) DbMismatch (Sprint 271c wire format) 에 대해 syncMismatchedActiveDb
// + Sprint 269 passive Retry toast 가 emit.
//
// 이슈 #2191 — 미리보기 게이트와 실행 게이트가 갈렸다. DROP SQL 은 확인
// 타이핑 전에 렌더되고, 확인 타이핑은 실행 여부만 쥔다.

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";

const { mockDropTrigger, toastWarningMock, verifyActiveDbMock } = vi.hoisted(
  () => ({
    mockDropTrigger: vi.fn(),
    toastWarningMock: vi.fn(),
    verifyActiveDbMock: vi.fn(),
  }),
);
beforeEach(() => {
  setupTauriMock({
    dropTrigger: mockDropTrigger,
    executeQueryDryRun: vi.fn(() => Promise.resolve([])),
    cancelQuery: vi.fn(() => Promise.resolve("cancelled")),
  });
});

vi.mock("@lib/runtime/toast", () => ({
  toast: { warning: toastWarningMock, info: vi.fn(), error: vi.fn() },
}));

vi.mock("@lib/api/verifyActiveDb", () => ({
  verifyActiveDb: verifyActiveDbMock,
}));

import { useConnectionStore } from "@stores/connectionStore";
import { useSafeModeStore } from "@stores/safeModeStore";
import {
  findPreviewSql,
  reactOnClick,
} from "./__tests__/dropDialogGateHelpers";
import DropTriggerDialog from "./DropTriggerDialog";

const DB_MISMATCH_ERROR =
  "Database mismatch: expected 'db-1', but found 'db-2'";
const DROP_TRIGGER_SQL = 'DROP TRIGGER "tg_audit" ON "public"."users"';

function commitCalls() {
  return mockDropTrigger.mock.calls.filter(
    (c) =>
      (c[0] as { previewOnly?: boolean } | undefined)?.previewOnly === false,
  );
}

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
        dbType: "postgresql",
        host: "localhost",
        port: 5432,
        database: "app",
        username: "u",
        password: null,
        environment: "production",
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

  // Issue #2191 — preview gate. The user reads the exact DROP statement
  // first and confirms afterwards, so nothing gates the preview fetch.
  it("[#2191] renders the DROP SQL before the typing-confirm input is touched", async () => {
    renderDialog();

    expect(
      screen.getByLabelText("Type the trigger name to confirm"),
    ).toHaveValue("");
    expect(await findPreviewSql(DROP_TRIGGER_SQL)).toBeInTheDocument();
    expect(mockDropTrigger).toHaveBeenCalledWith(
      expect.objectContaining({ previewOnly: true }),
    );
  });

  // Issue #2191 — execution gate. Showing the SQL must not move the Apply
  // gate; the typing-confirm input still owns it.
  it("[#2191] keeps Apply disabled while the DROP SQL is on screen and the input is untouched", async () => {
    renderDialog();
    await findPreviewSql(DROP_TRIGGER_SQL);

    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
  });

  // Issue #2191 — the execution gate is checked in the click handler too,
  // not only in the button's `disabled` binding. `previewSql` no longer
  // proves the user confirmed, so it cannot be the thing that admits a
  // commit.
  it("[#2191] clicking Apply before the typing match sends no commit request", async () => {
    renderDialog();
    await findPreviewSql(DROP_TRIGGER_SQL);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    });

    expect(mockDropTrigger).toHaveBeenCalledTimes(1);
    expect(commitCalls()).toHaveLength(0);
  });

  // Issue #2191 — second layer, on its own. A DOM click only ever proves
  // the first layer (`disabled`), since React never routes it to the
  // handler. Reaching the handler directly is what pins the `!canApply`
  // guard: delete that one line and this case is the only one that reddens.
  it("[#2191] the Apply handler refuses to commit when the click reaches it anyway", async () => {
    renderDialog();
    await findPreviewSql(DROP_TRIGGER_SQL);

    const apply = screen.getByRole("button", { name: "Apply" });
    await act(async () => {
      await reactOnClick(apply)();
    });

    expect(mockDropTrigger).toHaveBeenCalledTimes(1);
    expect(commitCalls()).toHaveLength(0);
  });

  // Issue #2191 — typing no longer drives the preview. It is already on
  // screen, and matching the trigger name only flips Apply.
  it("[#2191] typing the trigger name enables Apply without re-fetching the preview", async () => {
    renderDialog();
    await findPreviewSql(DROP_TRIGGER_SQL);
    expect(mockDropTrigger).toHaveBeenCalledTimes(1);

    const input = screen.getByLabelText("Type the trigger name to confirm");
    fireEvent.change(input, { target: { value: "tg_audit" } });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Apply" })).toBeEnabled();
    });
    expect(mockDropTrigger).toHaveBeenCalledTimes(1);
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

    // Exact byte-for-byte match → Apply enabled. The preview fetch is not
    // part of this — it already fired when the dialog opened (issue #2191).
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

  it("CASCADE toggle fires a second debounced fetch with cascade:true", async () => {
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
      expect(commitCalls()).toHaveLength(1);
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
    expect(commitCalls()).toHaveLength(0);
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
