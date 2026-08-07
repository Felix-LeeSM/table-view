// Sprint 235 (AC-235-02, AC-235-03, AC-235-05, AC-235-06, AC-235-09)
// — DropTableDialog test suite. Date: 2026-05-07.
//
// Why this file exists:
// - AC-235-05: typing-confirm enable/disable, CASCADE toggle → debounced
//   preview re-fetch with no `Show DDL` click in between (Sprint 238),
//   CASCADE checked emits SQL with `... CASCADE`, case-sensitive typing
//   match (`Users` ≠ `users`), Apply disabled before typing match.
// - AC-235-06: Safe Mode confirm / warn-cancel / safe matrix (Sprint 245
//   retired the block tier — see the case at "production × strict").
//   `DROP TABLE` is classified `ddl-drop`/danger so the gate fires on
//   production environments.
// - AC-235-02 / AC-235-03: IPC payload shape (camelCase) + call sequence
//   `[{ previewOnly: true }, { previewOnly: false }]`.
// - AC-235-09: invalid-table-name rejection (defense-in-depth — typing-
//   confirm is the user-visible gate).
// - Issue #2191: the preview gate and the execution gate are separate.
//   The DROP SQL renders before the typing-confirm input matches; the
//   typing-confirm input still owns whether the DROP may run.
//
// Mock pattern: `vi.hoisted` for `@lib/tauri.dropTableRequest`,
// `tauri.dropTable` (compat), and `tauri.listTables` (Sprint 223
// reload path).

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";

const { mockDropTableRequest, mockDropTable, mockListTables } = vi.hoisted(
  () => ({
    mockDropTableRequest: vi.fn(),
    mockDropTable: vi.fn().mockResolvedValue(undefined),
    mockListTables: vi.fn().mockResolvedValue([]),
  }),
);
beforeEach(() => {
  setupTauriMock({
    dropTableRequest: mockDropTableRequest,
    dropTable: mockDropTable,
    listTables: mockListTables,
    // Sprint 247 — `<DryRunPreview>` IPC stub for confirm dialog.
    executeQueryDryRun: vi.fn(() => Promise.resolve([])),
    cancelQuery: vi.fn(() => Promise.resolve("cancelled")),
  });
});

import { useConnectionStore } from "@stores/connectionStore";
import { useQueryHistoryStore } from "@stores/queryHistoryStore";
import { useSafeModeStore } from "@stores/safeModeStore";
import { useSchemaStore } from "@stores/schemaStore";
import {
  SCHEMA_GRAPH_IMPACT_SESSION_FK,
  seedSchemaGraphMigrationImpactFixture,
} from "@/test-utils/schemaGraphImpactFixture";
import {
  findPreviewSql,
  reactOnClick,
} from "./__tests__/dropDialogGateHelpers";
import DropTableDialog from "./DropTableDialog";

const DROP_USERS_SQL = 'DROP TABLE "public"."users"';

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
    useQueryHistoryStore.setState({ recentVisible: [] });
    useSchemaStore.setState({
      schemas: {},
      tables: {},
      tableColumnsCache: {},
      tableIndexesCache: {},
      tableConstraintsCache: {},
    });
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

  // Issue #2191 — preview gate. The user reads the exact DROP statement
  // first and confirms afterwards, so nothing gates the preview fetch.
  it("[#2191] renders the DROP SQL before the typing-confirm input is touched", async () => {
    renderDialog({ tableName: "users" });

    expect(screen.getByLabelText("Type the table name to confirm")).toHaveValue(
      "",
    );
    expect(await findPreviewSql(DROP_USERS_SQL)).toBeInTheDocument();
    expect(mockDropTableRequest).toHaveBeenCalledWith(
      expect.objectContaining({ previewOnly: true }),
    );
  });

  // Issue #2191 — execution gate. Showing the SQL must not move the Apply
  // gate; the typing-confirm input still owns it.
  it("[#2191] keeps Apply disabled while the DROP SQL is on screen and the input is untouched", async () => {
    renderDialog({ tableName: "users" });
    await findPreviewSql(DROP_USERS_SQL);

    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
  });

  // Issue #2191 — the execution gate is checked in the click handler too,
  // not only in the button's `disabled` binding. `previewSql` no longer
  // proves the user confirmed, so it cannot be the thing that admits a
  // commit.
  it("[#2191] clicking Apply before the typing match sends no commit request", async () => {
    renderDialog({ tableName: "users" });
    await findPreviewSql(DROP_USERS_SQL);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    });

    expect(mockDropTableRequest).toHaveBeenCalledTimes(1);
    expect(mockDropTable).not.toHaveBeenCalled();
  });

  // Issue #2191 — second layer, on its own. A DOM click only ever proves
  // the first layer (`disabled`), since React never routes it to the
  // handler. Reaching the handler directly is what pins the `!canApply`
  // guard: delete that one line and this case is the only one that reddens.
  it("[#2191] the Apply handler refuses to commit when the click reaches it anyway", async () => {
    renderDialog({ tableName: "users" });
    await findPreviewSql(DROP_USERS_SQL);

    const apply = screen.getByRole("button", { name: "Apply" });
    await act(async () => {
      await reactOnClick(apply)();
    });

    expect(mockDropTableRequest).toHaveBeenCalledTimes(1);
    expect(mockDropTable).not.toHaveBeenCalled();
  });

  // AC-235-05 (issue #2191) — typing no longer drives the preview. It is
  // already on screen, and matching the table name only flips Apply.
  it("[AC-235-05][#2191] typing the table name enables Apply without re-fetching the preview", async () => {
    renderDialog({ tableName: "users" });
    await findPreviewSql(DROP_USERS_SQL);
    expect(mockDropTableRequest).toHaveBeenCalledTimes(1);

    const input = screen.getByLabelText("Type the table name to confirm");
    fireEvent.change(input, { target: { value: "users" } });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Apply" })).toBeEnabled();
    });
    expect(mockDropTableRequest).toHaveBeenCalledTimes(1);
  });

  it("shows cached SchemaGraph migration impact in the DDL preview", () => {
    seedSchemaGraphMigrationImpactFixture();
    renderDialog({ tableName: "users" });

    expect(screen.getByText("Migration impact")).toBeInTheDocument();
    expect(screen.getByText("public.sessions")).toBeInTheDocument();
    expect(
      screen.getByText(SCHEMA_GRAPH_IMPACT_SESSION_FK),
    ).toBeInTheDocument();
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
    // 자동 fetch (cascade:false) 는 다이얼로그가 열릴 때 debounce 후 한 번
    // 난다 — 타이핑과 무관하다 (이슈 #2191).
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
    // Sprint 271c — `expectedDatabase` last-positional propagated.
    expect(mockDropTable).toHaveBeenCalledWith(
      "conn-1",
      "users",
      "public",
      "db-1",
    );
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
      // Sprint 271c — opt-in DbMismatch guard forwards workspace db.
      expectedDatabase: "db-1",
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
    // Sprint 271c — `expectedDatabase` last-positional propagated.
    expect(mockDropTable).toHaveBeenCalledWith(
      "conn-1",
      "users",
      "public",
      "db-1",
    );
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
    // does NOT run until the user answers it. Sprint 246 replaced the
    // earlier type-to-confirm gate with the single-click Yes/No dialog —
    // `ConfirmDestructiveDialog` has no text input.
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
