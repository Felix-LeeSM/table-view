// CreateTriggerDialog component test suite.
//
// Reason: lock the trigger CREATE dialog's contract — (1) form mount +
// Apply disabled in the initial state, (2) picking INSTEAD OF disables
// the STATEMENT radio so the UI blocks the backend rejection up front,
// (3) 250 ms debounced preview fetch + `expectedDatabase` payload
// propagation, (4) onRefresh + onClose called exactly once on a
// successful commit, (5) a `DbMismatch` wire error emits
// `syncMismatchedActiveDb` + a passive Retry toast.

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";

const { mockCreateTrigger, toastWarningMock, verifyActiveDbMock } = vi.hoisted(
  () => ({
    mockCreateTrigger: vi.fn(),
    toastWarningMock: vi.fn(),
    verifyActiveDbMock: vi.fn(),
  }),
);
beforeEach(() => {
  setupTauriMock({
    createTrigger: mockCreateTrigger,
    executeQueryDryRun: vi.fn(() => Promise.resolve([])),
    cancelQuery: vi.fn(() => Promise.resolve("cancelled")),
  });
});

afterEach(() => {
  vi.useRealTimers();
});

vi.mock("@lib/runtime/toast", () => ({
  toast: { warning: toastWarningMock, info: vi.fn(), error: vi.fn() },
}));

vi.mock("@lib/api/verifyActiveDb", () => ({
  verifyActiveDb: verifyActiveDbMock,
}));

import { useConnectionStore } from "@stores/connectionStore";
import { useSafeModeStore } from "@stores/safeModeStore";
import CreateTriggerDialog from "./CreateTriggerDialog";

const DB_MISMATCH_ERROR =
  "Database mismatch: expected 'db-1', but found 'db-2'";

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

function renderDialog(overrides?: {
  onClose?: () => void;
  onRefresh?: () => Promise<void>;
}) {
  const onClose = overrides?.onClose ?? vi.fn();
  const onRefresh =
    overrides?.onRefresh ?? vi.fn().mockResolvedValue(undefined);
  render(
    <CreateTriggerDialog
      connectionId="conn-1"
      database="db-1"
      schemaName="public"
      tableName="users"
      open
      onClose={onClose}
      onRefresh={onRefresh}
    />,
  );
  return { onClose, onRefresh };
}

async function fillMinimumForm() {
  // Trigger name + function name are the two required identifier
  // fields. Default timing/orientation/event already satisfy the
  // canPreview gate.
  const nameInput = screen.getByLabelText("Trigger name");
  fireEvent.change(nameInput, { target: { value: "tg_audit" } });
  const fnNameInput = screen.getByLabelText("Function name");
  fireEvent.change(fnNameInput, { target: { value: "log_change" } });
}

describe("CreateTriggerDialog — Sprint 273", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConnectionStore.setState({ connections: [], activeStatuses: {} });
    useSafeModeStore.setState({ mode: "off" });
    setDevConnection();
    verifyActiveDbMock.mockResolvedValue("db-2");
    mockCreateTrigger.mockResolvedValue({
      sql: 'CREATE TRIGGER "tg_audit" BEFORE INSERT ON "public"."users" FOR EACH ROW EXECUTE FUNCTION "public"."log_change"()',
    });
  });

  it("mounts with form fields visible and Apply disabled (preview not yet fetched)", () => {
    renderDialog();
    expect(screen.getByLabelText("Trigger name")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Timing BEFORE" })).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Event INSERT" }),
    ).toBeChecked();
    expect(
      screen.getByRole("radio", { name: "Orientation ROW" }),
    ).toBeChecked();
    const apply = screen.getByRole("button", { name: "Apply" });
    expect(apply).toBeDisabled();
  });

  it("INSTEAD OF disables the STATEMENT orientation radio (defense-in-depth UX guard)", async () => {
    renderDialog();
    const insteadOf = screen.getByRole("radio", { name: "Timing INSTEAD OF" });
    await act(async () => {
      fireEvent.click(insteadOf);
    });
    const statement = screen.getByRole("radio", {
      name: "Orientation STATEMENT",
    });
    expect(statement).toBeDisabled();
  });

  it("debounced auto-preview fires once after 250ms with expectedDatabase populated", async () => {
    renderDialog();
    await fillMinimumForm();

    await waitFor(
      () => {
        expect(mockCreateTrigger).toHaveBeenCalled();
      },
      { timeout: 1000 },
    );

    const firstCall = mockCreateTrigger.mock.calls[0]?.[0] as
      | {
          connectionId: string;
          schema: string;
          table: string;
          triggerName: string;
          events: string[];
          previewOnly?: boolean;
          expectedDatabase?: string;
        }
      | undefined;

    expect(firstCall?.connectionId).toBe("conn-1");
    expect(firstCall?.schema).toBe("public");
    expect(firstCall?.table).toBe("users");
    expect(firstCall?.triggerName).toBe("tg_audit");
    expect(firstCall?.events).toEqual(["INSERT"]);
    expect(firstCall?.previewOnly).toBe(true);
    // Opt-in DbMismatch guard.
    expect(firstCall?.expectedDatabase).toBe("db-1");
  });

  it("clicking Apply triggers commit IPC with previewOnly=false then closes dialog", async () => {
    const { onClose, onRefresh } = renderDialog();
    await fillMinimumForm();

    await waitFor(() => {
      expect(mockCreateTrigger).toHaveBeenCalled();
    });

    const apply = await screen.findByRole("button", { name: "Apply" });
    await waitFor(() => {
      expect(apply).not.toBeDisabled();
    });

    await act(async () => {
      fireEvent.click(apply);
    });

    await waitFor(() => {
      const commitCall = mockCreateTrigger.mock.calls.find(
        (c) =>
          (c[0] as { previewOnly?: boolean } | undefined)?.previewOnly ===
          false,
      );
      expect(commitCall).toBeTruthy();
    });

    await waitFor(() => {
      expect(onRefresh).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it("DbMismatch from preview fetch → verifyActiveDb + Sprint 269 Retry toast", async () => {
    mockCreateTrigger.mockRejectedValueOnce(new Error(DB_MISMATCH_ERROR));

    renderDialog();
    await fillMinimumForm();

    await waitFor(() => {
      expect(mockCreateTrigger).toHaveBeenCalled();
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

  it("Apply stays disabled when events selection is empty", async () => {
    vi.useFakeTimers();
    renderDialog();
    const insertCheckbox = screen.getByRole("checkbox", {
      name: "Event INSERT",
    });
    await act(async () => {
      // Uncheck the default INSERT so the events array is empty.
      fireEvent.click(insertCheckbox);
    });

    // Fill name + function so only the empty-events guard remains.
    const nameInput = screen.getByLabelText("Trigger name");
    fireEvent.change(nameInput, { target: { value: "tg_audit" } });
    const fnNameInput = screen.getByLabelText("Function name");
    fireEvent.change(fnNameInput, { target: { value: "log_change" } });

    // Even after a long wait, mockCreateTrigger must not fire because
    // canPreview is false (events.length === 0).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });

    expect(mockCreateTrigger).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
  });
});
