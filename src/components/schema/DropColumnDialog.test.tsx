// Sprint 236 (AC-236-02, AC-236-03, AC-236-05, AC-236-06, AC-236-09) —
// DropColumnDialog test suite. Date: 2026-05-07.
//
// Why this file exists:
// - AC-236-05: typing-confirm enable/disable, case-sensitive
//   byte-for-byte match (`Email` ≠ `email`), CASCADE toggle invalidates
//   preview + emits ` CASCADE` in next request, commit-success closes
//   modal + onColumnDropped called.
// - AC-236-06: Safe Mode confirm / warn-cancel / safe matrix (Sprint 245
//   retired the block tier — see the case at "production × strict").
//   `ALTER TABLE … DROP COLUMN` is classified `ddl-drop`/danger so the
//   gate fires on production environments.
// - AC-236-02 / AC-236-03: IPC payload shape (camelCase) + sequence
//   `[{ previewOnly: true }, { previewOnly: false }]`.
// - AC-236-09: invalid-column-name rejection (defense-in-depth — the
//   typing-confirm input is the user-visible gate).
// - Issue #2157: the preview gate and the execution gate are separate.
//   The DROP SQL renders before the typing-confirm input matches; the
//   typing-confirm input still owns whether the DROP may run.

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

const { mockDropColumnRequest } = vi.hoisted(() => ({
  mockDropColumnRequest: vi.fn(),
}));
beforeEach(() => {
  setupTauriMock({
    dropColumnRequest: mockDropColumnRequest,
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
  SCHEMA_GRAPH_IMPACT_DB,
  SCHEMA_GRAPH_IMPACT_SESSION_FK,
  seedSchemaGraphMigrationImpactFixture,
} from "@/test-utils/schemaGraphImpactFixture";
import {
  findPreviewSql,
  reactOnClick,
} from "./__tests__/dropDialogGateHelpers";
import DropColumnDialog from "./DropColumnDialog";

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
    onColumnDropped: () => Promise<void>;
    schemaName: string;
    tableName: string;
    columnName: string;
    database: string;
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
      database={overrides.database}
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

const DROP_EMAIL_SQL = 'ALTER TABLE "public"."users" DROP COLUMN "email"';

describe("DropColumnDialog (Sprint 236)", () => {
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

  // Issue #2157 — preview gate. The user reads the exact DROP statement
  // first and confirms afterwards, so nothing gates the preview fetch.
  it("[#2157] renders the DROP SQL before the typing-confirm input is touched", async () => {
    renderDialog({ columnName: "email" });

    expect(
      screen.getByLabelText("Type the column name to confirm"),
    ).toHaveValue("");
    expect(await findPreviewSql(DROP_EMAIL_SQL)).toBeInTheDocument();
    expect(mockDropColumnRequest).toHaveBeenCalledWith(
      expect.objectContaining({ previewOnly: true }),
    );
  });

  // Issue #2157 — execution gate. Showing the SQL must not move the Apply
  // gate; the typing-confirm input still owns it.
  it("[#2157] keeps Apply disabled while the DROP SQL is on screen and the input is untouched", async () => {
    renderDialog({ columnName: "email" });
    await findPreviewSql(DROP_EMAIL_SQL);

    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
  });

  // Issue #2157 — the execution gate is checked in the click handler too,
  // not only in the button's `disabled` binding. `previewSql` no longer
  // proves the user confirmed, so it cannot be the thing that admits a
  // commit.
  it("[#2157] clicking Apply before the typing match sends no commit request", async () => {
    renderDialog({ columnName: "email" });
    await findPreviewSql(DROP_EMAIL_SQL);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    });

    expect(mockDropColumnRequest).toHaveBeenCalledTimes(1);
    expect(mockDropColumnRequest).not.toHaveBeenCalledWith(
      expect.objectContaining({ previewOnly: false }),
      expect.anything(),
    );
  });

  // Issue #2157 — second layer, on its own. A DOM click only ever proves
  // the first layer (`disabled`), since React never routes it to the
  // handler. Reaching the handler directly is what pins the `!canApply`
  // guard: delete that one line and this case is the only one that reddens.
  it("[#2157] the Apply handler refuses to commit when the click reaches it anyway", async () => {
    renderDialog({ columnName: "email" });
    await findPreviewSql(DROP_EMAIL_SQL);

    const apply = screen.getByRole("button", { name: "Apply" });
    await act(async () => {
      await reactOnClick(apply)();
    });

    expect(mockDropColumnRequest).toHaveBeenCalledTimes(1);
    expect(mockDropColumnRequest).not.toHaveBeenCalledWith(
      expect.objectContaining({ previewOnly: false }),
      expect.anything(),
    );
  });

  // AC-236-05 (issue #2157) — typing no longer drives the preview. It is
  // already on screen, and matching the column name only flips Apply.
  it("[AC-236-05][#2157] typing the column name enables Apply without re-fetching the preview", async () => {
    renderDialog({ columnName: "email" });
    await findPreviewSql(DROP_EMAIL_SQL);
    expect(mockDropColumnRequest).toHaveBeenCalledTimes(1);

    const input = screen.getByLabelText("Type the column name to confirm");
    fireEvent.change(input, { target: { value: "email" } });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Apply" })).toBeEnabled();
    });
    expect(mockDropColumnRequest).toHaveBeenCalledTimes(1);
  });

  // AC-236-05 — CASCADE checkbox label per Sprint 236 spec.
  it("[AC-236-05] CASCADE checkbox label is 'Drop dependent objects (CASCADE)'", () => {
    renderDialog({ columnName: "email" });
    expect(
      screen.getByText("Drop dependent objects (CASCADE)"),
    ).toBeInTheDocument();
  });

  it("shows cached SchemaGraph migration impact in the DDL preview", () => {
    seedSchemaGraphMigrationImpactFixture();
    renderDialog({ columnName: "email", database: SCHEMA_GRAPH_IMPACT_DB });

    expect(screen.getByText("Migration impact")).toBeInTheDocument();
    expect(screen.getByText("public.sessions.user_email")).toBeInTheDocument();
    expect(
      screen.getByText(SCHEMA_GRAPH_IMPACT_SESSION_FK),
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
    await screen.findByText("PRODUCTION DATABASE");
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
    // Warn-tier mounts ConfirmDestructiveDialog; user clicks Cancel.
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
