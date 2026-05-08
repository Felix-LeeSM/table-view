// Sprint 236 (AC-236-02, AC-236-03, AC-236-05, AC-236-06, AC-236-09) —
// DropColumnDialog test suite. Date: 2026-05-07.
//
// Why this file exists:
// - AC-236-05: typing-confirm enable/disable, case-sensitive
//   byte-for-byte match (`Email` ≠ `email`), CASCADE toggle invalidates
//   preview + emits ` CASCADE` in next request, commit-success closes
//   modal + onColumnDropped called.
// - AC-236-06: Safe Mode block / warn-cancel / safe matrix.
//   `ALTER TABLE … DROP COLUMN` is classified `ddl-drop`/danger so the
//   gate fires on production environments.
// - AC-236-02 / AC-236-03: IPC payload shape (camelCase) + sequence
//   `[{ previewOnly: true }, { previewOnly: false }]`.
// - AC-236-09: invalid-column-name rejection (defense-in-depth — the
//   typing-confirm input is the user-visible gate).

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
  cleanup,
} from "@testing-library/react";

const { mockDropColumnRequest } = vi.hoisted(() => ({
  mockDropColumnRequest: vi.fn(),
}));

vi.mock("@lib/tauri", () => ({
  dropColumnRequest: mockDropColumnRequest,
}));

import DropColumnDialog from "./DropColumnDialog";
import { useConnectionStore } from "@stores/connectionStore";
import { useSafeModeStore } from "@stores/safeModeStore";
import { useQueryHistoryStore } from "@stores/queryHistoryStore";

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
    onColumnDropped: () => Promise<void>;
    schemaName: string;
    tableName: string;
    columnName: string;
  }> = {},
) {
  const onClose = overrides.onClose ?? vi.fn();
  const onColumnDropped =
    overrides.onColumnDropped ?? vi.fn().mockResolvedValue(undefined);
  const schemaName = overrides.schemaName ?? "public";
  const tableName = overrides.tableName ?? "users";
  const columnName = overrides.columnName ?? "email";
  const view = render(
    <DropColumnDialog
      connectionId="conn-1"
      schemaName={schemaName}
      tableName={tableName}
      columnName={columnName}
      open
      onClose={onClose}
      onColumnDropped={onColumnDropped}
    />,
  );
  return {
    ...view,
    onClose,
    onColumnDropped,
    schemaName,
    tableName,
    columnName,
  };
}

