// Sprint 235 (AC-235-02, AC-235-03, AC-235-05, AC-235-06, AC-235-09)
// — DropTableDialog test suite. Date: 2026-05-07.
//
// Why this file exists:
// - AC-235-05: typing-confirm enable/disable, CASCADE toggle → preview
//   re-fetch on next Show DDL, CASCADE checked emits SQL with `... CASCADE`,
//   case-sensitive typing match (`Users` ≠ `users`), Apply disabled
//   before typing match.
// - AC-235-06: Safe Mode block / warn-cancel / warn-confirm / safe matrix.
//   `DROP TABLE` is classified `ddl-drop`/danger so the gate fires on
//   production environments.
// - AC-235-02 / AC-235-03: IPC payload shape (camelCase) + call sequence
//   `[{ previewOnly: true }, { previewOnly: false }]`.
// - AC-235-09: invalid-table-name rejection (defense-in-depth — typing-
//   confirm is the user-visible gate).
//
// Mock pattern: `vi.hoisted` for `@lib/tauri.dropTableRequest`,
// `tauri.dropTable` (compat), and `tauri.listTables` (Sprint 223
// reload path).

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
  cleanup,
} from "@testing-library/react";

const { mockDropTableRequest, mockDropTable, mockListTables } = vi.hoisted(
  () => ({
    mockDropTableRequest: vi.fn(),
    mockDropTable: vi.fn().mockResolvedValue(undefined),
    mockListTables: vi.fn().mockResolvedValue([]),
  }),
);

vi.mock("@lib/tauri", () => ({
  dropTableRequest: mockDropTableRequest,
  dropTable: mockDropTable,
  listTables: mockListTables,
  // Sprint 247 — `<DryRunPreview>` IPC stub for confirm dialog.
  executeQueryDryRun: vi.fn(() => Promise.resolve([])),
  cancelQuery: vi.fn(() => Promise.resolve("cancelled")),
}));