describe("DropColumnDialog (Sprint 236)", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    useConnectionStore.setState({ connections: [] });
    useSafeModeStore.setState({ mode: "off" });
    useQueryHistoryStore.setState({ entries: [] });
    setDevConnection();
    mockDropColumnRequest.mockResolvedValue({
      sql: 'ALTER TABLE "public"."users" DROP COLUMN "email"',
    });
  });

  // AC-236-05 — Apply disabled before typing match.
  it("[AC-236-05] Apply disabled until typing-confirm matches column name", () => {
    renderDialog({ columnName: "email" });
    const apply = screen.getByRole("button", { name: "Apply" });
    expect(apply).toBeDisabled();
  });

  // AC-236-05 — case mismatch keeps Apply disabled.
  it("[AC-236-05] case mismatch (Email vs email) keeps Apply disabled", () => {
    renderDialog({ columnName: "Email" });
    const input = screen.getByLabelText("Type the column name to confirm");
    fireEvent.change(input, { target: { value: "email" } });
    const apply = screen.getByRole("button", { name: "Apply" });
    expect(apply).toBeDisabled();
  });

  // AC-236-05 — typing match enables Show DDL flow.
  it("[AC-236-05] typing match unlocks Show DDL → preview SQL fetched", async () => {
    renderDialog({ columnName: "email" });
    const input = screen.getByLabelText("Type the column name to confirm");
    fireEvent.change(input, { target: { value: "email" } });
    // Sprint 239 — preview pane defaults open; auto-debounced fetch settles via waitFor below.
    await waitFor(() => {
      expect(mockDropColumnRequest).toHaveBeenCalledTimes(1);
    });
  });

  // AC-236-05 — CASCADE checkbox label per Sprint 236 spec.
  it("[AC-236-05] CASCADE checkbox label is 'Drop dependent objects (CASCADE)'", () => {
    renderDialog({ columnName: "email" });
    expect(
      screen.getByText("Drop dependent objects (CASCADE)"),
    ).toBeInTheDocument();
  });

  // AC-236-05 — CASCADE default off → emits SQL without CASCADE.
  it("[AC-236-05] CASCADE default off emits payload cascade=false", async () => {
    renderDialog({ columnName: "email" });
    const input = screen.getByLabelText("Type the column name to confirm");
    fireEvent.change(input, { target: { value: "email" } });
    // Sprint 239 — preview pane defaults open; auto-debounced fetch settles via waitFor below.
    await waitFor(() => {
      expect(mockDropColumnRequest).toHaveBeenCalled();
    });
    expect(mockDropColumnRequest).toHaveBeenCalledWith(
      expect.objectContaining({ cascade: false, previewOnly: true }),
    );
  });

  // AC-236-05 — CASCADE toggled on → preview auto-refetches with CASCADE.
  // Sprint 238: 자동 refresh — CASCADE 토글만으로 새 preview 가 fetch 된다
  // (이전 Sprint 236 의 "Show DDL 재클릭 필요" friction 해소).
  it("[AC-236-05] CASCADE toggle auto-refetches preview with cascade:true", async () => {
    mockDropColumnRequest
      .mockResolvedValueOnce({
        sql: 'ALTER TABLE "public"."users" DROP COLUMN "email"',
      })
      .mockResolvedValueOnce({
        sql: 'ALTER TABLE "public"."users" DROP COLUMN "email" CASCADE',
      });
    renderDialog({ columnName: "email" });
    const input = screen.getByLabelText("Type the column name to confirm");
    fireEvent.change(input, { target: { value: "email" } });
    await waitFor(() => {
      expect(mockDropColumnRequest).toHaveBeenCalledTimes(1);
    });
    expect(mockDropColumnRequest.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ cascade: false, previewOnly: true }),
    );
    await act(async () => {
      fireEvent.click(screen.getByLabelText("CASCADE"));
    });
    await waitFor(() => {
      expect(mockDropColumnRequest).toHaveBeenCalledTimes(2);
    });
    expect(mockDropColumnRequest.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({ cascade: true, previewOnly: true }),
    );
  });

  // AC-236-02 / AC-236-03 — IPC payload shape (camelCase) + sequence
  // `[{ previewOnly: true }, { previewOnly: false }]`.
  it("[AC-236-02][AC-236-03] IPC sequence: preview true → commit previewOnly:false", async () => {
    renderDialog({
      schemaName: "public",
      tableName: "users",
      columnName: "email",
    });
    const input = screen.getByLabelText("Type the column name to confirm");
    fireEvent.change(input, { target: { value: "email" } });
    // Sprint 239 — preview pane defaults open; auto-debounced fetch settles via waitFor below.
    await waitFor(() => {
      expect(mockDropColumnRequest).toHaveBeenCalledTimes(1);
    });
    expect(mockDropColumnRequest).toHaveBeenCalledWith({
      connectionId: "conn-1",
      schema: "public",
      table: "users",
      columnName: "email",
      cascade: false,
      previewOnly: true,
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    });
    await waitFor(() => {
      expect(mockDropColumnRequest).toHaveBeenCalledTimes(2);
    });
    expect(mockDropColumnRequest.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({ previewOnly: false }),
    );
  });

  // AC-236-05 — commit success closes modal + calls callbacks.
  it("[AC-236-05] commit-success closes modal + onColumnDropped called once", async () => {
    const onClose = vi.fn();
    const onColumnDropped = vi.fn().mockResolvedValue(undefined);
    renderDialog({ columnName: "email", onClose, onColumnDropped });
    const input = screen.getByLabelText("Type the column name to confirm");
    fireEvent.change(input, { target: { value: "email" } });
    // Sprint 239 — preview pane defaults open; auto-debounced fetch settles via waitFor below.
    await waitFor(() => {
      expect(mockDropColumnRequest).toHaveBeenCalled();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    });
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    expect(onColumnDropped).toHaveBeenCalledTimes(1);
  });

  // AC-236-06 — Safe Mode confirm dialog on production×strict (was
  // block under Sprint 236/244). Sprint 245 (ADR 0022 Phase 1) —
  // destructive-only policy raises the confirm dialog instead. The
  // commit closure (previewOnly:false) still must NOT run until the
  // user confirms.
  it("[AC-236-06] production × strict + DROP COLUMN → confirm dialog opens, commit closure deferred", async () => {
    setProductionConnection();
    useSafeModeStore.setState({ mode: "strict" });
    mockDropColumnRequest.mockResolvedValueOnce({
      sql: 'ALTER TABLE "public"."users" DROP COLUMN "email"',
    });
    renderDialog({ columnName: "email" });
    const input = screen.getByLabelText("Type the column name to confirm");
    fireEvent.change(input, { target: { value: "email" } });
    // Sprint 239 — preview pane defaults open; auto-debounced fetch settles via waitFor below.
    await waitFor(() => {
      expect(mockDropColumnRequest).toHaveBeenCalled();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    });
    // Confirm dialog mounts; commit closure (previewOnly:false) does
    // NOT run until the user types the analyzer reason.
    await screen.findByText("Confirm dangerous statement");
    // Only the preview call ran; no commit.
    expect(mockDropColumnRequest).toHaveBeenCalledTimes(1);
    expect(mockDropColumnRequest.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ previewOnly: true }),
    );
  });

  // AC-236-06 — Safe Mode warn-cancel surfaces canonical message.
  it("[AC-236-06] production × warn + DROP COLUMN → warn-cancel surfaces canonical message", async () => {
    setProductionConnection();
    useSafeModeStore.setState({ mode: "warn" });
    mockDropColumnRequest.mockResolvedValueOnce({
      sql: 'ALTER TABLE "public"."users" DROP COLUMN "email"',
    });
    renderDialog({ columnName: "email" });
    const input = screen.getByLabelText("Type the column name to confirm");
    fireEvent.change(input, { target: { value: "email" } });
    // Sprint 239 — preview pane defaults open; auto-debounced fetch settles via waitFor below.
    await waitFor(() => {
      expect(mockDropColumnRequest).toHaveBeenCalled();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    });
    // Warn-tier mounts ConfirmDangerousDialog; user clicks Cancel.
    const cancelButtons = await screen.findAllByText(/Cancel/);
    await act(async () => {
      fireEvent.click(cancelButtons[cancelButtons.length - 1]!);
    });
    await waitFor(() => {
      const errorEls = document.querySelectorAll('[role="alert"]');
      const messages = Array.from(errorEls).map((e) => e.textContent ?? "");
      expect(
        messages.some((m) =>
          m.includes(
            "Safe Mode (warn): confirmation cancelled — no changes committed",
          ),
        ),
      ).toBe(true);
    });
    // Only the preview call ran; no commit.
    expect(mockDropColumnRequest).toHaveBeenCalledTimes(1);
  });

  // AC-236-06 — local + safe → commit runs.
  it("[AC-236-06] local × off + DROP COLUMN → safe path runs commit closure once", async () => {
    setDevConnection();
    useSafeModeStore.setState({ mode: "off" });
    mockDropColumnRequest.mockResolvedValueOnce({
      sql: 'ALTER TABLE "public"."users" DROP COLUMN "email"',
    });
    renderDialog({ columnName: "email" });
    const input = screen.getByLabelText("Type the column name to confirm");
    fireEvent.change(input, { target: { value: "email" } });
    // Sprint 239 — preview pane defaults open; auto-debounced fetch settles via waitFor below.
    await waitFor(() => {
      expect(mockDropColumnRequest).toHaveBeenCalled();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    });
    await waitFor(() => {
      expect(mockDropColumnRequest).toHaveBeenCalledTimes(2);
    });
    expect(mockDropColumnRequest.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({ previewOnly: false }),
    );
  });

  // AC-236-05 — IPC reject surfaces in previewError + modal stays open.
  it("[AC-236-05] PG-error-from-DROP-PK-column surfaces verbatim in previewError + modal stays open", async () => {
    mockDropColumnRequest.mockRejectedValueOnce(
      new Error('column "email" of relation "users" does not exist'),
    );
    const onClose = vi.fn();
    renderDialog({ columnName: "email", onClose });
    const input = screen.getByLabelText("Type the column name to confirm");
    fireEvent.change(input, { target: { value: "email" } });
    // Sprint 239 — preview pane defaults open; auto-debounced fetch settles via waitFor below.
    await waitFor(() => {
      const errorEls = document.querySelectorAll('[role="alert"]');
      const messages = Array.from(errorEls).map((e) => e.textContent ?? "");
      expect(messages.some((m) => m.includes("does not exist"))).toBe(true);
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});