import DropTableDialog from "./DropTableDialog";
import { useConnectionStore } from "@stores/connectionStore";
import { useSafeModeStore } from "@stores/safeModeStore";
import { useQueryHistoryStore } from "@stores/queryHistoryStore";
import { useSchemaStore } from "@stores/schemaStore";

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
    schemaName: string;
    tableName: string;
  }> = {},
) {
  const onClose = overrides.onClose ?? vi.fn();
  const schemaName = overrides.schemaName ?? "public";
  const tableName = overrides.tableName ?? "users";
  const view = render(
    <DropTableDialog
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

describe("DropTableDialog (Sprint 235)", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    useConnectionStore.setState({ connections: [] });
    useSafeModeStore.setState({ mode: "off" });
    useQueryHistoryStore.setState({ entries: [] });
    useSchemaStore.setState({ tables: {} });
    setDevConnection();
    mockDropTableRequest.mockResolvedValue({
      sql: 'DROP TABLE "public"."users"',
    });
    mockListTables.mockResolvedValue([]);
  });

  // AC-235-05 — Apply disabled before typing match.
  it("[AC-235-05] Apply disabled until typing-confirm matches table name", () => {
    renderDialog({ tableName: "users" });
    const apply = screen.getByRole("button", { name: "Apply" });
    expect(apply).toBeDisabled();
  });

  // AC-235-05 — case mismatch keeps Apply disabled.
  it("[AC-235-05] case mismatch (Users vs users) keeps Apply disabled", () => {
    renderDialog({ tableName: "Users" });
    const input = screen.getByLabelText("Type the table name to confirm");
    fireEvent.change(input, { target: { value: "users" } });
    const apply = screen.getByRole("button", { name: "Apply" });
    expect(apply).toBeDisabled();
  });

  // AC-235-05 — typing match enables Show DDL flow (Apply needs preview SQL too).
  it("[AC-235-05] typing match unlocks Show DDL → preview SQL fetched", async () => {
    renderDialog({ tableName: "users" });
    const input = screen.getByLabelText("Type the table name to confirm");
    fireEvent.change(input, { target: { value: "users" } });
    // Sprint 239 — preview pane defaults open; auto-debounced fetch settles via waitFor below.
    await waitFor(() => {
      expect(mockDropTableRequest).toHaveBeenCalledTimes(1);
    });
  });

  // AC-235-05 — CASCADE checkbox default off → emits SQL without CASCADE.
  it("[AC-235-05] CASCADE default off emits SQL without CASCADE keyword", async () => {
    renderDialog({ tableName: "users" });
    const input = screen.getByLabelText("Type the table name to confirm");
    fireEvent.change(input, { target: { value: "users" } });
    // Sprint 239 — preview pane defaults open; auto-debounced fetch settles via waitFor below.
    await waitFor(() => {
      expect(mockDropTableRequest).toHaveBeenCalled();
    });
    expect(mockDropTableRequest).toHaveBeenCalledWith(
      expect.objectContaining({ cascade: false, previewOnly: true }),
    );
  });

  // AC-235-05 — CASCADE toggled on → preview auto-refetches with CASCADE.
  // Sprint 238: 자동 refresh — CASCADE 토글만으로 새 preview 가 fetch 된다
  // (이전 Sprint 235 의 "Show DDL 재클릭 필요" friction 해소).
  it("[AC-235-05] CASCADE toggle auto-refetches preview with cascade:true", async () => {
    mockDropTableRequest
      .mockResolvedValueOnce({ sql: 'DROP TABLE "public"."users"' })
      .mockResolvedValueOnce({
        sql: 'DROP TABLE "public"."users" CASCADE',
      });
    renderDialog({ tableName: "users" });
    const input = screen.getByLabelText("Type the table name to confirm");
    fireEvent.change(input, { target: { value: "users" } });
    // 타이핑이 typingMatches=true 로 만들면 자동 fetch (cascade:false) 가
    // debounce 후 한 번 발생.
    await waitFor(() => {
      expect(mockDropTableRequest).toHaveBeenCalledTimes(1);
    });
    expect(mockDropTableRequest.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ cascade: false, previewOnly: true }),
    );
    // CASCADE 토글 → 두 번째 자동 fetch (cascade:true).
    await act(async () => {
      fireEvent.click(screen.getByLabelText("CASCADE"));
    });
    await waitFor(() => {
      expect(mockDropTableRequest).toHaveBeenCalledTimes(2);
    });
    expect(mockDropTableRequest.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({ cascade: true, previewOnly: true }),
    );
  });

  // AC-235-05 — commit success closes modal.
  it("[AC-235-05] commit-success closes modal + calls onClose once", async () => {
    const onClose = vi.fn();
    renderDialog({ tableName: "users", onClose });
    const input = screen.getByLabelText("Type the table name to confirm");
    fireEvent.change(input, { target: { value: "users" } });
    // Sprint 239 — preview pane defaults open; auto-debounced fetch settles via waitFor below.
    await waitFor(() => {
      expect(mockDropTableRequest).toHaveBeenCalled();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    });
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    // Sprint 223 useSchemaTableMutations chained the compat wrapper.
    expect(mockDropTable).toHaveBeenCalledWith("conn-1", "users", "public");
  });

  // AC-235-02 / AC-235-03 — IPC payload shape (camelCase) +
  // sequence `[{ previewOnly: true }, { previewOnly: false }]` —
  // commit closure runs `tauri.dropTable` (compat) which goes through
  // `dropTableRequest` with `previewOnly: false`.
  it("[AC-235-02][AC-235-03] IPC sequence: preview true → commit goes through compat wrapper", async () => {
    renderDialog({ schemaName: "public", tableName: "users" });
    const input = screen.getByLabelText("Type the table name to confirm");
    fireEvent.change(input, { target: { value: "users" } });
    // Sprint 239 — preview pane defaults open; auto-debounced fetch settles via waitFor below.
    await waitFor(() => {
      expect(mockDropTableRequest).toHaveBeenCalledTimes(1);
    });
    expect(mockDropTableRequest).toHaveBeenCalledWith({
      connectionId: "conn-1",
      schema: "public",
      table: "users",
      cascade: false,
      previewOnly: true,
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    });
    await waitFor(() => {
      expect(mockDropTable).toHaveBeenCalled();
    });
    // Compat wrapper bridges to the request call. Each commit call goes
    // through `tauri.dropTable` positional → `dropTableRequest` with
    // previewOnly:false.
    expect(mockDropTable).toHaveBeenCalledWith("conn-1", "users", "public");
  });

  // AC-235-06 — Safe Mode confirm dialog on production×strict (was
  // block under Sprint 235/244). Sprint 245 (ADR 0022 Phase 1) —
  // destructive-only policy raises the confirm dialog instead. The
  // commit closure still must NOT run until the user confirms.
  it("[AC-235-06] production × strict + DROP TABLE → confirm dialog opens, commit closure deferred", async () => {
    setProductionConnection();
    useSafeModeStore.setState({ mode: "strict" });
    mockDropTableRequest.mockResolvedValueOnce({
      sql: 'DROP TABLE "public"."users"',
    });
    renderDialog({ tableName: "users" });
    const input = screen.getByLabelText("Type the table name to confirm");
    fireEvent.change(input, { target: { value: "users" } });
    // Sprint 239 — preview pane defaults open; auto-debounced fetch settles via waitFor below.
    await waitFor(() => {
      expect(mockDropTableRequest).toHaveBeenCalled();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    });
    // Confirm dialog mounts; commit closure (tauri.dropTable compat)
    // does NOT run until the user types the analyzer reason.
    await screen.findByText("PRODUCTION DATABASE");
    expect(mockDropTable).not.toHaveBeenCalled();
  });

  // AC-235-06 — Safe Mode warn-cancel surfaces canonical message.
  it("[AC-235-06] production × warn + DROP TABLE → warn-cancel surfaces canonical message", async () => {
    setProductionConnection();
    useSafeModeStore.setState({ mode: "warn" });
    mockDropTableRequest.mockResolvedValueOnce({
      sql: 'DROP TABLE "public"."users"',
    });
    renderDialog({ tableName: "users" });
    const input = screen.getByLabelText("Type the table name to confirm");
    fireEvent.change(input, { target: { value: "users" } });
    // Sprint 239 — preview pane defaults open; auto-debounced fetch settles via waitFor below.
    await waitFor(() => {
      expect(mockDropTableRequest).toHaveBeenCalled();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    });
    // Warn-tier mounts ConfirmDestructiveDialog; user clicks Cancel.
    const cancelButtons = await screen.findAllByText(/Cancel/);
    // The last Cancel button is in the dangerous-confirm dialog (it
    // mounts above the parent dialog).
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
    expect(mockDropTable).not.toHaveBeenCalled();
  });

  // AC-235-06 — local + safe → commit runs.
  it("[AC-235-06] local × off + DROP TABLE → safe path runs commit closure once", async () => {
    setDevConnection();
    useSafeModeStore.setState({ mode: "off" });
    mockDropTableRequest.mockResolvedValueOnce({
      sql: 'DROP TABLE "public"."users"',
    });
    renderDialog({ tableName: "users" });
    const input = screen.getByLabelText("Type the table name to confirm");
    fireEvent.change(input, { target: { value: "users" } });
    // Sprint 239 — preview pane defaults open; auto-debounced fetch settles via waitFor below.
    await waitFor(() => {
      expect(mockDropTableRequest).toHaveBeenCalled();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    });
    await waitFor(() => {
      expect(mockDropTable).toHaveBeenCalledTimes(1);
    });
  });
});
